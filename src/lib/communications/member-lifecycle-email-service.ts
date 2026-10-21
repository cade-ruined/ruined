import "server-only";
import { getApplicationDatabase } from "@/lib/database/server";
import { AdminEmailError } from "./admin-email-model";
import { requireAdminEmailActor } from "./admin-email-repository";
import { getMemberEmailCadenceDeliveryConfiguration } from "./member-email-cadence-delivery";
import { renderCadenceDesignMessage, type CadenceDesignPlan } from "./member-email-cadence-renderer";
import { getLifecycleEditableTemplate, lifecycleEmailCopy, validateLifecycleCopy } from "./member-lifecycle-email-copy";
import { denverDate, holidayClosures, isLifecycleKey, LIFECYCLE_SETTINGS, LIFECYCLE_TITLES, lifecycleMissing, lifecycleOccurrences, type LifecycleEmailKey, type LifecycleSettings } from "./member-lifecycle-email-model";
import { lifecycleRecipientQualifies, readLifecycleMembers, readLifecycleRules, type LifecycleRule } from "./member-lifecycle-email-repository";
import type { TransactionSql } from "postgres";

const SITE_URL = "https://members.theruinedproject.com";
async function defaultDesign(tx: TransactionSql): Promise<CadenceDesignPlan | null> {
  const [row] = await tx<Array<{ snapshot: CadenceDesignPlan }>>`select sequence.snapshot from private.member_email_cadence_sequences sequence
    join platform_users actor on actor.auth_user_id=sequence.approved_by and actor.status='active'
    join platform_role_grants grant_row on grant_row.auth_user_id=actor.auth_user_id and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
    where sequence.active and sequence.track='members' and sequence.kind='foundations_01' order by sequence.updated_at desc limit 1`;
  if (!row) return null;
  const {template,bodyTarget,headingTarget,bindings,copy}=row.snapshot;
  return {template,bodyTarget,headingTarget,bindings,copy,siteUrl:SITE_URL};
}
export function renderLifecycleMessage(rule: Pick<LifecycleRule,"key"|"settings"|"design"|"copy">, name: string) {
  if (!rule.design) throw new Error("Choose an approved Ruined email design first.");
  const copy = lifecycleEmailCopy(rule.key,name,rule.settings,rule.design.siteUrl,rule.copy);
  return renderCadenceDesignMessage(rule.design,{...copy,heading:copy.subject,memberName:name});
}
function missingFor(rule: LifecycleRule, year: number, design: CadenceDesignPlan | null) {
  const missing=lifecycleMissing(rule.key,rule.settings,year);
  if (!design) missing.push("An approved Ruined email design is required.");
  if (!missing.length) {
    try { renderLifecycleMessage({...rule,design},"Member"); }
    catch { missing.push("Review the approved design and its fields before enabling this message."); }
  }
  if (rule.enabled && !rule.authorized) missing.push("The approving administrator no longer has active access.");
  return missing;
}
export async function getMemberLifecycleEmailOverview(actor: string, selected?: LifecycleEmailKey) {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx,actor);
    const [installed]=await tx`select to_regclass('private.member_lifecycle_email_rules') is not null as installed`;
    if (!installed?.installed) return {items:[],recent:[],closures:[],setupRequired:true};
    const [rules,members,design]=await Promise.all([readLifecycleRules(tx),readLifecycleMembers(tx),defaultDesign(tx)]);
    const now=new Date(), year=Number(denverDate(now).slice(0,4));
    const configuration=getMemberEmailCadenceDeliveryConfiguration();
    const items=await Promise.all(rules.map(async rule=>{
      const chosen=rule.design ?? design,missing=missingFor(rule,year,chosen);
      const eligibleMembers=members.filter(member=>lifecycleRecipientQualifies(rule.key,member,rule.settings));
      const occurrences=eligibleMembers.flatMap(member=>[year,year+1].flatMap(y=>lifecycleOccurrences(rule.key,member,y)))
        .filter(item=>Date.parse(item.dueAt)>=now.getTime()).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
      const [last]=await tx`select max(sent_at) as sent_at from private.member_lifecycle_email_deliveries where rule_key=${rule.key} and status='sent'`;
      return {key:rule.key,title:LIFECYCLE_TITLES[rule.key],enabled:rule.enabled,ready:missing.length===0,missing,settings:rule.settings,
        ...getLifecycleEditableTemplate(rule.key),...rule.copy,revision:rule.revision,nextDueAt:occurrences[0]?.dueAt ?? null,
        eligible:eligibleMembers.filter(member=>[year,year+1].some(y=>lifecycleOccurrences(rule.key,member,y).some(item=>Date.parse(item.expiresAt)>now.getTime()))).length,
        lastSentAt:last?.sent_at ? new Date(last.sent_at).toISOString() : null,
        ...(selected===rule.key ? {preview:missing.length ? null : renderLifecycleMessage({...rule,design:chosen},"Member")} : {})};
    }));
    const recent=await tx`select id,rule_key as key,status,due_at as "dueAt",sent_at as "sentAt",last_error as error
      from private.member_lifecycle_email_deliveries order by created_at desc limit 50`;
    return {items: selected ? items.filter(item=>item.key===selected) : items,recent,closures:holidayClosures(year),setupRequired:false,
      deliveryEnabled:configuration.enabled && configuration.ready};
  });
}

export async function updateMemberLifecycleEmail(actor: string, input: Record<string,unknown>) {
  if (!isLifecycleKey(input.key) || typeof input.enabled!=="boolean") throw new AdminEmailError(400,"Choose a recurring message and its status.");
  if (!Number.isSafeInteger(input.revision) || (input.revision as number)<1) throw new AdminEmailError(400,"Refresh this message before saving its changes.");
  if (!input.settings || typeof input.settings!=="object" || Array.isArray(input.settings)
    || Object.entries(input.settings).some(([key,value])=>!LIFECYCLE_SETTINGS.includes(key as typeof LIFECYCLE_SETTINGS[number])
      || typeof value!=="string" || value.length>2000 || /[\u0000]|\{\{|\[.*(?:TBD|INSERT|LINK)/i.test(value))) {
    throw new AdminEmailError(400,"Complete the message settings without unfinished placeholders.");
  }
  const key=input.key,enabled=input.enabled,settings=input.settings as LifecycleSettings;
  await getApplicationDatabase().begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);
    const [saved]=await tx`select revision,enabled from private.member_lifecycle_email_rules where key=${key} for update`;
    if (!saved) throw new AdminEmailError(404,"That recurring message is unavailable.");
    if (input.revision!==saved.revision) throw new AdminEmailError(409,"This message changed. Refresh before saving.");
    const current=(await readLifecycleRules(tx)).find(rule=>rule.key===key)!;
    let copy=current.copy ?? null;
    if (input.subject!==undefined || input.body!==undefined) {
      if (typeof input.subject!=="string" || typeof input.body!=="string") throw new AdminEmailError(400,"Add both the subject and message.");
      copy={subject:input.subject.trim(),body:input.body.trim()};
      try { validateLifecycleCopy(key,copy); } catch(error) { throw new AdminEmailError(400,error instanceof Error ? error.message : "Review the email copy."); }
      const previous=current.copy ?? getLifecycleEditableTemplate(key);
      if (enabled && (copy.subject!==previous.subject || copy.body!==previous.body)) throw new AdminEmailError(400,"Save your changes with this message paused, then preview and enable it.");
    }
    const design=current.design ?? await defaultDesign(tx),year=Number(denverDate(new Date()).slice(0,4));
    const missing=missingFor({...current,settings,copy,enabled:false},year,design);
    if (enabled && missing.length) throw new AdminEmailError(400,missing.join(" "));
    // Re-approval starts a new future-only window; old queued bytes cannot follow changed rules.
    await tx`update private.member_lifecycle_email_rules set enabled=${enabled},settings=${tx.json(settings)},copy=${copy ? tx.json(copy) : null},
      design=${design ? tx.json(JSON.parse(JSON.stringify(design))) : null},revision=revision+1,
      activated_at=case when ${enabled} then clock_timestamp() else activated_at end,approved_by=${actor}::uuid,updated_at=clock_timestamp() where key=${key}`;
    await tx`update private.member_lifecycle_email_deliveries set status=case when first_attempt_at is null then 'cancelled' else 'manual_review' end,
      last_error='Rule changed; old delivery stopped',lock_token=null,locked_at=null,updated_at=clock_timestamp()
      where rule_key=${key} and status in ('pending','failed','sending')`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'communications.lifecycle_updated','member_lifecycle_email',${key},${tx.json({enabled,settings,previousRevision:saved.revision})})`;
  });
  return getMemberLifecycleEmailOverview(actor,key);
}
