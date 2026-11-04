import "server-only";
import type Stripe from "stripe";
import { resolveFoundationsEnrollmentSchedule, type FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { getBillingDatabase } from "./database";
import { getStripe } from "./server";
import { MembershipCommitmentError, type MembershipCommitment } from "./commitment-policy";
import { inspectPrepaidMembershipInvoice } from "./prepaid-provider";
import { acceptedPrepaidScheduleFromSubscription, prepaidRolloverMetadata, prepaidScheduleFingerprint, prepaidScheduleFromSubscription } from "./prepaid-policy";

const fail = (code = "cohort_rollover_requires_review"): never => { throw new MembershipCommitmentError(code); };
const id = (value: string | {id: string} | null) => typeof value === "string" ? value : value?.id ?? null;
const same = (left: FoundationsBillingSchedule | null | undefined, right: FoundationsBillingSchedule) => Boolean(left && prepaidScheduleFingerprint(left) === prepaidScheduleFingerprint(right));
const effectiveContract = (contract: MembershipCommitment, schedule: FoundationsBillingSchedule): MembershipCommitment => ({ ...contract,
  startsAt: schedule.serviceStartsAt, initialTermEndsAt: schedule.initialTermEndsAt, billingSchedule: schedule });
export const permitsAutomaticCohortRollover = (contract: MembershipCommitment) => /^ruined_membership-v([4-9]|[1-9]\d+)$/.test(contract.agreementVersion);

/** Update only the existing subscription's deferred renewal. The original paid
 * invoice and accepted metadata are immutable. Read-back verification makes a
 * provider-success/database-timeout retry safe, even after idempotency expiry. */
export async function reconcileCohortRolloverProvider(stripe: Stripe, contract: MembershipCommitment,
  schedule: FoundationsBillingSchedule, now = new Date()) {
  if (!permitsAutomaticCohortRollover(contract) || !contract.billingSchedule) return fail("cohort_rollover_updated_agreement_required");
  const current = await stripe.subscriptions.retrieve(contract.subscriptionId);
  const accepted = acceptedPrepaidScheduleFromSubscription(current), providerSchedule = prepaidScheduleFromSubscription(current);
  if (!same(accepted, contract.billingSchedule) || !providerSchedule || (!same(providerSchedule, contract.billingSchedule) && !same(providerSchedule, schedule))
    || schedule.cohortMonth <= contract.billingSchedule.cohortMonth || Date.parse(schedule.prepaidThrough) <= now.getTime()
    || current.status !== "trialing" || current.cancel_at || current.cancel_at_period_end || current.canceled_at
    || current.schedule || current.pause_collection || current.pending_update) return fail();
  const payment = await inspectPrepaidMembershipInvoice(stripe, effectiveContract(contract, providerSchedule), { requireOnlyInitialInvoice: true });
  const paidAt = payment.invoice.status_transitions.paid_at;
  if (!paidAt || paidAt * 1000 > now.getTime() || !same(resolveFoundationsEnrollmentSchedule(contract.billingSchedule, new Date(paidAt * 1000), contract.billingPlan), schedule)) return fail();
  const pending = await stripe.invoiceItems.list({ customer: contract.customerId, pending: true, limit: 1 });
  if (pending.data.length || pending.has_more) return fail();
  if (!same(providerSchedule, schedule)) {
    await stripe.subscriptions.update(contract.subscriptionId, {
      trial_end: Math.floor(Date.parse(schedule.prepaidThrough) / 1000), proration_behavior: "none",
      metadata: prepaidRolloverMetadata(schedule, contract.id),
    }, { idempotencyKey: `ruined-cohort-rollover:${contract.id}:${prepaidScheduleFingerprint(schedule)}` });
  }
  const verified = await inspectPrepaidMembershipInvoice(stripe, effectiveContract(contract, schedule), { requireOnlyInitialInvoice: true });
  const subscription = verified.subscription;
  const pendingAfter = await stripe.invoiceItems.list({ customer: contract.customerId, pending: true, limit: 1 });
  if (subscription.status !== "trialing" || subscription.cancel_at || subscription.cancel_at_period_end || subscription.canceled_at
    || subscription.schedule || subscription.pause_collection || subscription.pending_update
    || subscription.trial_end !== Date.parse(schedule.prepaidThrough) / 1000
    || subscription.billing_cycle_anchor !== Date.parse(schedule.nextChargeAt) / 1000
    || id(subscription.latest_invoice) !== (verified.adjustmentInvoice?.id ?? payment.invoiceId) || verified.invoiceId !== payment.invoiceId
    || verified.amount !== payment.amount || verified.paymentIntentId !== payment.paymentIntentId || verified.chargeId !== payment.chargeId
    || verified.invoice.status_transitions.paid_at !== paidAt || pendingAfter.data.length || pendingAfter.has_more) return fail();
  return { subscriptionId: subscription.id, invoiceId: verified.invoiceId, paymentIntentId: verified.paymentIntentId,
    chargeId: verified.chargeId, amountPaid: verified.amount, status: subscription.status,
    trialEnd: new Date(subscription.trial_end * 1000).toISOString(),
    billingCycleAnchor: new Date(subscription.billing_cycle_anchor * 1000).toISOString(),
    adjustmentInvoiceId: verified.adjustmentInvoice?.id ?? null, latestInvoiceId: id(subscription.latest_invoice),
    noAdditionalCharges: true, noPendingInvoiceItems: true };
}

type Candidate = { contract: MembershipCommitment; paidAt: Date | string; invoiceId: string; reservationId: string };
/** No new payment, cancellation, refund or member consent is created here. Legacy
 * agreements explicitly promising a refund are held for an operator to review. */
export async function reconcilePaidFoundationsRollover(input: {subscriptionId: string; livemode: boolean}) {
  const sql = getBillingDatabase();
  const [candidate] = await sql<Candidate[]>`select contract.terms_snapshot as contract, invoice.paid_at as "paidAt",
    proof.stripe_invoice_id as "invoiceId", proof.reservation_id as "reservationId"
    from stripe_membership_prepaid_proofs proof
    join stripe_membership_commitments contract on contract.id=proof.contract_id
    join stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
    join membership_commercial_reservations reservation on reservation.id=proof.reservation_id
    where proof.stripe_subscription_id=${input.subscriptionId} and proof.livemode=${input.livemode}
      and proof.refund_state='review_required' and proof.review_reason='cohort_cutoff_missed'
      and proof.activated_at is null and proof.amount_refunded=0 and proof.cancellation_id is null
      and proof.provider_canceled_at is null and reservation.status='reserved' and contract.status='active'`;
  if (!candidate) return { handled: false, rolled: false, reviewRequired: false };
  if (!permitsAutomaticCohortRollover(candidate.contract) || !candidate.contract.billingSchedule) return { handled: true, rolled: false, reviewRequired: true };
  const schedule = resolveFoundationsEnrollmentSchedule(candidate.contract.billingSchedule, new Date(candidate.paidAt), candidate.contract.billingPlan);
  if (same(schedule, candidate.contract.billingSchedule)) return { handled: true, rolled: false, reviewRequired: true };
  // Persist intent before contacting Stripe. This survives a provider success
  // followed by a transaction/process failure; the retry validates the same dates.
  await sql`insert into private.membership_cohort_rollovers(reservation_id,contract_id,stripe_subscription_id,stripe_invoice_id,paid_at,accepted_schedule,effective_schedule)
    values(${candidate.reservationId}::uuid,${candidate.contract.id}::uuid,${input.subscriptionId},${candidate.invoiceId},${candidate.paidAt}::timestamptz,
      ${sql.json(JSON.parse(JSON.stringify(candidate.contract.billingSchedule)))}::jsonb,${sql.json(JSON.parse(JSON.stringify(schedule)))}::jsonb)
    on conflict(reservation_id) do nothing`;
  return await sql.begin(async tx => {
    const participants = await tx<Array<{memberId: string}>>`select member_id as "memberId" from membership_commercial_participants
      where reservation_id=${candidate.reservationId}::uuid order by member_id`;
    const memberIds = participants.map(participant => participant.memberId);
    await tx`select id from ruined_members where id=any(${memberIds}::uuid[]) order by id for update`;
    await tx`select member_id from member_lifecycle where member_id=any(${memberIds}::uuid[]) order by member_id for update`;
    await tx`select pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'))`;
    const [pending] = await tx<Array<{status: string; effectiveSchedule: FoundationsBillingSchedule}>>`
      select status,effective_schedule as "effectiveSchedule" from private.membership_cohort_rollovers
      where reservation_id=${candidate.reservationId}::uuid for update`;
    if (pending?.status === "completed") return { handled: true, rolled: true, reviewRequired: false };
    if (!pending || !same(pending.effectiveSchedule, schedule)) return fail();
    const [proof] = await tx<Array<{valid: boolean}>>`select (refund_state='review_required' and review_reason='cohort_cutoff_missed'
      and amount_refunded=0 and activated_at is null and cancellation_id is null and provider_canceled_at is null
      and not exists(select 1 from stripe_membership_cancellations where contract_id=${candidate.contract.id}::uuid and status<>'abandoned')) as valid
      from stripe_membership_prepaid_proofs where reservation_id=${candidate.reservationId}::uuid for update`;
    if (!proof?.valid) return fail();
    const evidence = await reconcileCohortRolloverProvider(getStripe(), candidate.contract, schedule);
    await tx`update private.membership_cohort_rollovers set status='completed',provider_evidence=${tx.json(evidence)}::jsonb,
      completed_at=clock_timestamp() where reservation_id=${candidate.reservationId}::uuid and status='pending'`;
    await tx`update stripe_membership_prepaid_proofs set refund_state='none',review_reason=null,verified_at=clock_timestamp()
      where reservation_id=${candidate.reservationId}::uuid`;
    await tx`insert into membership_commercial_events(member_id,reservation_id,event_type,evidence)
      values(${candidate.contract.memberId}::uuid,${candidate.reservationId}::uuid,'cohort_rolled',${tx.json({subscriptionId: input.subscriptionId,
        invoiceId: candidate.invoiceId, acceptedSchedule: JSON.parse(JSON.stringify(candidate.contract.billingSchedule)), effectiveSchedule: JSON.parse(JSON.stringify(schedule))})}::jsonb)`;
    return { handled: true, rolled: true, reviewRequired: false };
  });
}
