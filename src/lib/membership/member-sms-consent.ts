import type { Sql, TransactionSql } from "postgres";
import { MEMBER_COMMUNICATION_NOTICE_VERSION, MEMBER_SMS_TERMS_VERSION } from "./member-communication-preferences-model";

export const MEMBER_SMS_OPERATOR_ATTESTATION_VERSION = "membership-sms-operator-attestation-v1";
export const MEMBER_SMS_OPERATOR_ATTESTATION_ACTION = "operator_sms_permission_attested";
/** Every caller selects the latest SMS-topic row first and aliases it sms_decision.
 * Operator evidence records the administrator's attestation, never a member checkbox.
 * Suppression and live recipient eligibility are separate, mandatory delivery gates. */
export function acceptedMemberSmsConsentSql(sql: Sql | TransactionSql, destination: ReturnType<TransactionSql>) {
  return sql`(sms_decision.decision='accepted' and sms_decision.actor_auth_user_id is not null
    and sms_decision.consent_type='communications'
    and sms_decision.evidence->>'context'='member_communication_preferences_v1'
    and sms_decision.evidence->>'purpose'='membership_updates' and sms_decision.evidence->>'channel'='sms'
    and sms_decision.evidence->>'destination'=${destination}
    and sms_decision.evidence->'requested'='true'::jsonb and sms_decision.evidence->'marketingConsent'='false'::jsonb
    and ((sms_decision.source='member' and sms_decision.policy_version=${MEMBER_COMMUNICATION_NOTICE_VERSION}
      and sms_decision.evidence->>'action'='sms_checkbox_checked'
      and sms_decision.evidence->>'termsVersion'=${MEMBER_SMS_TERMS_VERSION})
    or (sms_decision.source='ops' and sms_decision.policy_version=${MEMBER_SMS_OPERATOR_ATTESTATION_VERSION}
      and sms_decision.evidence->>'action'=${MEMBER_SMS_OPERATOR_ATTESTATION_ACTION}
      and sms_decision.evidence->'operatorApproved'='true'::jsonb
      and sms_decision.evidence->'permissionConfirmed'='true'::jsonb
      and sms_decision.evidence->'memberAffirmed'='false'::jsonb
      and jsonb_typeof(sms_decision.evidence->'approvalReference')='string'
      and char_length(sms_decision.evidence->>'approvalReference') between 1 and 500
      and sms_decision.evidence->>'approvalReference' ~ '[^[:space:]]'
      and jsonb_typeof(sms_decision.evidence->'permissionStatement')='string'
      and char_length(sms_decision.evidence->>'permissionStatement') between 1 and 1000
      and sms_decision.evidence->>'permissionStatement' ~ '[^[:space:]]'
      and sms_decision.evidence->>'batchId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      and (sms_decision.evidence->'originalConsentId'='null'::jsonb
        or (jsonb_typeof(sms_decision.evidence->'originalConsentId')='string'
          and sms_decision.evidence->>'originalConsentId' ~ '^[1-9][0-9]*$'))))) is true`;
}
