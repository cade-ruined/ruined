import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type Stripe from "stripe";
import { getBillingDatabase } from "@/lib/stripe/database";
import { getMemberBillingCommitment } from "@/lib/stripe/commitment-account";
import { getStripe, isStripeTaxEnabled } from "@/lib/stripe/server";
import { readCommitmentProviderEvidence, stripeObjectId, verifyCommitmentSubscription } from "@/lib/stripe/cancellation-provider";
import { MembershipCommitmentError, quoteMembershipCancellation, quoteMembershipRenewalCancellation,
  type MembershipCancellationIntent, type MembershipCancellationQuote, type MembershipCommitment } from "@/lib/stripe/commitment-policy";
import { completeMembershipCancellation, confirmMembershipBillingStopped, fenceMembershipReplacementInvoice,
  getMembershipCancellation, getMembershipCommitment, markMembershipCancellationNeedsReview,
  recordCommitmentReconciliation, reserveMembershipCancellation } from "@/lib/stripe/commitment-repository";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
const requestOptions = { timeout: 8_000, maxNetworkRetries: 0 };
type StoredQuote = { id: string; quote: MembershipCancellationQuote; evidence: string | null; taxCode: string | null;
  taxEnabled: boolean; feeTotal: number };

export type PublicCancellationQuote = { id: string; intent: MembershipCancellationIntent; effectiveAt: string;
  accessThrough: string | null; feeDues: number; feeTax: number; feeTotal: number; remainingInitialDues: number | null;
  initialTermEndsAt: string; expiresAt: string };

function renewalSnapshot(subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  return { subscriptionId: subscription.id, customerId: stripeObjectId(subscription.customer)!, livemode: subscription.livemode,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString()
      : subscription.cancel_at_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    status: subscription.status as "active" | "past_due" | "unpaid" | "canceled", observedAt: new Date().toISOString() };
}

export async function createMemberCancellationQuote(memberId: string, intent: MembershipCancellationIntent): Promise<PublicCancellationQuote> {
  const contract = await getMemberBillingCommitment(memberId);
  if (!contract) throw new MembershipCommitmentError("no_paid_commitment");
  const stripe = getStripe(), sql = getBillingDatabase();
  let quote: MembershipCancellationQuote, evidence: string | null = null;
  if (intent === "disable_renewal") {
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
    initialTermEndsAt: contract.initialTermEndsAt, expiresAt: quote.expiresAt };
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
      return { effectiveAt: cancellation.quote.effectiveAt, invoiceUrl: invoice?.hosted_invoice_url ?? null };
    }
    if (!cancellation) {
      if (Date.now() > Date.parse(stored.quote.expiresAt)) throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
      if (stored.quote.intent === "early_exit") {
        const current = await readCommitmentProviderEvidence(contract);
        if (current.fingerprint !== stored.evidence) throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
      }
      cancellation = await sql.begin(tx => reserveMembershipCancellation(tx, { requestId: stored.id, memberId, quote: stored.quote }));
    }
    if (cancellation.status === "manual_review" || cancellation.status === "abandoned") throw new MembershipCommitmentError("early_exit_requires_review");
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
        subscriptionStatus: after.status as "active" | "past_due" | "unpaid" | "canceled",
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
    if (error instanceof MembershipCommitmentError && stored.quote.intent === "early_exit") {
      await sql.begin(tx => markMembershipCancellationNeedsReview(tx, stored.id, error.code));
    }
    throw error;
  } finally {
    await sql`update stripe_membership_commitments set cancellation_lease_token = null, cancellation_lease_until = null
      where id = ${contract.id}::uuid and cancellation_lease_token = ${lease}::uuid`;
  }
}
