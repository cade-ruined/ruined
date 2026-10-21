import "server-only";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { requireAdminEmailActor } from "./admin-email-repository";
import { assertCadencePayload, getMemberEmailCadenceDeliveryConfiguration, sendCadencePayload } from "./member-email-cadence-delivery";
import { assertCadenceRecipientDeliverable } from "./member-email-cadence-provider";
import { CadenceDeliveryError } from "./member-email-cadence-repository";
import type { CadenceEmailPayload } from "./member-email-cadence-types";
import { denverDate, lifecycleMissing, lifecycleOccurrenceIsDue, lifecycleOccurrences, type LifecycleEmailKey } from "./member-lifecycle-email-model";
import { lifecycleRecipientQualifies, readLifecycleMembers, readLifecycleRules, type LifecycleRule } from "./member-lifecycle-email-repository";
import { renderLifecycleMessage } from "./member-lifecycle-email-service";

type Delivery = { id:string; memberId:string; key:LifecycleEmailKey; revision:number; occurrenceKey:string;
  email:string; consentId:string; dueAt:Date|string; expiresAt:Date|string; attempts:number;
  firstAttemptAt:Date|string|null; payload:CadenceEmailPayload|null };
async function enqueue(globalActivatedAt:string) {
  return getApplicationDatabase().begin(async tx=>{
    const rules=await readLifecycleRules(tx,true),members=await readLifecycleMembers(tx);
    const now=new Date().toISOString(),year=Number(denverDate(now).slice(0,4));
    let count=0;
    for (const rule of rules) {
      if (!rule.enabled || !rule.authorized || !rule.design || !rule.activatedAt) continue;
      for (const member of members) {
        if (!lifecycleRecipientQualifies(rule.key,member,rule.settings) || !member.consentId) continue;
        for (const candidateYear of [year-1,year]) {
          if (lifecycleMissing(rule.key,rule.settings,candidateYear).length) continue;
          for (const occurrence of lifecycleOccurrences(rule.key,member,candidateYear)) {
            if (!lifecycleOccurrenceIsDue(occurrence,{now,activatedAt:new Date(Math.max(Date.parse(rule.activatedAt),Date.parse(globalActivatedAt))).toISOString(),enrolledAt:member.enrolledAt})) continue;
            const inserted=await tx`insert into private.member_lifecycle_email_deliveries
              (rule_key,rule_revision,member_id,occurrence_key,expected_email,expected_consent_id,due_at,expires_at)
              values(${rule.key},${rule.revision},${member.id}::uuid,${occurrence.occurrenceKey},${member.email},${member.consentId}::bigint,
                ${occurrence.dueAt}::timestamptz,${occurrence.expiresAt}::timestamptz)
              on conflict(member_id,rule_key,occurrence_key) do nothing returning id`;
            count+=inserted.length;
          }
        }
      }
    }
    return count;
  });
}
async function withDelivery(id:string,lease:string,action:(tx:TransactionSql,delivery:Delivery,rule:LifecycleRule,name:string)=>Promise<void>) {
  return getApplicationDatabase().begin(async tx=>{
    await tx`set local lock_timeout='3s'`;
    await tx`set local statement_timeout='20s'`;
    const [delivery]=await tx<Delivery[]>`select id,member_id as "memberId",rule_key as key,rule_revision as revision,
      occurrence_key as "occurrenceKey",expected_email as email,expected_consent_id::text as "consentId",
      due_at as "dueAt",expires_at as "expiresAt",attempts,first_attempt_at as "firstAttemptAt",payload
      from private.member_lifecycle_email_deliveries where id=${id}::uuid and lock_token=${lease}::uuid and status='sending' for update`;
    if (!delivery) return "deferred" as const;
    const stop=async(reason:string)=>{
      const status=delivery.firstAttemptAt ? "manual_review" : "cancelled";
      await tx`update private.member_lifecycle_email_deliveries set status=${status},last_error=${reason},lock_token=null,locked_at=null,
        updated_at=clock_timestamp() where id=${id}::uuid`;
      return status;
    };
    const configuration=getMemberEmailCadenceDeliveryConfiguration();
    if (!configuration.enabled || !configuration.ready || !configuration.activatedAt || Date.parse(configuration.activatedAt)>new Date(delivery.dueAt).getTime()) return stop("Delivery configuration changed");
    const rule=(await readLifecycleRules(tx,true)).find(item=>item.key===delivery.key);
    if (!rule?.enabled || !rule.authorized || !rule.design || !rule.activatedAt || rule.revision!==delivery.revision) return stop("Approval changed; delivery stopped");
    await requireAdminEmailActor(tx,rule.approvedBy!,true);
    const year=Number(delivery.occurrenceKey.slice(0,4));
    if (lifecycleMissing(rule.key,rule.settings,year).length) return stop("Message prerequisites need review");
    const [member]=await readLifecycleMembers(tx,delivery.memberId,true);
    if (!member || !lifecycleRecipientQualifies(rule.key,member,rule.settings) || member.email!==delivery.email || member.consentId!==delivery.consentId) return stop("Recipient access or email preference changed");
    const occurrence=lifecycleOccurrences(rule.key,member,year).find(item=>item.occurrenceKey===delivery.occurrenceKey);
    if (!occurrence || occurrence.dueAt!==new Date(delivery.dueAt).toISOString() || !lifecycleOccurrenceIsDue(occurrence,
      {now:new Date().toISOString(),activatedAt:rule.activatedAt,enrolledAt:member.enrolledAt})) return stop("Send window or member milestone changed");
    if (delivery.attempts>5 || delivery.firstAttemptAt && Date.now()-new Date(delivery.firstAttemptAt).getTime()>=23*60*60_000) return stop("Uncertain delivery needs manual review");
    await action(tx,delivery,rule,member.name);
    return "ok" as const;
  });
}
async function fulfillmentOwner(tx:TransactionSql,rule:LifecycleRule) {
  if (rule.key!=="checkin_6_month" || rule.settings.fulfillmentMode!=="task") return null;
  const owners=await tx`select account.auth_user_id from platform_users account
    join people person on person.id=account.person_id and person.status='active'
    where account.status='active' and account.email_normalized='libby@theruinedproject.com'
    and exists(select 1 from platform_role_grants role where role.auth_user_id=account.auth_user_id and role.role_slug='ops_admin' and role.revoked_at is null)
    and exists(select 1 from person_email_addresses address where address.person_id=account.person_id and address.email_normalized=account.email_normalized
      and address.verification_state='verified' and address.retired_at is null) for share of account,person`;
  if (owners.length!==1) throw new CadenceDeliveryError("six_month_fulfillment_owner_unavailable",true);
  return owners[0].auth_user_id as string;
}
async function fulfillmentTask(tx:TransactionSql,delivery:Delivery,rule:LifecycleRule,owner:string|null) {
  if (!owner) return;
  const key=`cade:six-month:${delivery.memberId}:${delivery.occurrenceKey}`;
  const [created]=await tx<Array<{id:string}>>`insert into operator_tasks(member_id,task_type,title,description,assigned_to_auth_user_id,created_by_type,idempotency_key)
    values(${delivery.memberId}::uuid,'communications.six_month_artifact','Prepare the six-month member Artifact',
      ${`The member received the six-month check-in. Follow the approved fulfillment process for: ${rule.settings.foundationsWorkLabel}. Do not place private Foundations responses in this task.`},
      ${owner}::uuid,'system',${key})
    on conflict(idempotency_key) where idempotency_key is not null do nothing returning id`;
  const task=created ?? (await tx<Array<{id:string}>>`select id from operator_tasks where idempotency_key=${key} for update`)[0];
  if (!task) throw new Error("Six-month fulfillment task unavailable");
  await tx`insert into operator_task_events(operator_task_id,event_type,next_status,actor_type,evidence,dedupe_key)
    values(${task.id}::uuid,'created','open','system',
      ${tx.json({source:"member_lifecycle_email",deliveryId:delivery.id,ruleKey:rule.key})},${`${key}:created`})
    on conflict(dedupe_key) do nothing`;
}

export async function processMemberLifecycleEmailBatch(limit=20) {
  const config=getMemberEmailCadenceDeliveryConfiguration();
  const result={ready:config.ready,enabled:config.enabled,queued:0,sent:0,failed:0,cancelled:0,manualReview:0};
  if (!config.enabled || !config.ready || !config.activatedAt || Date.parse(config.activatedAt)>Date.now()) return result;
  const deadline=Date.now()+145_000,sql=getApplicationDatabase(),lease=randomUUID();
  result.queued=await enqueue(config.activatedAt);
  await sql`update private.member_lifecycle_email_deliveries set status=case when first_attempt_at is null then 'cancelled' else 'manual_review' end,
    last_error='Send window expired',lock_token=null,locked_at=null,updated_at=clock_timestamp()
    where status in ('pending','failed','sending') and expires_at<=clock_timestamp() and (locked_at is null or locked_at<clock_timestamp()-interval '2 minutes')`;
  for (let index=0;index<Math.min(50,Math.max(1,limit)) && Date.now()<deadline;index++) {
    const [claim]=await sql`with candidate as(select id from private.member_lifecycle_email_deliveries
      where expires_at>clock_timestamp() and due_at<=clock_timestamp() and ((status in ('pending','failed') and available_at<=clock_timestamp())
        or (status='sending' and locked_at<clock_timestamp()-interval '2 minutes')) order by due_at,id for update skip locked limit 1)
      update private.member_lifecycle_email_deliveries delivery set status='sending',attempts=attempts+1,lock_token=${lease}::uuid,
        locked_at=clock_timestamp(),updated_at=clock_timestamp() from candidate where delivery.id=candidate.id returning delivery.id`;
    if (!claim) break;
    try {
      const prepared=await withDelivery(claim.id,lease,async(tx,delivery,rule,name)=>{
        const payload=delivery.payload ?? {...renderLifecycleMessage(rule,name),to:delivery.email};
        assertCadencePayload(payload,delivery.email);
        await tx`update private.member_lifecycle_email_deliveries set payload=coalesce(payload,${tx.json(payload)}),
          first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),updated_at=clock_timestamp() where id=${delivery.id}::uuid`;
      });
      if (prepared!=="ok") { if (prepared==="manual_review") result.manualReview++; else if (prepared==="cancelled") result.cancelled++; continue; }
      const outcome=await withDelivery(claim.id,lease,async(tx,delivery,rule)=>{
        if (!delivery.payload || !delivery.firstAttemptAt) throw new Error("Frozen message unavailable");
        assertCadencePayload(delivery.payload,delivery.email);
        const owner=await fulfillmentOwner(tx,rule);
        const sendDeadline=Math.min(deadline,new Date(delivery.expiresAt).getTime());
        await assertCadenceRecipientDeliverable(delivery.email,{deadline:sendDeadline});
        const providerId=await sendCadencePayload(delivery.payload,delivery.id,sendDeadline);
        await tx`update private.member_lifecycle_email_deliveries set status='sent',sent_at=clock_timestamp(),provider_message_id=${providerId},
          lock_token=null,locked_at=null,last_error=null,updated_at=clock_timestamp() where id=${delivery.id}::uuid`;
        await fulfillmentTask(tx,delivery,rule,owner);
      });
      if (outcome==="ok") result.sent++; else if (outcome==="manual_review") result.manualReview++; else if (outcome==="cancelled") result.cancelled++;
    } catch(error) {
      const terminal=error instanceof CadenceDeliveryError && error.terminal;
      await sql`update private.member_lifecycle_email_deliveries set status=${terminal ? "manual_review" : "failed"},
        last_error=${terminal ? "Delivery needs manual review" : "Delivery unavailable; retry pending"},lock_token=null,locked_at=null,
        available_at=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp()
        where id=${claim.id}::uuid and lock_token=${lease}::uuid and status='sending'`;
      if (terminal) result.manualReview++; else result.failed++;
      if (error instanceof CadenceDeliveryError && ["provider_timeout","delivery_budget"].includes(error.code)) break;
    }
  }
  return result;
}
