import "server-only";
import type Stripe from "stripe";
import { type MembershipCommitment, MembershipCommitmentError } from "@/lib/stripe/commitment-policy";
import { matchesPrepaidMembershipInvoice, prepaidScheduleFromSubscription, prepaidScheduleFingerprint } from "@/lib/stripe/prepaid-policy";
import { recognizesMembershipSubscription } from "@/lib/stripe/price-policy";
import { getMembershipPriceConfiguration } from "@/lib/stripe/server";

const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;
const fail = (): never => { throw new MembershipCommitmentError("prepaid_payment_requires_review"); };

/** Retrieve the original collected payment, never infer it from a trial status.
 * Refund evidence is returned only when explicitly requested; callers bind it to
 * their durable cancellation identity before acknowledging a refund. */
export async function inspectPrepaidMembershipInvoice(stripe: Stripe, contract: MembershipCommitment,
  options: { allowRefund?: boolean; requireOnlyInitialInvoice?: boolean } = {}) {
  const subscription = await stripe.subscriptions.retrieve(contract.subscriptionId);
  const schedule = prepaidScheduleFromSubscription(subscription);
  if (!contract.billingSchedule || !schedule || prepaidScheduleFingerprint(schedule) !== prepaidScheduleFingerprint(contract.billingSchedule)
    || subscription.id !== contract.subscriptionId || contract.startsAt !== schedule.serviceStartsAt || subscription.livemode !== contract.livemode
    || id(subscription.customer) !== contract.customerId || subscription.metadata.ruined_member_id !== contract.memberId
    || subscription.metadata.ruined_checkout_attempt_id !== contract.id
    || subscription.metadata.ruined_commercial_reservation_id !== contract.id
    || subscription.metadata.ruined_offer_id !== contract.offerId || subscription.metadata.ruined_billing_plan !== contract.billingPlan
    || subscription.items.data[0]?.price.id !== contract.priceId
    || subscription.metadata.agreement_acceptance_id !== contract.agreementAcceptanceId
    || !recognizesMembershipSubscription(subscription, getMembershipPriceConfiguration())) return fail();
  let initial: Stripe.Invoice | null = null;
  let count = 0;
  for await (const invoice of stripe.invoices.list({ subscription: subscription.id, limit: 100 })) {
    if (++count > 600) return fail();
    if (invoice.billing_reason === "subscription_create") {
      if (initial) return fail();
      initial = await stripe.invoices.retrieve(invoice.id);
    }
  }
  if (options.requireOnlyInitialInvoice && count !== 1) return fail();
  if (!initial || !matchesPrepaidMembershipInvoice(initial, subscription) || initial.status !== "paid"
    || initial.amount_paid !== initial.total || initial.amount_remaining !== 0 || initial.amount_paid <= 0
    || initial.customer_address?.country !== "US" || initial.pre_payment_credit_notes_amount !== 0
    || initial.post_payment_credit_notes_amount !== 0 || initial.starting_balance !== 0 || initial.ending_balance !== 0) return fail();
  const notes = await stripe.creditNotes.list({ invoice: initial.id, limit: 1 });
  const payments = await stripe.invoicePayments.list({ invoice: initial.id, status: "paid", limit: 100 });
  if (notes.data.length || notes.has_more || payments.has_more || payments.data.length !== 1) return fail();
  const payment = payments.data[0], paymentIntentId = id(payment.payment.payment_intent);
  if (payment.status !== "paid" || payment.payment.type !== "payment_intent" || !paymentIntentId || payment.amount_paid !== initial.total
    || payment.currency !== initial.currency || payment.livemode !== contract.livemode || id(payment.invoice) !== initial.id) return fail();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const chargeId = id(intent.latest_charge);
  if (!chargeId || intent.status !== "succeeded" || intent.amount_received !== initial.total
    || intent.currency !== initial.currency || intent.livemode !== contract.livemode || id(intent.customer) !== contract.customerId) return fail();
  const charge = await stripe.charges.retrieve(chargeId);
  if (!charge.paid || !charge.captured || charge.status !== "succeeded" || charge.disputed || charge.amount !== initial.total
    || charge.currency !== initial.currency || charge.livemode !== contract.livemode || id(charge.customer) !== contract.customerId
    || id(charge.payment_intent) !== paymentIntentId) return fail();
  const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  if (refunds.has_more || refunds.data.length > 1 || (!options.allowRefund && (refunds.data.length || charge.amount_refunded || charge.refunded))) return fail();
  const refund = refunds.data[0] ?? null;
  if (refund && (refund.amount !== initial.total || refund.currency !== initial.currency
    || id(refund.charge) !== chargeId || id(refund.payment_intent) !== paymentIntentId)) return fail();
  if (!refund && (charge.amount_refunded !== 0 || charge.refunded)) return fail();
  if (refund?.status === "succeeded" && (!charge.refunded || charge.amount_refunded !== initial.total)) return fail();
  return { subscription, invoice: initial, invoiceId: initial.id, paymentIntentId, chargeId,
    amount: initial.total, currency: initial.currency, periodStart: schedule.serviceStartsAt,
    periodEnd: schedule.prepaidThrough, refund };
}
