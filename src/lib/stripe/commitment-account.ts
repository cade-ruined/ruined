import "server-only";

import { getBillingDatabase } from "@/lib/stripe/database";
import { getStripeLivemode } from "@/lib/stripe/server";
import type { MembershipCommitment } from "@/lib/stripe/commitment-policy";

/** The payer's durable accepted contract, never a browser-supplied subscription. */
export async function getMemberBillingCommitment(memberId: string): Promise<MembershipCommitment | null> {
  const sql = getBillingDatabase();
  const rows = await sql<Array<{ terms: MembershipCommitment }>>`
    select c.terms_snapshot as terms from stripe_membership_commitments c
    join stripe_subscriptions s on s.id = c.stripe_subscription_id and s.member_id = c.member_id
    where c.member_id = ${memberId}::uuid and c.livemode = ${getStripeLivemode()}
    order by c.created_at desc limit 1
  `;
  return rows[0]?.terms ?? null;
}

export type MemberBillingCommitmentSummary = {
  startsAt: string;
  initialTermEndsAt: string;
  plan: "monthly" | "annual";
  installmentDues: number;
  status: "scheduled" | "active" | "pending_payment" | "canceled" | "review_required" | "refund_pending";
  canCancelBeforeStart: boolean;
  canceledBeforeStart: boolean;
  billingSchedule?: MembershipCommitment["billingSchedule"];
  refundAmount?: number;
  refundStatus?: "pending" | "succeeded" | null;
  cancellationQuoteId?: string | null;
};

/** Display only durable billing evidence. A Checkout return URL proves nothing. */
export async function getMemberBillingCommitmentSummary(memberId: string, now = new Date()): Promise<MemberBillingCommitmentSummary | null> {
  const sql = getBillingDatabase();
  const rows = await sql<Array<{ terms: MembershipCommitment; contractStatus: string; subscriptionStatus: string;
    prestartCanceled: boolean; prestartReview: boolean; paid: boolean; cancellationQuoteId: string | null }>>`
    select c.terms_snapshot as terms, c.status as "contractStatus", s.stripe_status as "subscriptionStatus",
      exists (select 1 from stripe_membership_cancellations cancellation where cancellation.contract_id = c.id
        and cancellation.intent = 'cancel_before_start' and cancellation.status = 'completed') as "prestartCanceled",
      exists (select 1 from stripe_membership_cancellations cancellation where cancellation.contract_id = c.id
        and cancellation.intent = 'cancel_before_start' and cancellation.status = 'manual_review') as "prestartReview",
      (select cancellation.id from stripe_membership_cancellations cancellation where cancellation.contract_id = c.id
        and cancellation.intent = 'cancel_before_start' and cancellation.status in ('requested','billing_stopped','collection_in_flight')
        order by cancellation.created_at desc limit 1) as "cancellationQuoteId",
      exists (select 1 from stripe_invoices invoice where invoice.id = s.latest_invoice_id
        and invoice.member_id = c.member_id and invoice.stripe_subscription_id = s.id
        and invoice.purpose = 'membership' and invoice.stripe_status = 'paid' and invoice.amount_paid > 0) as paid
    from stripe_membership_commitments c
    join stripe_subscriptions s on s.id = c.stripe_subscription_id and s.member_id = c.member_id
    where c.member_id = ${memberId}::uuid and c.livemode = ${getStripeLivemode()}
    order by c.created_at desc limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const beforeStart = now.getTime() < Date.parse(row.terms.startsAt);
  if (row.terms.billingSchedule) {
    const { getMembershipPrepayment } = await import("@/lib/stripe/billing-repository");
    const proof = await sql.begin(tx => getMembershipPrepayment(tx, { subscriptionId: row.terms.subscriptionId }));
    const refunded = proof?.refundState === "refunded" && row.prestartCanceled;
    const review = row.contractStatus === "manual_review" || row.prestartReview
      || proof && ["partial", "review_required"].includes(proof.refundState)
      || row.subscriptionStatus === "canceled" && !refunded && !row.cancellationQuoteId;
    const refundPending = row.cancellationQuoteId && !refunded;
    const settled = proof?.refundState === "none" && proof.amountPaid >= row.terms.installmentDues;
    const currentPaid = settled && (row.subscriptionStatus === "trialing" && now.getTime() < Date.parse(row.terms.billingSchedule.prepaidThrough)
      || row.subscriptionStatus === "active" && row.paid);
    const status = review ? "review_required" : refunded ? "canceled" : refundPending ? "refund_pending"
      : beforeStart && settled ? "scheduled" : !beforeStart && currentPaid && proof?.activatedAt ? "active" : "pending_payment";
    return { startsAt: row.terms.startsAt, initialTermEndsAt: row.terms.initialTermEndsAt,
      plan: row.terms.billingPlan, installmentDues: row.terms.installmentDues, status,
      billingSchedule: row.terms.billingSchedule, refundAmount: proof?.amountPaid ?? 0,
      refundStatus: refunded ? "succeeded" : refundPending ? "pending" : null,
      cancellationQuoteId: status === "refund_pending" ? row.cancellationQuoteId : null,
      canceledBeforeStart: refunded,
      canCancelBeforeStart: status === "scheduled" && row.contractStatus === "active" && row.subscriptionStatus === "trialing" };
  }
  const status = row.contractStatus === "manual_review" || row.prestartReview ? "review_required"
    : row.prestartCanceled || row.subscriptionStatus === "canceled" ? "canceled"
      : beforeStart ? "scheduled" : row.paid && row.subscriptionStatus === "active" ? "active" : "pending_payment";
  return { startsAt: row.terms.startsAt, initialTermEndsAt: row.terms.initialTermEndsAt,
    plan: row.terms.billingPlan, installmentDues: row.terms.installmentDues, status,
    canceledBeforeStart: status === "canceled" && row.prestartCanceled,
    canCancelBeforeStart: status === "scheduled" && row.contractStatus === "active" && row.subscriptionStatus === "active" };
}
