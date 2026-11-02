import "server-only";

import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { requireAdminEmailActor } from "./admin-email-repository";
import { AdminEmailError } from "./admin-email-model";
import { readMemberSmsConfiguration } from "./member-sms-config";
import { sendMemberSmsReminder } from "./member-sms-service";
import type { MemberSmsReminder } from "./member-sms-model";
import { MEMBER_COMMUNICATION_NOTICE_VERSION, MEMBER_SMS_TERMS_VERSION } from "../membership/member-communication-preferences-model";
import { isMemberSmsOneOffBody, MemberSmsOneOffError, renderMemberSmsOneOffBody,
  type MemberSmsOneOffConfiguration, type MemberSmsOneOffRecipient, type MemberSmsOneOffReviewResponse,
  type MemberSmsOneOffSearch, type MemberSmsOneOffSendResult } from "./member-sms-one-off-model";

export { MemberSmsOneOffError } from "./member-sms-one-off-model";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (body: string) => createHash("sha256").update(body,"utf8").digest("hex");
const iso = (value: Date | string) => new Date(value).toISOString();
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new MemberSmsOneOffError(400,"Choose a valid member or reviewed text.");
  return value;
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new MemberSmsOneOffError(400,"That text-message request is invalid.");
  }
  return value as Record<string, unknown>;
}
async function admin(tx: TransactionSql, actor: string, lock = false) {
  try { await requireAdminEmailActor(tx,actor,lock); }
  catch (error) {
    if (error instanceof AdminEmailError) throw new MemberSmsOneOffError(error.status,"Administrator access is required to send membership texts.");
    throw error;
  }
}
export function getMemberSmsOneOffConfiguration(): MemberSmsOneOffConfiguration {
  const config=readMemberSmsConfiguration();
  return { enabled:config.enabled,ready:config.sendReady,issues:[...(!config.enabled ? ["Text-message sending is paused."] : []),
    ...(!config.sendReady ? ["Text-message delivery needs setup."] : [])] };
}
type Recipient = { memberId:string;personId:string;authUserId:string;email:string;name:string;phone:string;sharedPhone:boolean;consentId:string };
const recipientView=(row:Pick<Recipient,"memberId"|"name"|"phone"|"sharedPhone">):MemberSmsOneOffRecipient=>({
  memberId:row.memberId,name:row.name,maskedPhone:`••• ${row.phone.slice(-4)}`,sharedPhone:row.sharedPhone,consentState:"opted_in",
});
/** Same latest-decision/phone/suppression rules as transport, with a verified,
 * active and released recipient identity for administrator-created texts. */
async function recipients(tx:TransactionSql, memberId:string|null, search:string, lock=false):Promise<Recipient[]> {
  // Dispatch owns phone/member/lifecycle/profile locks before calling this helper.
  // Readonly search/review never acquires transport locks or creates consent.
  const rows=await tx<Recipient[]>`select member.id as "memberId",member.person_id as "personId",account.auth_user_id as "authUserId",
      member.email_normalized as email,coalesce(nullif(btrim(display.display_name),''),'Member') as name,profile.mobile_e164 as phone,
      exists(select 1 from person_private_profiles other where other.mobile_e164=profile.mobile_e164 and other.person_id<>member.person_id) as "sharedPhone",
      consent.id::text as "consentId"
    from ruined_members member join people person on person.id=member.person_id and person.status='active'
    join platform_users account on account.person_id=member.person_id and account.status='active'
      and (account.member_id is null or account.member_id=member.id) and account.email_normalized=member.email_normalized
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
    join member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state='active'
    join person_private_profiles profile on profile.person_id=member.person_id
    left join person_profiles display on display.person_id=member.person_id
    join lateral(select * from member_consents decision where decision.member_id=member.id and decision.consent_type='communications'
      and decision.evidence->>'context'='member_communication_preferences_v1' and decision.evidence->>'purpose'='membership_updates'
      and decision.evidence->>'channel'='sms' order by decision.id desc limit 1) consent on true
    where member.deleted_at is null and member.membership_state='active' and private.ruined_member_profile_released(member.id)
      and profile.mobile_e164 ~ '^[+][1-9][0-9]{7,14}$' and consent.decision='accepted'
      and consent.policy_version=${MEMBER_COMMUNICATION_NOTICE_VERSION} and consent.source='member' and consent.actor_auth_user_id is not null
      and consent.evidence->>'destination'=profile.mobile_e164 and consent.evidence->>'requested'='true'
      and consent.evidence->>'action'='sms_checkbox_checked' and consent.evidence->>'marketingConsent'='false'
      and consent.evidence->>'termsVersion'=${MEMBER_SMS_TERMS_VERSION}
      and exists(select 1 from person_email_addresses email where email.person_id=member.person_id and email.email_normalized=member.email_normalized
        and email.verification_state='verified' and email.retired_at is null)
      and not exists(select 1 from private.member_sms_phone_suppressions suppression where suppression.phone_e164=profile.mobile_e164)
      and (${memberId}::uuid is null or member.id=${memberId}::uuid)
      and (${memberId}::uuid is not null or strpos(lower(coalesce(display.display_name,'')),${search})>0 or strpos(member.email_normalized,${search})>0)
    order by member.id limit ${memberId ? 2 : 21}
    ${lock ? tx`for share of person,account,grant_row` : tx``}`;
  if (lock && rows.length===1) {
    const verified=await tx`select email_normalized from person_email_addresses where person_id=${rows[0].personId}::uuid
      and email_normalized=${rows[0].email} and verification_state='verified' and retired_at is null for share`;
    if (!verified.length) return [];
    const release=await tx<Array<{released:Date|null}>>`select profile_activated_at as released from member_registration_access
      where member_id=${rows[0].memberId}::uuid for share`;
    if (release.some(row=>!row.released)) return [];
  }
  return rows;
}
export async function searchMemberSmsOneOffRecipients(actor:string, query:unknown):Promise<MemberSmsOneOffSearch> {
  if (typeof query!=="string" || query.trim().length<2 || query.length>80 || /[\u0000-\u001f\u007f]/.test(query)) {
    throw new MemberSmsOneOffError(400,"Search for a member using 2 to 80 characters.");
  }
  return getApplicationDatabase().begin("read only",async tx=>{
    await tx`set local statement_timeout='8s'`;await admin(tx,actor);
    const rows=await recipients(tx,null,query.trim().toLowerCase());
    return { recipients:rows.slice(0,20).map(recipientView),hasMore:rows.length>20,configuration:getMemberSmsOneOffConfiguration() };
  });
}
type Review = { id:string;actor:string;actorName:string;requestId:string;memberId:string;personId:string;authUserId:string;email:string;
  name:string;phone:string;sharedPhone:boolean;consentId:string;body:string;bodySha256:string;createdAt:Date|string;expiresAt:Date|string;
  status:"reviewed"|"claimed"|"finished";outcome:string|null;claimedAt:Date|string|null;expired:boolean };
async function readReview(tx:TransactionSql,actor:string,id:string|null,requestId:string|null,lock=false):Promise<Review|null> {
  const [row]=await tx<Review[]>`select id,actor_auth_user_id as actor,actor_name as "actorName",request_id as "requestId",member_id as "memberId",
      person_id as "personId",recipient_auth_user_id as "authUserId",recipient_email as email,recipient_name as name,destination_e164 as phone,
      shared_phone as "sharedPhone",consent_id::text as "consentId",body_text as body,body_sha256 as "bodySha256",created_at as "createdAt",
      expires_at as "expiresAt",status,outcome,claimed_at as "claimedAt",expires_at<=clock_timestamp() as expired
    from private.member_sms_one_off_reviews where actor_auth_user_id=${actor}::uuid
      and ((${id}::uuid is not null and id=${id}::uuid) or (${requestId}::uuid is not null and request_id=${requestId}::uuid))
    ${lock ? tx`for update` : tx``}`;
  return row??null;
}
async function audit(tx:TransactionSql,review:Pick<Review,"id"|"actor"|"memberId"|"consentId"|"bodySha256">,action:string) {
  await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,metadata)
    values(${review.actor}::uuid,${action},'member_sms_one_off',${review.id},${review.memberId}::uuid,
      ${tx.json({reviewId:review.id,consentId:review.consentId,bodySha256:review.bodySha256})}::jsonb)`;
}
async function rateLimit(tx:TransactionSql,actor:string,sending:boolean) {
  const result=await tx`insert into private.member_sms_one_off_limits(actor_auth_user_id,window_started_at,reviews,sends)
    values(${actor}::uuid,date_trunc('hour',statement_timestamp()),${sending?0:1},${sending?1:0})
    on conflict(actor_auth_user_id,window_started_at) do update set
      reviews=member_sms_one_off_limits.reviews+${sending?0:1},sends=member_sms_one_off_limits.sends+${sending?1:0}
    where ${sending ? tx`member_sms_one_off_limits.sends<30` : tx`member_sms_one_off_limits.reviews<30`} returning actor_auth_user_id`;
  if (!result.length) throw new MemberSmsOneOffError(429,"The hourly text-message limit has been reached. Try again later.");
}
function reviewView(review:Review):MemberSmsOneOffReviewResponse {
  return { review:{id:review.id,recipient:recipientView(review),body:review.body,createdAt:iso(review.createdAt),expiresAt:iso(review.expiresAt),status:"reviewed"},
    configuration:getMemberSmsOneOffConfiguration() };
}
export async function reviewMemberSmsOneOff(actor:string,value:unknown):Promise<MemberSmsOneOffReviewResponse> {
  const input=object(value,["memberId","message","requestId"]),memberId=uuid(input.memberId),requestId=uuid(input.requestId);
  if (typeof input.message!=="string") throw new MemberSmsOneOffError(400,"Write a membership text to review.");
  const body=renderMemberSmsOneOffBody(input.message),bodySha256=digest(body);
  return getApplicationDatabase().begin(async tx=>{
    await tx`set local lock_timeout='3s'`;await tx`set local statement_timeout='10s'`;await admin(tx,actor,true);
    await tx`select pg_advisory_xact_lock(hashtext(${actor+requestId}),8124)`;
    const existing=await readReview(tx,actor,null,requestId);
    if (existing) {
      if (existing.memberId!==memberId || existing.body!==body || existing.bodySha256!==bodySha256) throw new MemberSmsOneOffError(409,"This review request already contains different text or a different member.");
      if (existing.status!=="reviewed" || existing.expired) throw new MemberSmsOneOffError(409,"This review was already used or expired. Check Activity before preparing another text.");
      return reviewView(existing);
    }
    const found=await recipients(tx,memberId,"");
    if (found.length!==1) throw new MemberSmsOneOffError(409,"This member is not currently eligible for a membership text. Refresh the recipient search.");
    const recipient=found[0];await rateLimit(tx,actor,false);
    const [identity]=await tx<Array<{name:string}>>`select coalesce(nullif(btrim(profile.display_name),''),'Administrator') as name
      from platform_users account left join person_profiles profile on profile.person_id=account.person_id where account.auth_user_id=${actor}::uuid`;
    const [created]=await tx<Array<{id:string}>>`insert into private.member_sms_one_off_reviews(actor_auth_user_id,actor_name,request_id,member_id,person_id,
      recipient_auth_user_id,recipient_email,recipient_name,destination_e164,shared_phone,consent_id,body_text,body_sha256)
      values(${actor}::uuid,${identity?.name??"Administrator"},${requestId}::uuid,${recipient.memberId}::uuid,${recipient.personId}::uuid,
        ${recipient.authUserId}::uuid,${recipient.email},${recipient.name},${recipient.phone},${recipient.sharedPhone},${recipient.consentId}::bigint,${body},${bodySha256}) returning id`;
    const review=(await readReview(tx,actor,created.id,null))!;
    await audit(tx,review,"member_sms_one_off.reviewed");return reviewView(review);
  });
}
async function outcome(tx:TransactionSql,review:Review,repeated=false):Promise<MemberSmsOneOffSendResult> {
  const [attempt]=await tx<Array<{id:string;status:string;deliveryStatus:string|null}>>`select id,status,delivery_status as "deliveryStatus"
    from private.member_sms_delivery_attempts where member_id=${review.memberId}::uuid and reminder_kind='one_off' and reminder_key=${`one-off:${review.id}`}`;
  const status:MemberSmsOneOffSendResult["status"]=repeated?"duplicate":attempt?.status==="accepted"?"accepted":attempt?.status==="blocked"||review.outcome==="blocked"?"blocked":"unknown";
  const message=attempt?.status==="accepted"?"The delivery provider accepted this text. Activity shows its delivery status."
    :attempt?.status==="blocked"||review.outcome==="blocked"?"This text was not sent because its delivery checks did not pass. Review Activity."
      :"This send request has already started and its outcome needs review. Check Activity before taking any further action; do not resend it.";
  return {reviewId:review.id,status,attemptId:attempt?.id??null,message,deliveryStatus:attempt?.deliveryStatus??null};
}
/** Rechecked after the transport's phone/member locks at reservation and dispatch. */
async function validateReview(tx:TransactionSql,expected:Review,input:MemberSmsReminder):Promise<boolean> {
  try { await admin(tx,expected.actor,true); }
  catch (error) { if (error instanceof MemberSmsOneOffError) return false; throw error; }
  const rows=await recipients(tx,expected.memberId,"",true),current=rows[0];
  if (rows.length!==1 || !current || ["memberId","personId","authUserId","email","phone","consentId"].some(key=>current[key as keyof Recipient]!==expected[key as keyof Review])) return false;
  const [review]=await tx`select id from private.member_sms_one_off_reviews where id=${expected.id}::uuid and status='claimed'
    and actor_auth_user_id=${expected.actor}::uuid and member_id=${expected.memberId}::uuid and person_id=${expected.personId}::uuid
    and recipient_auth_user_id=${expected.authUserId}::uuid and recipient_email=${expected.email} and destination_e164=${expected.phone}
    and consent_id=${expected.consentId}::bigint and body_text=${expected.body} and body_sha256=${expected.bodySha256}
    and expires_at>clock_timestamp() for share`;
  return Boolean(review) && input.reminderKey===`one-off:${expected.id}` && input.oneOff?.body===expected.body
    && input.oneOff.actorAuthUserId===expected.actor && isMemberSmsOneOffBody(expected.body) && digest(expected.body)===expected.bodySha256;
}
export async function sendMemberSmsOneOff(actor:string,value:unknown):Promise<MemberSmsOneOffSendResult> {
  const input=object(value,["reviewId","confirm"]),reviewId=uuid(input.reviewId);
  if (input.confirm!==true) throw new MemberSmsOneOffError(400,"Confirm this exact reviewed text before sending.");
  const db=getApplicationDatabase();
  const claim=await db.begin(async tx=>{
    await tx`set local lock_timeout='3s'`;await tx`set local statement_timeout='10s'`;await admin(tx,actor,true);
    const review=await readReview(tx,actor,reviewId,null,true);
    if (!review) throw new MemberSmsOneOffError(404,"That reviewed text was not found for this administrator.");
    if (review.status!=="reviewed") return {result:await outcome(tx,review,true)};
    if (review.expired) throw new MemberSmsOneOffError(409,"This text review expired. Review the member and message again before sending.");
    const configuration=getMemberSmsOneOffConfiguration();
    if (!configuration.enabled || !configuration.ready) throw new MemberSmsOneOffError(503,configuration.issues.join(" "));
    if (!isMemberSmsOneOffBody(review.body) || digest(review.body)!==review.bodySha256) throw new MemberSmsOneOffError(409,"The saved review could not be verified. No text was sent.");
    await rateLimit(tx,actor,true);
    await tx`update private.member_sms_one_off_reviews set status='claimed',claimed_at=statement_timestamp() where id=${review.id}::uuid`;
    await audit(tx,review,"member_sms_one_off.send_requested");
    return {review:{...review,status:"claimed" as const}};
  });
  if (claim.result) return claim.result;
  const review=claim.review!;
  const reminder:MemberSmsReminder={memberId:review.memberId,kind:"one_off",expectedConsentId:review.consentId,reminderKey:`one-off:${review.id}`,
    oneOff:{reviewId:review.id,actorAuthUserId:review.actor,body:review.body}};
  // Once claimed, any failure is potentially ambiguous. Never re-enter this path
  // on a repeated request, even if the process died before reserving an attempt.
  let finalOutcome:"accepted"|"blocked"|"unknown"|"duplicate"="unknown";
  try {
    const result=await sendMemberSmsReminder(reminder,{guard:tx=>validateReview(tx,review,reminder)});
    finalOutcome=result.status==="accepted"||result.status==="unknown"||result.status==="duplicate"?result.status:"blocked";
  } catch { /* Keep only the safe outcome; provider/SQL text can contain private data. */ }
  try {
    return await db.begin(async tx=>{
      await tx`set local statement_timeout='10s'`;
      await tx`update private.member_sms_one_off_reviews set status='finished',finished_at=statement_timestamp(),outcome=${finalOutcome}
        where id=${review.id}::uuid and status='claimed'`;
      await audit(tx,review,`member_sms_one_off.${finalOutcome}`);
      return outcome(tx,{...review,status:"finished",outcome:finalOutcome});
    });
  } catch {
    return {reviewId:review.id,status:"unknown",attemptId:null,deliveryStatus:null,
      message:"The send request was recorded, but its final status could not be confirmed. Check Activity and do not resend it."};
  }
}
