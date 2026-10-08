import "server-only";

import twilio from "twilio";
import type { Sql } from "postgres";
import { readMemberSmsConfiguration } from "./member-sms-config";
import { MEMBER_COMMUNICATION_NOTICE_VERSION } from "../membership/member-communication-preferences-model";

const rank = { queued: 1, sending: 2, sent: 3, failed: 4, undelivered: 4, delivered: 5 } as const;
type DeliveryStatus = keyof typeof rank;
export type MemberSmsDeliveryStatus = {
  attemptId: string; messageSid: string; destination: string; status: DeliveryStatus; errorCode: number | null;
};

/** A signed per-attempt URL correlates callbacks even after an ambiguous timeout. */
export function verifyMemberSmsDeliveryStatus(rawBody: string, signature: string | null, attemptId: string): MemberSmsDeliveryStatus {
  const config = readMemberSmsConfiguration();
  if (!config.webhookReady || !config.statusUrl || !signature
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)) throw new Error("Invalid SMS delivery callback.");
  const params: Record<string, string> = Object.create(null);
  for (const [key, value] of new URLSearchParams(rawBody)) {
    if (Object.hasOwn(params, key)) throw new Error("Invalid SMS delivery callback.");
    params[key] = value;
  }
  const status = params.MessageStatus;
  const errorCode = params.ErrorCode ? Number(params.ErrorCode) : null;
  if (!twilio.validateRequest(config.authToken, signature, `${config.statusUrl}?attempt=${attemptId}`, params)
    || params.AccountSid !== config.accountSid || params.From !== config.phoneNumber
    || (params.MessagingServiceSid && params.MessagingServiceSid !== config.messagingServiceSid)
    || !/^SM[0-9a-f]{32}$/i.test(params.MessageSid ?? "")
    || !/^[+][1-9][0-9]{1,14}$/.test(params.To ?? "")
    || !Object.hasOwn(rank, status ?? "")
    || (errorCode !== null && (!Number.isInteger(errorCode) || errorCode < 10000 || errorCode > 99999))) {
    throw new Error("Invalid SMS delivery callback.");
  }
  return { attemptId, messageSid: params.MessageSid, destination: params.To, status: status as DeliveryStatus, errorCode };
}

/** Replayed/out-of-order callbacks cannot move a message backwards or resend it. */
export async function applyMemberSmsDeliveryStatus(sql: Sql, event: MemberSmsDeliveryStatus): Promise<{ matched: boolean; changed: boolean }> {
  return await sql.begin(async tx => {
    // Follow transport/STOP lock order: phone, member/profile, then attempt.
    await tx`select pg_advisory_xact_lock(hashtext(${event.destination}), 8123)`;
    const terminalOptOut = event.errorCode === 21610 && (event.status === "failed" || event.status === "undelivered");
    const members = terminalOptOut ? await tx<Array<{ id: string }>>`
      select member.id from ruined_members member join person_private_profiles profile on profile.person_id=member.person_id
      where profile.mobile_e164=${event.destination} order by member.id
      for no key update of member for share of profile` : [];
    const [attempt] = await tx<Array<{ status: string; messageSid: string | null; destination: string; deliveryStatus: DeliveryStatus | null; optOutRecorded: boolean }>>`
      select status,twilio_message_sid as "messageSid",destination_e164 as destination,delivery_status as "deliveryStatus",delivery_opt_out_recorded_at is not null as "optOutRecorded"
      from private.member_sms_delivery_attempts where id=${event.attemptId}::uuid for update`;
    if (!attempt || attempt.status === "blocked" || attempt.destination !== event.destination
      || (attempt.messageSid && attempt.messageSid !== event.messageSid)) return { matched: false, changed: false };
    const currentRank = attempt.deliveryStatus ? rank[attempt.deliveryStatus] : 0;
    const advanced = rank[event.status] > currentRank;
    const recordOptOut = terminalOptOut && !attempt.optOutRecorded;
    if (!advanced && !recordOptOut) return { matched: true, changed: false };
    if (advanced) await tx`update private.member_sms_delivery_attempts set status='accepted',twilio_message_sid=${event.messageSid},
      delivery_status=${event.status},delivery_error_code=${event.errorCode},delivery_updated_at=statement_timestamp(),updated_at=statement_timestamp()
      where id=${event.attemptId}::uuid`;
    if (recordOptOut) {
      // A terminal callback may arrive twice, first without its error code.
      // Definitive opt-out evidence applies even when delivery rank is unchanged.
      await tx`update private.member_sms_delivery_attempts set delivery_opt_out_recorded_at=statement_timestamp(),
        delivery_error_code=case when delivery_status='delivered' then delivery_error_code else 21610 end,updated_at=statement_timestamp()
        where id=${event.attemptId}::uuid`;
      await tx`insert into private.member_sms_phone_suppressions(phone_e164,source,provider_attempt_id)
        values(${event.destination},'provider_opt_out',${event.attemptId}::uuid)
        on conflict(phone_e164) do nothing`;
      // A late callback must not revoke consent for a member's new phone.
      for (const member of members) {
        await tx`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,evidence,dedupe_key)
          values(${member.id}::uuid,'communications',${MEMBER_COMMUNICATION_NOTICE_VERSION},'withdrawn',statement_timestamp(),'ops',
            ${tx.json({ context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "sms", destination: event.destination,
              requested: false, marketingConsent: false, action: "twilio_provider_opt_out", providerErrorCode: 21610 })}::jsonb,
            ${`member-sms-delivery-opt-out:${event.attemptId}:${member.id}`}) on conflict(dedupe_key) do nothing`;
      }
    }
    return { matched: true, changed: true };
  });
}
