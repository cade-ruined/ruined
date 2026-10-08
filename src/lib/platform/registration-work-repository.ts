import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { operatorMemberJourney } from "@/lib/membership/operator-registration-progress";
import { readMemberRegistrationProgress } from "@/lib/membership/registration-repository";

export type RegistrationOperatorWorkResult = { created: number; updated: number; resolved: number };
type TaskStatus = "open" | "in_progress" | "blocked" | "completed" | "cancelled";
type Checkpoint = "email" | "information" | "payment" | "profile" | "review";
type Resolution = "checkpoint_satisfied" | "next_step_changed" | "member_no_longer_eligible";
type WorkRow = {
  id: string; checkpoint: Checkpoint; status: TaskStatus; version: number | string;
  title: string; description: string | null; blocked_reason: string | null; due_at: Date | null;
  assigned_to_auth_user_id: string | null; resolution_reason: Resolution | null; manually_resolved: boolean;
};
type Journey = ReturnType<typeof operatorMemberJourney>;
const live = (status: TaskStatus) => status === "open" || status === "in_progress" || status === "blocked";

async function recordEvent(tx: postgres.TransactionSql, task: { id: string; version: number },
  previousStatus: TaskStatus | null, nextStatus: TaskStatus, reason: string, checkpoint: Checkpoint) {
  await tx`
    insert into operator_task_events (operator_task_id, event_type, previous_status, next_status, actor_type, evidence, dedupe_key)
    values (${task.id}::uuid, ${previousStatus === null ? "created" : nextStatus === "completed" ? "completed" : nextStatus === "cancelled" ? "cancelled" : "state_changed"},
      ${previousStatus}, ${nextStatus}, 'system',
      ${tx.json({ source: "registration.checkpoint", reason, checkpoint })},
      ${`registration-checkpoint-work:${task.id}:v${task.version}`})
  `;
}

function satisfied(journey: Journey, checkpoint: Checkpoint) {
  if (checkpoint === "review") return journey.next.key !== "review" && !journey.attention;
  const state = journey.checkpoints.find(item => item.key === checkpoint)?.state;
  return state === "complete" || state === "not_required";
}

/** Adopt one existing consent-based billing task instead of recreating it.
 * Prefer live work, then a manually closed obligation, then resolved history.
 * Older consent records and all task events remain in place. */
async function adoptLegacyWork(tx: postgres.TransactionSql, memberId: string) {
  await tx`
    insert into registration_checkpoint_work (member_id, checkpoint, operator_task_id, resolution_reason, resolved_at)
    select legacy.member_id, 'payment', task.id,
      case when legacy.resolution_reason is null then null
        when legacy.resolution_reason = 'billing_active' then 'checkpoint_satisfied'
        else 'next_step_changed' end,
      legacy.resolved_at
    from registration_operator_work legacy join operator_tasks task on task.id = legacy.operator_task_id
    where legacy.member_id = ${memberId}::uuid
      and not exists (select 1 from registration_checkpoint_work work where work.member_id = legacy.member_id and work.checkpoint = 'payment')
    order by case when task.status in ('open','in_progress','blocked') then 0
      when legacy.resolution_reason is null and task.status in ('completed','cancelled') then 1 else 2 end,
      task.created_at desc, task.id
    limit 1
    on conflict (member_id, checkpoint) do nothing
  `;
}

/** Reconcile the same next action displayed by the operator member journey.
 * This worker creates operator obligations only: never billing, profile access,
 * member communications or evidence that a checkpoint happened. */
export async function reconcileRegistrationOperatorWork(): Promise<RegistrationOperatorWorkResult> {
  const sql = getApplicationDatabase();
  const result: RegistrationOperatorWorkResult = { created: 0, updated: 0, resolved: 0 };
  // Explicit enrollment scope avoids new payment tasks for legacy members or
  // administrators who never entered registration. Include tracked work so
  // deleted/inactive members' outstanding tasks can be closed with a ledger.
  const members = await sql<Array<{ member_id: string }>>`
    select member_id from member_registration_access
    union select member_id from registration_checkpoint_work
    union select member_id from registration_operator_work
    order by member_id
  `;
  for (const { member_id: memberId } of members) {
    const change = await sql.begin(async tx => {
      const counts: RegistrationOperatorWorkResult = { created: 0, updated: 0, resolved: 0 };
      // Match the funding/payment writers' lock order and serialize workers per
      // member so concurrent queue refreshes cannot duplicate an obligation.
      await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`;
      const [member] = await tx<Array<{ person_id: string; eligible: boolean }>>`
        select member.person_id, (registration.member_id is not null and member.deleted_at is null
          and person.status = 'active' and member.membership_state <> 'ended'
          and lifecycle.account_state in ('provisional','invited','active')
          and lifecycle.billing_state <> 'ended' and lifecycle.program_state <> 'withdrawn') as eligible
        from ruined_members member join people person on person.id = member.person_id
        join member_lifecycle lifecycle on lifecycle.member_id = member.id
        left join member_registration_access registration on registration.member_id = member.id
        where member.id = ${memberId}::uuid for update of member
      `;
      await adoptLegacyWork(tx, memberId);
      const work = await tx<WorkRow[]>`
        select task.id, work.checkpoint, task.status, task.version, task.title, task.description,
          task.blocked_reason, task.due_at, task.assigned_to_auth_user_id, work.resolution_reason,
          coalesce((select event.actor_type = 'operator' from operator_task_events event
            where event.operator_task_id = task.id and event.next_status = task.status
              and event.event_type in ('completed','cancelled','state_changed')
            order by event.id desc limit 1), false) as manually_resolved
        from registration_checkpoint_work work join operator_tasks task on task.id = work.operator_task_id
        where work.member_id = ${memberId}::uuid order by task.id for update of task, work
      `;
      const progress = member?.eligible ? (await readMemberRegistrationProgress(tx, [memberId])).get(memberId) : null;
      const journey = progress ? operatorMemberJourney(progress) : null;
      // Shared billing has one payer follow-up. The partner's checkpoints still
      // show why they are waiting; their own email/info/profile work remains.
      const next = journey?.next.key === "complete" || (journey?.next.key === "payment" && progress?.paymentByPartner)
        ? null : journey?.next ?? null;
      for (const task of work) {
        if (!live(task.status) || task.checkpoint === next?.key) continue;
        const done = Boolean(journey && satisfied(journey, task.checkpoint));
        const resolution: Resolution = !journey ? "member_no_longer_eligible" : done ? "checkpoint_satisfied" : "next_step_changed";
        const status: TaskStatus = done ? "completed" : "cancelled";
        const version = Number(task.version) + 1;
        await tx`update operator_tasks set status = ${status}, completed_at = case when ${status} = 'completed' then statement_timestamp() else null end,
          due_at = null, blocked_reason = null, version = ${version}, updated_at = statement_timestamp() where id = ${task.id}::uuid`;
        await tx`update registration_checkpoint_work set resolution_reason = ${resolution}, resolved_at = statement_timestamp(), updated_at = statement_timestamp()
          where operator_task_id = ${task.id}::uuid`;
        // The legacy table is retained for old audit/reporting paths. Its reason
        // says billing confirmed only when verified payment is actually present.
        await tx`update registration_operator_work set resolution_reason = ${task.checkpoint === "payment" && progress?.paymentConfirmed ? "billing_active" : "registration_no_longer_eligible"},
          resolved_at = statement_timestamp(), updated_at = statement_timestamp() where operator_task_id = ${task.id}::uuid`;
        await recordEvent(tx, { id: task.id, version }, task.status, status, resolution, task.checkpoint);
        counts.resolved++;
      }
      if (!next || !journey || !progress || !member) return counts;
      const checkpoint = next.key as Checkpoint;
      const current = work.find(task => task.checkpoint === checkpoint);
      // A manual completion/cancellation is durable even if information or a
      // saved card later changes. System-resolved work can resume the same task.
      if (current && !live(current.status) && (!current.resolution_reason || current.manually_resolved)) return counts;
      const blockedReason = checkpoint === "payment" && progress.paidCheckoutAvailable === false
        ? "Paid membership is not open. Follow up when checkout is available; do not charge a saved card."
        : null;
      const status: TaskStatus = blockedReason ? "blocked" : current?.assigned_to_auth_user_id ? "in_progress" : "open";
      const title = next.label;
      const description = [next.detail, journey.attention, blockedReason,
        checkpoint === "payment" ? progress.paymentByPartner ? "Follow up with the shared billing owner. Do not start a separate checkout for this member."
          : "Payment is completed by the member through their membership checkout. A saved card alone is not permission to charge."
          : checkpoint === "profile" ? "Review the member's checkpoints and grant profile access when the launch plan allows. Completing this task does not open the profile."
          : null,
      ].filter((value, index, values) => value && values.indexOf(value) === index).join("\n\n");
      if (current) {
        if (current.status === status && current.title === title && current.description === description && current.blocked_reason === blockedReason && current.due_at === null) return counts;
        const version = Number(current.version) + 1;
        await tx`update operator_tasks set status = ${status}, title = ${title}, description = ${description}, blocked_reason = ${blockedReason},
          due_at = null, completed_at = null, version = ${version}, updated_at = statement_timestamp() where id = ${current.id}::uuid`;
        await tx`update registration_checkpoint_work set resolution_reason = null, resolved_at = null, updated_at = statement_timestamp()
          where operator_task_id = ${current.id}::uuid`;
        await recordEvent(tx, { id: current.id, version }, current.status, status, blockedReason ? "checkpoint_blocked" : "checkpoint_needed", checkpoint);
        counts.updated++;
      } else {
        const id = randomUUID();
        await tx`insert into operator_tasks (id, member_id, person_id, task_type, title, description, status, blocked_reason, created_by_type, idempotency_key)
          values (${id}::uuid, ${memberId}::uuid, ${member.person_id}::uuid, ${`registration.checkpoint.${checkpoint}`}, ${title}, ${description}, ${status},
            ${blockedReason}, 'system', ${`registration-checkpoint:${memberId}:${checkpoint}`})`;
        await tx`insert into registration_checkpoint_work (member_id, checkpoint, operator_task_id) values (${memberId}::uuid, ${checkpoint}, ${id}::uuid)`;
        await recordEvent(tx, { id, version: 1 }, null, status, blockedReason ? "checkpoint_blocked" : "checkpoint_needed", checkpoint);
        counts.created++;
      }
      return counts;
    });
    result.created += change.created;
    result.updated += change.updated;
    result.resolved += change.resolved;
  }
  return result;
}
