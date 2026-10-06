import "server-only";
import type Stripe from "stripe";
import { getCommercialMembershipReservation, activateCommercialMembership, releasePrepaidCommercialMembership } from "@/lib/membership/commercial-repository";
import { buildMembershipCommitment, MembershipCommitmentError, MEMBERSHIP_COMMITMENT_TERMS_VERSION } from "./commitment-policy";
import { createMembershipCommitment, getMembershipCommitment } from "./commitment-repository";
import { getMembershipPrepayment, recordMembershipPrepayment, markMembershipPrepaymentReview, upsertInvoice, updateMemberBillingState, type BillingTransaction } from "./billing-repository";
import { inspectPrepaidMembershipInvoice } from "./prepaid-provider";
import { prepaidScheduleFromSubscription, prepaidScheduleFingerprint } from "./prepaid-policy";
import { getStripe } from "./server";
import type { MembershipState } from "./membership-state";

const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;

/** A paid invoice establishes the prepaid contract, but service eligibility is
 * separately gated by its immutable cohort start and fresh refund evidence. */
export async function projectPrepaidMembershipInvoice(tx: BillingTransaction, input: {
  subscription: Stripe.Subscription; invoice: Stripe.Invoice; memberId: string;
  eventCreated: number; verifiedPayment: boolean;
}): Promise<MembershipState | null> {
  const { subscription, invoice, memberId } = input;
  const schedule = prepaidScheduleFromSubscription(subscription);
  const reservation = await getCommercialMembershipReservation(subscription.metadata.ruined_commercial_reservation_id, tx);
  if (!schedule || !reservation?.billingSchedule || reservation.memberId !== memberId
    || reservation.id !== subscription.metadata.ruined_checkout_attempt_id
    || reservation.offerId !== subscription.metadata.ruined_offer_id
    || reservation.stripePriceId !== subscription.items.data[0]?.price.id
    || prepaidScheduleFingerprint(schedule) !== prepaidScheduleFingerprint(reservation.billingSchedule)
    || reservation.stripeSubscriptionId && reservation.stripeSubscriptionId !== subscription.id) {
    throw new MembershipCommitmentError("commercial_consent_identity_mismatch");
  }
  const memberIds = reservation.participants.map(person => person.memberId).sort();
  await tx`select id from ruined_members where id=any(${memberIds}::uuid[]) order by id for update`;
  await tx`select member_id from member_lifecycle where member_id=any(${memberIds}::uuid[]) order by member_id for update`;
  await tx`select pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'))`;
  // A concurrent refund may have released this enrollment while these locks
  // were waiting. Never project that historical enrollment onto a later one.
  const currentReservation = await getCommercialMembershipReservation(reservation.id, tx);
  if (!currentReservation || currentReservation.stripeSubscriptionId && currentReservation.stripeSubscriptionId !== subscription.id) {
    throw new MembershipCommitmentError("commercial_consent_identity_mismatch");
  }
  if (currentReservation.status === "released") return null;
  await tx`update membership_commercial_reservations set stripe_subscription_id=${subscription.id}
    where id=${reservation.id}::uuid and status='reserved' and (stripe_subscription_id is null or stripe_subscription_id=${subscription.id})`;
  let proof = await getMembershipPrepayment(tx, { reservationId: reservation.id });
  if (subscription.status === "canceled") {
    if (proof?.refundState === "refunded" && !proof.activatedAt && subscription.canceled_at) {
      await releasePrepaidCommercialMembership({ reservationId: reservation.id, stripeSubscriptionId: subscription.id,
        canceledAt: new Date(subscription.canceled_at * 1000) }, tx);
      return "pending";
    }
    return proof?.activatedAt ? "ended" : "attention_required";
  }
  if (!["active", "trialing"].includes(subscription.status)) return "attention_required";
  const existing = await getMembershipCommitment(tx, { memberId, subscriptionId: subscription.id, livemode: subscription.livemode });
  if (!existing && (invoice.status !== "paid" || invoice.amount_paid <= 0)) return "pending";
  let contract = existing?.contract;
  if (!contract) {
    const [accepted] = await tx<Array<{ acceptanceId: string; agreementVersion: string; agreementContentSha256: string; acceptedAt: Date }>>`
      select acceptance.id as "acceptanceId", acceptance.agreement_key_snapshot || '-v' || acceptance.agreement_version_snapshot::text as "agreementVersion",
        acceptance.agreement_content_sha256 as "agreementContentSha256", acceptance.accepted_at as "acceptedAt"
      from stripe_checkout_attempts attempt
      join membership_agreement_acceptances acceptance on acceptance.id=attempt.agreement_acceptance_id
      where attempt.id=${reservation.id}::uuid and attempt.member_id=${memberId}::uuid
        and attempt.commercial_reservation_id=${reservation.id}::uuid and attempt.offer_id=${reservation.offerId}
        and acceptance.id=${subscription.metadata.agreement_acceptance_id}::uuid
        and attempt.recurring_payment_terms->>'version'=${MEMBERSHIP_COMMITMENT_TERMS_VERSION}
    `;
    if (!accepted || !/^ruined_membership-v([3-9]|[1-9]\d+)$/.test(accepted.agreementVersion)) throw new MembershipCommitmentError("commitment_consent_mismatch");
    contract = buildMembershipCommitment({ id: reservation.id, memberId, subscriptionId: subscription.id,
      customerId: id(subscription.customer)!, livemode: subscription.livemode, offerId: reservation.offerId,
      priceId: reservation.stripePriceId!, agreementAcceptanceId: accepted.acceptanceId,
      agreementVersion: accepted.agreementVersion, agreementContentSha256: accepted.agreementContentSha256,
      acceptedAt: new Date(accepted.acceptedAt).toISOString(), startsAt: schedule.serviceStartsAt,
      billingTermsVersion: MEMBERSHIP_COMMITMENT_TERMS_VERSION, billingSchedule: schedule });
    await createMembershipCommitment(tx, contract, reservation.id);
  }
  if (proof && proof.refundState !== "none") return "attention_required";
  try {
    const verified = await inspectPrepaidMembershipInvoice(getStripe(), contract);
    // The provider can change while the outer invoice projection is in flight.
    // A settled historical payment must not activate an already canceled or
    // newly unpaid subscription through the older persisted snapshot.
    if (!["active", "trialing"].includes(verified.subscription.status)
      || id(verified.subscription.latest_invoice) !== id(subscription.latest_invoice)) return "attention_required";
    // A renewal event can arrive before the original invoice's webhook.
    await upsertInvoice(tx, { id: verified.invoice.id, customerId: contract.customerId, memberId,
      subscriptionId: subscription.id, amountDue: verified.invoice.amount_due, amountPaid: verified.invoice.amount_paid,
      billingReason: verified.invoice.billing_reason, currency: verified.invoice.currency, eventCreated: input.eventCreated,
      paidAt: verified.invoice.status_transitions.paid_at ? new Date(verified.invoice.status_transitions.paid_at * 1000) : null,
      purpose: "membership", status: verified.invoice.status });
    proof = await recordMembershipPrepayment(tx, { reservationId: reservation.id, contractId: contract.id, memberId,
      subscriptionId: subscription.id, invoiceId: verified.invoiceId, paymentIntentId: verified.paymentIntentId,
      chargeId: verified.chargeId, serviceStartsAt: schedule.serviceStartsAt, prepaidThrough: schedule.prepaidThrough,
      duesAmount: contract.installmentDues, amountPaid: verified.amount, currency: "usd", livemode: contract.livemode, verifiedAt: new Date() });
  } catch (error) {
    if (!(error instanceof MembershipCommitmentError)) throw error;
    await markMembershipPrepaymentReview(tx, { reservationId: reservation.id, reason: "prepaid_payment_requires_review", verifiedAt: new Date() });
    return "attention_required";
  }
  if (proof.refundState !== "none" || !input.verifiedPayment) return "attention_required";
  if (Date.now() < Date.parse(schedule.serviceStartsAt)) return "pending";
  if (!input.verifiedPayment || id(subscription.latest_invoice) !== invoice.id) return "attention_required";
  await activateCommercialMembership({ reservationId: reservation.id, stripeSubscriptionId: subscription.id }, tx);
  return "active";
}

/** Any payment adjustment pauses automatic access until the durable refund path
 * or an operator has reconciled it. An old paid event cannot clear this gate. */
export async function holdPrepaidMembershipForAdjustment(tx: BillingTransaction, subscriptionId: string, event: Stripe.Event): Promise<void> {
  const [identity] = await tx<Array<{ reservationId: string }>>`select reservation_id as "reservationId"
    from stripe_membership_prepaid_proofs where stripe_subscription_id=${subscriptionId}`;
  if (!identity) return;
  const reservation = await getCommercialMembershipReservation(identity.reservationId, tx);
  if (!reservation) return;
  const memberIds = reservation.participants.map(person => person.memberId).sort();
  await tx`select id from ruined_members where id=any(${memberIds}::uuid[]) order by id for update`;
  await tx`select member_id from member_lifecycle where member_id=any(${memberIds}::uuid[]) order by member_id for update`;
  await tx`select pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'))`;
  const proof = await getMembershipPrepayment(tx, { subscriptionId });
  if (proof && proof.refundState === "none") await markMembershipPrepaymentReview(tx, {
    reservationId: proof.reservationId, reason: "payment_adjustment", verifiedAt: new Date(),
  });
  if (proof && proof.refundState !== "refunded" && reservation.status !== "released") {
    for (const memberId of memberIds) await updateMemberBillingState(tx, { memberId, state: "attention_required",
      eventCreated: event.created, sourceEventId: event.id });
  }
}
