import "server-only";
import { createHash } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { AdminEmailError } from "./admin-email-model";
import { assertAdminEmailAccess, requireAdminEmailActor } from "./admin-email-repository";
import { getResendEmailTemplate } from "./resend-email-service";
import { CADENCE_KIND_LABELS, cadenceOccurrences, isCadenceKind, isCadenceTrack } from "./member-email-cadence-model";
import { getMemberEmailCadenceDeliveryConfiguration, assertCadencePayload } from "./member-email-cadence-delivery";
import { readCadenceEvent, sameCadenceEvent, readCadenceRecipients, cadenceCallReady } from "./member-email-cadence-repository";
import { listCadenceTemplates, reviewCadenceProviderRecipients } from "./member-email-cadence-provider";
import { cadencePreviewPlan, renderCadenceEmail, validateCadenceDesign } from "./member-email-cadence-renderer";
import { getAutomatedEmailCatalog } from "./automated-email-catalog";
import type { ResendEmailTemplateSummary } from "./resend-email-model";
import { matchingCadenceEvents } from "./member-email-cadence-inheritance";
import { cadenceManagementDescriptions, type CadenceDeliveryCounts, type CadenceDeliveryOutcome, type CadenceManagedCall,
  type CadenceManagementDetail, type CadenceManagementOverview, type CadenceManagementStatus, type CadenceManagementSummary,
  type CadenceNextReminder, type CadencePlanSummary, type CadenceSequenceSummary } from "./member-email-cadence-management";
import type { CadenceConfiguration } from "./member-email-cadence-model";
import type { CadenceDraft, CadenceEventSnapshot, CadencePlan, CadenceRecipient } from "./member-email-cadence-types";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function canonical(value:unknown):unknown {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==="object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const audienceHash=(value:CadenceRecipient[])=>hash([...value].sort((a,b)=>a.memberId.localeCompare(b.memberId)));
const id=(value:unknown)=>{if(typeof value!=="string" || !UUID.test(value)) throw new AdminEmailError(400,"Choose a valid email automation record.");return value;};
const INACTIVE=[
  {title:"Missed calls and unfinished work",reason:"Inactive until completion requirements, deadlines, and next steps are approved."},
  {title:"Foundations completion and Circle reveal",reason:"Inactive until completion timing and approved Circle readiness are settled."},
  {title:"Birthdays, anniversaries, and milestones",reason:"Inactive until timing, milestone anchors, discounts, and final copy are defined."},
  {title:"Holidays, launches, and clothing drops",reason:"Inactive until dates, benefits, marketing audiences, and copy are approved."},
];

function draftInput(value:unknown):CadenceDraft {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new AdminEmailError(400,"Choose a call and email design.");
  const draft=value as CadenceDraft;
  if (draft.scope!==undefined && draft.scope!=="event" && draft.scope!=="sequence") throw new AdminEmailError(400,"Choose a call or future sequence.");
  if (draft.scope!=="sequence" || draft.eventId) id(draft.eventId);
  id(draft.templateId);
  if (!isCadenceKind(draft.kind) || !isCadenceTrack(draft.track) || typeof draft.templateVersion!=="string"
    || !draft.templateVersion || typeof draft.bodyTarget!=="string"
    || (draft.headingTarget!==undefined && typeof draft.headingTarget!=="string")) throw new AdminEmailError(400,"Complete the call and design setup.");
  return {scope:draft.scope ?? "event",eventId:draft.eventId || "",kind:draft.kind,track:draft.track,templateId:draft.templateId,templateVersion:draft.templateVersion,
    bodyTarget:draft.bodyTarget,headingTarget:draft.headingTarget || undefined,bindings:draft.bindings,copy:draft.copy};
}
function assertEventScope(plan:CadencePlan,futureRequired=true) {
  const event=plan.event;
  if ((plan.kind.startsWith("foundations_") || plan.track==="founder_test")
    && (event.visibility!=="invite_only" || event.registration_mode!=="internal")) {
    throw new AdminEmailError(400,"Foundations and founder tests need a private call with an explicit invited roster. Set that up in the calendar first.");
  }
  if (plan.kind==="circle" && (event.visibility!=="circle" || event.kind!=="circle_meeting")) {
    throw new AdminEmailError(400,"Choose a Circle meeting with its actual Circle audience.");
  }
  if (plan.kind==="membership" && (event.visibility==="circle" || event.kind==="circle_meeting")) {
    throw new AdminEmailError(400,"Use the Circle call cadence for this meeting.");
  }
  if (futureRequired && !cadenceOccurrences(event,plan.kind,plan.track).some(item=>Date.parse(item.dueAt)>Date.now())) {
    throw new AdminEmailError(400,"This call has no future reminders left. Past send times are never replayed.");
  }
}
type ManagementTx=Parameters<typeof requireAdminEmailActor>[0];
type StoredPlan={id:string;eventId:string;revision:number;active:boolean;activatedAt:Date|string;updatedAt:Date|string;
  snapshot:CadencePlan;sequenceId:string|null;sequenceRevision:number|null;sequenceActive:boolean|null;
  currentSequenceRevision:number|null;approvedByActive:boolean;sequenceApprovedByActive:boolean;
  currentEvent:CadenceEventSnapshot;eventStatus:string;cancelled:boolean;delivery:CadenceDeliveryCounts};
type StoredSequence={id:string;kind:CadencePlan["kind"];track:CadencePlan["track"];active:boolean;revision:number;
  activatedAt:Date|string;updatedAt:Date|string;snapshot:CadencePlan;approvedByActive:boolean;delivery:CadenceDeliveryCounts};
const emptyDelivery=():CadenceDeliveryCounts=>({sent:0,pending:0,failed:0,manualReview:0,cancelled:0});
const iso=(value:Date|string)=>new Date(value).toISOString();
const publicEvent=(event:CadenceEventSnapshot)=>({id:event.id,title:event.title,startsAt:iso(event.startsAt),endsAt:iso(event.endsAt),timeZone:event.timeZone});
const normalizedEvent=(event:CadenceEventSnapshot):CadenceEventSnapshot=>({...event,...publicEvent(event)});
function savedDraft(plan:CadencePlan,scope:"event"|"sequence"):CadenceDraft {
  return {scope,eventId:scope==="sequence" ? "" : plan.eventId,kind:plan.kind,track:plan.track,templateId:plan.templateId,
    templateVersion:plan.templateVersion,bodyTarget:plan.bodyTarget,...(plan.headingTarget ? {headingTarget:plan.headingTarget} : {}),
    bindings:Object.fromEntries(Object.entries(plan.bindings).map(([key,binding])=>[key,{source:binding.source,...(binding.value!==undefined ? {value:binding.value} : {})}])),
    ...(plan.copy ? {copy:Object.fromEntries(Object.entries(plan.copy).map(([key,value])=>[key,value]))} : {})};
}
function savedTemplate(template:CadencePlan["template"]):CadencePlan["template"] {
  return {id:template.id,name:template.name,status:template.status,version:template.version,hasUnpublishedVersions:template.hasUnpublishedVersions,
    ...(template.campaignOnly!==undefined ? {campaignOnly:template.campaignOnly} : {}),...(template.signOffText!==undefined ? {signOffText:template.signOffText} : {}),
    html:template.html,text:template.text,subject:template.subject,from:template.from,replyTo:[...template.replyTo],
    variables:template.variables.map(variable=>({key:variable.key,type:variable.type,fallbackValue:variable.fallbackValue})),
    fields:template.fields.map(field=>({key:field.key,label:field.label,value:field.value}))};
}
async function managementTablesReady(tx:ManagementTx) {
  const [tables]=await tx`select to_regclass('private.member_email_cadence_plans') is not null
    and to_regclass('private.member_email_cadence_sequences') is not null as ready`;
  return Boolean(tables?.ready);
}
async function managementPlans(tx:ManagementTx,filter:{id?:string;eventId?:string}={}):Promise<StoredPlan[]> {
  return tx<StoredPlan[]>`select plan.id,plan.experience_id as "eventId",plan.revision,plan.active,
    plan.activated_at as "activatedAt",plan.updated_at as "updatedAt",plan.snapshot,
    plan.sequence_id as "sequenceId",plan.sequence_revision as "sequenceRevision",sequence.active as "sequenceActive",
    sequence.revision as "currentSequenceRevision",
    exists(select 1 from platform_users actor join platform_role_grants role on role.auth_user_id=actor.auth_user_id
      where actor.auth_user_id=plan.approved_by and actor.status='active' and role.role_slug='ops_admin' and role.revoked_at is null) as "approvedByActive",
    exists(select 1 from platform_users actor join platform_role_grants role on role.auth_user_id=actor.auth_user_id
      where actor.auth_user_id=sequence.approved_by and actor.status='active' and role.role_slug='ops_admin' and role.revoked_at is null) as "sequenceApprovedByActive",
    jsonb_build_object('id',event.id,'title',event.title,'startsAt',event.starts_at,'endsAt',event.ends_at,
      'timeZone',event.timezone,'version',event.version::text,'visibility',event.visibility,'circle_id',event.circle_id,
      'block_id',event.block_id,'progression_level_slug',event.progression_level_slug,
      'registration_mode',event.registration_mode,'kind',event.kind) as "currentEvent",
    event.status as "eventStatus",(event.cancelled_at is not null) as cancelled,
    (select jsonb_build_object('sent',count(*) filter(where status='sent'),
      'pending',count(*) filter(where status in ('pending','sending')),'failed',count(*) filter(where status='failed'),
      'manualReview',count(*) filter(where status='manual_review'),'cancelled',count(*) filter(where status='cancelled'))
      from private.member_email_cadence_deliveries where plan_id=plan.id) as delivery
    from private.member_email_cadence_plans plan join experiences event on event.id=plan.experience_id
    left join private.member_email_cadence_sequences sequence on sequence.id=plan.sequence_id
    where (${filter.id ?? null}::uuid is null or plan.id=${filter.id ?? null}::uuid)
      and (${filter.eventId ?? null}::uuid is null or plan.experience_id=${filter.eventId ?? null}::uuid)
    order by (event.starts_at>statement_timestamp() and event.status='published' and event.cancelled_at is null) desc,
      plan.active desc,plan.updated_at desc,plan.id limit 251`;
}
async function managementSequences(tx:ManagementTx):Promise<StoredSequence[]> {
  return tx<StoredSequence[]>`select sequence.id,sequence.kind,sequence.track,sequence.active,sequence.revision,
    sequence.activated_at as "activatedAt",sequence.updated_at as "updatedAt",sequence.snapshot,
    (select jsonb_build_object('sent',count(*) filter(where delivery.status='sent'),
      'pending',count(*) filter(where delivery.status in ('pending','sending')),'failed',count(*) filter(where delivery.status='failed'),
      'manualReview',count(*) filter(where delivery.status='manual_review'),'cancelled',count(*) filter(where delivery.status='cancelled'))
      from private.member_email_cadence_deliveries delivery join private.member_email_cadence_plans plan on plan.id=delivery.plan_id
      where plan.sequence_id=sequence.id) as delivery,
    exists(select 1 from platform_users actor join platform_role_grants role on role.auth_user_id=actor.auth_user_id
      where actor.auth_user_id=sequence.approved_by and actor.status='active' and role.role_slug='ops_admin' and role.revoked_at is null) as "approvedByActive"
    from private.member_email_cadence_sequences sequence order by sequence.kind,sequence.track`;
}
function nextReminder(event:CadenceEventSnapshot,plan:CadencePlan,activatedAt:Date|string,configuration:CadenceConfiguration):CadenceNextReminder|null {
  if (!configuration.enabled || !configuration.ready || !configuration.activatedAt) return null;
  const earliest=Math.max(Date.parse(iso(activatedAt)),Date.parse(configuration.activatedAt));
  const occurrence=cadenceOccurrences(event,plan.kind,plan.track).find(item=>Date.parse(item.expiresAt)>Date.now() && Date.parse(item.dueAt)>=earliest);
  return occurrence ? {...occurrence,eventId:event.id,eventTitle:event.title,timeZone:event.timeZone} : null;
}
async function planSummary(tx:ManagementTx,row:StoredPlan,configuration:CadenceConfiguration,classified?:boolean):Promise<CadencePlanSummary> {
  const current=normalizedEvent(row.currentEvent),plan=row.snapshot;
  let status:CadenceManagementStatus="upcoming",attention="";
  if (row.cancelled) {status="cancelled";attention="This call was cancelled. No reminders will send.";}
  else if (row.eventStatus!=="published") {status="unavailable";attention="This call is not published. No reminders will send.";}
  else if (Date.parse(current.startsAt)<=Date.now()) {status="past";attention="This call has started. Past stages are never replayed.";}
  else if (!row.active) {status="paused";attention="This call’s reminders are paused. A fresh review is required to resume.";}
  else if (!sameCadenceEvent(current,plan.event)) {status="changed";attention="Call changed — review again before reminders can resume.";}
  else if (row.sequenceId && (!row.sequenceActive || row.sequenceRevision!==row.currentSequenceRevision)) {
    status="paused";attention="Sequence paused or awaiting its approved update. No reminders will send for this call.";
  } else if (row.sequenceId && classified===false) {status="changed";attention="This call no longer matches its approved sequence. Review its calendar classification.";}
  else if (!row.approvedByActive || (row.sequenceId && !row.sequenceApprovedByActive)) {status="blocked";attention="The approving administrator no longer has active access. Review again with an active administrator.";}
  else if (!await cadenceCallReady(tx,current.id)) {status="blocked";attention="This call needs a working calendar and Meet link before reminders can run.";}
  else if (!configuration.enabled || !configuration.ready || !configuration.activatedAt || Date.parse(configuration.activatedAt)>Date.now()) {
    status="blocked";attention="Global delivery is paused or not configured. Saved approval does not mean emails are running.";
  }
  const next=status==="upcoming" ? nextReminder(current,plan,row.activatedAt,configuration) : null;
  if (status==="upcoming" && !next) {status="no_remaining";attention="No future reminder windows remain after this approval. Past stages are never replayed.";}
  if (!attention && row.delivery.failed+row.delivery.manualReview>0) attention="Delivery needs attention. Check the email history before taking further action.";
  return {id:row.id,eventId:row.eventId,sequenceId:row.sequenceId,kind:plan.kind,track:plan.track,active:row.active,
    revision:row.revision,templateName:plan.template.name,updatedAt:iso(row.updatedAt),title:current.title,status,attention,
    ...cadenceManagementDescriptions(plan.kind,plan.track),inheritanceSummary:row.sequenceId
      ? "Inherited from the approved sequence. This call’s own pause and any changed call details still take precedence."
      : "An individual call approval. Sequence updates and pauses do not replace or control this plan.",
    nextReminder:next,delivery:row.delivery};
}
async function sequenceCalls(tx:ManagementTx,sequence:StoredSequence,configuration:CadenceConfiguration,knownPlans:StoredPlan[]=[]) {
  const events=await matchingCadenceEvents(tx,sequence.kind,sequence.track);
  const calls:CadenceManagedCall[]=[];
  for (const event of events) {
    const row=knownPlans.find(plan=>plan.eventId===event.id) ?? (await managementPlans(tx,{eventId:event.id}))[0];
    if (row) {
      const summary=await planSummary(tx,row,configuration,true);
      const own=row.sequenceId===sequence.id;
      calls.push({...publicEvent(event),planId:row.id,revision:row.revision,active:row.active,
        status:own ? summary.status : "manual_override",
        attention:own ? summary.attention : "This call has an independent approval. Changing or pausing this sequence will not control it.",
        nextReminder:own ? summary.nextReminder : null,delivery:row.delivery});
    } else {
      calls.push({...publicEvent(event),planId:null,revision:null,active:false,
        status:!sequence.active ? "paused" : !sequence.approvedByActive || !configuration.enabled || !configuration.ready ? "blocked" : "inheritance_pending",
        attention:!sequence.active ? "Sequence paused. No call approval will be inherited."
          : "No call approval has been inherited yet. A matching call and working Meet link are required; this is not a queued send.",
        nextReminder:null,delivery:emptyDelivery()});
    }
  }
  return {events,calls};
}
function sequenceSummary(sequence:StoredSequence,calls:CadenceManagedCall[],configuration:CadenceConfiguration):CadenceSequenceSummary {
  const next=calls.flatMap(call=>call.nextReminder ? [call.nextReminder] : []).sort((a,b)=>Date.parse(a.dueAt)-Date.parse(b.dueAt))[0] ?? null;
  const status:CadenceManagementStatus=!sequence.active ? "paused" : !sequence.approvedByActive || !configuration.enabled || !configuration.ready
    ? "blocked" : next ? "upcoming" : calls.some(call=>call.status==="inheritance_pending") ? "inheritance_pending"
      : calls.some(call=>call.status==="changed") ? "changed" : calls.some(call=>call.status==="blocked") ? "blocked"
        : calls.some(call=>call.status==="paused") ? "paused" : calls.length && calls.every(call=>call.status==="manual_override") ? "manual_override" : "no_remaining";
  const delivery=sequence.delivery;
  return {id:sequence.id,kind:sequence.kind,track:sequence.track,active:sequence.active,revision:sequence.revision,
    title:CADENCE_KIND_LABELS[sequence.kind],templateName:sequence.snapshot.template.name,updatedAt:iso(sequence.updatedAt),status,
    attention:!sequence.active ? "Paused. A fresh review is required to resume."
      : status==="blocked" ? "Global delivery or approving administrator access is unavailable. Saved approval does not prove delivery is running."
        : calls.some(call=>["changed","blocked","paused"].includes(call.status)) ? "Some matching calls need attention or are individually paused. Inspect the call list."
          : !calls.length ? "No matching future calls currently exist. This approval remains available for future matching calls."
            : status==="manual_override" ? "Matching calls have independent approvals. This sequence does not control them." : "",
    ...cadenceManagementDescriptions(sequence.kind,sequence.track),nextReminder:status==="upcoming" ? next : null,
    matchingCallCount:calls.length,delivery};
}
export async function getCadenceOverview(actor:string):Promise<CadenceManagementOverview> {
  await assertAdminEmailAccess(actor);
  const sql=getApplicationDatabase();
  let templates:ResendEmailTemplateSummary[]=[];
  const warnings:string[]=[];
  try {templates=await listCadenceTemplates(actor);}
  catch {warnings.push("The current Resend design list is unavailable. Saved approvals and pause controls remain available; try again before creating or editing a design.");}
  const configuration=getMemberEmailCadenceDeliveryConfiguration();
  const base={templates,configuration,inactive:INACTIVE,warnings,managedElsewhere:getAutomatedEmailCatalog()};
  return sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor);
    if (!await managementTablesReady(tx)) return {...base,events:[],plans:[],sequences:[],setupRequired:true};
    const events=await tx<Array<CadenceEventSnapshot>>`select id,title,starts_at as "startsAt",ends_at as "endsAt",timezone as "timeZone"
      from experiences where status='published' and cancelled_at is null and starts_at>statement_timestamp()
        and ends_at>starts_at and kind in ('weekly_call','circle_meeting','academy_session','member_event')
        and visibility<>'public' and registration_mode<>'external' order by starts_at,id limit 250`;
    const availablePlans=await managementPlans(tx),rows=availablePlans.slice(0,250),sequences:CadenceSequenceSummary[]=[],matches=new Map<string,Set<string>>();
    if (availablePlans.length>250) warnings.push("Showing 250 call approvals, prioritizing future calls. Older call approvals are omitted from this list; sequence history still includes all of its delivery outcomes.");
    for (const sequence of await managementSequences(tx)) {
      const {calls}=await sequenceCalls(tx,sequence,configuration,rows);
      matches.set(sequence.id,new Set(calls.map(call=>call.id)));
      sequences.push(sequenceSummary(sequence,calls,configuration));
    }
    const plans:CadencePlanSummary[]=[];
    for (const row of rows) plans.push(await planSummary(tx,row,configuration,row.sequenceId ? matches.get(row.sequenceId)?.has(row.eventId) ?? false : undefined));
    return {...base,events:events.map(publicEvent),plans,sequences,setupRequired:false};
  });
}

function deliveryReason(status:CadenceDeliveryOutcome["status"]):string {
  return ({sent:"Accepted by the email provider; this is not proof of inbox delivery.",pending:"Queued for eligibility checks.",
    sending:"Provider handoff is in progress or awaiting its recorded result.",failed:"Delivery failed. Review before taking further action.",
    manual_review:"The delivery result is uncertain. Automatic retries are stopped; review the email history.",
    cancelled:"Cancelled or no longer eligible; this message will not be retried."})[status];
}
export async function getCadenceManagementDetail(actor:string,scope:unknown,recordId:unknown,eventId?:unknown):Promise<CadenceManagementDetail> {
  await assertAdminEmailAccess(actor);
  if (scope!=="event" && scope!=="sequence") throw new AdminEmailError(400,"Choose a call or future sequence.");
  const record=id(recordId),selected=eventId===undefined || eventId===null ? null : id(eventId);
  const sql=getApplicationDatabase(),configuration=getMemberEmailCadenceDeliveryConfiguration();
  const source=await sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor);
    if (!await managementTablesReady(tx)) throw new AdminEmailError(503,"Email automation setup is not installed.");
    const row=scope==="event" ? (await managementPlans(tx,{id:record}))[0] : undefined;
    const sequence=scope==="sequence" ? (await managementSequences(tx)).find(item=>item.id===record) : undefined;
    if (!row && !sequence) throw new AdminEmailError(404,"This email automation was not found.");
    const stored=(row?.snapshot ?? sequence!.snapshot),draft=savedDraft(stored,scope);
    let calls:CadenceManagedCall[],event:CadenceEventSnapshot,summary:CadenceManagementSummary;
    let actual:CadenceEventSnapshot|null=null;
    if (sequence) {
      const matching=await sequenceCalls(tx,sequence,configuration);
      calls=matching.calls;summary=sequenceSummary(sequence,calls,configuration);
      if (selected && !matching.events.some(item=>item.id===selected)) throw new AdminEmailError(400,"Choose a current matching call from this sequence.");
      actual=matching.events.find(item=>item.id===selected) ?? matching.events[0] ?? null;
      event=actual ?? exampleCadenceEvent(draft);
    } else {
      if (selected && selected!==row!.eventId) throw new AdminEmailError(400,"Choose this automation’s own call.");
      const matching=row!.sequenceId ? (await managementSequences(tx)).find(item=>item.id===row!.sequenceId) : null;
      const classified=matching ? (await matchingCadenceEvents(tx,matching.kind,matching.track)).some(item=>item.id===row!.eventId) : false;
      summary=await planSummary(tx,row!,configuration,classified);
      calls=[{...publicEvent(row!.currentEvent),planId:row!.id,revision:row!.revision,active:row!.active,status:summary.status,
        attention:summary.attention,nextReminder:summary.nextReminder,delivery:summary.delivery}];
      // A changed call must not silently replace the event approved in this saved message.
      event=normalizedEvent(stored.event);
      if (row!.eventStatus==="published" && !row!.cancelled && Date.parse(row!.currentEvent.startsAt)>Date.now()) actual=normalizedEvent(row!.currentEvent);
    }
    const recipientsChecked=Boolean(actual && (scope==="event" || selected));
    const recipients=recipientsChecked ? await readCadenceRecipients(tx,actual!,stored.track) : [];
    const recent=await tx<Array<{id:string;eventId:string;eventTitle:string;stage:CadenceDeliveryOutcome["stage"];status:CadenceDeliveryOutcome["status"];
      dueAt:Date|string;updatedAt:Date|string;sentAt:Date|string|null}>>`
      select delivery.id,delivery.experience_id as "eventId",event.title as "eventTitle",delivery.stage,delivery.status,
        delivery.due_at as "dueAt",delivery.updated_at as "updatedAt",delivery.sent_at as "sentAt"
      from private.member_email_cadence_deliveries delivery join private.member_email_cadence_plans plan on plan.id=delivery.plan_id
      join experiences event on event.id=delivery.experience_id
      where (${scope}='event' and delivery.plan_id=${record}::uuid) or (${scope}='sequence' and plan.sequence_id=${record}::uuid)
      order by delivery.updated_at desc,delivery.id desc limit 50`;
    return {stored,draft,summary,calls,event,actual,recipients,recipientsChecked,recent};
  });
  // Provider checks are read-only and only performed for a deliberately inspected actual audience.
  let checked:CadenceRecipient[]=[];
  let recipientsChecked=source.recipientsChecked;
  const recipientWarnings:string[]=[];
  if (recipientsChecked) {
    try {checked=await reviewCadenceProviderRecipients(source.recipients);}
    catch {recipientsChecked=false;recipientWarnings.push("Recipient eligibility could not be verified with the email provider. No recipient list is shown as qualified; try inspecting this call again.");}
  }
  await assertAdminEmailAccess(actor);
  const occurrences=cadenceOccurrences(source.event,source.stored.kind,source.stored.track);
  const previews=occurrences.map(occurrence=>{
    const rendered=renderCadenceEmail({plan:source.stored,event:source.event,stage:occurrence.stage,email:"preview@example.com",memberName:"Member"});
    return {stage:occurrence.stage,html:rendered.html,subject:rendered.subject,text:rendered.text};
  });
  return {scope,id:source.summary.id,revision:source.summary.revision,active:source.summary.active,title:source.summary.title,status:source.summary.status,
    draft:source.draft,template:savedTemplate(source.stored.template),configuration,
    timingSummary:source.summary.timingSummary,audienceSummary:source.summary.audienceSummary,inheritanceSummary:source.summary.inheritanceSummary,
    nextReminder:source.summary.nextReminder,calls:source.calls,selectedEventId:source.actual?.id ?? (scope==="event" ? source.stored.eventId : null),
    previewIsExample:scope==="sequence" && !source.actual,previews,occurrences,
    recipients:checked.map(({memberId,name,email,eligible,reason})=>({memberId,name,email,eligible,reason})),recipientsChecked,
    recentDeliveries:source.recent.map(item=>({...item,dueAt:iso(item.dueAt),updatedAt:iso(item.updatedAt),sentAt:item.sentAt ? iso(item.sentAt) : null,reason:deliveryReason(item.status)})),
    warnings:[...recipientWarnings,"Messages use the saved approved design. Editing requires a fresh review; viewing does not activate, resume, or send anything.",
      "Reminder times are scheduled opportunities, not guaranteed sends. Eligibility and provider preferences are checked again before every handoff.",
      "Configuration shows whether delivery is permitted; it does not prove the scheduled worker is running.",
      ...(source.summary.attention ? [source.summary.attention] : []),
      ...(scope==="sequence" ? ["Selected call previews use this sequence’s saved design. Independent call approvals may use a different design; open the individual call to inspect it."] : []),
      ...(scope==="event" && source.summary.status==="changed" ? ["These messages retain the originally approved call details. The current call must be reviewed before delivery can resume."] : [])]};
}

type ReviewSnapshot={plan:CadencePlan;localAudienceHash:string;planRevision:number|null;scope?:"event"|"sequence";sequenceRevision?:number|null};

function exampleCadenceEvent(draft:CadenceDraft):CadenceEventSnapshot {
  const start=new Date(Date.now()+45*86_400_000);start.setUTCHours(22,0,0,0);
  const privateCall=draft.kind.startsWith("foundations_") || draft.track==="founder_test";
  return {id:"00000000-0000-4000-8000-000000000001",title:CADENCE_KIND_LABELS[draft.kind],
    startsAt:start.toISOString(),endsAt:new Date(start.getTime()+90*60_000).toISOString(),timeZone:"America/Denver",version:"1",
    visibility:privateCall ? "invite_only" : draft.kind==="circle" ? "circle" : "all_members",
    circle_id:draft.kind==="circle" ? "00000000-0000-4000-8000-000000000002" : null,block_id:null,progression_level_slug:null,
    registration_mode:privateCall ? "internal" : "none",kind:draft.kind==="circle" ? "circle_meeting" : "weekly_call"};
}
export async function previewCadence(actor:string,value:unknown) {
  await assertAdminEmailAccess(actor);
  const draft=draftInput(value);
  const template=await getResendEmailTemplate(actor,draft.templateId);
  if (template.version!==draft.templateVersion) throw new AdminEmailError(409,"The Resend design changed. Reload it and review again.");
  validateCadenceDesign(draft,template);
  const sql=getApplicationDatabase();
  const source=await sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor);
    const sequence=draft.scope==="sequence";
    const matchingEvents=sequence ? await matchingCadenceEvents(tx,draft.kind,draft.track) : [];
    if (sequence && draft.eventId && !matchingEvents.some(event=>event.id===draft.eventId)) {
      throw new AdminEmailError(400,"That example call is not classified for this sequence. Set its email sequence in Calendar, or use the sample preview.");
    }
    const event=sequence && !draft.eventId ? exampleCadenceEvent(draft) : await readCadenceEvent(tx,draft.eventId);
    if (!event) throw new AdminEmailError(400,"Choose a published future call with a complete start and end time.");
    if (!sequence && !await cadenceCallReady(tx,event.id)) throw new AdminEmailError(400,"This call needs its working calendar and Meet link before reminders can be prepared.");
    const [existing]=await tx<Array<{revision:number}>>`select revision from private.member_email_cadence_plans where experience_id=${event.id}::uuid`;
    const [existingSequence]=sequence ? await tx<Array<{revision:number}>>`select revision from private.member_email_cadence_sequences
      where kind=${draft.kind} and track=${draft.track}` : [];
    const plan=cadencePreviewPlan(draft,template,event);
    assertEventScope(plan,!sequence);
    return {plan,planRevision:existing?.revision ?? null,sequenceRevision:existingSequence?.revision ?? null,matchingEvents,
      recipients:sequence && !draft.eventId ? [] : await readCadenceRecipients(tx,event,draft.track)};
  });
  const recipients=await reviewCadenceProviderRecipients(source.recipients);
  const occurrences=cadenceOccurrences(source.plan.event,draft.kind,draft.track).filter(item=>draft.scope==="sequence" || Date.parse(item.dueAt)>Date.now());
  const previews=occurrences.map(occurrence=>{
    const rendered=renderCadenceEmail({plan:source.plan,event:source.plan.event,stage:occurrence.stage,
      email:"preview@example.com",memberName:"Member"});
    try { assertCadencePayload(rendered,"preview@example.com"); }
    catch { throw new AdminEmailError(400,"This design needs a valid sender, reply address, subject, and message. Update it in Resend and review again."); }
    if (/\bTBD\b|\[(?:INSERT|ADD|NAME|FIRST NAME|LINK|DATE|TIME|DEADLINE|RECORDING)[^\]]*\]|\bWrite your message here\b|\bYour name\b/i.test(rendered.text)) {
      throw new AdminEmailError(400,"This design still contains unfinished copy. Finish it in Resend before activation.");
    }
    return {stage:occurrence.stage,html:rendered.html,subject:rendered.subject,text:rendered.text};
  });
  if (!previews.length) throw new AdminEmailError(409,"The remaining send time has passed. Choose a later call.");
  const snapshot:ReviewSnapshot={scope:draft.scope,plan:source.plan,localAudienceHash:audienceHash(source.recipients),
    planRevision:source.planRevision,sequenceRevision:source.sequenceRevision};
  const [review]=await sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);
    // Reviews are private, short-lived approvals; pruning them never changes a plan or a delivery.
    await tx`delete from private.member_email_cadence_reviews where expires_at<statement_timestamp()-interval '7 days'`;
    return tx<Array<{id:string;expiresAt:Date|string}>>`insert into private.member_email_cadence_reviews
      (actor_auth_user_id,snapshot,audience_hash) values(${actor}::uuid,${tx.json(snapshot)}::jsonb,${audienceHash(recipients)})
      returning id,expires_at as "expiresAt"`;
  });
  return {scope:draft.scope,matchingEvents:source.matchingEvents,reviewToken:review.id,expiresAt:new Date(review.expiresAt).toISOString(),preview:previews[0],previews,occurrences,recipients,
    warnings:[...(draft.scope==="sequence" ? ["Approval applies this design to current and future matching published calls. Example recipients are a snapshot; each call uses its own qualified audience.",
      "Paid Foundations members join only calls matching their accepted cohort and session time. Existing cancellations, waitlists, individual plans, and paused calls are preserved.",
      "Example dates show the sequence timing. Past stages are never sent, and calls need a working Meet link before reminders can run."] : []),
      "Foundations uses confirmed invitations. Open Membership and Circle calls use their current qualified audience. New members qualify only for future send times.",
      "Call details or audience scope changes pause delivery until you review the call again.",
      ...(!getMemberEmailCadenceDeliveryConfiguration().ready ? ["Global delivery is paused or not configured. Activating a plan alone will not send emails."] : []),
      ...(recipients.some(item=>!item.eligible) ? ["Excluded people will not receive these reminders unless they qualify before a future send time."] : [])]};
}

export async function activateCadence(actor:string,reviewToken:unknown) {
  await assertAdminEmailAccess(actor);
  const reviewId=id(reviewToken),sql=getApplicationDatabase();
  const [review]=await sql<Array<{snapshot:ReviewSnapshot;audience_hash:string}>>`select snapshot,audience_hash
    from private.member_email_cadence_reviews where id=${reviewId}::uuid and actor_auth_user_id=${actor}::uuid
      and consumed_at is null and expires_at>statement_timestamp()`;
  if (!review) throw new AdminEmailError(409,"This review expired or was already used. Review the call again.");
  const {plan,planRevision,localAudienceHash}=review.snapshot;
  const template=await getResendEmailTemplate(actor,plan.templateId);
  if (hash(template)!==hash(plan.template)) throw new AdminEmailError(409,"The Resend design changed. Review it again before activation.");
  if (review.snapshot.scope==="sequence") return activateSequenceReview(actor,reviewId,review.snapshot);
  const recipients=await sql.begin(async tx=>{
    const event=await readCadenceEvent(tx,plan.eventId);
    if (!sameCadenceEvent(event,plan.event)) throw new AdminEmailError(409,"Call details changed. Review again.");
    return readCadenceRecipients(tx,plan.event,plan.track);
  });
  const checked=await reviewCadenceProviderRecipients(recipients);
  if (!checked.some(item=>item.eligible)) throw new AdminEmailError(400,"No recipients currently qualify. Review the call roster and email preferences first.");
  if (audienceHash(checked)!==review.audience_hash) throw new AdminEmailError(409,"Recipient eligibility changed. Review the list again.");
  return sql.begin(async tx=>{
    await tx`set local lock_timeout='3s'`;
    await requireAdminEmailActor(tx,actor,true);
    await tx`select pg_advisory_xact_lock(hashtext(${`member-email-cadence:${plan.eventId}`}))`;
    const [currentReview]=await tx`select id from private.member_email_cadence_reviews where id=${reviewId}::uuid
      and actor_auth_user_id=${actor}::uuid and consumed_at is null and expires_at>clock_timestamp() for update`;
    if (!currentReview) throw new AdminEmailError(409,"This review expired or was already used. Review again.");
    const event=await readCadenceEvent(tx,plan.eventId,true);
    if (!sameCadenceEvent(event,plan.event) || !await cadenceCallReady(tx,plan.eventId,true)) throw new AdminEmailError(409,"Call details or access changed. Review again.");
    assertEventScope(plan);
    const current=await readCadenceRecipients(tx,plan.event,plan.track,{lock:true});
    if (audienceHash(current)!==localAudienceHash) throw new AdminEmailError(409,"Recipient eligibility changed. Review the list again.");
    const [old]=await tx<Array<{id:string;revision:number}>>`select id,revision from private.member_email_cadence_plans
      where experience_id=${plan.eventId}::uuid for update`;
    if ((old?.revision ?? null)!==planRevision) throw new AdminEmailError(409,"Another admin changed this plan. Review it again.");
    const rows=old ? await tx`update private.member_email_cadence_plans set snapshot=${tx.json(plan)}::jsonb,
      revision=revision+1,active=true,activated_at=clock_timestamp(),approved_by=${actor}::uuid,updated_at=clock_timestamp(),
      sequence_id=null,sequence_revision=null
      where id=${old.id}::uuid returning id,revision`
      : await tx`insert into private.member_email_cadence_plans(experience_id,active,snapshot,approved_by)
        values(${plan.eventId}::uuid,true,${tx.json(plan)}::jsonb,${actor}::uuid) returning id,revision`;
    await tx`update private.member_email_cadence_reviews set consumed_at=clock_timestamp() where id=${reviewId}::uuid`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'member_email_cadence.activated','experience',${plan.eventId},
        ${tx.json({planId:rows[0].id,revision:rows[0].revision,reviewId,kind:plan.kind,track:plan.track,eligible:checked.filter(item=>item.eligible).length})}::jsonb)`;
    return {id:rows[0].id,revision:rows[0].revision,active:true};
  });
}

async function activateSequenceReview(actor:string,reviewId:string,snapshot:ReviewSnapshot) {
  const {plan,sequenceRevision}=snapshot;
  return getApplicationDatabase().begin(async tx=>{
    await tx`set local lock_timeout='3s'`;
    await requireAdminEmailActor(tx,actor,true);
    await tx`select pg_advisory_xact_lock(hashtext(${`member-email-sequence:${plan.kind}:${plan.track}`}))`;
    const [review]=await tx`select id from private.member_email_cadence_reviews where id=${reviewId}::uuid
      and actor_auth_user_id=${actor}::uuid and consumed_at is null and expires_at>clock_timestamp() for update`;
    if (!review) throw new AdminEmailError(409,"This review expired or was already used. Review the sequence again.");
    const [old]=await tx<Array<{id:string;revision:number}>>`select id,revision from private.member_email_cadence_sequences
      where kind=${plan.kind} and track=${plan.track} for update`;
    if ((old?.revision ?? null)!==sequenceRevision) throw new AdminEmailError(409,"Another admin changed this sequence. Review it again.");
    const [sequence]=old ? await tx`update private.member_email_cadence_sequences set active=true,revision=revision+1,
      activated_at=clock_timestamp(),snapshot=${tx.json(plan)}::jsonb,approved_by=${actor}::uuid,updated_at=clock_timestamp()
      where id=${old.id}::uuid returning id,revision`
      : await tx`insert into private.member_email_cadence_sequences(kind,track,active,snapshot,approved_by)
        values(${plan.kind},${plan.track},true,${tx.json(plan)}::jsonb,${actor}::uuid) returning id,revision`;
    await tx`update private.member_email_cadence_reviews set consumed_at=clock_timestamp() where id=${reviewId}::uuid`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'member_email_sequence.activated','member_email_sequence',${sequence.id},
        ${tx.json({revision:sequence.revision,reviewId,kind:plan.kind,track:plan.track})}::jsonb)`;
    return {id:sequence.id,revision:sequence.revision,active:true,scope:"sequence" as const};
  });
}

export async function pauseCadenceSequence(actor:string,sequenceId:unknown,revision:unknown) {
  id(sequenceId);
  if (!Number.isSafeInteger(revision) || Number(revision)<1) throw new AdminEmailError(400,"Reload the sequence before pausing it.");
  return getApplicationDatabase().begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);
    const [sequence]=await tx`update private.member_email_cadence_sequences set active=false,revision=revision+1,updated_at=clock_timestamp()
      where id=${sequenceId as string}::uuid and revision=${Number(revision)} returning id,revision`;
    if (!sequence) throw new AdminEmailError(409,"This sequence changed. Reload before pausing.");
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'member_email_sequence.paused','member_email_sequence',${sequence.id},${tx.json({revision:sequence.revision})}::jsonb)`;
    return {id:sequence.id,revision:sequence.revision,active:false,scope:"sequence" as const};
  });
}

export async function pauseCadence(actor:string,planId:unknown,revision:unknown) {
  id(planId);
  if (!Number.isSafeInteger(revision) || Number(revision)<1) throw new AdminEmailError(400,"Reload the plan before pausing it.");
  return getApplicationDatabase().begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);
    const [plan]=await tx`update private.member_email_cadence_plans set active=false,revision=revision+1,updated_at=clock_timestamp()
      where id=${planId as string}::uuid and revision=${Number(revision)} returning id,revision`;
    if (!plan) throw new AdminEmailError(409,"This plan changed. Reload before pausing.");
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'member_email_cadence.paused','member_email_cadence',${plan.id},${tx.json({revision:plan.revision})}::jsonb)`;
    return {id:plan.id,revision:plan.revision,active:false};
  });
}
