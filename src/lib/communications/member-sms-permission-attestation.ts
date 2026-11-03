import "server-only";
import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { requireAdminEmailActor } from "./admin-email-repository";
import { AdminEmailError } from "./admin-email-model";
import { acceptedMemberSmsConsentSql, MEMBER_SMS_OPERATOR_ATTESTATION_ACTION, MEMBER_SMS_OPERATOR_ATTESTATION_VERSION } from "../membership/member-sms-consent";
import { lockMemberSmsFunding, memberSmsFundedEligibilitySql } from "./member-sms-eligibility";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE=/^[+][1-9][0-9]{7,14}$/;
export class MemberSmsPermissionAttestationError extends Error {
  constructor(readonly status:number,message:string){super(message);this.name="MemberSmsPermissionAttestationError";}
}
export type MemberSmsPermissionTarget={memberId:string;phone:string;expectedConsentId:string|null};
export type MemberSmsPermissionBatch={batchId:string;approvalReference:string;permissionStatement:string;targets:MemberSmsPermissionTarget[]};
export type MemberSmsPermissionBatchResult={batchId:string;recorded:Array<{memberId:string;consentId:string}>;unchanged:Array<{memberId:string;consentId:string}>};
type Target={memberId:string;phone:string|null;name:string;funded:boolean;suppressed:boolean;consentId:string|null;policyVersion:string|null;validConsent:boolean};
function object(value:unknown,keys:string[]):value is Record<string,unknown>{
  return value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).sort().join(",")===keys.sort().join(",");
}
function validate(value:unknown):MemberSmsPermissionBatch {
  if(!object(value,["batchId","approvalReference","permissionStatement","targets"])||typeof value.batchId!=="string"||!UUID.test(value.batchId)
    ||typeof value.approvalReference!=="string"||!value.approvalReference.trim()||value.approvalReference.length>500
    ||typeof value.permissionStatement!=="string"||!value.permissionStatement.trim()||value.permissionStatement.length>1000
    ||!Array.isArray(value.targets)||!value.targets.length||value.targets.length>50)throw new MemberSmsPermissionAttestationError(400,"An explicit, bounded permission batch is required.");
  const targets=value.targets.map(target=>{
    if(!object(target,["memberId","phone","expectedConsentId"])||typeof target.memberId!=="string"||!UUID.test(target.memberId)
      ||typeof target.phone!=="string"||!PHONE.test(target.phone)
      ||!(target.expectedConsentId===null||typeof target.expectedConsentId==="string"&&/^[1-9][0-9]*$/.test(target.expectedConsentId)))
      throw new MemberSmsPermissionAttestationError(400,"Each member requires an exact phone and prior consent identity.");
    return target as MemberSmsPermissionTarget;
  }).sort((a,b)=>a.memberId.localeCompare(b.memberId));
  if(new Set(targets.map(target=>target.memberId)).size!==targets.length)throw new MemberSmsPermissionAttestationError(400,"Each member may appear only once.");
  return {batchId:value.batchId,approvalReference:value.approvalReference,permissionStatement:value.permissionStatement,targets};
}
async function authorize(tx:TransactionSql,actor:string,lock:boolean){
  try{await requireAdminEmailActor(tx,actor,lock);}catch(error){
    if(error instanceof AdminEmailError)throw new MemberSmsPermissionAttestationError(error.status,"An active administrator must attest SMS permission.");throw error;
  }
  const rows=await tx`select person.id from platform_users account join people person on person.id=account.person_id and person.status='active'
    where account.auth_user_id=${actor}::uuid ${lock?tx`for share of person`:tx``}`;
  if(!rows.length)throw new MemberSmsPermissionAttestationError(403,"An active administrator must attest SMS permission.");
}
async function readTarget(tx:TransactionSql,memberId:string):Promise<Target|null>{
  const [target]=await tx<Target[]>`select member.id as "memberId",profile.mobile_e164 as phone,
    coalesce(nullif(btrim(display.display_name),''),'Member') as name,
    ${memberSmsFundedEligibilitySql(tx,tx`member.id`)} as funded,
    exists(select 1 from private.member_sms_phone_suppressions stop where stop.phone_e164=profile.mobile_e164) as suppressed,
    sms_decision.id::text as "consentId",sms_decision.policy_version as "policyVersion",
    ${acceptedMemberSmsConsentSql(tx,tx`profile.mobile_e164`)} as "validConsent"
    from ruined_members member left join person_private_profiles profile on profile.person_id=member.person_id
    left join person_profiles display on display.person_id=member.person_id
    left join lateral(select * from member_consents decision where decision.member_id=member.id and decision.consent_type='communications'
      and decision.evidence->>'context'='member_communication_preferences_v1' and decision.evidence->>'purpose'='membership_updates'
      and decision.evidence->>'channel'='sms' order by decision.id desc limit 1) sms_decision on true
    where member.id=${memberId}::uuid`;
  return target??null;
}
/** Read-only, administrator-only preview for an explicit roster. Never selects new members. */
export async function previewMemberSmsPermissionAttestation(actor:string,memberIds:string[]){
  if(!Array.isArray(memberIds)||!memberIds.length||memberIds.length>50||memberIds.some(id=>typeof id!=="string"||!UUID.test(id))
    ||new Set(memberIds).size!==memberIds.length)throw new MemberSmsPermissionAttestationError(400,"Choose between one and fifty exact member records.");
  return getApplicationDatabase().begin("isolation level repeatable read read only",async tx=>{
    await tx`set local statement_timeout='10s'`;await authorize(tx,actor,false);
    const result=[];
    for(const memberId of memberIds){
      const target=await readTarget(tx,memberId);
      const eligible=Boolean(target?.funded&&!target.suppressed&&target.phone&&PHONE.test(target.phone));
      result.push({memberId,name:target?.name??"Member",phone:target?.phone??null,maskedPhone:target?.phone?`••• ${target.phone.slice(-4)}`:null,
        expectedConsentId:target?.consentId??null,eligible,needsAttestation:eligible&&!target?.validConsent,
        reason:!target?"Member unavailable":!target.funded?"Current funding, released profile, and verified active access are required"
          :target.suppressed?"Text delivery is suppressed":!target.phone||!PHONE.test(target.phone)?"Current phone is unavailable":null});
    }
    return result;
  });
}
/** Append the administrator's truthful attestation. Never changes phones, consent
 * history, membership state, suppression, delivery attempts, or worker settings. */
export async function attestMemberSmsPermissions(actor:string,value:unknown):Promise<MemberSmsPermissionBatchResult>{
  const input=validate(value),fingerprint=createHash("sha256").update(JSON.stringify({actor,...input})).digest("hex");
  const batchKey=`member-sms-permission-batch:${input.batchId}`;
  return getApplicationDatabase().begin(async tx=>{
    await tx`set local lock_timeout='3s'`;await tx`set local statement_timeout='10s'`;await authorize(tx,actor,true);
    await tx`select pg_advisory_xact_lock(hashtext(${batchKey}),8125)`;
    const [prior]=await tx<Array<{metadata:{fingerprint?:string;result?:MemberSmsPermissionBatchResult}}>>`
      select metadata from operator_audit_events where dedupe_key=${batchKey}`;
    if(prior){
      if(prior.metadata.fingerprint!==fingerprint||!prior.metadata.result)throw new MemberSmsPermissionAttestationError(409,"This approval batch was already used for a different request.");
      return prior.metadata.result;
    }
    for(const phone of [...new Set(input.targets.map(target=>target.phone))].sort())await tx`select pg_advisory_xact_lock(hashtext(${phone}),8123)`;
    const checked:Target[]=[];
    for(const expected of input.targets){
      await lockMemberSmsFunding(tx,expected.memberId);
      await tx`select profile.person_id from person_private_profiles profile join ruined_members member on member.person_id=profile.person_id
        where member.id=${expected.memberId}::uuid for share of profile`;
      const current=await readTarget(tx,expected.memberId);
      if(!current||!current.funded||current.suppressed||current.phone!==expected.phone||current.consentId!==expected.expectedConsentId)
        throw new MemberSmsPermissionAttestationError(409,`Member ${expected.memberId} changed or is not currently eligible. Refresh the exact roster.`);
      checked.push(current);
    }
    const result:MemberSmsPermissionBatchResult={batchId:input.batchId,recorded:[],unchanged:[]};
    for(const target of checked){
      if(target.validConsent&&target.consentId){result.unchanged.push({memberId:target.memberId,consentId:target.consentId});continue;}
      const evidence={context:"member_communication_preferences_v1",purpose:"membership_updates",channel:"sms",destination:target.phone,
        requested:true,marketingConsent:false,action:MEMBER_SMS_OPERATOR_ATTESTATION_ACTION,operatorApproved:true,permissionConfirmed:true,
        memberAffirmed:false,batchId:input.batchId,approvalReference:input.approvalReference,permissionStatement:input.permissionStatement,
        originalConsentId:target.consentId,originalPolicyVersion:target.policyVersion};
      const [consent]=await tx<Array<{id:string}>>`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
        values(${target.memberId}::uuid,'communications',${MEMBER_SMS_OPERATOR_ATTESTATION_VERSION},'accepted',statement_timestamp(),'ops',${actor}::uuid,
          ${tx.json(evidence)}::jsonb,${`member-sms-permission:${input.batchId}:${target.memberId}`}) returning id::text`;
      result.recorded.push({memberId:target.memberId,consentId:consent.id});
      await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,metadata,dedupe_key)
        values(${actor}::uuid,'member_sms.permission_attested','member_consent',${consent.id},${target.memberId}::uuid,
          ${tx.json({batchId:input.batchId,consentId:consent.id,originalConsentId:target.consentId})}::jsonb,${`member-sms-permission-audit:${input.batchId}:${target.memberId}`})`;
    }
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata,dedupe_key)
      values(${actor}::uuid,'member_sms.permission_batch','member_sms_permission_batch',${input.batchId},
        ${tx.json({fingerprint,result,approvalReference:input.approvalReference,permissionStatement:input.permissionStatement})}::jsonb,${batchKey})`;
    return result;
  });
}
