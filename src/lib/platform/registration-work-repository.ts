import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getPlatformConfiguration } from "@/lib/platform/config";

export type RegistrationOperatorWorkResult = { created: number; updated: number; resolved: number };
type TaskStatus = "open" | "in_progress" | "blocked" | "completed" | "cancelled";
type WorkRow = {
  id: string; payment_setup_attempt_id: string; status: TaskStatus; version: number | string;
  title: string; description: string | null; blocked_reason: string | null; due_at: Date | null;
  resolution_reason: string | null;
};
type RegistrationState = {
  person_id: string; attempt_id: string | null; eligible: boolean; billing_active: boolean;
  profile_released: boolean; checkout_pending: boolean; registration_partner_id: string | null;
  payer_ids: string[];
};

async function recordEvent(tx: postgres.TransactionSql, task: { id: string; version: number },
  previousStatus: TaskStatus | null, nextStatus: TaskStatus, reason: string, attemptId: string) {
  await tx`
    insert into operator_task_events (operator_task_id, event_type, previous_status, next_status, actor_type, evidence, dedupe_key)
    values (${task.id}::uuid, ${previousStatus === null ? "created" : nextStatus === "completed" ? "completed" : nextStatus === "cancelled" ? "cancelled" : "state_changed"},
      ${previousStatus}, ${nextStatus}, 'system',
      ${tx.json({ source: "registration.billing_review", reason, paymentSetupAttemptId: attemptId })},
      ${`registration-work:${task.id}:v${task.version}`})
  `;
}

async function readRegistrationState(tx: postgres.TransactionSql, memberId: string) {
  const [row] = await tx<RegistrationState[]>`
    select member.person_id, method.consent_attempt_id as attempt_id,
      (registration.registered_at is not null and registration.completion_basis = 'saved_card'
        and member.deleted_at is null and person.status = 'active' and lifecycle.account_state = 'active'
        and member.membership_state = 'pending' and lifecycle.billing_state = 'pending'
        and lifecycle.standing_state = 'pre_active' and lifecycle.program_state in ('prospect', 'onboarding')
        and private.ruined_member_registration_ready(member.id)
        and not private.ruined_member_has_complimentary_funding(member.id)
        and not private.ruined_member_has_operator_funding(member.id)
        and not private.ruined_member_has_couple_funding(member.id)
        and coalesce(private.ruined_member_shared_billing_state(member.id), 'pending') = 'pending'
        and not exists (select 1 from stripe_subscriptions subscription where subscription.member_id = member.id
          and subscription.stripe_status in ('active', 'trialing', 'past_due', 'unpaid', 'paused'))
      ) as eligible,
      coalesce(private.ruined_member_shared_billing_state(member.id) = 'active',
        (exists (select 1 from stripe_subscriptions subscription where subscription.member_id = member.id
            and subscription.stripe_status in ('active', 'trialing')
            and (subscription.cancel_at is null or subscription.cancel_at > statement_timestamp()))
          and not exists (select 1 from stripe_subscriptions subscription where subscription.member_id = member.id
            and subscription.stripe_status in ('incomplete', 'past_due', 'unpaid', 'paused')))
        or (lifecycle.billing_state = 'active' and not exists (
          select 1 from stripe_subscriptions subscription where subscription.member_id = member.id))) as billing_active,
      private.ruined_member_profile_released(member.id) as profile_released,
      (exists (select 1 from stripe_checkout_attempts checkout where checkout.member_id = member.id
          and (checkout.status in ('creating', 'open') or (checkout.status = 'completed'
            and (checkout.stripe_subscription_id is null or not exists (
              select 1 from stripe_subscriptions subscription where subscription.id = checkout.stripe_subscription_id)))))
        or exists (select 1 from stripe_subscriptions subscription where subscription.member_id = member.id
          and subscription.stripe_status = 'incomplete')) as checkout_pending,
      private.ruined_registration_circle_couple_partner(member.id) as registration_partner_id,
      array(select distinct reservation.payer_member_id from membership_commercial_participants participant
        join membership_commercial_reservations reservation on reservation.id = participant.reservation_id
          and reservation.kind = 'couple' and reservation.status in ('reserved', 'activated')
        join membership_commercial_participants partner on partner.reservation_id = reservation.id
          and partner.member_id = private.ruined_commercial_circle_couple_partner(member.id)
        where participant.member_id = member.id and participant.person_id = member.person_id
      ) as payer_ids
    from ruined_members member
    join people person on person.id = member.person_id
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    left join member_registration_access registration on registration.member_id = member.id
    left join member_payment_method_accounts method on method.member_id = member.id
      and method.stripe_account_id = registration.payment_setup_account_id
      and method.livemode = registration.payment_setup_livemode
    where member.id = ${memberId}::uuid
  `;
  return row;
}

/** Reconcile review tasks only. Call from an authenticated internal worker, never
 * a member read. Existing registrations are backfilled on the first run. Global
 * checkout readiness already includes the commercial/tax release approval; the
 * optional automatic-tax switch is not evidence that billing has been approved.
 */
export async function reconcileRegistrationOperatorWork(): Promise<RegistrationOperatorWorkResult> {
  const sql = getApplicationDatabase();
  const checkoutReady = getPlatformConfiguration().stripeCheckoutReady;
  const result: RegistrationOperatorWorkResult = { created: 0, updated: 0, resolved: 0 };
  const members = await sql<Array<{ member_id: string }>>`
    select registration.member_id from member_registration_access registration
    join ruined_members member on member.id = registration.member_id and member.deleted_at is null
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    where registration.registered_at is not null and registration.completion_basis = 'saved_card'
      and member.membership_state = 'pending' and lifecycle.billing_state = 'pending'
      and lifecycle.account_state = 'active' and lifecycle.standing_state = 'pre_active'
      and lifecycle.program_state in ('prospect', 'onboarding')
    union select work.member_id from registration_operator_work work
      join operator_tasks task on task.id = work.operator_task_id and task.status in ('open', 'in_progress', 'blocked')
    order by member_id
  `;
  for (const { member_id: memberId } of members) {
    const change = await sql.begin(async (tx) => {
      const counts: RegistrationOperatorWorkResult = { created: 0, updated: 0, resolved: 0 };
      // Match setup/registration/funding writers' lock order. Separate member
      // transactions avoid holding one member's lock while waiting on another.
      await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`;
      await tx`select id from ruined_members where id = ${memberId}::uuid for update`;
      const state = await readRegistrationState(tx, memberId);
      const work = await tx<WorkRow[]>`
        select task.id, work.payment_setup_attempt_id, task.status, task.version, task.title, task.description,
          task.blocked_reason, task.due_at, work.resolution_reason
        from registration_operator_work work join operator_tasks task on task.id = work.operator_task_id
        where work.member_id = ${memberId}::uuid order by task.id for update of task, work
      `;
      const otherPayer = state?.payer_ids.length === 1 && state.payer_ids[0] !== memberId;
      const eligible = Boolean(state?.eligible && state.attempt_id && !otherPayer);
      for (const task of work) {
        if (["completed", "cancelled"].includes(task.status) || (eligible && task.payment_setup_attempt_id === state!.attempt_id)) continue;
        const reason = state?.billing_active ? "billing_active" : otherPayer ? "billing_owner_changed"
          : eligible ? "saved_method_replaced" : "registration_no_longer_eligible";
        const status = reason === "billing_active" ? "completed" : "cancelled";
        const version = Number(task.version) + 1;
        await tx`update operator_tasks set status = ${status}, completed_at = case when ${status} = 'completed' then statement_timestamp() else null end,
          due_at = null, blocked_reason = null, version = ${version}, updated_at = statement_timestamp() where id = ${task.id}::uuid`;
        await tx`update registration_operator_work set resolution_reason = ${reason}, resolved_at = statement_timestamp(), updated_at = statement_timestamp()
          where operator_task_id = ${task.id}::uuid`;
        await recordEvent(tx, { id: task.id, version }, task.status, status, reason, task.payment_setup_attempt_id);
        counts.resolved += 1;
      }
      if (!eligible || !state?.attempt_id) return counts;
      const current = work.find(task => task.payment_setup_attempt_id === state.attempt_id);
      // Operator completion is durable for this exact consent. A new saved-card
      // attempt creates a new task; refreshing the queue never reopens it.
      if (current?.status === "completed" || (current?.status === "cancelled" && !current.resolution_reason)) return counts;
      const blockedReason = !checkoutReady ? "Paid membership is not open. Keep this review on hold until the existing commercial, payment and tax release checks are approved."
        : !state.profile_released ? "This member's registration profile has not been activated. The existing registration hold prevents paid checkout."
        : state.payer_ids.length > 1 ? "Shared billing responsibility is ambiguous. Confirm the canonical billing owner before proceeding."
        : state.checkout_pending ? "A membership checkout or subscription confirmation is already pending. Verify its outcome before starting another checkout."
        : null;
      const status: TaskStatus = blockedReason ? "blocked" : current?.status === "in_progress" ? "in_progress" : "open";
      const title = blockedReason ? state.checkout_pending && checkoutReady && state.profile_released
        ? "Card saved — checkout confirmation pending" : "Card saved — billing opening pending" : "Review membership billing";
      const description = [
        "Registration is complete and a payment method is saved. Review the member's billing next step; the saved card does not authorize a charge.",
        blockedReason ?? "Confirm the applicable membership offer and guide the member through the published agreement and final checkout. This task does not start billing or activate access.",
        state.registration_partner_id && state.payer_ids.length !== 1
          ? "A registration couple link is present. It records Circle placement intent only; confirm shared billing responsibility separately."
          : state.payer_ids.length === 1 ? "This member is the canonical billing owner for the shared membership." : null,
      ].filter(Boolean).join("\n\n");
      if (current) {
        if (current.status === status && current.title === title && current.description === description && current.blocked_reason === blockedReason && current.due_at === null) return counts;
        const version = Number(current.version) + 1;
        await tx`update operator_tasks set status = ${status}, title = ${title}, description = ${description}, blocked_reason = ${blockedReason},
          due_at = null, completed_at = null, version = ${version}, updated_at = statement_timestamp() where id = ${current.id}::uuid`;
        await tx`update registration_operator_work set resolution_reason = null, resolved_at = null, updated_at = statement_timestamp()
          where operator_task_id = ${current.id}::uuid`;
        await recordEvent(tx, { id: current.id, version }, current.status, status, blockedReason ? "review_blocked" : "review_ready", state.attempt_id);
        counts.updated += 1;
      } else {
        const id = randomUUID();
        await tx`insert into operator_tasks (id, member_id, person_id, task_type, title, description, status, blocked_reason, created_by_type, idempotency_key)
          values (${id}::uuid, ${memberId}::uuid, ${state.person_id}::uuid, 'registration.billing_review', ${title}, ${description}, ${status},
            ${blockedReason}, 'system', ${`registration-billing-review:${memberId}:${state.attempt_id}`})`;
        await tx`insert into registration_operator_work (member_id, payment_setup_attempt_id, operator_task_id)
          values (${memberId}::uuid, ${state.attempt_id}::uuid, ${id}::uuid)`;
        await recordEvent(tx, { id, version: 1 }, null, status, blockedReason ? "review_blocked" : "review_ready", state.attempt_id);
        counts.created += 1;
      }
      return counts;
    });
    result.created += change.created;
    result.updated += change.updated;
    result.resolved += change.resolved;
  }
  return result;
}
