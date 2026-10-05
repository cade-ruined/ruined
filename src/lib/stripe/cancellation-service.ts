import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type Stripe from "stripe";
import { getBillingDatabase } from "@/lib/stripe/database";
import { getMemberBillingCommitment } from "@/lib/stripe/commitment-account";
import { getStripe, isStripeTaxEnabled } from "@/lib/stripe/server";
import { readCommitmentProviderEvidence, readPrestartCancellationEvidence, readPrepaidCancellationEvidence, stripeObjectId, verifyCommitmentSubscription } from "@/lib/stripe/cancellation-provider";
import { MembershipCommitmentError, quoteMembershipCancellation, quoteMembershipRenewalCancellation, quoteMembershipPrestartCancellation, quoteMembershipPrepaidCancellation, quoteMembershipMissedCohortCancellation,
  type MembershipCancellationIntent, type MembershipCancellationQuote, type MembershipCommitment } from "@/lib/stripe/commitment-policy";
import { completeMembershipCancellation, confirmMembershipBillingStopped, fenceMembershipReplacementInvoice,
  getMembershipCancellation, getMembershipCommitment, markMembershipCancellationNeedsReview,
  recordCommitmentReconciliation, reserveMembershipCancellation, fenceMembershipPrepaidRefund, recordMembershipPrepaidRefundEvidence,
  type MembershipCancellationRecord, type CommitmentPrepaidRefundEvidence } from "@/lib/stripe/commitment-repository";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
const requestOptions = { timeout: 8_000, maxNetworkRetries: 0 };
type StoredQuote = { id: string; quote: MembershipCancellationQuote; evidence: string | null; taxCode: string | null;
  taxEnabled: boolean; feeTotal: number };

export type PublicCancellationQuote = { id: string; intent: MembershipCancellationIntent; effectiveAt: string;
  accessThrough: string | null; feeDues: number; feeTax: number; feeTotal: number; remainingInitialDues: number | null;
  initialTermEndsAt: string; expiresAt: string; refundAmount?: number };

function renewalSnapshot(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  return { subscriptionId: subscription.id, customerId: stripeObjectId(subscription.customer)!, livemode: subscription.livemode,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString()
      : subscription.cancel_at_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    status: subscription.status as "active" | "past_due" | "unpaid" | "canceled" | "trialing", observedAt: new Date().toISOString() };
}

export async function createMemberCancellationQuote(memberId: string, intent: MembershipCancellationIntent): Promise<PublicCancellationQuote> {
  const contract = await getMemberBillingCommitment(memberId);
  if (!contract) throw new MembershipCommitmentError("no_paid_commitment");
  const stripe = getStripe(), sql = getBillingDatabase();
  let quote: MembershipCancellationQuote, evidence: string | null = null;
  if (intent === "cancel_before_start") {
    if (contract.billingSchedule) {
      const provider = await readPrepaidCancellationEvidence(contract);
      quote = quoteMembershipPrepaidCancellation(contract, provider.snapshot);
    } else {
      const provider = await readPrestartCancellationEvidence(contract);
      quote = quoteMembershipPrestartCancellation(contract, provider.snapshot);
    }
  } else if (intent === "disable_renewal") {
    const subscription = await stripe.subscriptions.retrieve(contract.subscriptionId);
    verifyCommitmentSubscription(subscription, contract);
    quote = quoteMembershipRenewalCancellation(contract, renewalSnapshot(subscription));
  } else {
    const provider = await readCommitmentProviderEvidence(contract);
    evidence = provider.fingerprint;
    quote = await sql.begin(async tx => {
      // Lock before replacing monetary evidence. A second quote must not turn an
      // already confirmed execution into manual review or authorize another fee.
      const current = await getMembershipCommitment(tx, { memberId, subscriptionId: contract.subscriptionId, livemode: contract.livemode });
      if (!current || current.status !== "active") throw new MembershipCommitmentError("cancellation_in_progress");
      await recordCommitmentReconciliation(tx, { id: randomUUID(), contractId: contract.id, state: "complete",
        reconciledAt: new Date().toISOString(), invoices: provider.invoices, sourceEvidence: {
          subscriptionId: contract.subscriptionId, customerId: contract.customerId, livemode: contract.livemode,
          allInvoicePages: true, allRefundPages: true, allCreditNotePages: true, principalAllocation: "verified" } });
      const record = await getMembershipCommitment(tx, { memberId, subscriptionId: contract.subscriptionId, livemode: contract.livemode });
      return quoteMembershipCancellation(record!.contract, record!.ledger, "early_exit");
    });
  }
  const taxEnabled = isStripeTaxEnabled();
  let taxCode: string | null = null, feeTotal = quote.buyoutDues;
  if (quote.buyoutDues > 0) {
    // Fee classification is a separate explicit configuration; never inherit the store's goods code.
    taxCode = process.env.STRIPE_MEMBERSHIP_BUYOUT_TAX_CODE?.trim() || null;
    if (process.env.STRIPE_MEMBERSHIP_BUYOUT_READY !== "true" || taxEnabled && !taxCode) {
      throw new MembershipCommitmentError("early_exit_requires_review");
    }
    if (taxEnabled) {
      const calculation = await stripe.tax.calculations.create({ currency: "usd", customer: contract.customerId,
        line_items: [{ amount: quote.buyoutDues, reference: contract.id, tax_behavior: "exclusive", tax_code: taxCode! }] });
      feeTotal = calculation.amount_total;
    }
  }
  const id = randomUUID();
  await sql`insert into stripe_membership_cancellation_quotes
    (id,member_id,contract_id,quote,provider_evidence_sha256,fee_tax_code,fee_tax_enabled,fee_total,expires_at)
    values (${id}::uuid,${memberId}::uuid,${contract.id}::uuid,${sql.json(json(quote))}::jsonb,
      ${evidence},${taxCode},${taxEnabled},${feeTotal},${quote.expiresAt}::timestamptz)`;
  return { id, intent, effectiveAt: quote.effectiveAt, accessThrough: quote.accessThrough, feeDues: quote.buyoutDues,
    feeTax: feeTotal - quote.buyoutDues, feeTotal, remainingInitialDues: quote.remainingInitialDues,
    initialTermEndsAt: contract.initialTermEndsAt, expiresAt: quote.expiresAt,
    ...(quote.refundAmount !== undefined ? { refundAmount: quote.refundAmount } : {}) };
}

async function confirmPrepaidCancellation(contract: MembershipCommitment, cancellation: MembershipCancellationRecord) {
  const sql = getBillingDatabase(), stripe = getStripe(), payment = cancellation.quote.prepaidProviderSnapshot;
  if (!contract.billingSchedule || !payment || cancellation.quote.refundAmount !== payment.amount) {
    throw new MembershipCommitmentError("prepaid_cancellation_requires_review");
  }
  const read = () => readPrepaidCancellationEvidence(contract, { allowRefund: true, cancellationId: cancellation.id,
    ...(cancellation.quote.invalidEnrollmentReason ? { invalidEnrollmentReason: cancellation.quote.invalidEnrollmentReason } : {}) });
  const matches = (current: Awaited<ReturnType<typeof read>>) => {
    if (["invoiceId", "paymentIntentId", "chargeId", "amount", "currency"]
      .some(key => current.snapshot[key as keyof typeof payment] !== payment[key as keyof typeof payment])) {
      throw new MembershipCommitmentError("prepaid_refund_requires_review");
    }
  };
  if (cancellation.status === "requested") {
    const before = await read(); matches(before);
    if (before.subscription.status !== "canceled") {
      if (!cancellation.quote.invalidEnrollmentReason && Date.parse(contract.startsAt) - Date.now() <= requestOptions.timeout + 2_000) {
        throw new MembershipCommitmentError("prepaid_cancellation_requires_review");
      }
      await stripe.subscriptions.cancel(contract.subscriptionId, { invoice_now: false, prorate: false },
        { ...requestOptions, idempotencyKey: `${cancellation.providerIdempotencyKey}:cancel-before-start` });
    }
    const after = await read(); matches(after);
    const stopped = await sql.begin(tx => confirmMembershipBillingStopped(tx, cancellation.id, {
      subscriptionId: contract.subscriptionId, customerId: contract.customerId, livemode: contract.livemode,
      subscriptionStatus: after.subscription.status as "canceled", observedAt: after.snapshot.observedAt,
      canceledAt: after.snapshot.canceledAt, cancelAt: null, firstChargeAt: contract.startsAt,
      prepaidInvoiceId: payment.invoiceId, openOrdinaryInvoiceIds: [], pendingProrationOrInvoiceItems: false,
      ...(cancellation.quote.invalidEnrollmentReason ? { invalidEnrollmentReason: cancellation.quote.invalidEnrollmentReason } : {}),
    }));
    if (!stopped) throw new MembershipCommitmentError("cancellation_in_progress");
  }
  let current = await read(); matches(current);
  if (current.subscription.status !== "canceled" || !current.snapshot.canceledAt) {
    throw new MembershipCommitmentError("prepaid_cancellation_requires_review");
  }
  if (!current.refund) {
    const fence = await sql.begin(tx => fenceMembershipPrepaidRefund(tx, cancellation.id));
    if (!fence) throw new MembershipCommitmentError("prepaid_refund_requires_review");
    await stripe.refunds.create({ payment_intent: payment.paymentIntentId, amount: payment.amount,
      metadata: { ruined_context: "membership_prestart_refund", ruined_cancellation_id: cancellation.id,
        ruined_commitment_id: contract.id, ruined_invoice_id: payment.invoiceId } },
    { ...requestOptions, idempotencyKey: `${fence.providerIdempotencyKey}:prepaid-refund` });
    // Even a successful create response is not proof that funds were returned.
    current = await read(); matches(current);
  }
  const refund = current.refund;
  if (!refund) throw new Error("Prepaid refund readback is still pending.");
  const evidence: CommitmentPrepaidRefundEvidence = { id: refund.id,
    status: refund.status as CommitmentPrepaidRefundEvidence["status"], cancellationId: cancellation.id,
    invoiceId: payment.invoiceId, paymentIntentId: payment.paymentIntentId, chargeId: payment.chargeId,
    amount: refund.amount, currency: payment.currency, livemode: payment.livemode, observedAt: new Date().toISOString() };
  const { recordPrepaidMembershipRefund, getMembershipPrepayment } = await import("@/lib/stripe/billing-repository");
  await sql.begin(async tx => {
    // Match webhook writers: commercial eligibility, payment proof, commitment.
    // Never retain a contract lock while waiting for a webhook's commercial lock.
    await tx`select pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'))`;
    await getMembershipPrepayment(tx, { reservationId: contract.id });
    if (!await recordMembershipPrepaidRefundEvidence(tx, cancellation.id, evidence)) throw new MembershipCommitmentError("prepaid_refund_requires_review");
    if (evidence.status !== "requires_action") await recordPrepaidMembershipRefund(tx, {
      reservationId: contract.id, subscriptionId: contract.subscriptionId, cancellationId: cancellation.id,
      invoiceId: payment.invoiceId, paymentIntentId: payment.paymentIntentId, chargeId: payment.chargeId,
      refundId: refund.id, status: evidence.status, amount: refund.amount, currency: payment.currency,
      livemode: contract.livemode, canceledAt: current.snapshot.canceledAt!, verifiedAt: evidence.observedAt,
    });
    if (evidence.status === "succeeded" && !await completeMembershipCancellation(tx, { cancellationId: cancellation.id, replacementInvoiceId: null })) {
      throw new MembershipCommitmentError("cancellation_in_progress");
    }
  });
  if (!["pending", "succeeded"].includes(evidence.status)) throw new MembershipCommitmentError("prepaid_refund_requires_review");
  return { effectiveAt: cancellation.quote.effectiveAt, invoiceUrl: null,
    refundStatus: evidence.status as "pending" | "succeeded", refundAmount: payment.amount };
}

async function replacementInvoice(contract: MembershipCommitment, stored: StoredQuote) {
  const sql = getBillingDatabase(), stripe = getStripe();
  const fence = await sql.begin(tx => fenceMembershipReplacementInvoice(tx, stored.id));
  if (!fence) throw new MembershipCommitmentError("early_exit_requires_review");
  const metadata = { ruined_context: "membership_buyout", ruined_cancellation_id: stored.id,
    ruined_member_id: contract.memberId, ruined_commitment_id: contract.id };
  const invoice = await stripe.invoices.create({ customer: contract.customerId, currency: "usd", auto_advance: false,
    collection_method: "charge_automatically", pending_invoice_items_behavior: "exclude", discounts: "",
    automatic_tax: { enabled: stored.taxEnabled }, metadata,
    description: "Early membership exit. Replaces the remaining initial-term installments." },
  { ...requestOptions, idempotencyKey: `${fence.providerIdempotencyKey}:invoice` });
  // Every operation has its own stable key and never scoops up unrelated pending items.
  await stripe.invoiceItems.create({ customer: contract.customerId, invoice: invoice.id, currency: "usd",
    amount: fence.quote.buyoutDues, discountable: false, tax_behavior: "exclusive",
    ...(stored.taxCode ? { tax_code: stored.taxCode } : {}), metadata,
    description: "Early membership exit — replaces remaining initial-term installments" },
  { ...requestOptions, idempotencyKey: `${fence.providerIdempotencyKey}:line` });
  await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false },
    { ...requestOptions, idempotencyKey: `${fence.providerIdempotencyKey}:finalize` });
  // A retried idempotent finalize response can be stale. Read the current invoice
  // before exposing payment or recording a completed replacement obligation.
  const finalized = await stripe.invoices.retrieve(invoice.id);
  if (finalized.id !== invoice.id || !["open", "paid"].includes(finalized.status ?? "")
    || finalized.currency !== "usd" || finalized.total !== stored.feeTotal || finalized.amount_due !== stored.feeTotal
    || finalized.total_excluding_tax !== stored.quote.buyoutDues || finalized.starting_balance !== 0
    || (finalized.ending_balance ?? 0) !== 0 || finalized.auto_advance !== false
    || finalized.livemode !== contract.livemode || stripeObjectId(finalized.customer) !== contract.customerId
    || finalized.metadata?.ruined_cancellation_id !== stored.id || finalized.metadata?.ruined_commitment_id !== contract.id
    || finalized.lines.has_more || finalized.lines.data.length !== 1
    || stored.taxEnabled && finalized.automatic_tax.status !== "complete") {
    // No automatic collection was enabled. An open invoice with changed terms
    // is voided; a paid/otherwise changed invoice needs provider reconciliation.
    if (finalized.status === "open") await stripe.invoices.voidInvoice(invoice.id, {}, { ...requestOptions, idempotencyKey: `${fence.providerIdempotencyKey}:void-mismatch` });
    throw new MembershipCommitmentError("early_exit_requires_review");
  }
  const completed = await sql.begin(tx => completeMembershipCancellation(tx, { cancellationId: stored.id, replacementInvoiceId: invoice.id }));
  if (!completed) {
    if (finalized.status === "open") await stripe.invoices.voidInvoice(invoice.id, {},
      { ...requestOptions, idempotencyKey: `${fence.providerIdempotencyKey}:void-unconfirmed` });
    throw new MembershipCommitmentError("early_exit_requires_review");
  }
  // Paying is a separate action on Stripe's hosted invoice. Failed payment cannot restore installments.
  return finalized.hosted_invoice_url;
}

export async function confirmMemberCancellation(memberId: string, quoteId: string) {
  const sql = getBillingDatabase(), stripe = getStripe();
  const rows = await sql<StoredQuote[]>`select id, quote, provider_evidence_sha256 as evidence,
    fee_tax_code as "taxCode", fee_tax_enabled as "taxEnabled", fee_total::integer as "feeTotal"
    from stripe_membership_cancellation_quotes where id = ${quoteId}::uuid and member_id = ${memberId}::uuid`;
  const stored = rows[0], contract = await getMemberBillingCommitment(memberId);
  if (!stored || !contract || contract.id !== stored.quote.contractId) throw new MembershipCommitmentError("cancellation_quote_not_found");
  const lease = randomUUID();
  const locked = await sql`update stripe_membership_commitments set cancellation_lease_token = ${lease}::uuid,
    cancellation_lease_until = statement_timestamp() + interval '5 minutes'
    where id = ${contract.id}::uuid and (cancellation_lease_until is null or cancellation_lease_until < statement_timestamp()) returning id`;
  if (!locked.length) throw new MembershipCommitmentError("cancellation_in_progress");
  try {
    let cancellation = await sql.begin(tx => getMembershipCancellation(tx, stored.id));
    if (cancellation?.status === "completed") {
      const invoice = cancellation.replacementInvoiceId ? await stripe.invoices.retrieve(cancellation.replacementInvoiceId) : null;
      return { effectiveAt: cancellation.quote.effectiveAt, invoiceUrl: invoice?.hosted_invoice_url ?? null,
        ...(cancellation.quote.refundAmount !== undefined ? { refundStatus: "succeeded" as const, refundAmount: cancellation.quote.refundAmount } : {}) };
    }
    if (!cancellation) {
      if (Date.now() >= Date.parse(stored.quote.expiresAt)) throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
      if (stored.quote.intent === "early_exit") {
        const current = await readCommitmentProviderEvidence(contract);
        if (current.fingerprint !== stored.evidence) throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
      }
      cancellation = await sql.begin(tx => reserveMembershipCancellation(tx, { requestId: stored.id, memberId, quote: stored.quote }));
    }
    if (cancellation.status === "manual_review" || cancellation.status === "abandoned") {
      throw new MembershipCommitmentError(stored.quote.intent === "cancel_before_start" ? "prestart_cancellation_requires_review" : "early_exit_requires_review");
    }
    if (stored.quote.intent === "cancel_before_start") {
      if (stored.quote.prepaidProviderSnapshot) return await confirmPrepaidCancellation(contract, cancellation);
      if (cancellation.status === "requested") {
        const before = await readPrestartCancellationEvidence(contract);
        if (before.subscription.status !== "canceled") {
          // Recheck after the network reads. Leave enough time for the bounded
          // cancellation request to complete before the immutable billing start.
          if (Date.parse(contract.startsAt) - Date.now() <= requestOptions.timeout + 2_000) {
            throw new MembershipCommitmentError("prestart_cancellation_requires_review");
          }
          await stripe.subscriptions.cancel(contract.subscriptionId, { invoice_now: false, prorate: false },
            { ...requestOptions, idempotencyKey: `${cancellation.providerIdempotencyKey}:cancel-before-start` });
        }
        // On a timeout retry, a previously canceled object is read and verified
        // here. Never restore it or issue a second subscription/invoice.
        const after = await readPrestartCancellationEvidence(contract);
        if (after.subscription.status !== "canceled") throw new MembershipCommitmentError("prestart_cancellation_requires_review");
        const stopped = await sql.begin(tx => confirmMembershipBillingStopped(tx, stored.id, {
          subscriptionId: after.snapshot.subscriptionId, customerId: after.snapshot.customerId,
          livemode: after.snapshot.livemode, observedAt: after.snapshot.observedAt, subscriptionStatus: "canceled",
          cancelAt: null, canceledAt: after.snapshot.canceledAt, firstChargeAt: after.snapshot.firstChargeAt,
          openOrdinaryInvoiceIds: [], pendingProrationOrInvoiceItems: false, noInvoices: true,
        }));
        if (!stopped) throw new MembershipCommitmentError("cancellation_in_progress");
      }
      const completed = await sql.begin(tx => completeMembershipCancellation(tx, { cancellationId: stored.id, replacementInvoiceId: null }));
      if (!completed) throw new MembershipCommitmentError("cancellation_in_progress");
      return { effectiveAt: stored.quote.effectiveAt, invoiceUrl: null };
    }
    if (cancellation.status === "requested") {
      const before = await stripe.subscriptions.retrieve(contract.subscriptionId);
      const item = verifyCommitmentSubscription(before, contract);
      const target = Math.floor(Date.parse(stored.quote.effectiveAt) / 1000);
      // The stale renewal request must never undo an earlier accepted exit.
      const existingEnd = before.cancel_at ?? (before.cancel_at_period_end ? item.current_period_end : null);
      if (existingEnd && existingEnd < target) throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
      if (stored.quote.intent === "disable_renewal" && before.status !== "canceled"
        && renewalSnapshot(before).currentPeriodEnd !== stored.quote.renewalProviderSnapshot?.currentPeriodEnd) {
        throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
      }
      if (stored.quote.intent === "early_exit" && target !== item.current_period_end) {
        throw new MembershipCommitmentError("early_exit_requires_review");
      }
      if (before.status !== "canceled" && existingEnd !== target) {
        if (target <= Date.now() / 1000) throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
        await stripe.subscriptions.update(contract.subscriptionId, { cancel_at: target, proration_behavior: "none" },
          { ...requestOptions, idempotencyKey: `${cancellation.providerIdempotencyKey}:stop` });
      }
      const after = await stripe.subscriptions.retrieve(contract.subscriptionId);
      verifyCommitmentSubscription(after, contract);
      // Scheduling changes no invoice principal; a fresh read proves paid access and no ordinary debt.
      const evidence = stored.quote.intent === "early_exit" ? await readCommitmentProviderEvidence(contract) : null;
      if (evidence && evidence.fingerprint !== stored.evidence) throw new MembershipCommitmentError("early_exit_requires_review");
      const stopped = await sql.begin(tx => confirmMembershipBillingStopped(tx, stored.id, { subscriptionId: after.id,
        customerId: stripeObjectId(after.customer)!, livemode: after.livemode, observedAt: new Date().toISOString(),
        subscriptionStatus: after.status as "active" | "past_due" | "unpaid" | "canceled" | "trialing",
        cancelAt: after.cancel_at ? new Date(after.cancel_at * 1000).toISOString() : null,
        openOrdinaryInvoiceIds: [], pendingProrationOrInvoiceItems: false }));
      if (!stopped) throw new MembershipCommitmentError("cancellation_in_progress");
    }
    if (stored.quote.buyoutDues > 0) {
      return { effectiveAt: stored.quote.effectiveAt, invoiceUrl: await replacementInvoice(contract, stored) };
    }
    const completed = await sql.begin(tx => completeMembershipCancellation(tx, { cancellationId: stored.id, replacementInvoiceId: null }));
    if (!completed) throw new MembershipCommitmentError("cancellation_in_progress");
    return { effectiveAt: stored.quote.effectiveAt, invoiceUrl: null };
  } catch (error) {
    if (error instanceof MembershipCommitmentError && stored.quote.intent !== "disable_renewal") {
      await sql.begin(tx => markMembershipCancellationNeedsReview(tx, stored.id, error.code));
    }
    throw error;
  } finally {
    await sql`update stripe_membership_commitments set cancellation_lease_token = null, cancellation_lease_until = null
      where id = ${contract.id}::uuid and cancellation_lease_token = ${lease}::uuid`;
  }
}

/** Run after the webhook transaction commits. Only a member-confirmed durable
 * execution can be resumed; a quote alone or provider metadata creates no action. */
export async function reconcilePrepaidMembershipCancellation(input: { subscriptionId: string; livemode: boolean }) {
  const sql = getBillingDatabase();
  const rows = await sql<Array<{ cancellationId: string; memberId: string; status: string }>>`
    select cancellation.id as "cancellationId", contract.member_id as "memberId", cancellation.status
    from stripe_membership_cancellations cancellation
    join stripe_membership_commitments contract on contract.id = cancellation.contract_id
    join stripe_membership_prepaid_proofs proof on proof.contract_id = contract.id
      and proof.stripe_subscription_id = contract.stripe_subscription_id and proof.member_id = contract.member_id
    where contract.stripe_subscription_id = ${input.subscriptionId} and contract.livemode = ${input.livemode}
      and contract.terms_snapshot->'billingSchedule'->>'version' = 'foundations-prepaid-v1'
      and cancellation.intent = 'cancel_before_start'
      and cancellation.status in ('requested', 'billing_stopped', 'collection_in_flight', 'manual_review')
      and (proof.cancellation_id is null or proof.cancellation_id = cancellation.id)
    order by cancellation.created_at desc limit 1
  `;
  if (!rows[0]) return { handled: false as const };
  if (rows[0].status === "manual_review") return { handled: true as const, reviewRequired: true as const };
  try {
    return { handled: true as const, cancellation: await confirmMemberCancellation(rows[0].memberId, rows[0].cancellationId) };
  } catch (error) {
    // Another confirmed execution holds the lease. Its provider result or the
    // next webhook/status retry will finish the same refund without a second key.
    if (error instanceof MembershipCommitmentError && error.code === "cancellation_in_progress") {
      return { handled: true as const, pending: true as const };
    }
    throw error;
  }
}

/** The worker resumes durable executions only. It cannot choose a customer,
 * amount, or new cancellation policy through this bounded candidate list. */
export async function listPendingPrepaidMembershipCancellations(limit = 25) {
  const sql = getBillingDatabase();
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  if (!Number.isFinite(boundedLimit)) throw new MembershipCommitmentError("invalid_cancellation_batch_limit");
  return sql<Array<{ subscriptionId: string; livemode: boolean }>>`
    select contract.stripe_subscription_id as "subscriptionId", contract.livemode
    from stripe_membership_cancellations cancellation
    join stripe_membership_commitments contract on contract.id = cancellation.contract_id
    join stripe_membership_prepaid_proofs proof on proof.contract_id = contract.id
      and proof.stripe_subscription_id = contract.stripe_subscription_id and proof.member_id = contract.member_id
    where contract.terms_snapshot->'billingSchedule'->>'version' = 'foundations-prepaid-v1'
      and cancellation.intent = 'cancel_before_start'
      and cancellation.status in ('requested', 'billing_stopped', 'collection_in_flight')
      and (proof.cancellation_id is null or proof.cancellation_id = cancellation.id)
    order by cancellation.updated_at, cancellation.id limit ${boundedLimit}
  `;
}

/** A missed payment cutoff invalidates this enrollment. Restitution remains
 * available after an outage, but only for the verified never-started enrollment;
 * this executor cannot create a general after-start refund authorization. */
export async function refundMissedFoundationsEnrollment(input: { subscriptionId: string; livemode: boolean }) {
  const resumed = await reconcilePrepaidMembershipCancellation(input);
  if (resumed.handled) return resumed;
  const sql = getBillingDatabase();
  const rows = await sql<Array<{ contract: MembershipCommitment }>>`
    select contract.terms_snapshot as contract from stripe_membership_commitments contract
    join stripe_membership_prepaid_proofs proof on proof.contract_id=contract.id
      and proof.stripe_subscription_id=contract.stripe_subscription_id and proof.member_id=contract.member_id
    join membership_commercial_reservations reservation on reservation.id=proof.reservation_id
    where contract.stripe_subscription_id=${input.subscriptionId} and contract.livemode=${input.livemode}
      and contract.status='active' and proof.review_reason='cohort_cutoff_missed'
      and proof.refund_state='review_required' and proof.activated_at is null and reservation.status='reserved'
    limit 1
  `;
  const contract = rows[0]?.contract;
  if (!contract) return { handled: false as const };
  const provider = await readPrepaidCancellationEvidence(contract, { invalidEnrollmentReason: "cohort_cutoff_missed" });
  const quote = quoteMembershipMissedCohortCancellation(contract, provider.snapshot, new Date()), id = randomUUID();
  await sql`insert into stripe_membership_cancellation_quotes
    (id,member_id,contract_id,quote,provider_evidence_sha256,fee_tax_code,fee_tax_enabled,fee_total,expires_at)
    values (${id}::uuid,${contract.memberId}::uuid,${contract.id}::uuid,${sql.json(json(quote))}::jsonb,
      ${null},${null},${false},${0},${quote.expiresAt}::timestamptz)`;
  try {
    return { handled: true as const, cancellation: await confirmMemberCancellation(contract.memberId, id) };
  } catch (error) {
    if (error instanceof MembershipCommitmentError && error.code === "cancellation_in_progress") return { handled: true as const, pending: true as const };
    throw error;
  }
}
