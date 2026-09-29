import { createHash } from "node:crypto";

import { MEMBERSHIP_OFFERS, type MembershipOfferId } from "@/lib/membership/pricing";

/** A new acceptance is required. Pilot acceptances must never acquire these terms. */
export const MEMBERSHIP_COMMITMENT_TERMS_VERSION = "membership-billing-v2";
export const MEMBERSHIP_BUYOUT_CAP = 150_000;
export const MEMBERSHIP_COMMITMENT_RECONCILIATION_MAX_AGE_MS = 5 * 60_000;

export type MembershipCommitment = {
  id: string;
  memberId: string;
  subscriptionId: string;
  customerId: string;
  livemode: boolean;
  offerId: MembershipOfferId;
  priceId: string;
  agreementAcceptanceId: string;
  agreementVersion: string;
  agreementContentSha256: string;
  acceptedAt: string;
  startsAt: string;
  initialTermEndsAt: string;
  billingPlan: "monthly" | "annual";
  currency: "usd";
  installmentDues: number;
  totalInitialDues: number;
  buyoutCap: number;
  billingTermsVersion: typeof MEMBERSHIP_COMMITMENT_TERMS_VERSION;
};

export type CommitmentInvoice = {
  invoiceId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  priceId: string;
  /** Principal before tax. Never use invoice.amount_paid (which may include tax). */
  duesBilled: number;
  /** Principal actually settled, including applied customer credit, before refunds. */
  duesPaid: number;
  duesRefunded: number;
  /** A reviewed waiver of principal; excludes amounts already counted in duesPaid/refunded. */
  duesCredited: number;
  state: "open" | "paid" | "void" | "uncollectible";
  adjustmentState: "none" | "reviewed" | "unresolved";
};
export type CommitmentLedger = {
  revision: number;
  reconciledAt: string | null;
  state: "unknown" | "complete" | "review_required";
  invoices: CommitmentInvoice[];
};
export type MembershipCancellationIntent = "disable_renewal" | "early_exit";
export type MembershipCancellationQuote = {
  contractId: string;
  memberId: string;
  subscriptionId: string;
  livemode: boolean;
  intent: MembershipCancellationIntent;
  ledgerRevision: number;
  quotedAt: string;
  expiresAt: string;
  effectiveAt: string;
  accessThrough: string | null;
  remainingInitialDues: number | null;
  buyoutDues: number;
  currency: "usd";
  replacesRemainingInstallments: boolean;
  fingerprint: string;
  renewalProviderSnapshot?: CommitmentRenewalProviderSnapshot;
};
export type CommitmentRenewalProviderSnapshot = {
  subscriptionId: string;
  customerId: string;
  livemode: boolean;
  currentPeriodEnd: string;
  cancelAt?: string | null;
  status: "active" | "past_due" | "unpaid" | "canceled";
  observedAt: string;
};

export class MembershipCommitmentError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MembershipCommitmentError"; }
}

function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new MembershipCommitmentError("invalid_commitment_date");
  return result;
}
function cents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new MembershipCommitmentError("invalid_commitment_amount");
}
/** Anchor every period to the original day, including Jan 31 and leap-day starts. */
export function membershipCommitmentAnniversary(startsAt: string, months: number): string {
  const original = new Date(timestamp(startsAt));
  const result = new Date(original);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(original.getUTCDate(), finalDay));
  return result.toISOString();
}

export function buildMembershipCommitment(input: Omit<MembershipCommitment,
  "initialTermEndsAt" | "billingPlan" | "currency" | "installmentDues" | "totalInitialDues" | "buyoutCap">): MembershipCommitment {
  if (input.billingTermsVersion !== MEMBERSHIP_COMMITMENT_TERMS_VERSION
    || !Object.hasOwn(MEMBERSHIP_OFFERS, input.offerId)
    || !/^price_/.test(input.priceId) || !/^sub_/.test(input.subscriptionId) || !/^cus_/.test(input.customerId)
    || !/^[a-f0-9]{64}$/.test(input.agreementContentSha256) || !input.agreementVersion.trim()
    || Math.floor(timestamp(input.acceptedAt) / 1000) > Math.floor(timestamp(input.startsAt) / 1000)) {
    throw new MembershipCommitmentError("unaccepted_commitment_terms");
  }
  const offer = MEMBERSHIP_OFFERS[input.offerId];
  return {
    ...input, acceptedAt: new Date(input.acceptedAt).toISOString(), startsAt: new Date(input.startsAt).toISOString(),
    initialTermEndsAt: membershipCommitmentAnniversary(input.startsAt, 12), billingPlan: offer.plan,
    currency: "usd", installmentDues: offer.amount, totalInitialDues: offer.initialTermAmount,
    buyoutCap: MEMBERSHIP_BUYOUT_CAP,
  };
}

export function commitmentSnapshotFingerprint(contract: MembershipCommitment): string {
  // Explicit key order makes this stable after a jsonb round trip.
  return createHash("sha256").update(JSON.stringify([
    contract.id, contract.memberId, contract.subscriptionId, contract.customerId, contract.livemode,
    contract.offerId, contract.priceId, contract.agreementAcceptanceId, contract.agreementVersion,
    contract.agreementContentSha256, contract.acceptedAt, contract.startsAt, contract.initialTermEndsAt,
    contract.billingPlan, contract.currency, contract.installmentDues, contract.totalInitialDues,
    contract.buyoutCap, contract.billingTermsVersion,
  ])).digest("hex");
}

/** Complete reconciliation must include every subscription invoice, refunds and credit notes.
 * Unknown allocations, prorations, mixed invoices and unreviewed adjustments fail closed.
 * This policy never infers a contract for complimentary or legacy/pilot members.
 */
export function quoteMembershipCancellation(contract: MembershipCommitment, ledger: CommitmentLedger,
  intent: MembershipCancellationIntent, now = new Date()): MembershipCancellationQuote {
  if (intent !== "early_exit") throw new MembershipCommitmentError("renewal_provider_snapshot_required");
  if (contract.billingTermsVersion !== MEMBERSHIP_COMMITMENT_TERMS_VERSION) throw new MembershipCommitmentError("unaccepted_commitment_terms");
  for (const amount of [contract.installmentDues, contract.totalInitialDues, contract.buyoutCap]) cents(amount);
  if (!Number.isSafeInteger(ledger.revision) || ledger.revision < 1 || ledger.state !== "complete" || !ledger.reconciledAt
    || now.getTime() - timestamp(ledger.reconciledAt) > MEMBERSHIP_COMMITMENT_RECONCILIATION_MAX_AGE_MS
    || timestamp(ledger.reconciledAt) > now.getTime()) throw new MembershipCommitmentError("commitment_reconciliation_required");
  const start = timestamp(contract.startsAt), termEnd = timestamp(contract.initialTermEndsAt);
  if (now.getTime() < start || termEnd <= start) throw new MembershipCommitmentError("invalid_commitment_period");
  const invoices = [...ledger.invoices].sort((a, b) => timestamp(a.periodStart) - timestamp(b.periodStart));
  let initialDuesSettled = 0, accessThrough = start, previousEnd = start;
  const ids = new Set<string>();
  for (const invoice of invoices) {
    const periodStart = timestamp(invoice.periodStart), periodEnd = timestamp(invoice.periodEnd);
    for (const amount of [invoice.duesBilled, invoice.duesPaid, invoice.duesRefunded, invoice.duesCredited]) cents(amount);
    if (!invoice.invoiceId.startsWith("in_") || ids.has(invoice.invoiceId) || invoice.currency !== contract.currency
      || invoice.priceId !== contract.priceId || periodStart < start || periodEnd <= periodStart
      || periodStart < previousEnd || periodStart > now.getTime() || invoice.duesBilled !== contract.installmentDues
      || invoice.duesRefunded > invoice.duesPaid || invoice.duesPaid - invoice.duesRefunded + invoice.duesCredited > invoice.duesBilled
      || invoice.adjustmentState === "unresolved" || (invoice.duesRefunded > 0 || invoice.duesCredited > 0) && invoice.adjustmentState !== "reviewed"
      || invoice.state === "void" || invoice.state === "uncollectible") {
      throw new MembershipCommitmentError("commitment_invoice_review_required");
    }
    ids.add(invoice.invoiceId); previousEnd = periodEnd;
    const settled = invoice.duesPaid - invoice.duesRefunded + invoice.duesCredited;
    if (periodStart < termEnd) {
      if (periodEnd > termEnd) throw new MembershipCommitmentError("commitment_invoice_crosses_term");
      initialDuesSettled += settled;
    }
    if (invoice.state === "paid" && settled === invoice.duesBilled) accessThrough = Math.max(accessThrough, periodEnd);
  }
  // A complete reconciliation cannot silently omit an installment already due.
  const step = contract.billingPlan === "annual" ? 12 : 1;
  for (let month = 0; ; month += step) {
    const due = timestamp(membershipCommitmentAnniversary(contract.startsAt, month));
    if (due > now.getTime()) break;
    const end = timestamp(membershipCommitmentAnniversary(contract.startsAt, month + step));
    if (!invoices.some(invoice => timestamp(invoice.periodStart) === due && timestamp(invoice.periodEnd) === end)) {
      throw new MembershipCommitmentError("commitment_invoice_ledger_incomplete");
    }
  }
  if (initialDuesSettled > contract.totalInitialDues) throw new MembershipCommitmentError("commitment_overpayment_review_required");
  const remainingInitialDues = contract.totalInitialDues - initialDuesSettled;
  const beforeInitialEnd = now.getTime() < termEnd;
  const buyoutDues = intent === "early_exit" && beforeInitialEnd && contract.billingPlan === "monthly"
    ? Math.min(contract.buyoutCap, remainingInitialDues) : 0;
  const effectiveAt = Math.max(now.getTime(), accessThrough);
  const quote = {
    contractId: contract.id, memberId: contract.memberId, subscriptionId: contract.subscriptionId, livemode: contract.livemode,
    intent, ledgerRevision: ledger.revision, quotedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    effectiveAt: new Date(effectiveAt).toISOString(), accessThrough: new Date(accessThrough).toISOString(),
    remainingInitialDues, buyoutDues, currency: "usd" as const,
    replacesRemainingInstallments: intent === "early_exit" && contract.billingPlan === "monthly" && beforeInitialEnd,
  };
  return { ...quote, fingerprint: cancellationQuoteFingerprint(quote) };
}

export function cancellationQuoteFingerprint(quote: Omit<MembershipCancellationQuote, "fingerprint">): string {
  return createHash("sha256").update(JSON.stringify([
    quote.contractId, quote.memberId, quote.subscriptionId, quote.livemode, quote.intent, quote.ledgerRevision,
    quote.quotedAt, quote.expiresAt, quote.effectiveAt, quote.accessThrough, quote.remainingInitialDues,
    quote.buyoutDues, quote.currency, quote.replacesRemainingInstallments,
    quote.renewalProviderSnapshot ? [quote.renewalProviderSnapshot.subscriptionId, quote.renewalProviderSnapshot.customerId,
      quote.renewalProviderSnapshot.livemode, quote.renewalProviderSnapshot.currentPeriodEnd,
      quote.renewalProviderSnapshot.status, quote.renewalProviderSnapshot.observedAt, quote.renewalProviderSnapshot.cancelAt ?? null] : null,
  ])).digest("hex");
}

/** Stopping renewal never depends on settling disputed dues or producing a buyout.
 * The caller retrieves this subscription directly from Stripe and verifies its identity.
 * No new paid access is inferred from an unpaid Stripe billing period.
 */
export function quoteMembershipRenewalCancellation(contract: MembershipCommitment,
  provider: CommitmentRenewalProviderSnapshot, now = new Date()): MembershipCancellationQuote {
  if (contract.billingTermsVersion !== MEMBERSHIP_COMMITMENT_TERMS_VERSION
    || provider.subscriptionId !== contract.subscriptionId || provider.customerId !== contract.customerId
    || provider.livemode !== contract.livemode || !["active", "past_due", "unpaid", "canceled"].includes(provider.status)
    || timestamp(provider.observedAt) > now.getTime()
    || now.getTime() - timestamp(provider.observedAt) > MEMBERSHIP_COMMITMENT_RECONCILIATION_MAX_AGE_MS) {
    throw new MembershipCommitmentError("renewal_provider_snapshot_required");
  }
  const requestedEnd = Math.max(now.getTime(), timestamp(provider.currentPeriodEnd),
    contract.billingPlan === "monthly" ? timestamp(contract.initialTermEndsAt) : 0);
  // A prior, valid earlier cancellation must never be moved later by a second request.
  const effectiveAt = provider.status === "canceled" ? now.getTime()
    : provider.cancelAt ? Math.max(now.getTime(), Math.min(requestedEnd, timestamp(provider.cancelAt))) : requestedEnd;
  const quote = {
    contractId: contract.id, memberId: contract.memberId, subscriptionId: contract.subscriptionId, livemode: contract.livemode,
    intent: "disable_renewal" as const, ledgerRevision: 0, quotedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), effectiveAt: new Date(effectiveAt).toISOString(),
    accessThrough: null, remainingInitialDues: null, buyoutDues: 0, currency: "usd" as const,
    replacesRemainingInstallments: false, renewalProviderSnapshot: provider,
  };
  return { ...quote, fingerprint: cancellationQuoteFingerprint(quote) };
}
