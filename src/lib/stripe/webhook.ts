import "server-only";

import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { prepaidScheduleFromSubscription } from "@/lib/stripe/prepaid-policy";
import { reconcileMemberBadgesForStripeEvent } from "@/lib/membership/badge-repository";

import {
  type BillingMember,
  type BillingTransaction,
  claimWebhookEvent,
  completeWebhookEvent,
  ensureBillingMember,
  findMemberBySubscription,
  hasMembershipCheckoutConsent,
  reconcileCheckoutAttempt,
  recordWebhookFailure,
  updateMemberBillingState,
  upsertCheckoutSession,
  upsertInvoice,
  upsertSubscription,
} from "@/lib/stripe/billing-repository";
import { getBillingDatabase } from "@/lib/stripe/database";
import {
  MEMBERSHIP_CONTEXT,
  type StripeSubscriptionState,
  applyBillingGuardrails,
  deriveMembershipState,
  isUuid,
  unixSecondsToDate,
} from "@/lib/stripe/membership-state";
import {
  getStripe,
  getMembershipPriceConfiguration,
  isStripeTaxEnabled,
} from "@/lib/stripe/server";

import { hasFullMembershipPayment, matchesMembershipInvoice, recognizesMembershipSubscription } from "@/lib/stripe/price-policy";
import { isMembershipBillingPlan } from "@/lib/membership/pricing";

type WebhookResult = {
  duplicate: boolean;
  handled: boolean;
  runMembershipWork?: boolean;
};

function expandableId(value: { id: string } | string | null | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.id ?? null;
}

function parseMetadataDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  return expandableId(invoice.parent?.subscription_details?.subscription);
}

function metadataFromInvoice(invoice: Stripe.Invoice): Stripe.Metadata | null {
  return invoice.parent?.subscription_details?.metadata ?? invoice.metadata;
}

async function customerEmail(
  customer: Stripe.Customer | Stripe.DeletedCustomer | string | null,
  fallback: string | null = null,
): Promise<string | null> {
  if (fallback) return fallback;

  if (customer && typeof customer !== "string" && !customer.deleted) {
    return customer.email;
  }

  const customerId = expandableId(customer);
  if (!customerId) return null;

  const retrieved = await getStripe().customers.retrieve(customerId);
  return retrieved.deleted ? null : retrieved.email;
}

async function handleCheckoutSession(
  tx: BillingTransaction,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): Promise<boolean> {
  if (session.metadata?.ruined_context !== MEMBERSHIP_CONTEXT) {
    return false;
  }

  const memberId = session.metadata.ruined_member_id ?? session.client_reference_id;
  const customerId = expandableId(session.customer);
  const subscriptionId = expandableId(session.subscription);
  const email = await customerEmail(session.customer, session.customer_details?.email ?? session.customer_email);

  // Match the invoice path's participant → attempt lock order, including the
  // two adults on one bill, before reconciling a completed native Checkout.
  if (subscriptionId && (session.metadata.ruined_billing_schedule_version || session.metadata.billing_consent_source === "stripe_checkout")) {
    const current = await getStripe().subscriptions.retrieve(subscriptionId);
    const { lockCommitmentSubscriptionProjection } = await import("@/lib/stripe/commitment-webhook");
    await lockCommitmentSubscriptionProjection(tx, current);
  }

  const checkoutAttemptId = session.metadata.ruined_checkout_attempt_id;
  if (isUuid(checkoutAttemptId)) {
    await reconcileCheckoutAttempt(tx, {
      acceptanceId: isUuid(session.metadata.agreement_acceptance_id)
        ? session.metadata.agreement_acceptance_id
        : null,
      attemptId: checkoutAttemptId,
      expiresAt: new Date(session.expires_at * 1_000),
      sessionId: session.id,
      status:
        session.status === "complete"
          ? "completed"
          : session.status === "expired"
            ? "expired"
            : "open",
      subscriptionId,
    });
  }


  // An expired, never-completed Session might have no Customer. Its event is
  // still durably acknowledged, but there is no billing identity to persist.
  if (!isUuid(memberId) || !customerId || !email) {
    if (event.type === "checkout.session.expired") return true;
    throw new Error("Membership Checkout Session is missing its billing identity.");
  }

  const member = await ensureBillingMember(tx, {
    agreementAcceptedAt: parseMetadataDate(session.metadata.agreement_accepted_at),
    agreementVersion: session.metadata.agreement_version ?? null,
    ageAttestedAt: parseMetadataDate(session.metadata.age_attested_at),
    candidateMemberId: memberId,
    customerId,
    email,
  });

  await upsertCheckoutSession(tx, {
    customerId,
    eventCreated: event.created,
    id: session.id,
    livemode: session.livemode,
    memberId: member.id,
    paymentStatus: session.payment_status,
    sessionStatus: session.status,
    subscriptionId,
  });

  if (session.status === "complete" && subscriptionId) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const { reconcileNativeCheckoutConsent } = await import("@/lib/stripe/checkout-consent");
    await reconcileNativeCheckoutConsent(tx, getStripe(), { subscription, sessionId: session.id, eventId: event.id });
  }

  if (session.status === "complete" && subscriptionId && session.metadata.ruined_first_charge_at) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    if (!isExpectedMembershipPrice(subscription)) throw new Error("Scheduled membership price does not match the accepted offer.");
    await upsertSubscription(tx, subscriptionSnapshot(subscription, member.id, event.created));
    const { prepareScheduledMembershipProjection, releaseCanceledScheduledMembership } = await import("@/lib/stripe/commitment-webhook");
    await prepareScheduledMembershipProjection(tx, { subscription, session, memberId: member.id });
    await releaseCanceledScheduledMembership(tx, subscription);
  }


  if (session.status === "complete" && subscriptionId && (session.metadata.ruined_billing_schedule_version ||
    session.metadata.billing_consent_source === "stripe_checkout" && !session.metadata.ruined_first_charge_at)) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const latestInvoiceId = expandableId(subscription.latest_invoice);
    if (latestInvoiceId) await handleInvoice(tx, event, await getStripe().invoices.retrieve(latestInvoiceId));
  }
  return true;
}

function subscriptionSnapshot(
  subscription: Stripe.Subscription,
  memberId: string,
  eventCreated: number,
) {
  const primaryItem = subscription.items.data[0];

  return {
    automaticTaxDisabledReason: subscription.automatic_tax.disabled_reason,
    automaticTaxEnabled: subscription.automatic_tax.enabled,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: unixSecondsToDate(subscription.cancel_at),
    currentPeriodEnd: unixSecondsToDate(primaryItem?.current_period_end),
    currentPeriodStart: unixSecondsToDate(primaryItem?.current_period_start),
    customerId: expandableId(subscription.customer) ?? "",
    eventCreated,
    id: subscription.id,
    latestInvoiceId: expandableId(subscription.latest_invoice),
    memberId,
    priceId: primaryItem?.price.id ?? null,
    status: subscription.status,
  };
}

async function ensureMemberFromSubscription(
  tx: BillingTransaction,
  subscription: Stripe.Subscription,
  fallbackEmail: string | null,
): Promise<BillingMember | null> {
  const existing = await findMemberBySubscription(tx, subscription.id);
  if (existing) return existing;

  const candidateMemberId = subscription.metadata.ruined_member_id;
  const customerId = expandableId(subscription.customer);
  const email = await customerEmail(subscription.customer, fallbackEmail);

  if (!isUuid(candidateMemberId) || !customerId || !email) {
    return null;
  }

  return ensureBillingMember(tx, {
    agreementAcceptedAt: parseMetadataDate(subscription.metadata.agreement_accepted_at),
    agreementVersion: subscription.metadata.agreement_version ?? null,
    ageAttestedAt: parseMetadataDate(subscription.metadata.age_attested_at),
    candidateMemberId,
    customerId,
    email,
  });
}

function isExpectedMembershipPrice(subscription: Stripe.Subscription): boolean {
  return recognizesMembershipSubscription(subscription, getMembershipPriceConfiguration());
}

async function handleInvoice(
  tx: BillingTransaction,
  event: Stripe.Event,
  invoice: Stripe.Invoice,
): Promise<boolean> {
  const metadata = metadataFromInvoice(invoice);
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  // Buyout invoices replace installments; they must never activate membership.
  const replacementFee = Boolean(invoice.metadata?.ruined_cancellation_id) || invoice.metadata?.ruined_context === "membership_cancellation";
  const isMembership = !replacementFee && metadata?.ruined_context === MEMBERSHIP_CONTEXT;
  const customerId = expandableId(invoice.customer);
  let member: BillingMember | null = null;
  let subscription: Stripe.Subscription | null = null;
  let membershipPriceMatches = false;
  let nativeConsentPending = false;

  if (isMembership && subscriptionId) {
    subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    if (subscription.metadata.billing_terms_version === "membership-billing-v2") {
      invoice = await getStripe().invoices.retrieve(invoice.id);
    }
    if (subscription.metadata.ruined_billing_schedule_version || subscription.metadata.billing_consent_source === "stripe_checkout") {
      const { lockCommitmentSubscriptionProjection } = await import("@/lib/stripe/commitment-webhook");
      await lockCommitmentSubscriptionProjection(tx, subscription);
    }
    member = await ensureMemberFromSubscription(tx, subscription, invoice.customer_email);
    membershipPriceMatches = matchesMembershipInvoice(invoice, subscription, getMembershipPriceConfiguration());
    if (subscription.metadata.billing_terms_version === "membership-billing-v2") {
      const { reconcileNativeCheckoutConsent } = await import("@/lib/stripe/checkout-consent");
      nativeConsentPending = !await reconcileNativeCheckoutConsent(tx, getStripe(), { subscription, eventId: event.id });
    }
    const plan = subscription.metadata.ruined_billing_plan;
    if (isMembershipBillingPlan(plan)) {
      const attemptId = subscription.metadata.ruined_checkout_attempt_id;
      const acceptanceId = subscription.metadata.agreement_acceptance_id;
      membershipPriceMatches = membershipPriceMatches && member !== null && isUuid(attemptId) && isUuid(acceptanceId) &&
        await hasMembershipCheckoutConsent(tx, {
          memberId: member.id, attemptId, acceptanceId, plan,
          priceId: subscription.items.data[0].price.id, subscriptionId: subscription.id,
          ...(subscription.metadata.billing_terms_version === "membership-billing-v2" ? {
            billingTermsVersion: subscription.metadata.billing_terms_version,
            offerId: subscription.metadata.ruined_offer_id,
            commercialReservationId: subscription.metadata.ruined_commercial_reservation_id,
            firstChargeAt: subscription.metadata.ruined_first_charge_at ?? null,
            billingSchedule: prepaidScheduleFromSubscription(subscription),
          } : {}),
        });
    }
  }

  // A paid invoice can precede Checkout's final state. Defer before persisting
  // it as a price mismatch or advancing any event-time fence: the completed
  // Checkout event may arrive later with an OLDER provider timestamp. Its fresh
  // retrieval must still be able to project this invoice once consent is real.
  if (nativeConsentPending) return true;

  const purpose = isMembership
    ? membershipPriceMatches
      ? "membership"
      : "membership_price_mismatch"
    : invoice.metadata?.ruined_context === "consulting"
      ? "consulting"
      : "unclassified";

  await upsertInvoice(tx, {
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    billingReason: invoice.billing_reason,
    currency: invoice.currency,
    customerId,
    eventCreated: event.created,
    id: invoice.id,
    memberId: member?.id ?? null,
    paidAt: invoice.status === "paid" ? unixSecondsToDate(invoice.status_transitions.paid_at) : null,
    purpose,
    status: invoice.status,
    subscriptionId,
  });

  if (isMembership && subscription && !member) {
    throw new Error("Membership invoice cannot be linked to a Ruined member.");
  }

  if (!isMembership || !subscription || !member) {
    return true;
  }

  const snapshot = subscriptionSnapshot(subscription, member.id, event.created);
  if (!snapshot.customerId) {
    throw new Error("Membership subscription has no Stripe Customer.");
  }
  await upsertSubscription(tx, snapshot);

  const v2 = subscription.metadata.billing_terms_version === "membership-billing-v2";
  const latestInvoiceId = expandableId(subscription.latest_invoice);
  if (subscription.metadata.ruined_billing_schedule_version && latestInvoiceId && latestInvoiceId !== invoice.id) {
    return handleInvoice(tx, event, await getStripe().invoices.retrieve(latestInvoiceId));
  }
  if (v2) {
    const { invalidateCommitmentFromInvoice } = await import("@/lib/stripe/commitment-webhook");
    if (subscription.metadata.ruined_billing_schedule_version || subscription.metadata.billing_consent_source === "stripe_checkout") {
      const { lockCommitmentSubscriptionProjection } = await import("@/lib/stripe/commitment-webhook");
      await lockCommitmentSubscriptionProjection(tx, subscription);
      await tx`select pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'))`;
    } else await invalidateCommitmentFromInvoice(tx, invoice, event);
    if (!subscription.metadata.ruined_billing_schedule_version && expandableId(subscription.latest_invoice) !== invoice.id) return true; // Old invoices cannot overwrite the current paid projection.
  }
  const scheduledFirstCharge = subscription.metadata.ruined_first_charge_at;
  const scheduledPaymentEligible = !scheduledFirstCharge || (Number.isFinite(Date.parse(scheduledFirstCharge)) &&
    Date.parse(scheduledFirstCharge) <= Date.now() && invoice.lines.data[0]?.period.start >= Date.parse(scheduledFirstCharge) / 1000);
  let verifiedPayment = hasFullMembershipPayment(invoice, subscription) && membershipPriceMatches && scheduledPaymentEligible;
  if (v2 && verifiedPayment) {
    const { hasVerifiedCommitmentInvoicePayment } = await import("@/lib/stripe/commitment-webhook");
    verifiedPayment = await hasVerifiedCommitmentInvoicePayment(getStripe(), invoice, subscription);
  }
  const paymentProblem = v2 ? !verifiedPayment :
    event.type === "invoice.marked_uncollectible" ||
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.payment_action_required" ||
    event.type === "invoice.voided" ||
    !membershipPriceMatches;
  const taxProblem =
    isStripeTaxEnabled() &&
    (!subscription.automatic_tax.enabled || Boolean(subscription.automatic_tax.disabled_reason));
  const currentState = deriveMembershipState({
    paidInvoice: (v2 ? verifiedPayment : event.type === "invoice.paid" && invoice.amount_paid > 0 && verifiedPayment),
    previousState: member.membershipState,
    subscriptionState: subscription.status as StripeSubscriptionState,
  });
  let state = applyBillingGuardrails({
    hasOperationalProblem: !membershipPriceMatches || taxProblem || paymentProblem,
    state: currentState,
  });

  if (v2 && membershipPriceMatches && subscription.metadata.ruined_billing_schedule_version) {
    const { projectPrepaidMembershipInvoice } = await import("@/lib/stripe/prepaid-webhook");
    const prepaidState = await projectPrepaidMembershipInvoice(tx, { subscription, invoice, memberId: member.id,
      eventCreated: event.created, verifiedPayment: verifiedPayment && !taxProblem });
    if (prepaidState === null) return true;
    state = prepaidState;
  } else if (v2 && membershipPriceMatches) {
    const { prepareCommitmentInvoiceProjection } = await import("@/lib/stripe/commitment-webhook");
    await prepareCommitmentInvoiceProjection(tx, { event, subscription, invoice, memberId: member.id,
      paidActivation: verifiedPayment && state === "active" });
  }
  if (v2 && subscription.metadata.ruined_billing_schedule_version) {
    const { invalidateCommitmentFromInvoice } = await import("@/lib/stripe/commitment-webhook");
    await invalidateCommitmentFromInvoice(tx, invoice, event);
  }
  await updateMemberBillingState(tx, {
    eventCreated: event.created,
    memberId: member.id,
    sourceEventId: event.id,
    state,
  });
  if (v2) {
    const { projectCommercialParticipantBillingState } = await import("@/lib/stripe/commitment-webhook");
    await projectCommercialParticipantBillingState(tx, { subscription, payerMemberId: member.id, state, event });
  }

  return true;
}

async function handleSubscription(
  tx: BillingTransaction,
  event: Stripe.Event,
  eventSubscription: Stripe.Subscription,
): Promise<boolean> {
  // Subscription webhooks can arrive out of order. Reconcile from Stripe's
  // current object instead of toggling access from the stale event snapshot.
  const subscription = await getStripe().subscriptions.retrieve(eventSubscription.id);
  if (subscription.metadata.ruined_billing_schedule_version || subscription.metadata.billing_consent_source === "stripe_checkout") {
    const { lockCommitmentSubscriptionProjection } = await import("@/lib/stripe/commitment-webhook");
    await lockCommitmentSubscriptionProjection(tx, subscription);
  }
  const existing = await findMemberBySubscription(tx, subscription.id);
  const belongsToMembership =
    subscription.metadata.ruined_context === MEMBERSHIP_CONTEXT || Boolean(existing);

  if (!belongsToMembership) return false;

  const member = existing ?? (await ensureMemberFromSubscription(tx, subscription, null));
  if (!member) {
    throw new Error("Membership subscription cannot be linked to a Ruined member.");
  }

  const snapshot = subscriptionSnapshot(subscription, member.id, event.created);
  if (!snapshot.customerId) {
    throw new Error("Membership subscription has no Stripe Customer.");
  }
  await upsertSubscription(tx, snapshot);
  if (subscription.metadata.ruined_billing_schedule_version) {
    const latestInvoiceId = expandableId(subscription.latest_invoice);
    if (latestInvoiceId) return handleInvoice(tx, event, await getStripe().invoices.retrieve(latestInvoiceId));
    // A provider status alone cannot confer prepaid membership.
    await updateMemberBillingState(tx, { eventCreated: event.created, memberId: member.id, sourceEventId: event.id, state: "pending" });
    return true;
  }

  const taxProblem =
    isStripeTaxEnabled() &&
    (!subscription.automatic_tax.enabled || Boolean(subscription.automatic_tax.disabled_reason));
  const currentState = deriveMembershipState({
    paidInvoice: false,
    previousState: member.membershipState,
    subscriptionState: subscription.status as StripeSubscriptionState,
  });
  let state = applyBillingGuardrails({
    hasOperationalProblem: !isExpectedMembershipPrice(subscription) || taxProblem,
    state: currentState,
  });

  if (subscription.metadata.billing_terms_version === "membership-billing-v2") {
    const { lockCommitmentSubscriptionProjection, releaseCanceledScheduledMembership } = await import("@/lib/stripe/commitment-webhook");
    await lockCommitmentSubscriptionProjection(tx, subscription);
    if (subscription.metadata.ruined_first_charge_at && await releaseCanceledScheduledMembership(tx, subscription)) {
      // Canceling before any membership payment withdraws billing authorization;
      // it does not end an enrollment or erase the completed registration rate.
      state = "pending";
    }
  }
  await updateMemberBillingState(tx, {
    eventCreated: event.created,
    memberId: member.id,
    sourceEventId: event.id,
    state,
  });
  if (subscription.metadata.billing_terms_version === "membership-billing-v2") {
    const { projectCommercialParticipantBillingState } = await import("@/lib/stripe/commitment-webhook");
    await projectCommercialParticipantBillingState(tx, { subscription, payerMemberId: member.id, state, event });
  }

  return true;
}

async function dispatchStripeEvent(
  tx: BillingTransaction,
  event: Stripe.Event,
): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.async_payment_failed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.completed":
    case "checkout.session.expired":
      if (event.data.object.mode === "setup") {
        const { handlePaymentMethodSetupEvent } = await import("@/lib/stripe/payment-method-service");
        return handlePaymentMethodSetupEvent(tx, event);
      }
      return handleCheckoutSession(tx, event, event.data.object);

    case "setup_intent.succeeded":
    case "payment_method.detached": {
      const { handlePaymentMethodSetupEvent } = await import("@/lib/stripe/payment-method-service");
      return handlePaymentMethodSetupEvent(tx, event);
    }

    case "invoice.marked_uncollectible":
    case "invoice.paid":
    case "invoice.payment_action_required":
    case "invoice.payment_failed":
    case "invoice.voided":
      return handleInvoice(tx, event, event.data.object);

    case "credit_note.created":
    case "credit_note.updated":
    case "credit_note.voided": {
      const invoiceId = expandableId(event.data.object.invoice);
      if (!invoiceId) return false;
      const invoice = await getStripe().invoices.retrieve(invoiceId);
      const { invalidateCommitmentFromInvoice } = await import("@/lib/stripe/commitment-webhook");
      return invalidateCommitmentFromInvoice(tx, invoice, event);
    }
    case "charge.refunded":
    case "charge.dispute.created":
    case "charge.dispute.closed":
    case "refund.created":
    case "refund.updated":
    case "refund.failed": {
      const { invalidateCommitmentFromPaymentAdjustment } = await import("@/lib/stripe/commitment-webhook");
      return invalidateCommitmentFromPaymentAdjustment(tx, getStripe(), event);
    }

    case "customer.subscription.deleted":
    case "customer.subscription.updated":
      return handleSubscription(tx, event, event.data.object);

    default:
      return false;
  }
}

export async function processStripeWebhookEvent(event: Stripe.Event): Promise<WebhookResult> {
  const sql = getBillingDatabase();

  try {
    const result = await sql.begin(async (tx) => {
      const claim = await claimWebhookEvent(tx, event);

      if (claim === "duplicate") {
        if (event.type === "invoice.paid") await reconcileMemberBadgesForStripeEvent(tx, event.id);
        return { duplicate: true, handled: true };
      }

      const handled = await dispatchStripeEvent(tx, event);
      if (event.type === "invoice.paid") await reconcileMemberBadgesForStripeEvent(tx, event.id);
      await completeWebhookEvent(tx, event.id);

      const setupOnly = event.type === "setup_intent.succeeded"
        || event.type === "payment_method.detached"
        || (event.type.startsWith("checkout.session.")
          && (event.data.object as Stripe.Checkout.Session).mode === "setup");
      return { duplicate: false, handled, ...(setupOnly ? { runMembershipWork: false } : {}) };
    });
    if (["charge.refunded", "refund.created", "refund.updated", "refund.failed", "charge.dispute.created", "charge.dispute.closed",
      "credit_note.created", "credit_note.updated", "credit_note.voided"].includes(event.type)) {
      const object = event.data.object as unknown as { id: string; charge?: string | { id: string }; invoice?: string | { id: string } };
      const chargeId = event.type === "charge.refunded" ? object.id : expandableId(object.charge);
      const invoiceId = expandableId(object.invoice);
      const affected = await sql<Array<{ subscriptionId: string; livemode: boolean }>>`
        select stripe_subscription_id as "subscriptionId",livemode from stripe_membership_prepaid_proofs
        where livemode=${event.livemode} and (stripe_charge_id=${chargeId} or stripe_invoice_id=${invoiceId})
      `;
      for (const proof of affected) {
        const { reconcilePrepaidMembershipCancellation } = await import("@/lib/stripe/cancellation-service");
        await reconcilePrepaidMembershipCancellation(proof);
        await reconcilePrepaidMembershipSubscription(proof.subscriptionId);
      }
    }
    // Registration fulfillment is independently retryable after provider state
    // commits. A duplicate webhook can finish it after a prior post-commit error.
    const prepaidObject = event.data.object as unknown as {
      id: string; metadata?: Record<string, string>; subscription?: string | { id: string } | null;
      parent?: { subscription_details?: { subscription?: string | { id: string } | null; metadata?: Record<string, string> | null } | null } | null;
    };
    const prepaidMetadata = prepaidObject.metadata?.ruined_billing_schedule_version
      || prepaidObject.parent?.subscription_details?.metadata?.ruined_billing_schedule_version;
    const prepaidSubscriptionId = prepaidMetadata ? event.type.startsWith("customer.subscription.")
      ? prepaidObject.id : expandableId(prepaidObject.subscription ?? prepaidObject.parent?.subscription_details?.subscription) : null;
    if (prepaidSubscriptionId) {
      const { reconcilePaidMemberRegistrations } = await import("@/lib/membership/registration-repository");
      await reconcilePaidMemberRegistrations(prepaidSubscriptionId);
    }
    return result;
  } catch (error) {
    try {
      await recordWebhookFailure(event, error);
    } catch {
      // The original failure remains authoritative. A missing database or
      // migration will make the endpoint return 5xx so Stripe retries safely.
    }
    throw error;
  }
}

/** Internal scheduled reconciliation uses its own source identity. It is not a
 * Stripe webhook and is never inserted into the signed-provider event inbox. */
export async function reconcilePrepaidMembershipSubscription(subscriptionId: string): Promise<void> {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  if (!subscription.metadata.ruined_billing_schedule_version) return;
  const source = { id: `prepaid_reconcile:${randomUUID()}`, created: Math.floor(Date.now() / 1000),
    livemode: subscription.livemode, type: "customer.subscription.updated", data: { object: subscription },
    object: "event", api_version: "2026-08-26.dahlia", pending_webhooks: 0, request: null } as Stripe.Event;
  await getBillingDatabase().begin(tx => handleSubscription(tx, source, subscription));
  const { reconcilePaidMemberRegistrations } = await import("@/lib/membership/registration-repository");
  await reconcilePaidMemberRegistrations(subscription.id);
}
