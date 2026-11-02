import "server-only";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { HELD_EMAILS } from "./communications-catalog";
import { readLifecycleEmailWorkReadiness, type LifecycleEmailWorkReadiness } from "./member-lifecycle-email-service";
import type { LifecycleEmailKey } from "./member-lifecycle-email-model";

export type HeldEmailWork = {
  id: string;
  title: string;
  reason: string;
  reviewHref: string | null;
  reviewLabel: string;
};

const CADE_PREFIX = "cade-communications-20261021:";
const WORK_TYPE = "communications.held_email_review";
const SOURCE = "held_email_work";
const ACTIVE = new Set(["open", "in_progress", "blocked"]);
const LIFECYCLE_CADE_KEYS: Partial<Record<LifecycleEmailKey, string>> = {
  birthday: "birthday-gift",
  checkin_30: "review-badge",
  checkin_90: "survey-badge",
  checkin_6_month: "six-month-artifact",
};

function taskKey(key: LifecycleEmailKey): string {
  const cade = LIFECYCLE_CADE_KEYS[key];
  return cade ? `${CADE_PREFIX}${cade}` : `held-email:lifecycle:${key}`;
}

function lifecycleWork(rule: LifecycleEmailWorkReadiness): HeldEmailWork {
  return {
    id: `lifecycle:${rule.key}`,
    title: rule.title,
    reason: rule.missing.join(" "),
    reviewHref: `/ops/messages?mode=automations&lifecycle=${rule.key}#lifecycle-emails`,
    reviewLabel: "Review template & rules",
  };
}

/** Current held markers enrich existing tasks; they never replace their full briefs. */
export async function readHeldEmailWork(tx: TransactionSql): Promise<Map<string, HeldEmailWork>> {
  const work = new Map<string, HeldEmailWork>();
  for (const item of HELD_EMAILS) {
    const sourceKey = item.id.replace("held:email:", "");
    const key = sourceKey === "later-anniversaries" ? "anniversary-later-years" : sourceKey;
    work.set(`${CADE_PREFIX}${key}`, {
      id: item.id, title: item.title, reason: item.detail ?? item.trigger,
      reviewHref: null, reviewLabel: "Review full draft & decisions",
    });
  }
  work.set(`${CADE_PREFIX}clothing-benefits`, {
    id: "held:email:clothing-benefits",
    title: "Clothing-drop member access and benefits",
    reason: "Decide early access, member-only items and any approved benefit before using the manual clothing-drop email.",
    reviewHref: null, reviewLabel: "Review full draft & decisions",
  });
  for (const rule of await readLifecycleEmailWorkReadiness(tx)) {
    if (!rule.ready) work.set(taskKey(rule.key), lifecycleWork(rule));
  }
  return work;
}

type TaskRow = {
  id: string;
  idempotency_key: string;
  task_type: string;
  title: string;
  description: string | null;
  status: string;
  version: number | string;
  assigned_to_auth_user_id: string | null;
  system_resolved: boolean;
};

async function recordEvent(tx: TransactionSql, task: Pick<TaskRow, "id" | "version">, key: string, previous: string | null, next: string, reason: string) {
  await tx`
    insert into operator_task_events(operator_task_id,event_type,previous_status,next_status,actor_type,evidence,dedupe_key)
    values(${task.id}::uuid,${previous === null ? "created" : next === "completed" ? "completed" : "state_changed"},
      ${previous},${next},'system',${tx.json({ source: SOURCE, key, reason, changesDelivery: false, version: Number(task.version) })},
      ${`${SOURCE}:${task.id}:${task.version}`})
  `;
}

/** Called only inside the Work queue's reauthorized admin transaction. No delivery mutation occurs here. */
export async function syncHeldEmailWork(tx: TransactionSql): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtext('ruined-held-email-work'), 1)`;
  const rules = await readLifecycleEmailWorkReadiness(tx, new Date(), true);
  if (!rules.length) return;
  const keys = rules.map(rule => taskKey(rule.key));
  const tasks = await tx<TaskRow[]>`
    select task.id,task.idempotency_key,task.task_type,task.title,task.description,task.status,task.version,task.assigned_to_auth_user_id,
      coalesce((select event.actor_type='system' and event.evidence->>'source'=${SOURCE}
          and event.evidence->>'reason'='held_email_ready'
        from operator_task_events event where event.operator_task_id=task.id
          and event.next_status in ('completed','cancelled')
          and event.event_type in ('completed','cancelled','state_changed')
        order by event.id desc limit 1),false) as system_resolved
    from operator_tasks task where task.idempotency_key=any(${keys}::text[])
    order by task.id for update of task
  `;
  const byKey = new Map(tasks.map(task => [task.idempotency_key, task]));
  for (const rule of rules) {
    const key = taskKey(rule.key), task = byKey.get(key);
    // The original CADE work includes broader decisions and complete source copy.
    // Preserve its owner, status and description even after the email becomes ready.
    if (LIFECYCLE_CADE_KEYS[rule.key] || (task && task.task_type !== WORK_TYPE)) continue;
    if (rule.ready) {
      if (!task || !ACTIVE.has(task.status)) continue;
      const version = Number(task.version) + 1;
      await tx`update operator_tasks set status='completed',completed_at=statement_timestamp(),version=${version},updated_at=statement_timestamp()
        where id=${task.id}::uuid`;
      await recordEvent(tx, { id: task.id, version }, rule.key, task.status, "completed", "held_email_ready");
      continue;
    }
    const title = `Review held email: ${rule.title}`;
    const description = ["HELD EMAIL — REVIEW WORK ONLY. This task does not enable or send an email.",
      ...rule.missing, "Review the template and its rules in Communications. Enabling delivery is a separate administrator action."].join("\n\n");
    if (!task) {
      const id = randomUUID();
      await tx`insert into operator_tasks(id,task_type,title,description,status,created_by_type,idempotency_key)
        values(${id}::uuid,${WORK_TYPE},${title},${description},'open','system',${key})`;
      await recordEvent(tx, { id, version: 1 }, rule.key, null, "open", "held_email_needed");
      continue;
    }
    if (!ACTIVE.has(task.status) && !task.system_resolved) continue;
    const status = ACTIVE.has(task.status) ? task.status : task.assigned_to_auth_user_id ? "in_progress" : "open";
    if (task.status === status && task.title === title && task.description === description) continue;
    const version = Number(task.version) + 1;
    await tx`update operator_tasks set title=${title},description=${description},status=${status},completed_at=null,
      version=${version},updated_at=statement_timestamp() where id=${task.id}::uuid`;
    await recordEvent(tx, { id: task.id, version }, rule.key, task.status, status, "held_email_needed");
  }
}
