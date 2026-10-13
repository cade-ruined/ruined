import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { AdminEmailError, isAdminEmailAddress } from "./admin-email-model";
import { assertAdminEmailAccess, requireAdminEmailActor } from "./admin-email-repository";
import { prepareResendEmail, resendEmailProvider, listResendEmailRecords } from "./resend-email-service";
import { resolveEmailGroup, checkEmailGroupRecipientPermission, checkEmailGroupRecipientPermissionInTransaction, requireEmailGroupRevision } from "./email-group-repository";
import { EMAIL_GROUP_CAMPAIGN_LIMIT, personalizeEmailGroupMessage, type EmailGroupCampaignDraft, type EmailGroupCampaignMessage, type EmailGroupCampaignPurpose, type EmailGroupCampaignRecipient } from "./email-group-campaign-model";

const hash=(value:unknown)=>createHash("sha256").update(typeof value==="string" ? value : JSON.stringify(value)).digest("hex");
const uuid=(value:unknown)=>{if(typeof value!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AdminEmailError(400,"Choose a valid group campaign.");return value;};
const revision=(value:unknown)=>{if(typeof value!=="number" || !Number.isSafeInteger(value) || value<1) throw new AdminEmailError(400,"Reload the current campaign revision.");return value;};
const iso=(value:Date|string)=>new Date(value).toISOString();
const unsubscribeUrl=(token:string)=>`https://members.theruinedproject.com/api/email-groups/unsubscribe?token=${token}`;
type Tx=Parameters<typeof requireAdminEmailActor>[0];
type CampaignRow={id:string;revision:number;name:string;groupId:string;groupRevision:number;purpose:EmailGroupCampaignPurpose;draft:EmailGroupCampaignDraft;status:string;actor:string;createdAt:Date|string;updatedAt:Date|string};
type Snapshot={message:EmailGroupCampaignMessage;recipients:EmailGroupCampaignRecipient[];excluded:Array<EmailGroupCampaignRecipient & {reason:string}>;groupId:string;groupRevision:number;groupName:string;purpose:EmailGroupCampaignPurpose;topicId:string|null;templateId:string;templateVersion:string};
export function getEmailGroupCampaignConfiguration() {
  const issues=[...(getPlatformConfiguration().mode!=="connected" ? ["A connected platform is required."] : []),
    ...(!process.env.RESEND_API_KEY?.trim() ? ["Connect Resend before reviewing recipients."] : []),
    ...(process.env.ADMIN_EMAIL_SENDING_ENABLED!=="true" ? ["Administrator email sending is disabled."] : []),
    ...(process.env.ADMIN_EMAIL_GROUP_SENDING_ENABLED!=="true" ? ["Native group campaign sending is disabled."] : []),
    ...(!process.env.CRON_SECRET?.trim() ? ["The campaign delivery worker is not configured."] : [])];
  return {ready:issues.length===0,sendingReady:issues.length===0,issues};
}
async function readCampaign(tx:Tx,campaignId:string,lock=false) {
  const [row]=await tx<CampaignRow[]>`select id,revision,name,group_id as "groupId",group_revision as "groupRevision",purpose,draft,status,
    actor_auth_user_id as actor,created_at as "createdAt",updated_at as "updatedAt" from admin_email_group_campaigns
    where id=${campaignId}::uuid ${lock ? tx`for update` : tx``}`;
  if (!row) throw new AdminEmailError(404,"This group campaign was not found.");return row;
}
const campaignView=(row:CampaignRow)=>({...row.draft,id:row.id,revision:row.revision,name:row.name,groupId:row.groupId,groupRevision:row.groupRevision,purpose:row.purpose,status:row.status,createdAt:iso(row.createdAt),updatedAt:iso(row.updatedAt)});
async function audit(tx:Tx,actor:string,action:string,id:string) {
  await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
    values(${actor}::uuid,${action},'email_group_campaign',${id},${tx.json({campaignId:id})}::jsonb)`;
}
async function withdrawn(tx:Tx,email:string,purpose:EmailGroupCampaignPurpose) {
  const rows=await tx`select 1 from admin_email_group_withdrawals where email_normalized=${email} and purpose=${purpose}`;return rows.length>0;
}
async function localPermission(email:string,purpose:EmailGroupCampaignPurpose) {
  return await checkEmailGroupRecipientPermission(email,purpose) && !await getApplicationDatabase().begin(tx=>withdrawn(tx,email,purpose));
}
function normalizeDraft(input:unknown):EmailGroupCampaignDraft {
  if (!input || typeof input!=="object" || Array.isArray(input)) throw new AdminEmailError(400,"Complete the group campaign draft.");
  const value=input as EmailGroupCampaignDraft;
  if (typeof value.name!=="string" || !value.name.trim() || value.name.length>200 || /[\r\n\0]/.test(value.name)
    || !["general_updates","membership_updates"].includes(value.purpose) || typeof value.templateVersion!=="string" || !value.templateVersion
    || !value.edits || typeof value.edits!=="object") throw new AdminEmailError(400,"Complete the group campaign draft.");
  return {...(value.id ? {id:uuid(value.id),revision:revision(value.revision)} : {}),name:value.name.trim(),groupId:uuid(value.groupId),
    groupRevision:revision(value.groupRevision),purpose:value.purpose,templateId:uuid(value.templateId),templateVersion:value.templateVersion,edits:value.edits};
}
function groupTopic(purpose:EmailGroupCampaignPurpose) {
  if (purpose==="membership_updates") return null;
  const value=process.env.RESEND_TOPIC_UPDATES_ID?.trim();
  if (!value) throw new AdminEmailError(503,"Configure the general-updates email topic before reviewing this campaign.");return uuid(value);
}
type Contact={id:string;email:string;first_name?:string|null;last_name?:string|null;unsubscribed:boolean};
async function providerPermission(email:string,purpose:EmailGroupCampaignPurpose,topicId:string|null,suppressed:Set<string>,contact?:Contact|null,topicDefault?:string,deadline?:number):Promise<string|null> {
  if (suppressed.has(email)) return "Email is suppressed by the provider";
  if (contact===undefined) {
    try {contact=await resendEmailProvider<Contact>(`/contacts/${encodeURIComponent(email)}`,"GET",undefined,undefined,deadline);}
    catch(error) {if(error instanceof AdminEmailError && error.status===404) contact=null;else throw error;}
  }
  if (contact && typeof contact.unsubscribed!=="boolean") throw new AdminEmailError(502,"Provider preference evidence is incomplete.");
  if (contact?.unsubscribed) return "Unsubscribed in Resend";
  if (purpose==="membership_updates") return null;
  if (!contact) return "No confirmed provider topic subscription";
  const defaultSubscription=topicDefault ?? (await resendEmailProvider<{default_subscription:string}>(`/topics/${topicId}`,"GET",undefined,undefined,deadline)).default_subscription;
  if (!["opt_in","opt_out"].includes(defaultSubscription)) throw new AdminEmailError(502,"The provider topic is incomplete.");
  const topics=await listResendEmailRecords<{id:string;subscription:string}>(`/contacts/${uuid(contact.id)}/topics`,1000,deadline);
  const state=topics.find(item=>item.id===topicId)?.subscription ?? defaultSubscription;
  if (!["opt_in","opt_out"].includes(state)) throw new AdminEmailError(502,"Provider preference evidence is incomplete.");
  return state==="opt_in" ? null : "Not subscribed to the general-updates topic";
}
async function suppressions(deadline?:number) {
  const rows=await listResendEmailRecords<{id:string;email:string}>("/suppressions",10000,deadline);
  if (rows.some(row=>typeof row.email!=="string" || !isAdminEmailAddress(row.email))) throw new AdminEmailError(502,"Provider suppression evidence is incomplete.");
  return new Set(rows.map(row=>row.email.toLowerCase()));
}
async function resolveCampaignAudience(actor:string,draft:EmailGroupCampaignDraft,topicId:string|null) {
  const deadline=Date.now()+240000;
  const resolved=await resolveEmailGroup(actor,draft.groupId,draft.groupRevision);
  if (resolved.members.length>EMAIL_GROUP_CAMPAIGN_LIMIT) throw new AdminEmailError(400,"Use a group of 1,000 people or fewer.");
  const suppressed=await suppressions();
  const contacts=await listResendEmailRecords<Contact>("/contacts",10000);
  if (contacts.some(contact=>!isAdminEmailAddress(contact.email) || typeof contact.unsubscribed!=="boolean")) throw new AdminEmailError(502,"Provider contacts are incomplete.");
  const byEmail=new Map(contacts.map(contact=>[contact.email.toLowerCase(),contact]));
  const topicDefault=topicId ? (await resendEmailProvider<{default_subscription:string}>(`/topics/${topicId}`)).default_subscription : undefined;
  if(topicId && !["opt_in","opt_out"].includes(topicDefault ?? "")) throw new AdminEmailError(502,"The provider topic is incomplete.");
  const recipients:EmailGroupCampaignRecipient[]=[],excluded:Snapshot["excluded"]=[],seen=new Set<string>();
  for (const member of resolved.members) {
    if(Date.now()>=deadline) throw new AdminEmailError(503,"Recipient checks took too long. Use a smaller group or try again; no campaign was queued.");
    const email=member.email.trim().toLowerCase();if(seen.has(email)) continue;seen.add(email);
    const recipient:EmailGroupCampaignRecipient={email,name:member.name,...(member.memberId ? {memberId:member.memberId} : {}),...(member.personId ? {personId:member.personId} : {})};
    const reason=!await localPermission(email,draft.purpose) ? "This email purpose is not permitted or has been unsubscribed"
      : await providerPermission(email,draft.purpose,topicId,suppressed,byEmail.get(email) ?? null,topicDefault);
    if (reason) excluded.push({...recipient,reason});else recipients.push(recipient);
  }
  recipients.sort((a,b)=>a.email.localeCompare(b.email));excluded.sort((a,b)=>a.email.localeCompare(b.email));
  return {recipients,excluded,groupName:resolved.group.name};
}
export async function getEmailGroupCampaigns(actor:string,campaignId?:unknown) {
  await assertAdminEmailAccess(actor);const sql=getApplicationDatabase();
  return sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor);
    if (campaignId!==undefined && campaignId!==null) {
      const row=await readCampaign(tx,uuid(campaignId));
      const outcomes=await tx`select id,email_normalized as email,status,safe_reason as reason,provider_id as "providerId",completed_at as "completedAt"
        from admin_email_group_deliveries where campaign_id=${row.id}::uuid order by email_normalized limit 1000`;
      return {campaign:campaignView(row),outcomes,configuration:getEmailGroupCampaignConfiguration()};
    }
    const campaigns=await tx`select campaign.id,campaign.revision,campaign.name,campaign.status,campaign.purpose,campaign.group_id as "groupId",
      campaign.updated_at as "updatedAt",count(delivery.id)::int as total,
      count(delivery.id) filter(where delivery.status='pending')::int as pending,count(delivery.id) filter(where delivery.status='sending')::int as sending,
      count(delivery.id) filter(where delivery.status='sent')::int as sent,count(delivery.id) filter(where delivery.status='unknown')::int as unknown,
      count(delivery.id) filter(where delivery.status='failed')::int as failed,count(delivery.id) filter(where delivery.status='cancelled')::int as cancelled
      from admin_email_group_campaigns campaign left join admin_email_group_deliveries delivery on delivery.campaign_id=campaign.id
      group by campaign.id order by campaign.updated_at desc limit 100`;
    return {campaigns,configuration:getEmailGroupCampaignConfiguration()};
  });
}
export async function saveEmailGroupCampaign(actor:string,input:unknown) {
  await assertAdminEmailAccess(actor);const draft=normalizeDraft(input);
  await resolveEmailGroup(actor,draft.groupId,draft.groupRevision);
  await prepareResendEmail(actor,{...draft,mode:"campaign"});
  const row=await getApplicationDatabase().begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);await requireEmailGroupRevision(tx,draft.groupId,draft.groupRevision);
    if (draft.id) {
      const current=await readCampaign(tx,draft.id,true);
      if (current.status!=="draft" || current.revision!==draft.revision) throw new AdminEmailError(409,"This campaign changed or was already queued. Reload it.");
      await tx`update admin_email_group_campaigns set name=${draft.name},group_id=${draft.groupId}::uuid,group_revision=${draft.groupRevision},purpose=${draft.purpose},draft=${tx.json(draft)}::jsonb,
        revision=revision+1,actor_auth_user_id=${actor}::uuid,updated_at=clock_timestamp() where id=${draft.id}::uuid`;
      await audit(tx,actor,"email_group_campaign.saved",draft.id);return readCampaign(tx,draft.id);
    }
    const [created]=await tx<Array<{id:string}>>`insert into admin_email_group_campaigns(actor_auth_user_id,name,group_id,group_revision,purpose,draft)
      values(${actor}::uuid,${draft.name},${draft.groupId}::uuid,${draft.groupRevision},${draft.purpose},${tx.json(draft)}::jsonb) returning id`;
    await audit(tx,actor,"email_group_campaign.created",created.id);return readCampaign(tx,created.id);
  });return {campaign:campaignView(row)};
}
export async function reviewEmailGroupCampaign(actor:string,campaignId:unknown,expectedRevision:unknown) {
  await assertAdminEmailAccess(actor);const key=uuid(campaignId),version=revision(expectedRevision);
  const row=await getApplicationDatabase().begin(tx=>readCampaign(tx,key));
  if(row.status!=="draft" || row.revision!==version) throw new AdminEmailError(409,"Reload the current draft before review.");
  const topicId=groupTopic(row.purpose),message=await prepareResendEmail(actor,{...row.draft,mode:"campaign"},{persistSignOff:true});
  const audience=await resolveCampaignAudience(actor,row.draft,topicId);
  if (!audience.recipients.length) throw new AdminEmailError(400,"No recipients currently qualify for this email purpose.");
  for (const recipient of audience.recipients) personalizeEmailGroupMessage(message,recipient,unsubscribeUrl("preview-not-a-live-unsubscribe-token"));
  const snapshot:Snapshot={message,...audience,groupId:row.groupId,groupRevision:row.groupRevision,purpose:row.purpose,topicId,templateId:row.draft.templateId,templateVersion:row.draft.templateVersion};
  const review=await getApplicationDatabase().begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);await requireEmailGroupRevision(tx,row.groupId,row.groupRevision);
    const current=await readCampaign(tx,key,true);if(current.status!=="draft" || current.revision!==version) throw new AdminEmailError(409,"The draft changed during review.");
    const [created]=await tx<Array<{id:string;expiresAt:Date|string}>>`insert into admin_email_group_campaign_reviews(campaign_id,campaign_revision,actor_auth_user_id,snapshot,recipient_hash)
      values(${key}::uuid,${version},${actor}::uuid,${tx.json(snapshot)}::jsonb,${hash(audience.recipients)}) returning id,expires_at as "expiresAt"`;return created;
  });
  return {id:review.id,origin:"local_group",mode:"campaign",campaignId:key,...message,...audience,recipientCount:audience.recipients.length,
    excludedCount:audience.excluded.length,purpose:row.purpose,expiresAt:iso(review.expiresAt)};
}
export async function queueEmailGroupCampaign(actor:string,reviewId:unknown) {
  await assertAdminEmailAccess(actor);if (!getEmailGroupCampaignConfiguration().sendingReady) throw new AdminEmailError(503,"Native group campaign sending is disabled or incomplete. Your draft and review are saved.");
  const key=uuid(reviewId),sql=getApplicationDatabase();
  const [review]=await sql<Array<{campaignId:string;campaignRevision:number;snapshot:Snapshot;recipientHash:string;consumedAt:Date|null;expiresAt:Date|string}>>`
    select campaign_id as "campaignId",campaign_revision as "campaignRevision",snapshot,recipient_hash as "recipientHash",consumed_at as "consumedAt",expires_at as "expiresAt"
    from admin_email_group_campaign_reviews where id=${key}::uuid and actor_auth_user_id=${actor}::uuid`;
  if (!review) throw new AdminEmailError(404,"Campaign review not found.");
  if(review.consumedAt) return {status:"queued",id:review.campaignId,message:"This campaign was already queued. View its delivery results."};
  if(Date.parse(iso(review.expiresAt))<=Date.now()) throw new AdminEmailError(409,"This review expired. Review the campaign again.");
  const row=await sql.begin(tx=>readCampaign(tx,review.campaignId));
  if(row.status!=="draft" || row.revision!==review.campaignRevision) throw new AdminEmailError(409,"This campaign changed or was already queued.");
  // A fresh render detects source design version changes; frozen review bytes remain authoritative.
  await prepareResendEmail(actor,{...row.draft,mode:"campaign"});
  const audience=await resolveCampaignAudience(actor,row.draft,review.snapshot.topicId);
  if(hash(audience.recipients)!==review.recipientHash) throw new AdminEmailError(409,"The group or recipient permissions changed. Review again.");
  await sql.begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);await requireEmailGroupRevision(tx,row.groupId,row.groupRevision);
    const current=await readCampaign(tx,row.id,true);
    const [valid]=await tx`select id from admin_email_group_campaign_reviews where id=${key}::uuid and consumed_at is null and expires_at>clock_timestamp() for update`;
    if(current.status!=="draft" || current.revision!==review.campaignRevision || !valid) throw new AdminEmailError(409,"This review changed or was already queued.");
    for (const recipient of review.snapshot.recipients) {
      if (await withdrawn(tx,recipient.email,row.purpose) || !await checkEmailGroupRecipientPermissionInTransaction(tx,recipient.email,row.purpose,{expectedIdentity:recipient})) throw new AdminEmailError(409,"Recipient permissions changed. Review again.");
      await tx`insert into admin_email_group_deliveries(campaign_id,review_id,email_normalized,recipient_name)
        values(${row.id}::uuid,${key}::uuid,${recipient.email},${recipient.name})`;
    }
    await tx`update admin_email_group_campaign_reviews set consumed_at=clock_timestamp() where id=${key}::uuid`;
    await tx`update admin_email_group_campaigns set status='queued',updated_at=clock_timestamp() where id=${row.id}::uuid`;
    await audit(tx,actor,"email_group_campaign.queued",row.id);
  });
  return {status:"queued",id:row.id,message:"Queued for individual delivery. Permissions are checked again before each message; nothing is marked delivered yet."};
}

async function updateCampaignOutcome(campaignId:string) {
  await getApplicationDatabase()`update admin_email_group_campaigns campaign set status=case
    when exists(select 1 from admin_email_group_deliveries where campaign_id=campaign.id and status in ('pending','sending')) then 'queued'
    when exists(select 1 from admin_email_group_deliveries where campaign_id=campaign.id and status in ('unknown','failed')) then 'attention'
    else 'completed' end,updated_at=clock_timestamp() where id=${campaignId}::uuid and status<>'draft'`;
}
type PendingDelivery={id:string;campaignId:string;email:string;name:string;actor:string;groupId:string;groupRevision:number;purpose:EmailGroupCampaignPurpose;snapshot:Snapshot};
async function purposeLock(tx:Tx,email:string,purpose:EmailGroupCampaignPurpose) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`native-group-email:${purpose}:${email}`},0))`;
}
/** No queued recipient can be silently expanded or retried after an uncertain handoff. */
export async function processEmailGroupCampaignBatch(requestedLimit=20) {
  const configuration=getEmailGroupCampaignConfiguration();
  const result={...configuration,claimed:0,sent:0,cancelled:0,unknown:0,failed:0,deferred:0};
  if (!configuration.sendingReady) return result;
  const sql=getApplicationDatabase(),deadline=Date.now()+150000;
  const limit=Number.isFinite(requestedLimit) ? Math.min(20,Math.max(1,Math.trunc(requestedLimit))) : 20;
  // An interrupted claim may already have reached the provider. Never reset it to pending.
  await sql`update admin_email_group_deliveries set status='unknown',safe_reason='Sending result is uncertain; do not resend automatically.',completed_at=clock_timestamp()
    where status='sending' and attempted_at<clock_timestamp()-interval '5 minutes'`;
  await sql`update admin_email_group_campaigns campaign set status=case
    when exists(select 1 from admin_email_group_deliveries where campaign_id=campaign.id and status in ('unknown','failed')) then 'attention' else 'completed' end,
    updated_at=clock_timestamp() where campaign.status='queued'
      and not exists(select 1 from admin_email_group_deliveries where campaign_id=campaign.id and status in ('pending','sending'))`;
  try {
    for (let index=0;index<limit && Date.now()<deadline;index++) {
      const [job]=await sql<PendingDelivery[]>`select delivery.id,delivery.campaign_id as "campaignId",delivery.email_normalized as email,delivery.recipient_name as name,
        review.actor_auth_user_id as actor,campaign.group_id as "groupId",campaign.group_revision as "groupRevision",campaign.purpose,review.snapshot
        from admin_email_group_deliveries delivery join admin_email_group_campaigns campaign on campaign.id=delivery.campaign_id
        join admin_email_group_campaign_reviews review on review.id=delivery.review_id
        where delivery.status='pending' and campaign.status='queued' order by delivery.created_at,delivery.id limit 1`;
      if (!job) break;
      const approvedRecipient=job.snapshot.recipients.find(recipient=>recipient.email===job.email);
      let eligible=true,effectiveGroupRevision=job.groupRevision;
      try {
        const current=await resolveEmailGroup(job.actor,job.groupId);
        effectiveGroupRevision=current.group.revision;
        eligible=!!approvedRecipient && current.members.some(member=>member.email.toLowerCase()===job.email
          && (member.memberId ?? null)===(approvedRecipient.memberId ?? null) && (member.personId ?? null)===(approvedRecipient.personId ?? null)) && await localPermission(job.email,job.purpose);
      } catch(error) {
        if(error instanceof AdminEmailError && [400,403,404,409].includes(error.status)) eligible=false;else throw error;
      }
      let providerReason:string|null=null;
      if (eligible) providerReason=await providerPermission(job.email,job.purpose,job.snapshot.topicId,await suppressions(deadline),undefined,undefined,deadline);
      if (!eligible || providerReason) {
        await sql`update admin_email_group_deliveries set status='cancelled',safe_reason=${providerReason ?? "Group membership, approval, or email permission changed."},completed_at=clock_timestamp()
          where id=${job.id}::uuid and status='pending'`;
        result.cancelled++;await updateCampaignOutcome(job.campaignId);continue;
      }
      if(Date.now()>=deadline) {result.deferred++;break;}
      const token=randomBytes(32).toString("base64url"),url=unsubscribeUrl(token);
      const message=personalizeEmailGroupMessage(job.snapshot.message,{email:job.email,name:job.name},url);
      const payload={from:message.from,to:[job.email],subject:message.subject,html:message.html,text:message.text,
        ...(message.replyTo.length ? {reply_to:message.replyTo} : {}),...(job.snapshot.topicId ? {topic_id:job.snapshot.topicId} : {}),
        headers:{"List-Unsubscribe":`<${url}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}};
      const claimed=await sql.begin(async tx=>{
        await requireAdminEmailActor(tx,job.actor,true);await requireEmailGroupRevision(tx,job.groupId,effectiveGroupRevision);
        await purposeLock(tx,job.email,job.purpose);
        if(await withdrawn(tx,job.email,job.purpose) || !await checkEmailGroupRecipientPermissionInTransaction(tx,job.email,job.purpose,{expectedIdentity:approvedRecipient})) {
          await tx`update admin_email_group_deliveries set status='cancelled',safe_reason='Email permission changed.',completed_at=clock_timestamp()
            where id=${job.id}::uuid and status='pending'`;return false;
        }
        const rows=await tx`update admin_email_group_deliveries set status='sending',attempted_at=clock_timestamp(),unsubscribe_hash=${hash(token)},payload_hash=${hash(payload)}
          where id=${job.id}::uuid and status='pending' returning id`;
        return rows.length>0;
      });
      if(!claimed) {await updateCampaignOutcome(job.campaignId);continue;}
      result.claimed++;
      let submitted=false;
      try {
        const sent=await sql.begin(async tx=>{
          await requireAdminEmailActor(tx,job.actor,true);await requireEmailGroupRevision(tx,job.groupId,effectiveGroupRevision);
          await purposeLock(tx,job.email,job.purpose);
          const [delivery]=await tx`select id from admin_email_group_deliveries where id=${job.id}::uuid and status='sending' for update`;
          if(!delivery) return false;
          if(Date.now()>=deadline || !getEmailGroupCampaignConfiguration().sendingReady || await withdrawn(tx,job.email,job.purpose)
            || !await checkEmailGroupRecipientPermissionInTransaction(tx,job.email,job.purpose,{expectedIdentity:approvedRecipient})) return false;
          if(await providerPermission(job.email,job.purpose,job.snapshot.topicId,await suppressions(deadline),undefined,undefined,deadline)) return false;
          if(Date.now()>=deadline) return false;
          // The claim and exact payload digest are already committed; this is the only provider POST for this delivery.
          submitted=true;
          const response=await resendEmailProvider<{id:string}>("/emails","POST",payload,`ruined-group-delivery/${job.id}`,deadline);
          if(typeof response.id!=="string" || !response.id) throw new Error("Missing provider acknowledgement");
          await tx`update admin_email_group_deliveries set status='sent',provider_id=${response.id},safe_reason='Accepted by Resend; inbox delivery is not confirmed.',completed_at=clock_timestamp()
            where id=${job.id}::uuid and status='sending'`;
          return true;
        });
        if(sent) result.sent++;
        else {
          await sql`update admin_email_group_deliveries set status='cancelled',safe_reason='Permission or delivery configuration changed before handoff.',completed_at=clock_timestamp()
            where id=${job.id}::uuid and status='sending'`;result.cancelled++;
        }
      } catch(error) {
        const knownRejected=submitted && error instanceof AdminEmailError && [400,404,422].includes(error.status);
        const status=!submitted ? "cancelled" : knownRejected ? "failed" : "unknown";
        await sql`update admin_email_group_deliveries set status=${status},safe_reason=${status==="unknown" ? "Sending result is uncertain; do not resend automatically." : status==="failed" ? "Provider rejected this message; review the campaign." : "Approval or permission changed before handoff."},completed_at=clock_timestamp()
          where id=${job.id}::uuid and status='sending'`;
        result[status]++;await updateCampaignOutcome(job.campaignId);
        if(status==="unknown") break;
      }
      await updateCampaignOutcome(job.campaignId);
    }
  } catch {result.deferred++;}
  return result;
}
export async function inspectEmailGroupUnsubscribe(token:unknown) {
  if(typeof token!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AdminEmailError(404,"This unsubscribe link is invalid.");
  const [row]=await getApplicationDatabase()<Array<{email:string;purpose:EmailGroupCampaignPurpose}>>`
    select delivery.email_normalized as email,campaign.purpose from admin_email_group_deliveries delivery
    join admin_email_group_campaigns campaign on campaign.id=delivery.campaign_id where delivery.unsubscribe_hash=${hash(token)}`;
  if(!row) throw new AdminEmailError(404,"This unsubscribe link is invalid.");return {purpose:row.purpose};
}
export async function unsubscribeEmailGroupCampaign(token:unknown) {
  await inspectEmailGroupUnsubscribe(token);
  return getApplicationDatabase().begin(async tx=>{
    const [row]=await tx<Array<{email:string;purpose:EmailGroupCampaignPurpose}>>`select delivery.email_normalized as email,campaign.purpose
      from admin_email_group_deliveries delivery join admin_email_group_campaigns campaign on campaign.id=delivery.campaign_id
      where delivery.unsubscribe_hash=${hash(token)}`;
    if(!row) throw new AdminEmailError(404,"This unsubscribe link is invalid.");
    await purposeLock(tx,row.email,row.purpose);
    await tx`insert into admin_email_group_withdrawals(email_normalized,purpose) values(${row.email},${row.purpose}) on conflict do nothing`;
    await tx`update admin_email_group_deliveries delivery set status='cancelled',safe_reason='Unsubscribed from this purpose of Ruined group email.',completed_at=clock_timestamp()
      from admin_email_group_campaigns campaign where campaign.id=delivery.campaign_id and campaign.purpose=${row.purpose}
        and delivery.email_normalized=${row.email} and delivery.status='pending'`;
    return {purpose:row.purpose};
  });
}
