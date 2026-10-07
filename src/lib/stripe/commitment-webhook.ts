import "server-only";

import type Stripe from "stripe";
import { isMembershipOfferId } from "./price-policy";
import {
  activateCommercialMembership,
  getCommercialBillingGroupBySubscription,
  getCommercialMembershipReservation,
  reconcileCommercialMemberships,
  releaseScheduledCommercialMembership,
} from "@/lib/membership/commercial-repository";
import { hasMembershipCheckoutConsent, updateMemberBillingState, type BillingTransaction } from "./billing-repository";
import type { MembershipState } from "./membership-state";
import { buildMembershipCommitment, MEMBERSHIP_COMMITMENT_TERMS_VERSION, MembershipCommitmentError } from "./commitment-policy";
import { createMembershipCommitment, getMembershipCommitment, invalidateMembershipCommitmentLedger } from "./commitment-repository";

function id(value: { id: string } | string | null | undefined) { return typeof value === "string" ? value : value?.id ?? null; }

/** Current paid status does not prove a payment was not refunded. New v2 access
 * accepts only the simple, fully settled Checkout payment; adjusted or disputed
 * allocations need review instead of silently granting membership from old money.
 */
export async function hasVerifiedCommitmentInvoicePayment(stripe: Stripe, invoice: Stripe.Invoice, subscription: Stripe.Subscription): Promise<boolean> {
  if (invoice.customer_address?.country !== "US" || invoice.status !== "paid" || invoice.amount_paid <= 0 || invoice.amount_remaining !== 0
    || invoice.amount_paid !== invoice.total || invoice.pre_payment_credit_notes_amount !== 0 || invoice.post_payment_credit_notes_amount !== 0
    || invoice.starting_balance !== 0 || invoice.ending_balance !== 0
    || (invoice.total_discount_amounts ?? []).some(discount => discount.amount !== 0)) return false;
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 100 });
  if (payments.has_more || payments.data.length !== 1) return false;
  const payment = payments.data[0];
  if (id(payment.invoice) !== invoice.id || payment.livemode !== invoice.livemode || payment.currency !== invoice.currency
    || payment.amount_paid !== invoice.amount_paid || payment.status !== "paid") return false;
  let chargeId: string | null = null;
  if (payment.payment.type === "payment_intent" && id(payment.payment.payment_intent)) {
    const intent = await stripe.paymentIntents.retrieve(id(payment.payment.payment_intent)!);
    if (intent.status !== "succeeded" || intent.livemode !== invoice.livemode || id(intent.customer) !== id(subscription.customer)) return false;
    chargeId = id(intent.latest_charge);
  } else if (payment.payment.type === "charge") chargeId = id(payment.payment.charge);
  if (!chargeId) return false;
  const charge = await stripe.charges.retrieve(chargeId);
  if (!charge.paid || !charge.captured || charge.status !== "succeeded" || charge.refunded || charge.amount_refunded !== 0 || charge.disputed
    || charge.amount !== invoice.amount_paid || charge.currency !== invoice.currency || charge.livemode !== invoice.livemode
    || id(charge.customer) !== id(subscription.customer)) return false;
  const refunds = await stripe.refunds.list({ charge: chargeId, limit: 100 });
  return !refunds.has_more && refunds.data.every(refund => refund.status === "failed" || refund.status === "canceled");
}

/** Run after invoice/subscription persistence, before lifecycle activation. Lock
 * both adults before commercial reconciliation can take its global eligibility lock.
 */
export async function prepareCommitmentInvoiceProjection(tx: BillingTransaction, input: {
  event: Stripe.Event; subscription: Stripe.Subscription; invoice: Stripe.Invoice; memberId: string; paidActivation: boolean;
}): Promise<void> {
  const { subscription, memberId, event } = input;
  if (subscription.metadata.billing_terms_version !== MEMBERSHIP_COMMITMENT_TERMS_VERSION) return;
  const reservationId = subscription.metadata.ruined_commercial_reservation_id;
  const attemptId = subscription.metadata.ruined_checkout_attempt_id;
  const offerId = subscription.metadata.ruined_offer_id;
  if (!isMembershipOfferId(offerId) || reservationId !== attemptId) throw new MembershipCommitmentError("commercial_consent_identity_mismatch");
  const reservation = await getCommercialMembershipReservation(reservationId, tx);
  if (!reservation || reservation.memberId !== memberId || reservation.offerId !== offerId
    || reservation.stripePriceId !== subscription.items.data[0]?.price.id
    || reservation.stripeSubscriptionId && reservation.stripeSubscriptionId !== subscription.id) {
    throw new MembershipCommitmentError("commercial_consent_identity_mismatch");
  }
  if ((reservation.firstChargeAt?.toISOString() ?? null) !== (subscription.metadata.ruined_first_charge_at ?? null) ||
    reservation.firstChargeAt && (subscription.billing_cycle_anchor !== Math.floor(reservation.firstChargeAt.getTime() / 1000) ||
      input.invoice.lines.data[0]?.period.start < reservation.firstChargeAt.getTime() / 1000)) {
    throw new MembershipCommitmentError("scheduled_billing_date_mismatch");
  }
  const memberIds = reservation.participants.map(person => person.memberId).sort();
  await tx`select id from ruined_members where id = any(${memberIds}::uuid[]) order by id for update`;
  await tx`select member_id from member_lifecycle where member_id = any(${memberIds}::uuid[]) order by member_id for update`;
  if (input.paidActivation) {
    const existing = await getMembershipCommitment(tx, { memberId, subscriptionId: subscription.id, livemode: subscription.livemode });
    if (!existing) {
      const accepted = await tx<Array<{ acceptanceId: string; agreementVersion: string; agreementContentSha256: string; acceptedAt: Date }>>`
        select acceptance.id as "acceptanceId", acceptance.agreement_key_snapshot || '-v' || acceptance.agreement_version_snapshot::text as "agreementVersion",
          acceptance.agreement_content_sha256 as "agreementContentSha256", acceptance.accepted_at as "acceptedAt"
        from stripe_checkout_attempts attempt
        join membership_agreement_acceptances acceptance on acceptance.id = attempt.agreement_acceptance_id
        where attempt.id = ${attemptId}::uuid and attempt.member_id = ${memberId}::uuid
          and attempt.commercial_reservation_id = ${reservationId}::uuid and attempt.offer_id = ${offerId}
          and acceptance.id = ${subscription.metadata.agreement_acceptance_id}::uuid
          and attempt.recurring_payment_terms->>'version' = ${MEMBERSHIP_COMMITMENT_TERMS_VERSION}
      `;
      if (!accepted[0]) throw new MembershipCommitmentError("commitment_consent_mismatch");
      const contract = buildMembershipCommitment({ id: attemptId, memberId, subscriptionId: subscription.id,
        customerId: id(subscription.customer)!, livemode: subscription.livemode, offerId,
        priceId: subscription.items.data[0].price.id, agreementAcceptanceId: accepted[0].acceptanceId,
        agreementVersion: accepted[0].agreementVersion, agreementContentSha256: accepted[0].agreementContentSha256,
        acceptedAt: new Date(accepted[0].acceptedAt).toISOString(), startsAt: reservation.firstChargeAt?.toISOString() ?? new Date(subscription.start_date * 1000).toISOString(),
        billingTermsVersion: MEMBERSHIP_COMMITMENT_TERMS_VERSION });
      await createMembershipCommitment(tx, contract, attemptId);
    }
    // SQL independently requires the currently persisted latest membership invoice.
    await activateCommercialMembership({ reservationId, stripeSubscriptionId: subscription.id }, tx);
  }
  await invalidateMembershipCommitmentLedger(tx, { memberId, subscriptionId: subscription.id, livemode: subscription.livemode, providerEventId: event.id });
}

export async function projectCommercialParticipantBillingState(tx: BillingTransaction, input: {
  subscription: Stripe.Subscription; payerMemberId: string; state: MembershipState; event: Stripe.Event;
}): Promise<void> {
  if (input.subscription.metadata.billing_terms_version !== MEMBERSHIP_COMMITMENT_TERMS_VERSION) return;
  let group = await getCommercialBillingGroupBySubscription(input.subscription.id, tx);
  if (!group && input.subscription.metadata.ruined_billing_schedule_version) {
    const pending = await getCommercialMembershipReservation(input.subscription.metadata.ruined_commercial_reservation_id, tx);
    if (pending?.stripeSubscriptionId === input.subscription.id) group = pending;
  }
  if (!group || group.memberId !== input.payerMemberId) return;
  for (const participant of [...group.participants].sort((a, b) => a.memberId.localeCompare(b.memberId))) {
    if (participant.memberId !== input.payerMemberId) await updateMemberBillingState(tx, {
      memberId: participant.memberId, state: input.state, eventCreated: input.event.created, sourceEventId: input.event.id,
    });
  }
  await reconcileCommercialMemberships(tx);
}

/** Refunds and credit notes invalidate only matching v2 contracts. They cannot
 * activate membership, and a replacement fee invoice is never a dues invoice.
 */
export async function invalidateCommitmentFromInvoice(tx: BillingTransaction, invoice: Stripe.Invoice, event: Stripe.Event): Promise<boolean> {
  const subscriptionId = id(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return false;
  const rows = await tx<Array<{ member_id: string }>>`
    select member_id from stripe_membership_commitments where stripe_subscription_id = ${subscriptionId} and livemode = ${event.livemode}
  `;
  if (!rows[0]) return false;
  if (event.type.startsWith("credit_note.") || event.type.startsWith("refund.") || event.type.startsWith("charge.")) {
    const { holdPrepaidMembershipForAdjustment } = await import("@/lib/stripe/prepaid-webhook");
    await holdPrepaidMembershipForAdjustment(tx, subscriptionId, event);
  }
  return invalidateMembershipCommitmentLedger(tx, { memberId: rows[0].member_id, subscriptionId, livemode: event.livemode, providerEventId: event.id });
}

export async function lockCommitmentSubscriptionProjection(tx: BillingTransaction, subscription: Stripe.Subscription): Promise<void> {
  let group = await getCommercialBillingGroupBySubscription(subscription.id, tx);
  if (!group && (subscription.metadata.ruined_first_charge_at || subscription.metadata.ruined_billing_schedule_version || subscription.metadata.billing_consent_source === "stripe_checkout")) {
    const pending = await getCommercialMembershipReservation(subscription.metadata.ruined_commercial_reservation_id, tx);
    if (pending?.memberId === subscription.metadata.ruined_member_id &&
      (!pending.stripeSubscriptionId || pending.stripeSubscriptionId === subscription.id)) group = pending;
  }
  if (group) {
    const memberIds = group.participants.map(participant => participant.memberId).sort();
    await tx`select id from ruined_members where id = any(${memberIds}::uuid[]) order by id for update`;
    await tx`select member_id from member_lifecycle where member_id = any(${memberIds}::uuid[]) order by member_id for update`;
  }
}

export async function invalidateCommitmentFromPaymentAdjustment(tx: BillingTransaction, stripe: Stripe, event: Stripe.Event): Promise<boolean> {
  let chargeId: string | null = null;
  if (event.type === "charge.refunded") chargeId = event.data.object.id;
  else if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") chargeId = id(event.data.object.charge);
  else if (event.type === "refund.created" || event.type === "refund.updated" || event.type === "refund.failed") chargeId = id(event.data.object.charge);
  if (!chargeId) return false;
  const charge = await stripe.charges.retrieve(chargeId), paymentIntentId = id(charge.payment_intent);
  if (!paymentIntentId) return false; // New subscription Checkout always has a PaymentIntent.
  let handled = false;
  for await (const payment of stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 100 })) {
    const invoiceId = id(payment.invoice);
    if (!invoiceId) continue;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    handled = await invalidateCommitmentFromInvoice(tx, invoice, event) || handled;
  }
  return handled;
}

/** A member-confirmed $0 Checkout establishes the future contract and permits
 * cancellation. It never calls paid activation or advances member access. */
export async function prepareScheduledMembershipProjection(tx: BillingTransaction, input: {
  subscription: Stripe.Subscription; session: Stripe.Checkout.Session; memberId: string;
}): Promise<void> {
  const { subscription, session, memberId } = input;
  const reservationId = subscription.metadata.ruined_commercial_reservation_id;
  const reservation = await getCommercialMembershipReservation(reservationId, tx);
  // An earlier canceled-subscription webhook may have already released this
  // same scheduled reservation. A late Checkout completion must not reopen it.
  if (reservation?.status === "released" && reservation.stripeSubscriptionId === subscription.id && subscription.status === "canceled") return;
  if (!reservation?.firstChargeAt || reservation.memberId !== memberId ||
    reservation.id !== subscription.metadata.ruined_checkout_attempt_id || reservation.offerId !== subscription.metadata.ruined_offer_id ||
    reservation.stripePriceId !== subscription.items.data[0]?.price.id ||
    reservation.stripeSubscriptionId && reservation.stripeSubscriptionId !== subscription.id ||
    subscription.metadata.billing_terms_version !== MEMBERSHIP_COMMITMENT_TERMS_VERSION ||
    subscription.metadata.ruined_first_charge_at !== reservation.firstChargeAt.toISOString() ||
    subscription.billing_cycle_anchor !== Math.floor(reservation.firstChargeAt.getTime() / 1000) || subscription.trial_end ||
    session.metadata?.ruined_first_charge_at !== reservation.firstChargeAt.toISOString() ||
    session.metadata?.ruined_commercial_reservation_id !== reservation.id ||
    session.metadata?.ruined_checkout_attempt_id !== reservation.id ||
    session.metadata?.agreement_acceptance_id !== subscription.metadata.agreement_acceptance_id ||
    session.metadata?.ruined_member_id !== memberId || session.metadata?.ruined_price_id !== reservation.stripePriceId ||
    session.mode !== "subscription" || session.status !== "complete" || session.payment_status !== "no_payment_required" ||
    session.amount_total !== 0 || session.livemode !== subscription.livemode ||
    session.consent?.terms_of_service !== "accepted" || id(session.subscription) !== subscription.id ||
    id(session.customer) !== id(subscription.customer) ||
    !await hasMembershipCheckoutConsent(tx, { memberId, attemptId: reservation.id,
      acceptanceId: subscription.metadata.agreement_acceptance_id, plan: reservation.plan, priceId: reservation.stripePriceId!,
      subscriptionId: subscription.id, billingTermsVersion: MEMBERSHIP_COMMITMENT_TERMS_VERSION,
      offerId: reservation.offerId, commercialReservationId: reservation.id, firstChargeAt: reservation.firstChargeAt.toISOString() })) {
    throw new MembershipCommitmentError("scheduled_billing_consent_mismatch");
  }
  const memberIds = reservation.participants.map(person => person.memberId).sort();
  await tx`select id from ruined_members where id=any(${memberIds}::uuid[]) order by id for update`;
  await tx`select member_id from member_lifecycle where member_id=any(${memberIds}::uuid[]) order by member_id for update`;
  const [accepted] = await tx<Array<{ acceptanceId: string; agreementVersion: string; agreementContentSha256: string; acceptedAt: Date }>>`
    select acceptance.id as "acceptanceId",acceptance.agreement_key_snapshot || '-v' || acceptance.agreement_version_snapshot::text as "agreementVersion",
      acceptance.agreement_content_sha256 as "agreementContentSha256",acceptance.accepted_at as "acceptedAt"
    from stripe_checkout_attempts attempt join membership_agreement_acceptances acceptance on acceptance.id=attempt.agreement_acceptance_id
    where attempt.id=${reservation.id}::uuid and attempt.member_id=${memberId}::uuid and attempt.first_charge_at=${reservation.firstChargeAt}
      and attempt.status='completed' and attempt.stripe_subscription_id=${subscription.id}
  `;
  if (!accepted) throw new MembershipCommitmentError("scheduled_billing_consent_mismatch");
  const contract = buildMembershipCommitment({ id: reservation.id,memberId,subscriptionId: subscription.id,
    customerId: id(subscription.customer)!,livemode: subscription.livemode,offerId: reservation.offerId,
    priceId: reservation.stripePriceId!,agreementAcceptanceId: accepted.acceptanceId,agreementVersion: accepted.agreementVersion,
    agreementContentSha256: accepted.agreementContentSha256,acceptedAt: new Date(accepted.acceptedAt).toISOString(),
    startsAt: reservation.firstChargeAt.toISOString(),billingTermsVersion: MEMBERSHIP_COMMITMENT_TERMS_VERSION });
  await createMembershipCommitment(tx,contract,reservation.id);
  await tx`update membership_commercial_reservations set stripe_subscription_id=${subscription.id}
    where id=${reservation.id}::uuid and status='reserved' and (stripe_subscription_id is null or stripe_subscription_id=${subscription.id})`;
}

export async function releaseCanceledScheduledMembership(tx: BillingTransaction, subscription: Stripe.Subscription): Promise<boolean> {
  if (subscription.status !== "canceled" || !subscription.metadata.ruined_first_charge_at) return false;
  const reservation = await getCommercialMembershipReservation(subscription.metadata.ruined_commercial_reservation_id, tx);
  if (!reservation?.firstChargeAt || reservation.status === "activated") return false;
  if (subscription.metadata.ruined_first_charge_at !== reservation.firstChargeAt.toISOString() ||
    subscription.metadata.ruined_member_id !== reservation.memberId || !subscription.canceled_at ||
    subscription.canceled_at >= reservation.firstChargeAt.getTime() / 1000 || subscription.latest_invoice) {
    throw new MembershipCommitmentError("scheduled_cancellation_requires_review");
  }
  if (!reservation.stripeSubscriptionId) await tx`update membership_commercial_reservations set stripe_subscription_id=${subscription.id}
    where id=${reservation.id}::uuid and stripe_subscription_id is null`;
  await releaseScheduledCommercialMembership({ reservationId: reservation.id,stripeSubscriptionId: subscription.id,canceledAt: new Date(subscription.canceled_at * 1000) },tx);
  return true;
}
