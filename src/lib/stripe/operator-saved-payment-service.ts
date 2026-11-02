import "server-only";
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getCommercialMembershipReservation } from "@/lib/membership/commercial-repository";
import { reserveMembershipCheckout } from "./billing-repository";
import { getOperatorCheckoutMember, acceptOperatorSavedPaymentAgreement } from "./operator-membership-repository";
import { quoteOperatorMembership, operatorMembershipStatus } from "./operator-membership-service";
import { OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION, OperatorMembershipError, type OperatorMembershipQuote } from "./operator-membership-model";
import { getStripe, getStripeLivemode, getMembershipPriceConfiguration, isStripeTaxEnabled, validateStripeMembershipOfferPrice } from "./server";
import { validateMembershipPortalConfiguration } from "./portal";
import { inspectOperatorSavedPayment, operatorSavedPaymentParameters, matchesOperatorSavedSubscription,
  savedPaymentFingerprint, savedPaymentFailure, type SavedPaymentInspection } from "./operator-saved-payment-provider";
import { getOperatorSavedPaymentTarget, getOperatorSavedPaymentBinding, prepareOperatorSavedPaymentBinding,
  claimOperatorSavedPaymentBinding, bindOperatorSavedPaymentSubscription, failOperatorSavedPaymentBinding,
  getOperatorSavedPaymentReservation, type OperatorSavedPaymentBinding } from "./operator-saved-payment-repository";
import { reconcilePrepaidMembershipSubscription } from "./webhook";

export type OperatorSavedMembershipQuote = OperatorMembershipQuote & {
  total: number; tax: number; paymentMethodLabel: string; authorityVersion: string;
};
export type OperatorSavedMembershipResult = {
  state: "paid" | "pending" | "requires_action" | "failed" | "review";
  message: string; subscriptionId?: string;
};
type Actor = { authUserId: string; memberId: string };
const noReplay = "The payment result needs reconciliation. Do not start another payment.";
const providerId = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;

function token(actor: Actor, quote: OperatorMembershipQuote, inspection: SavedPaymentInspection) {
  return savedPaymentFingerprint([actor.authUserId, actor.memberId, quote.id, quote.reviewToken, quote.expiresAt,
    inspection.target.customerId, inspection.target.paymentMethodId, inspection.target.setupIntentId,
    inspection.target.stripeAccountId, inspection.target.livemode, inspection.mandateId,
    inspection.expectedTotal, inspection.tax, inspection.automaticTaxEnabled, inspection.customerFingerprint,
    OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION]);
}

async function reviewedQuote(input: Actor & { requestId: string; plan: "monthly" }) {
  if (input.plan !== "monthly") throw new OperatorMembershipError("Saved-payment collection currently supports individual monthly membership only.", 400);
  const target = await getOperatorSavedPaymentTarget(input);
  const { quote } = await quoteOperatorMembership(input);
  if (!quote.billingSchedule || quote.firstChargeAt || !["founding_individual_monthly", "individual_monthly"].includes(quote.offer.id)) {
    throw new OperatorMembershipError("This offer must use the member’s normal checkout.");
  }
  const commercial = await getCommercialMembershipReservation(quote.id);
  if (!commercial?.stripePriceId || commercial.kind !== "individual") throw new OperatorMembershipError("This membership offer is unavailable.");
  if (target.stripeAccountId !== process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() || target.livemode !== getStripeLivemode()) {
    throw new OperatorMembershipError("The saved payment belongs to a different Stripe account.");
  }
  const inspection = await inspectOperatorSavedPayment(getStripe(), { target, priceId: commercial.stripePriceId,
    offerId: commercial.offerId, schedule: quote.billingSchedule, automaticTaxEnabled: isStripeTaxEnabled(), priceConfiguration: getMembershipPriceConfiguration() });
  const savedQuote: OperatorSavedMembershipQuote = { ...quote, total: inspection.expectedTotal, tax: inspection.tax,
    paymentMethodLabel: inspection.paymentMethodLabel, authorityVersion: OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION,
    reviewToken: token(input, quote, inspection) };
  return { quote: savedQuote, inspection, commercial };
}

export async function quoteOperatorSavedMembership(input: Actor & { requestId: string; plan: "monthly" }) {
  const existing = await getOperatorSavedPaymentBinding(input);
  if (existing) throw new OperatorMembershipError("A saved-payment attempt already exists. Check its result before starting another.", 409, "saved_payment_exists");
  const { quote } = await reviewedQuote(input);
  return { quote };
}

/** Recovery performs reads and projection only. A lost response must never
 * manufacture a second subscription or send the first charge twice. */
async function recover(actor: Actor, binding: OperatorSavedPaymentBinding): Promise<OperatorSavedMembershipResult> {
  if (binding.status === "succeeded") {
    const member = await getOperatorCheckoutMember(actor.authUserId, actor.memberId, { allowIneligible: true });
    return member.paid ? { state: "paid", message: "First membership payment confirmed. Renewals follow the accepted schedule.", subscriptionId: binding.subscriptionId ?? undefined }
      : { state: "review", message: "A payment was recorded, but its current membership evidence needs review.", subscriptionId: binding.subscriptionId ?? undefined };
  }
  if (binding.status === "prepared") return { state: "pending", message: "Payment is prepared but has not been submitted." };
  const reservation = await getOperatorSavedPaymentReservation({ ...actor, attemptId: binding.attemptId });
  const stripe = getStripe();
  const subscriptions = await stripe.subscriptions.list({ customer: binding.customerId, status: "all", limit: 100 });
  if (subscriptions.has_more) return { state: "review", message: noReplay };
  const matches = subscriptions.data.filter(subscription => subscription.metadata.ruined_saved_payment_id === binding.attemptId
    || subscription.id === binding.subscriptionId);
  if (matches.length > 1) return { state: "review", message: noReplay };
  if (!matches.length) {
    const state = binding.errorCode === "authentication_required" ? "requires_action" : binding.errorCode === "payment_declined" ? "failed" : "review";
    return { state, message: binding.errorCode === "authentication_required"
      ? "The bank requires the member to authenticate payment. Review this attempt before opening a member checkout."
      : binding.errorCode === "payment_declined" ? "Stripe did not confirm payment. Review the saved method before retrying." : noReplay };
  }
  const subscription = await stripe.subscriptions.retrieve(matches[0].id);
  if (!matchesOperatorSavedSubscription(subscription, { reservation, target: { ...binding, email: "" }, automaticTaxEnabled: binding.automaticTaxEnabled })) {
    return { state: "review", message: noReplay, subscriptionId: subscription.id };
  }
  await bindOperatorSavedPaymentSubscription({ ...actor, attemptId: binding.attemptId, subscriptionId: subscription.id });
  await reconcilePrepaidMembershipSubscription(subscription.id);
  const final = await getOperatorSavedPaymentBinding({ ...actor, attemptId: binding.attemptId });
  if (final?.status === "succeeded") {
    const member = await getOperatorCheckoutMember(actor.authUserId, actor.memberId, { allowIneligible: true });
    if (member.paid) return { state: "paid", message: "First membership payment confirmed. Renewals follow the accepted schedule.", subscriptionId: subscription.id };
  }
  const latestInvoiceId = providerId(subscription.latest_invoice);
  if (latestInvoiceId) {
    const invoice = await stripe.invoices.retrieve(latestInvoiceId);
    if (providerId(invoice.customer) !== binding.customerId || invoice.livemode !== binding.livemode
      || providerId(invoice.parent?.subscription_details?.subscription) !== subscription.id
      || invoice.total !== binding.expectedTotal || invoice.currency !== "usd") return { state: "review", message: noReplay, subscriptionId: subscription.id };
    if (invoice.status === "paid") return { state: "review", message: "Stripe recorded a payment, but its membership evidence needs review. Do not charge again.", subscriptionId: subscription.id };
    const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 100 });
    if (payments.has_more) return { state: "review", message: noReplay, subscriptionId: subscription.id };
    for (const payment of payments.data) {
      const intentId = providerId(payment.payment.payment_intent);
      if (!intentId || providerId(payment.invoice) !== invoice.id) continue;
      const intent = await stripe.paymentIntents.retrieve(intentId);
      if (intent.livemode !== binding.livemode || providerId(intent.customer) !== binding.customerId
        || intent.amount !== binding.expectedTotal || intent.currency !== "usd") return { state: "review", message: noReplay, subscriptionId: subscription.id };
      if (intent.status === "requires_action") return { state: "requires_action", message: "The bank requires the member to authenticate this payment. Review the existing subscription before starting any other checkout.", subscriptionId: subscription.id };
      if (intent.status === "requires_payment_method" || intent.status === "canceled") return { state: "failed", message: "The first payment was not collected. Review the existing subscription and saved payment method before retrying.", subscriptionId: subscription.id };
    }
  }
  return { state: "pending", message: "Stripe’s payment is being reconciled with the membership. Do not start another payment.", subscriptionId: subscription.id };
}

export async function statusOperatorSavedMembership(authUserId: string, memberId: string) {
  const actor = { authUserId, memberId };
  const status = await operatorMembershipStatus(authUserId, memberId);
  const binding = await getOperatorSavedPaymentBinding(actor);
  if (binding) {
    const result = await recover(actor, binding);
    return { ...status, eligible: false, state: result.state, result, reason: result.message, paymentMethodLabel: null };
  }
  if (!status.eligible) return { ...status, state: status.paid ? "paid" : "unavailable", paymentMethodLabel: null };
  try {
    await getOperatorSavedPaymentTarget(actor);
    return { ...status, state: "ready", paymentMethodLabel: "Saved payment method" };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { ...status, eligible: false, state: "unavailable", paymentMethodLabel: null,
      reason: "This member has no available saved payment method. Use member checkout or the separate operator-card checkout." };
  }
}

export async function startOperatorSavedMembership(input: Actor & {
  reservationId: string; reviewToken: string; authorityAccepted: boolean; authorityVersion: string;
  authorizationEvidence: string; applicationOrigin: string; userAgent: string | null;
}): Promise<OperatorSavedMembershipResult> {
  if (input.authorityAccepted !== true || input.authorityVersion !== OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION
    || typeof input.authorizationEvidence !== "string" || input.authorizationEvidence.trim().length < 20 || input.authorizationEvidence.length > 3000) {
    throw new OperatorMembershipError("Record the member’s specific permission for their first payment and recurring renewals before collection.", 400);
  }
  const actor = { authUserId: input.authUserId, memberId: input.memberId };
  const previous = await getOperatorSavedPaymentBinding({ ...actor, attemptId: input.reservationId });
  if (previous && previous.status !== "prepared") return recover(actor, previous);
  const { quote, inspection, commercial } = await reviewedQuote({ ...actor, requestId: input.reservationId, plan: "monthly" });
  if (quote.id !== input.reservationId || quote.reviewToken !== input.reviewToken || Date.parse(quote.expiresAt) <= Date.now()) {
    throw new OperatorMembershipError("The method, price, tax, or agreement changed. Review the payment again.", 409, "review_changed");
  }
  await validateMembershipPortalConfiguration("commitment");
  const priceId = await validateStripeMembershipOfferPrice(commercial.offerId);
  if (priceId !== commercial.stripePriceId) throw new OperatorMembershipError("The membership price changed. Review it again.");
  const { acceptanceId } = await acceptOperatorSavedPaymentAgreement({ ...actor, reservationId: commercial.id,
    authorityAccepted: true, authorityVersion: input.authorityVersion, origin: input.applicationOrigin, userAgent: input.userAgent,
    expectedAgreementVersion: quote.agreement.version, expectedAgreementSha256: createHash("sha256").update(quote.agreement.bodyText).digest("hex"),
    evidence: { source: "operator_recorded_member_authorization", statement: input.authorizationEvidence.trim() } });
  const reservation = await reserveMembershipCheckout({ acceptanceId, attemptId: commercial.id, commercialReservationId: commercial.id,
    authUserId: input.authUserId, operatorMemberId: input.memberId, email: inspection.target.email, plan: "monthly",
    stripePriceId: priceId, paidAgreementVersion: quote.agreement.version, consentSource: "operator_saved_payment" });
  const params = operatorSavedPaymentParameters({ reservation, inspection, minimumAge: getPlatformConfiguration().minimumAge });
  const binding = await prepareOperatorSavedPaymentBinding({ ...actor, attemptId: reservation.attemptId,
    ...inspection.target, mandateId: inspection.mandateId, providerRequestSha256: savedPaymentFingerprint(params),
    expectedTotal: inspection.expectedTotal, automaticTaxEnabled: inspection.automaticTaxEnabled });
  const claimed = await claimOperatorSavedPaymentBinding({ ...actor, attemptId: binding.attemptId });
  if (!claimed.claimed) return recover(actor, claimed.binding);
  // One durable transition grants one provider create. SDK retries are disabled;
  // even after an unknown result, recovery only searches the original identity.
  let subscription: Stripe.Subscription;
  try {
    subscription = await getStripe().subscriptions.create(params, {
      idempotencyKey: `ruined-operator-saved-payment:${binding.stripeAccountId}:${binding.livemode}:${binding.attemptId}`,
      maxNetworkRetries: 0,
    });
  } catch (error) {
    const failure = savedPaymentFailure(error);
    await failOperatorSavedPaymentBinding({ ...actor, attemptId: binding.attemptId, errorCode: failure.code, definitive: false });
    // A provider error can still accompany a created subscription; reconcile
    // before deciding whether there is anything for the member to retry.
    const current = (await getOperatorSavedPaymentBinding({ ...actor, attemptId: binding.attemptId }))!;
    const result = await recover(actor, current);
    return result.state === "review" && failure.state !== "review" ? { ...result, state: failure.state, message: failure.message } : result;
  }
  if (!matchesOperatorSavedSubscription(subscription, { reservation, target: inspection.target, automaticTaxEnabled: inspection.automaticTaxEnabled })) {
    await failOperatorSavedPaymentBinding({ ...actor, attemptId: binding.attemptId, errorCode: "provider_identity_mismatch", definitive: false });
    return { state: "review", message: noReplay };
  }
  await bindOperatorSavedPaymentSubscription({ ...actor, attemptId: binding.attemptId, subscriptionId: subscription.id });
  return recover(actor, (await getOperatorSavedPaymentBinding({ ...actor, attemptId: binding.attemptId }))!);
}
