import "server-only";

import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { getMembershipPriceConfiguration, getStripe } from "@/lib/stripe/server";
import { matchesMembershipInvoice, recognizesMembershipSubscription } from "@/lib/stripe/price-policy";
import { MembershipCommitmentError, type CommitmentInvoice, type CommitmentPrestartProviderSnapshot,
  type MembershipCommitment } from "@/lib/stripe/commitment-policy";

export const stripeObjectId = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;

export function verifyCommitmentSubscription(subscription: Stripe.Subscription, contract: MembershipCommitment) {
  if (subscription.id !== contract.subscriptionId || stripeObjectId(subscription.customer) !== contract.customerId
    || subscription.livemode !== contract.livemode || !recognizesMembershipSubscription(subscription, getMembershipPriceConfiguration())
    || subscription.items.data[0]?.price.id !== contract.priceId || subscription.metadata.ruined_member_id !== contract.memberId
    || subscription.schedule || subscription.pause_collection || subscription.pending_update
    || !["active", "past_due", "unpaid", "canceled"].includes(subscription.status)) {
    throw new MembershipCommitmentError("subscription_requires_review");
  }
  return subscription.items.data[0];
}

/** The scheduled start is consented and immutable. A no-fee cancellation may
 * never absorb an invoice, pending item, changed anchor, or an in-flight payment. */
export async function readPrestartCancellationEvidence(contract: MembershipCommitment, now = new Date()) {
  const stripe = getStripe(), subscription = await stripe.subscriptions.retrieve(contract.subscriptionId);
  verifyCommitmentSubscription(subscription, contract);
  const startsAt = Date.parse(contract.startsAt);
  const canceledAt = subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null;
  if (subscription.billing_cycle_anchor * 1000 !== startsAt
    || subscription.metadata.ruined_first_charge_at !== contract.startsAt
    || subscription.latest_invoice || subscription.cancel_at || subscription.cancel_at_period_end
    || subscription.status !== "active" && subscription.status !== "canceled"
    || subscription.status === "active" && (now.getTime() >= startsAt || canceledAt !== null)
    || subscription.status === "canceled" && (!canceledAt || Date.parse(canceledAt) >= startsAt)) {
    throw new MembershipCommitmentError("prestart_cancellation_requires_review");
  }
  const invoices = await stripe.invoices.list({ subscription: contract.subscriptionId, limit: 1 });
  const pending = await stripe.invoiceItems.list({ customer: contract.customerId, pending: true, limit: 1 });
  if (invoices.data.length || invoices.has_more || pending.data.length || pending.has_more) {
    throw new MembershipCommitmentError("prestart_invoice_requires_review");
  }
  const snapshot: CommitmentPrestartProviderSnapshot = { subscriptionId: subscription.id,
    customerId: stripeObjectId(subscription.customer)!, livemode: subscription.livemode,
    status: subscription.status as "active" | "canceled", firstChargeAt: contract.startsAt, canceledAt,
    observedAt: new Date().toISOString(), hasInvoices: false, pendingInvoiceItems: false };
  return { subscription, snapshot };
}

/** Automatic early exit handles fully settled, unadjusted invoices. Credits,
 * disputes, partial payments, unpaid invoices and unusual anchors receive review;
 * none of these conditions prevent the separate no-fee renewal cancellation. */
export async function readCommitmentProviderEvidence(contract: MembershipCommitment) {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(contract.subscriptionId);
  verifyCommitmentSubscription(subscription, contract);
  // Stripe applies an existing invoice balance when the next invoice finalizes.
  // A debit could increase the hosted fee amount without changing invoice.total.
  const customer = await stripe.customers.retrieve(contract.customerId, { expand: ["cash_balance"] });
  if (customer.deleted || customer.id !== contract.customerId || customer.livemode !== contract.livemode
    || customer.balance !== 0 || (customer.invoice_credit_balance?.usd ?? 0) !== 0
    || (customer.cash_balance?.available?.usd ?? 0) !== 0) {
    throw new MembershipCommitmentError("customer_balance_requires_review");
  }
  const invoices: CommitmentInvoice[] = [];
  for await (const invoice of stripe.invoices.list({ subscription: contract.subscriptionId, limit: 100 })) {
    if (invoices.length >= 600) throw new MembershipCommitmentError("invoice_history_requires_review");
    if (stripeObjectId(invoice.customer) !== contract.customerId
      || !matchesMembershipInvoice(invoice, subscription, getMembershipPriceConfiguration())
      || invoice.status !== "paid" || invoice.amount_remaining !== 0
      || invoice.total_excluding_tax !== contract.installmentDues || invoice.amount_paid !== invoice.total
      || invoice.starting_balance !== 0 || invoice.pre_payment_credit_notes_amount !== 0
      || invoice.post_payment_credit_notes_amount !== 0 || invoice.total_discount_amounts?.some(d => d.amount !== 0)) {
      throw new MembershipCommitmentError("invoice_history_requires_review");
    }
    // Even fully paid invoices may later be refunded outside their invoice.
    const notes = await stripe.creditNotes.list({ invoice: invoice.id, limit: 1 });
    if (notes.data.length) throw new MembershipCommitmentError("invoice_history_requires_review");
    let settled = 0;
    for await (const payment of stripe.invoicePayments.list({ invoice: invoice.id, limit: 100 })) {
      if (payment.status === "canceled") continue;
      if (payment.status !== "paid" || payment.livemode !== contract.livemode
        || stripeObjectId(payment.invoice) !== invoice.id || payment.payment.type !== "payment_intent") {
        throw new MembershipCommitmentError("invoice_history_requires_review");
      }
      const intentId = stripeObjectId(payment.payment.payment_intent);
      if (!intentId) throw new MembershipCommitmentError("invoice_history_requires_review");
      const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
      const charge = intent.latest_charge;
      if (!charge || typeof charge === "string" || charge.disputed || charge.refunded || charge.amount_refunded !== 0
        || intent.status !== "succeeded" || stripeObjectId(intent.customer) !== contract.customerId
        || intent.livemode !== contract.livemode || intent.currency !== invoice.currency
        || charge.livemode !== contract.livemode || stripeObjectId(charge.customer) !== contract.customerId
        || charge.currency !== invoice.currency || !charge.paid || !charge.captured || charge.status !== "succeeded"
        || charge.amount !== payment.amount_paid || intent.amount_received !== payment.amount_paid) {
        throw new MembershipCommitmentError("invoice_history_requires_review");
      }
      const refunds = await stripe.refunds.list({ payment_intent: intentId, limit: 1 });
      if (refunds.data.length) throw new MembershipCommitmentError("invoice_history_requires_review");
      settled += payment.amount_paid ?? 0;
    }
    if (settled !== invoice.total) throw new MembershipCommitmentError("invoice_history_requires_review");
    const line = invoice.lines.data[0];
    invoices.push({ invoiceId: invoice.id, periodStart: new Date(line.period.start * 1000).toISOString(),
      periodEnd: new Date(line.period.end * 1000).toISOString(), currency: invoice.currency, priceId: contract.priceId,
      duesBilled: contract.installmentDues, duesPaid: contract.installmentDues, duesRefunded: 0, duesCredited: 0,
      state: "paid", adjustmentState: "none" });
  }
  const pending = await stripe.invoiceItems.list({ customer: contract.customerId, pending: true, limit: 1 });
  if (pending.data.length) throw new MembershipCommitmentError("pending_invoice_items_require_review");
  invoices.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
  const fingerprint = createHash("sha256").update(JSON.stringify({ invoices, subscriptionId: subscription.id,
    periodEnd: subscription.items.data[0].current_period_end, status: subscription.status })).digest("hex");
  return { subscription, invoices, fingerprint };
}
