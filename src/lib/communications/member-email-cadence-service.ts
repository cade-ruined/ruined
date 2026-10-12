import "server-only";
import { createHash } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { AdminEmailError } from "./admin-email-model";
import { assertAdminEmailAccess, requireAdminEmailActor } from "./admin-email-repository";
import { getResendEmailTemplate } from "./resend-email-service";
import { cadenceOccurrences, isCadenceKind, isCadenceTrack } from "./member-email-cadence-model";
import { getMemberEmailCadenceDeliveryConfiguration, assertCadencePayload } from "./member-email-cadence-delivery";
import { readCadenceEvent, sameCadenceEvent, readCadenceRecipients, cadenceCallReady } from "./member-email-cadence-repository";
import { listCadenceTemplates, reviewCadenceProviderRecipients } from "./member-email-cadence-provider";
import { cadencePreviewPlan, renderCadenceEmail, validateCadenceDesign } from "./member-email-cadence-renderer";
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
  {title:"Welcome and profile ready",reason:"Already automated. This cadence does not send a second welcome."},
  {title:"Missed calls and unfinished work",reason:"Inactive until completion requirements, deadlines, and next steps are approved."},
  {title:"Foundations completion and Circle reveal",reason:"Inactive until completion timing and approved Circle readiness are settled."},
  {title:"Birthdays, anniversaries, and milestones",reason:"Inactive until timing, milestone anchors, discounts, and final copy are defined."},
  {title:"Holidays, launches, and clothing drops",reason:"Inactive until dates, benefits, marketing audiences, and copy are approved."},
  {title:"Text reminders",reason:"The existing text system is separate. This release does not add duplicate texts or change its timing."},
];

function draftInput(value:unknown):CadenceDraft {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new AdminEmailError(400,"Choose a call and email design.");
  const draft=value as CadenceDraft;
  id(draft.eventId); id(draft.templateId);
  if (!isCadenceKind(draft.kind) || !isCadenceTrack(draft.track) || typeof draft.templateVersion!=="string"
    || !draft.templateVersion || typeof draft.bodyTarget!=="string"
    || (draft.headingTarget!==undefined && typeof draft.headingTarget!=="string")) throw new AdminEmailError(400,"Complete the call and design setup.");
  return {eventId:draft.eventId,kind:draft.kind,track:draft.track,templateId:draft.templateId,templateVersion:draft.templateVersion,
    bodyTarget:draft.bodyTarget,headingTarget:draft.headingTarget || undefined,bindings:draft.bindings,copy:draft.copy};
}
function assertEventScope(plan:CadencePlan) {
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
  if (!cadenceOccurrences(event,plan.kind,plan.track).some(item=>Date.parse(item.dueAt)>Date.now())) {
    throw new AdminEmailError(400,"This call has no future reminders left. Past send times are never replayed.");
  }
}
export async function getCadenceOverview(actor:string) {
  await assertAdminEmailAccess(actor);
  const sql=getApplicationDatabase();
  const templates=await listCadenceTemplates(actor);
  const configuration=getMemberEmailCadenceDeliveryConfiguration();
  const base={templates,configuration,inactive:INACTIVE};
  const [tables]=await sql`select to_regclass('private.member_email_cadence_plans') is not null as ready`;
  if (!tables?.ready) return {...base,events:[],plans:[],setupRequired:true};
  return sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor);
    const events=await tx`select id,title,starts_at as "startsAt",ends_at as "endsAt",timezone as "timeZone"
      from experiences where status='published' and cancelled_at is null and starts_at>statement_timestamp()
        and ends_at>starts_at and kind in ('weekly_call','circle_meeting','academy_session','member_event')
        and visibility<>'public' and registration_mode<>'external' order by starts_at,id limit 250`;
    const rows=await tx<Array<{
      id:string;eventId:string;kind:string;track:string;active:boolean;revision:number;templateName:string;updatedAt:Date|string;
      approvedEvent:CadenceEventSnapshot;currentEvent:CadenceEventSnapshot;eventAvailable:boolean;
      delivery:{sent:number;pending:number;failed:number;manualReview:number;cancelled:number};
    }>>`select plan.id,plan.experience_id as "eventId",plan.snapshot->>'kind' as kind,plan.snapshot->>'track' as track,
      plan.active,plan.revision,plan.snapshot->'template'->>'name' as "templateName",plan.updated_at as "updatedAt",
      plan.snapshot->'event' as "approvedEvent",
      jsonb_build_object('id',event.id,'title',event.title,'startsAt',event.starts_at,'endsAt',event.ends_at,
        'timeZone',event.timezone,'version',event.version::text,'visibility',event.visibility,'circle_id',event.circle_id,
        'block_id',event.block_id,'progression_level_slug',event.progression_level_slug,
        'registration_mode',event.registration_mode,'kind',event.kind) as "currentEvent",
      (event.status='published' and event.cancelled_at is null) as "eventAvailable",
      (select jsonb_build_object('sent',count(*) filter(where status='sent'),
        'pending',count(*) filter(where status in ('pending','sending')),'failed',count(*) filter(where status='failed'),
        'manualReview',count(*) filter(where status='manual_review'),'cancelled',count(*) filter(where status='cancelled'))
        from private.member_email_cadence_deliveries where plan_id=plan.id) as delivery
      from private.member_email_cadence_plans plan join experiences event on event.id=plan.experience_id
      order by plan.updated_at desc limit 250`;
    const plans=rows.map(({approvedEvent,currentEvent,eventAvailable,...plan})=>{
      const current={...currentEvent,startsAt:new Date(currentEvent.startsAt).toISOString(),
        endsAt:currentEvent.endsAt ? new Date(currentEvent.endsAt).toISOString() : ""};
      const changed=plan.active && (!eventAvailable || !sameCadenceEvent(current,approvedEvent));
      const attention=changed ? "Call changed — review again before reminders can resume."
        : plan.delivery.failed+plan.delivery.manualReview>0 ? "Delivery needs attention. Check the email history before taking further action." : "";
      return {...plan,attention};
    });
    return {...base,events,plans,setupRequired:false};
  });
}

type ReviewSnapshot={plan:CadencePlan;localAudienceHash:string;planRevision:number|null};
export async function previewCadence(actor:string,value:unknown) {
  await assertAdminEmailAccess(actor);
  const draft=draftInput(value);
  const template=await getResendEmailTemplate(actor,draft.templateId);
  if (template.version!==draft.templateVersion) throw new AdminEmailError(409,"The Resend design changed. Reload it and review again.");
  validateCadenceDesign(draft,template);
  const sql=getApplicationDatabase();
  const source=await sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor);
    const event=await readCadenceEvent(tx,draft.eventId);
    if (!event) throw new AdminEmailError(400,"Choose a published future call with a complete start and end time.");
    if (!await cadenceCallReady(tx,event.id)) throw new AdminEmailError(400,"This call needs its working calendar and Meet link before reminders can be prepared.");
    const [existing]=await tx<Array<{revision:number}>>`select revision from private.member_email_cadence_plans where experience_id=${event.id}::uuid`;
    const plan=cadencePreviewPlan(draft,template,event);
    assertEventScope(plan);
    return {plan,planRevision:existing?.revision ?? null,recipients:await readCadenceRecipients(tx,event,draft.track)};
  });
  const recipients=await reviewCadenceProviderRecipients(source.recipients);
  const occurrences=cadenceOccurrences(source.plan.event,draft.kind,draft.track).filter(item=>Date.parse(item.dueAt)>Date.now());
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
  const snapshot:ReviewSnapshot={plan:source.plan,localAudienceHash:audienceHash(source.recipients),planRevision:source.planRevision};
  const [review]=await sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);
    // Reviews are private, short-lived approvals; pruning them never changes a plan or a delivery.
    await tx`delete from private.member_email_cadence_reviews where expires_at<statement_timestamp()-interval '7 days'`;
    return tx<Array<{id:string;expiresAt:Date|string}>>`insert into private.member_email_cadence_reviews
      (actor_auth_user_id,snapshot,audience_hash) values(${actor}::uuid,${tx.json(snapshot)}::jsonb,${audienceHash(recipients)})
      returning id,expires_at as "expiresAt"`;
  });
  return {reviewToken:review.id,expiresAt:new Date(review.expiresAt).toISOString(),preview:previews[0],previews,occurrences,recipients,
    warnings:["Foundations uses confirmed invitations. Open Membership and Circle calls use their current qualified audience. New members qualify only for future send times.",
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
      revision=revision+1,active=true,activated_at=clock_timestamp(),approved_by=${actor}::uuid,updated_at=clock_timestamp()
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
