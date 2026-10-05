import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import {
  buildMembershipCommitment,
  cancellationQuoteFingerprint,
  commitmentSnapshotFingerprint,
  MEMBERSHIP_COMMITMENT_RECONCILIATION_MAX_AGE_MS,
  MembershipCommitmentError,
  quoteMembershipCancellation,
  quoteMembershipRenewalCancellation,
  quoteMembershipPrestartCancellation,
  type CommitmentInvoice,
  type CommitmentLedger,
  type MembershipCancellationQuote,
  type MembershipCommitment,
} from "./commitment-policy";

export type CommitmentTransaction = postgres.TransactionSql;
export type MembershipCommitmentRecord = {
  contract: MembershipCommitment;
  ledger: CommitmentLedger;
  status: "active" | "exit_pending" | "ended" | "manual_review";
};
export type MembershipCancellationRecord = {
  id: string;
  contractId: string;
  status: "requested" | "billing_stopped" | "collection_in_flight" | "completed" | "manual_review" | "abandoned";
  quote: MembershipCancellationQuote;
  providerIdempotencyKey: string;
  replacementInvoiceId: string | null;
};
function json(value: unknown): postgres.JSONValue { return JSON.parse(JSON.stringify(value)) as postgres.JSONValue; }

/** Call inside the webhook transaction after verifying the actual paid Checkout.
 * Both agreement acceptance and the separate v2 recurring-payment consent must match.
 * Supplying a pilot acceptance or changing a stored contract fails closed.
 */
export async function createMembershipCommitment(tx: CommitmentTransaction, contract: MembershipCommitment,
  checkoutAttemptId: string): Promise<MembershipCommitment> {
  if (commitmentSnapshotFingerprint(buildMembershipCommitment(contract)) !== commitmentSnapshotFingerprint(contract)) {
    throw new MembershipCommitmentError("commitment_snapshot_mismatch");
  }
  const accepted = await tx`
    select attempt.id from stripe_checkout_attempts attempt
    join membership_agreement_acceptances acceptance on acceptance.id = attempt.agreement_acceptance_id
    where attempt.id = ${checkoutAttemptId}::uuid and attempt.member_id = ${contract.memberId}::uuid
      and acceptance.member_id = ${contract.memberId}::uuid and acceptance.id = ${contract.agreementAcceptanceId}::uuid
      and acceptance.agreement_content_sha256 = ${contract.agreementContentSha256}
      and acceptance.agreement_key_snapshot || '-v' || acceptance.agreement_version_snapshot::text = ${contract.agreementVersion}
      and acceptance.accepted_at = ${contract.acceptedAt}::timestamptz
      and attempt.billing_plan = ${contract.billingPlan} and attempt.stripe_price_id = ${contract.priceId}
      and (attempt.first_charge_at is null or (attempt.first_charge_at = ${contract.startsAt}::timestamptz
        and (attempt.recurring_payment_terms->>'firstChargeAt')::timestamptz = attempt.first_charge_at))
      and attempt.recurring_payment_accepted_at is not null and attempt.billing_consent_auth_user_id is not null
      and attempt.recurring_payment_terms->>'version' = ${contract.billingTermsVersion}
      and attempt.recurring_payment_terms->>'offerId' = ${contract.offerId}
      and attempt.recurring_payment_terms->>'amount' = ${String(contract.installmentDues)}
      and attempt.recurring_payment_terms->>'initialTermAmount' = ${String(contract.totalInitialDues)}
      and attempt.recurring_payment_terms->>'initialTermMonths' = '12'
      and attempt.recurring_payment_terms->>'buyoutCap' = ${String(contract.buyoutCap)}
      and attempt.status in ('creating', 'open', 'completed')
      and (attempt.stripe_subscription_id is null or attempt.stripe_subscription_id = ${contract.subscriptionId})
    limit 1
  `;
  if (accepted.length !== 1) throw new MembershipCommitmentError("commitment_consent_mismatch");
  const fingerprint = commitmentSnapshotFingerprint(contract);
  await tx`
    insert into stripe_membership_commitments
      (id, member_id, checkout_attempt_id, agreement_acceptance_id, stripe_subscription_id, stripe_customer_id, livemode, terms_snapshot, terms_sha256)
    values (${contract.id}::uuid, ${contract.memberId}::uuid, ${checkoutAttemptId}::uuid, ${contract.agreementAcceptanceId}::uuid,
      ${contract.subscriptionId}, ${contract.customerId}, ${contract.livemode}, ${tx.json(json(contract))}::jsonb, ${fingerprint})
    on conflict do nothing
  `;
  const rows = await tx<Array<{ terms_snapshot: MembershipCommitment; terms_sha256: string; checkout_attempt_id: string }>>`
    select terms_snapshot, terms_sha256, checkout_attempt_id from stripe_membership_commitments
    where livemode = ${contract.livemode} and stripe_subscription_id = ${contract.subscriptionId}
  `;
  if (rows.length !== 1 || rows[0].terms_sha256 !== fingerprint || rows[0].checkout_attempt_id !== checkoutAttemptId) {
    throw new MembershipCommitmentError("commitment_already_bound_to_other_terms");
  }
  return rows[0].terms_snapshot;
}

export async function getMembershipCommitment(tx: CommitmentTransaction, input: {
  memberId: string; subscriptionId: string; livemode: boolean;
}): Promise<MembershipCommitmentRecord | null> {
  const rows = await tx<Array<{ terms_snapshot: MembershipCommitment; status: MembershipCommitmentRecord["status"]; ledger_revision: number }>>`
    select terms_snapshot, status, ledger_revision from stripe_membership_commitments
    where member_id = ${input.memberId}::uuid and stripe_subscription_id = ${input.subscriptionId} and livemode = ${input.livemode}
    for update
  `;
  const row = rows[0];
  if (!row) return null;
  const ledger = await readLedger(tx, row.terms_snapshot.id, row.ledger_revision);
  return { contract: row.terms_snapshot, status: row.status, ledger };
}
async function readLedger(tx: CommitmentTransaction, contractId: string, revision: number): Promise<CommitmentLedger> {
  const rows = await tx<Array<{ state: CommitmentLedger["state"]; reconciled_at: Date; invoices: CommitmentInvoice[] }>>`
    select state, reconciled_at, invoices from stripe_membership_commitment_ledgers
    where contract_id = ${contractId}::uuid and revision = ${revision}
  `;
  return rows[0] ? { state: rows[0].state, reconciledAt: new Date(rows[0].reconciled_at).toISOString(), invoices: rows[0].invoices, revision }
    : { state: "unknown", reconciledAt: null, invoices: [], revision };
}

export type CommitmentReconciliationInput = {
  id: string;
  contractId: string;
  state: CommitmentLedger["state"];
  reconciledAt: string;
  invoices: CommitmentInvoice[];
  sourceEvidence: {
    subscriptionId: string;
    customerId: string;
    livemode: boolean;
    allInvoicePages: boolean;
    allRefundPages: boolean;
    allCreditNotePages: boolean;
    principalAllocation: "verified" | "unresolved";
    reason?: string;
    providerEventId?: string;
  };
};
/** The provider adapter must collect all invoice/refund/credit-note pages before
 * asserting complete. Keep this transaction short: retrieve Stripe data beforehand.
 */
export async function recordCommitmentReconciliation(tx: CommitmentTransaction, input: CommitmentReconciliationInput): Promise<number> {
  const rows = await tx<Array<{ terms_snapshot: MembershipCommitment; ledger_revision: number }>>`
    select terms_snapshot, ledger_revision from stripe_membership_commitments where id = ${input.contractId}::uuid for update
  `;
  const row = rows[0];
  if (!row || row.terms_snapshot.subscriptionId !== input.sourceEvidence.subscriptionId
    || row.terms_snapshot.customerId !== input.sourceEvidence.customerId || row.terms_snapshot.livemode !== input.sourceEvidence.livemode) {
    throw new MembershipCommitmentError("commitment_reconciliation_identity_mismatch");
  }
  if (input.state === "complete" && (!input.sourceEvidence.allInvoicePages || !input.sourceEvidence.allRefundPages
    || !input.sourceEvidence.allCreditNotePages || input.sourceEvidence.principalAllocation !== "verified")) {
    throw new MembershipCommitmentError("commitment_reconciliation_incomplete");
  }
  const duplicate = await tx<Array<{ revision: number; matches: boolean }>>`
    select revision, contract_id = ${input.contractId}::uuid and state = ${input.state}
      and reconciled_at = ${input.reconciledAt}::timestamptz and invoices = ${tx.json(json(input.invoices))}::jsonb
      and source_evidence = ${tx.json(json(input.sourceEvidence))}::jsonb as matches
    from stripe_membership_commitment_ledgers where id = ${input.id}::uuid
  `;
  if (duplicate[0]) {
    if (!duplicate[0].matches) throw new MembershipCommitmentError("reconciliation_idempotency_conflict");
    return duplicate[0].revision;
  }
  const previous = await readLedger(tx, input.contractId, row.ledger_revision);
  if (previous.reconciledAt && Date.parse(input.reconciledAt) < Date.parse(previous.reconciledAt)) {
    throw new MembershipCommitmentError("stale_commitment_reconciliation");
  }
  if (input.state === "complete" && previous.invoices.some(invoice => !input.invoices.some(next => next.invoiceId === invoice.invoiceId))) {
    throw new MembershipCommitmentError("commitment_invoice_history_missing");
  }
  const revision = row.ledger_revision + 1;
  await tx`
    insert into stripe_membership_commitment_ledgers (id, contract_id, revision, state, reconciled_at, invoices, source_evidence)
    values (${input.id}::uuid, ${input.contractId}::uuid, ${revision}, ${input.state}, ${input.reconciledAt}::timestamptz,
      ${tx.json(json(input.invoices))}::jsonb, ${tx.json(json(input.sourceEvidence))}::jsonb)
  `;
  await tx`update stripe_membership_commitments set ledger_revision = ${revision}, updated_at = statement_timestamp() where id = ${input.contractId}::uuid`;
  // A changed ledger never silently changes the amount a member authorized.
  await tx`
    update stripe_membership_cancellations set status = 'manual_review', last_error_code = 'commitment_ledger_changed', updated_at = statement_timestamp()
    where contract_id = ${input.contractId}::uuid and intent = 'early_exit' and status in ('requested', 'billing_stopped', 'collection_in_flight')
      and ledger_revision <> ${revision}
  `;
  return revision;
}

/** Refund, credit-note, payment and invoice webhooks invalidate fee automation.
 * They never prevent ordinary renewal cancellation or mutate accepted dues.
 */
export async function invalidateMembershipCommitmentLedger(tx: CommitmentTransaction, input: {
  memberId: string; subscriptionId: string; livemode: boolean; providerEventId: string; now?: Date;
}): Promise<boolean> {
  const record = await getMembershipCommitment(tx, input);
  if (!record) return false;
  const duplicate = await tx`
    select id from stripe_membership_commitment_ledgers where contract_id = ${record.contract.id}::uuid
      and source_evidence->>'providerEventId' = ${input.providerEventId} limit 1
  `;
  if (duplicate.length) return false;
  await recordCommitmentReconciliation(tx, { id: randomUUID(), contractId: record.contract.id, state: "unknown",
    reconciledAt: (input.now ?? new Date()).toISOString(), invoices: record.ledger.invoices,
    sourceEvidence: { subscriptionId: input.subscriptionId, customerId: record.contract.customerId, livemode: input.livemode,
      allInvoicePages: false, allRefundPages: false, allCreditNotePages: false, principalAllocation: "unresolved", providerEventId: input.providerEventId } });
  return true;
}

export async function getMembershipCancellation(tx: CommitmentTransaction, id: string): Promise<MembershipCancellationRecord | null> {
  const rows = await tx<Array<MembershipCancellationRecord>>`
    select id, contract_id as "contractId", status, quote_snapshot as quote,
      provider_idempotency_key as "providerIdempotencyKey", replacement_invoice_id as "replacementInvoiceId"
    from stripe_membership_cancellations where id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

/** Call only after the member explicitly confirms the exact displayed quote.
 * requestId is stable per confirmation. Never accept prices or quote JSON from a browser.
 */
export async function reserveMembershipCancellation(tx: CommitmentTransaction, input: {
  requestId: string; memberId: string; quote: MembershipCancellationQuote; now?: Date;
}): Promise<MembershipCancellationRecord> {
  const { quote } = input, now = input.now ?? new Date();
  const record = await getMembershipCommitment(tx, { memberId: input.memberId, subscriptionId: quote.subscriptionId, livemode: quote.livemode });
  if (!record || record.contract.id !== quote.contractId || input.memberId !== quote.memberId) {
    throw new MembershipCommitmentError("cancellation_identity_mismatch");
  }
  const existing = await getMembershipCancellation(tx, input.requestId);
  if (existing) {
    if (existing.contractId !== quote.contractId || existing.quote.fingerprint !== quote.fingerprint) {
      throw new MembershipCommitmentError("cancellation_idempotency_conflict");
    }
    return existing;
  }
  if (quote.intent !== "disable_renewal" && record.status !== "active" || now.getTime() >= Date.parse(quote.expiresAt) || Date.parse(quote.quotedAt) > now.getTime()
    || quote.intent === "cancel_before_start" && now.getTime() >= Date.parse(record.contract.startsAt)
    || quote.fingerprint !== cancellationQuoteFingerprint(quote)) throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
  const fresh = quote.intent === "cancel_before_start" && quote.prestartProviderSnapshot
    ? quoteMembershipPrestartCancellation(record.contract, quote.prestartProviderSnapshot, new Date(quote.quotedAt))
    : quote.intent === "disable_renewal" && quote.renewalProviderSnapshot
    ? quoteMembershipRenewalCancellation(record.contract, quote.renewalProviderSnapshot, new Date(quote.quotedAt))
    : quoteMembershipCancellation(record.contract, record.ledger, quote.intent, new Date(quote.quotedAt));
  const observedAt = quote.intent === "cancel_before_start" ? quote.prestartProviderSnapshot?.observedAt
    : quote.intent === "disable_renewal" ? quote.renewalProviderSnapshot?.observedAt : record.ledger.reconciledAt;
  if (fresh.fingerprint !== quote.fingerprint || !observedAt
    || now.getTime() - Date.parse(observedAt) > MEMBERSHIP_COMMITMENT_RECONCILIATION_MAX_AGE_MS) {
    throw new MembershipCommitmentError("cancellation_quote_expired_or_changed");
  }
  const pending = await tx<Array<{ id: string; status: MembershipCancellationRecord["status"] }>>`
    select id, status from stripe_membership_cancellations where contract_id = ${quote.contractId}::uuid
    and intent = ${quote.intent} and status in ('requested', 'billing_stopped', 'collection_in_flight', 'manual_review') limit 1`;
  if (pending[0]) {
    if (quote.intent !== "disable_renewal" || !["requested", "manual_review"].includes(pending[0].status)) {
      throw new MembershipCommitmentError("cancellation_already_pending");
    }
    // A stale no-fee request must not trap the member in automatic renewal.
    // The executor still re-reads Stripe and cannot extend an earlier end date.
    await tx`update stripe_membership_cancellations set status = 'abandoned', last_error_code = 'superseded_renewal_request', updated_at = ${now}::timestamptz
      where id = ${pending[0].id}::uuid and intent = 'disable_renewal' and status in ('requested', 'manual_review')`;
  }
  await tx`
    insert into stripe_membership_cancellations
      (id, contract_id, requested_by_member_id, intent, quote_snapshot, quote_sha256, ledger_revision, buyout_dues, effective_at, provider_idempotency_key)
    values (${input.requestId}::uuid, ${quote.contractId}::uuid, ${input.memberId}::uuid, ${quote.intent},
      ${tx.json(json(quote))}::jsonb, ${quote.fingerprint}, ${quote.ledgerRevision}, ${quote.buyoutDues}, ${quote.effectiveAt}::timestamptz,
      ${`ruined:membership-cancellation:${input.requestId}`})
  `;
  if (quote.intent !== "disable_renewal") await tx`update stripe_membership_commitments set status = 'exit_pending', updated_at = statement_timestamp() where id = ${quote.contractId}::uuid`;
  return (await getMembershipCancellation(tx, input.requestId))!;
}

export type CommitmentBillingStopEvidence = {
  subscriptionId: string;
  customerId: string;
  livemode: boolean;
  observedAt: string;
  subscriptionStatus: "active" | "past_due" | "unpaid" | "canceled";
  cancelAt: string | null;
  canceledAt?: string | null;
  firstChargeAt?: string;
  noInvoices?: boolean;
  /** For an early exit, ordinary unpaid invoices must be voided/replaced first. */
  openOrdinaryInvoiceIds: string[];
  pendingProrationOrInvoiceItems: boolean;
};
/** Store only read-back evidence from Stripe. A scheduled cancellation still
 * preserves paid access. The replacement invoice may remain unpaid without
 * restoring ordinary installments; its single obligation is tracked separately.
 */
export async function confirmMembershipBillingStopped(tx: CommitmentTransaction, cancellationId: string,
  evidence: CommitmentBillingStopEvidence, now = new Date()): Promise<boolean> {
  const cancellation = await getMembershipCancellation(tx, cancellationId);
  if (!cancellation) return false;
  const quote = cancellation.quote;
  const contractRows = await tx<Array<{ terms_snapshot: MembershipCommitment; ledger_revision: number }>>`
    select terms_snapshot, ledger_revision from stripe_membership_commitments where id = ${quote.contractId}::uuid for update
  `;
  const contract = contractRows[0];
  if (!contract || evidence.subscriptionId !== quote.subscriptionId || evidence.customerId !== contract.terms_snapshot.customerId
    || evidence.livemode !== quote.livemode || !Number.isFinite(Date.parse(evidence.observedAt))
    || now.getTime() < Date.parse(evidence.observedAt) || now.getTime() - Date.parse(evidence.observedAt) > MEMBERSHIP_COMMITMENT_RECONCILIATION_MAX_AGE_MS
    || evidence.subscriptionStatus !== "canceled" && (!evidence.cancelAt || Date.parse(evidence.cancelAt) !== Date.parse(quote.effectiveAt))
    || quote.intent === "early_exit" && (contract.ledger_revision !== quote.ledgerRevision || evidence.openOrdinaryInvoiceIds.length > 0 || evidence.pendingProrationOrInvoiceItems)
    || quote.intent === "cancel_before_start" && (evidence.subscriptionStatus !== "canceled" || !evidence.canceledAt
      || !Number.isFinite(Date.parse(evidence.canceledAt)) || Date.parse(evidence.canceledAt) >= Date.parse(contract.terms_snapshot.startsAt)
      || Date.parse(evidence.canceledAt) > Date.parse(evidence.observedAt)
      || evidence.firstChargeAt !== contract.terms_snapshot.startsAt || evidence.noInvoices !== true
      || evidence.openOrdinaryInvoiceIds.length > 0 || evidence.pendingProrationOrInvoiceItems)) {
    throw new MembershipCommitmentError("ordinary_billing_not_safely_stopped");
  }
  const rows = await tx`
    update stripe_membership_cancellations set status = 'billing_stopped', billing_stop_evidence = ${tx.json(json(evidence))}::jsonb,
      billing_stopped_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
    where id = ${cancellationId}::uuid and status = 'requested' returning id
  `;
  return rows.length === 1;
}

/** Persist before creating the ONE replacement Stripe invoice. Commit this transaction
 * before the network call. Retry with the same provider key only; uncertainty after
 * Stripe's 24-hour key retention requires remote reconciliation, never a fresh charge.
 */
export async function fenceMembershipReplacementInvoice(tx: CommitmentTransaction, cancellationId: string,
  now = new Date()): Promise<{ providerIdempotencyKey: string; quote: MembershipCancellationQuote; retry: boolean } | null> {
  const cancellation = await getMembershipCancellation(tx, cancellationId);
  if (!cancellation || cancellation.quote.buyoutDues === 0) return null;
  await tx`select id from stripe_membership_commitments where id = ${cancellation.contractId}::uuid for update`;
  const rows = await tx<Array<{ providerIdempotencyKey: string; quote: MembershipCancellationQuote; retry: boolean }>>`
    update stripe_membership_cancellations cancellation set status = 'collection_in_flight',
      first_collection_attempt_at = coalesce(first_collection_attempt_at, ${now}::timestamptz), updated_at = ${now}::timestamptz
    from stripe_membership_commitments contract
    where cancellation.id = ${cancellationId}::uuid and contract.id = cancellation.contract_id
      and cancellation.intent = 'early_exit' and cancellation.status in ('billing_stopped', 'collection_in_flight')
      and cancellation.ledger_revision = contract.ledger_revision and cancellation.replacement_invoice_id is null
      and (cancellation.first_collection_attempt_at is null or cancellation.first_collection_attempt_at > ${now}::timestamptz - interval '23 hours')
      and (cancellation.first_collection_attempt_at is not null or cancellation.billing_stopped_at >= ${now}::timestamptz - interval '5 minutes')
    returning cancellation.provider_idempotency_key as "providerIdempotencyKey", cancellation.quote_snapshot as quote,
      cancellation.first_collection_attempt_at <> ${now}::timestamptz as retry
  `;
  if (!rows[0]) await tx`
    update stripe_membership_cancellations set status = 'manual_review', last_error_code = 'replacement_invoice_requires_reconciliation', updated_at = ${now}::timestamptz
    where id = ${cancellationId}::uuid and status in ('billing_stopped', 'collection_in_flight')
  `;
  return rows[0] ?? null;
}

/** Completion means ordinary installments were replaced and one exact invoice is
 * durably linked; it does NOT mean the fee was paid. Collection failures never
 * reinstate the old recurring obligation. Validate the provider invoice before calling.
 */
export async function completeMembershipCancellation(tx: CommitmentTransaction, input: {
  cancellationId: string; replacementInvoiceId: string | null; now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date(), cancellation = await getMembershipCancellation(tx, input.cancellationId);
  if (!cancellation) return false;
  await tx`select id from stripe_membership_commitments where id = ${cancellation.contractId}::uuid for update`;
  if (cancellation.status === "completed") return cancellation.replacementInvoiceId === input.replacementInvoiceId;
  if (cancellation.quote.buyoutDues > 0 && (!input.replacementInvoiceId?.startsWith("in_") || cancellation.status !== "collection_in_flight")
    || cancellation.quote.buyoutDues === 0 && (input.replacementInvoiceId !== null || cancellation.status !== "billing_stopped")) {
    throw new MembershipCommitmentError("replacement_invoice_not_confirmed");
  }
  const rows = await tx`
    update stripe_membership_cancellations set status = 'completed', replacement_invoice_id = ${input.replacementInvoiceId},
      completed_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
    where id = ${input.cancellationId}::uuid and status in ('billing_stopped', 'collection_in_flight') returning id
  `;
  if (rows.length && cancellation.quote.intent !== "disable_renewal") await tx`
    update stripe_membership_commitments set status = 'ended', updated_at = ${now}::timestamptz where id = ${cancellation.contractId}::uuid
  `;
  return rows.length === 1;
}

/** Persist an actionable review state after a known policy/provider mismatch.
 * Do not use for an uncertain timeout: retry its existing idempotency key instead.
 * No accepted quote or previously created invoice is rewritten.
 */
export async function markMembershipCancellationNeedsReview(tx: CommitmentTransaction, cancellationId: string, code: string): Promise<boolean> {
  if (!/^[a-z][a-z0-9_]{0,119}$/.test(code)) throw new MembershipCommitmentError("invalid_cancellation_review_code");
  const cancellation = await getMembershipCancellation(tx, cancellationId);
  if (!cancellation) return false;
  await tx`select id from stripe_membership_commitments where id = ${cancellation.contractId}::uuid for update`;
  const rows = await tx`update stripe_membership_cancellations set status = 'manual_review', last_error_code = ${code}, updated_at = statement_timestamp()
    where id = ${cancellationId}::uuid and status in ('requested', 'billing_stopped', 'collection_in_flight', 'manual_review') returning id`;
  return rows.length === 1;
}
