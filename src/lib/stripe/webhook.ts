import "server-only";

import type Stripe from "stripe";

import {
  type BillingMember,
  type BillingTransaction,
  claimWebhookEvent,
  completeWebhookEvent,
  ensureBillingMember,
  findMemberBySubscription,
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
  getStripeMembershipPriceId,
  isStripeTaxEnabled,
} from "@/lib/stripe/server";

type WebhookResult = {
  duplicate: boolean;
  handled: boolean;
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
  const expectedPriceId = getStripeMembershipPriceId();
  return subscription.items.data.some((item) => item.price.id === expectedPriceId);
}

async function handleInvoice(
  tx: BillingTransaction,
  event: Stripe.Event,
  invoice: Stripe.Invoice,
): Promise<boolean> {
  const metadata = metadataFromInvoice(invoice);
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  const isMembership = metadata?.ruined_context === MEMBERSHIP_CONTEXT;
  const customerId = expandableId(invoice.customer);
  let member: BillingMember | null = null;
  let subscription: Stripe.Subscription | null = null;
  let membershipPriceMatches = false;

  if (isMembership && subscriptionId) {
    subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    member = await ensureMemberFromSubscription(tx, subscription, invoice.customer_email);
    membershipPriceMatches = isExpectedMembershipPrice(subscription);
  }

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

  const paymentProblem =
    event.type === "invoice.marked_uncollectible" ||
    event.type === "invoice.payment_failed" ||
    event.type === "invoice.payment_action_required" ||
    event.type === "invoice.voided" ||
    !membershipPriceMatches;
  const taxProblem =
    isStripeTaxEnabled() &&
    (!subscription.automatic_tax.enabled || Boolean(subscription.automatic_tax.disabled_reason));
  const currentState = deriveMembershipState({
    paidInvoice: event.type === "invoice.paid" && invoice.amount_paid > 0,
    previousState: member.membershipState,
    subscriptionState: subscription.status as StripeSubscriptionState,
  });
  const state = applyBillingGuardrails({
    hasOperationalProblem: !membershipPriceMatches || taxProblem || paymentProblem,
    state: currentState,
  });

  await updateMemberBillingState(tx, {
    eventCreated: event.created,
    memberId: member.id,
    sourceEventId: event.id,
    state,
  });

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

  const taxProblem =
    isStripeTaxEnabled() &&
    (!subscription.automatic_tax.enabled || Boolean(subscription.automatic_tax.disabled_reason));
  const currentState = deriveMembershipState({
    paidInvoice: false,
    previousState: member.membershipState,
    subscriptionState: subscription.status as StripeSubscriptionState,
  });
  const state = applyBillingGuardrails({
    hasOperationalProblem: !isExpectedMembershipPrice(subscription) || taxProblem,
    state: currentState,
  });

  await updateMemberBillingState(tx, {
    eventCreated: event.created,
    memberId: member.id,
    sourceEventId: event.id,
    state,
  });

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
      return handleCheckoutSession(tx, event, event.data.object);

    case "invoice.marked_uncollectible":
    case "invoice.paid":
    case "invoice.payment_action_required":
    case "invoice.payment_failed":
    case "invoice.voided":
      return handleInvoice(tx, event, event.data.object);

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
    return await sql.begin(async (tx) => {
      const claim = await claimWebhookEvent(tx, event);

      if (claim === "duplicate") {
        return { duplicate: true, handled: true };
      }

      const handled = await dispatchStripeEvent(tx, event);
      await completeWebhookEvent(tx, event.id);

      return { duplicate: false, handled };
    });
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
