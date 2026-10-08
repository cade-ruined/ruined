import "server-only";

import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { MEMBER_COMMUNICATION_NOTICE_VERSION, MEMBER_SMS_TERMS_VERSION } from "../membership/member-communication-preferences-model";
import type { MemberSmsBlockedReason, MemberSmsInbound, MemberSmsReminder, MemberSmsSendResult } from "./member-sms-model";

const CONTEXT = "member_communication_preferences_v1";
const phonePattern = /^[+][1-9][0-9]{1,14}$/;
type Eligible = { phone: string; consentId: string };
type Gate = Eligible | { reason: MemberSmsBlockedReason };
export type MemberSmsDispatchOptions = { guard?: (tx: TransactionSql) => Promise<boolean> };
type Reservation = { attemptId: string; phone: string; consentId: string };

async function lockPhone(tx: TransactionSql, phone: string) {
  await tx`select pg_advisory_xact_lock(hashtext(${phone}), 8123)`;
}

/** Lock order is phone, member, lifecycle, then profile. No network operation precedes this gate. */
async function eligibleMember(tx: TransactionSql, input: MemberSmsReminder, lockedPhone: string): Promise<Gate> {
  const memberId = input.memberId;
  const confirmation = input.kind === "opt_in_confirmation";
  const [member] = await tx<Array<{ personId: string | null; state: string; deleted: boolean }>>`
    select person_id as "personId",membership_state as state,deleted_at is not null as deleted from ruined_members where id=${memberId}::uuid for no key update`;
  if (!member || member.deleted || (!confirmation && member.state !== "active")) return { reason: "member_inactive" };
  const [lifecycle] = await tx<Array<{ accountState: string }>>`select account_state as "accountState"
    from member_lifecycle where member_id=${memberId}::uuid for share`;
  if (!lifecycle || !(confirmation ? ["provisional", "invited", "active"] : ["active"]).includes(lifecycle.accountState)) return { reason: "member_inactive" };
  if (!member.personId) return { reason: "phone_missing" };
  const [profile] = await tx<Array<{ phone: string | null }>>`select mobile_e164 as phone
    from person_private_profiles where person_id=${member.personId}::uuid for share`;
  const phone = profile?.phone;
  if (!phone || !phonePattern.test(phone)) return { reason: "phone_missing" };
  if (phone !== lockedPhone) return { reason: "no_current_consent" };
  const [suppressed] = await tx`select 1 from private.member_sms_phone_suppressions where phone_e164=${phone}`;
  if (suppressed) return { reason: "phone_suppressed" };
  // Inspect the latest decision first. Filtering accepted/v2 before ordering
  // would let an older opt-in override a withdrawal or invalidation.
  const [consent] = await tx<Array<{ id: string; allowed: boolean }>>`
    select id::text, (decision='accepted' and policy_version=${MEMBER_COMMUNICATION_NOTICE_VERSION}
      and source='member' and actor_auth_user_id is not null
      and evidence->>'destination'=${phone} and evidence->>'requested'='true'
      and evidence->>'action'='sms_checkbox_checked' and evidence->>'marketingConsent'='false'
      and evidence->>'termsVersion'=${MEMBER_SMS_TERMS_VERSION}) as allowed
    from member_consents where member_id=${memberId}::uuid and consent_type='communications'
      and evidence->>'context'=${CONTEXT} and evidence->>'purpose'='membership_updates'
      and evidence->>'channel'='sms' order by id desc limit 1`;
  if (!consent?.allowed || (input.expectedConsentId !== undefined && consent.id !== input.expectedConsentId)
    || (confirmation && (!/^[1-9][0-9]*$/.test(input.expectedConsentId ?? "") || input.reminderKey !== `consent:${input.expectedConsentId}`))) return { reason: "no_current_consent" };
  return { phone, consentId: consent.id };
}

/** A committed dispatching reservation is never automatically resumed or reclaimed. */
export async function reserveMemberSmsAttempt(sql: Sql, input: MemberSmsReminder, body: string, options: MemberSmsDispatchOptions = {}): Promise<Reservation | MemberSmsSendResult> {
  return await sql.begin(async tx => {
    await tx`set local lock_timeout='3s'`;
    await tx`set local statement_timeout='10s'`;
    const [profile] = await tx<Array<{ phone: string | null }>>`select profile.mobile_e164 as phone
      from ruined_members member left join person_private_profiles profile on profile.person_id=member.person_id
      where member.id=${input.memberId}::uuid`;
    const phone = profile?.phone;
    if (!phone || !phonePattern.test(phone)) return { status: "blocked" as const, reason: "phone_missing" as const };
    await lockPhone(tx, phone);
    const gate = await eligibleMember(tx, input, phone);
    if ("reason" in gate) return { status: "blocked" as const, reason: gate.reason };
    if (options.guard && !await options.guard(tx)) return { status: "blocked" as const, reason: "source_ineligible" as const };
    const digest = createHash("sha256").update(body, "utf8").digest("hex");
    const [attempt] = await tx<Array<{ id: string }>>`insert into private.member_sms_delivery_attempts
      (member_id,reminder_key,reminder_kind,destination_e164,consent_id,body_sha256)
      values(${input.memberId}::uuid,${input.reminderKey},${input.kind},${phone},${gate.consentId}::bigint,${digest})
      on conflict(member_id,reminder_kind,reminder_key) do nothing returning id`;
    if (!attempt) {
      const [existing] = await tx<Array<{ id: string }>>`select id from private.member_sms_delivery_attempts
        where member_id=${input.memberId}::uuid and reminder_kind=${input.kind} and reminder_key=${input.reminderKey}`;
      if (!existing) throw new Error("SMS delivery reservation unavailable.");
      return { status: "duplicate" as const, attemptId: existing.id };
    }
    return { attemptId: attempt.id, phone, consentId: gate.consentId };
  });
}

/**
 * Recheck consent at dispatch while STOP and contact edits are locked out.
 * A crash/DB rollback after Twilio accepted leaves the prior durable dispatching
 * reservation intact, so retries cannot issue another billable request.
 */
export async function dispatchReservedMemberSms(sql: Sql, input: MemberSmsReminder, reservation: Reservation,
  send: (phone: string) => Promise<string>, options: MemberSmsDispatchOptions = {}): Promise<MemberSmsSendResult> {
  return await sql.begin(async tx => {
    await tx`set local lock_timeout='3s'`;
    await tx`set local statement_timeout='10s'`;
    await lockPhone(tx, reservation.phone);
    const gate = await eligibleMember(tx, input, reservation.phone);
    const [attempt] = await tx<Array<{ status: string }>>`select status from private.member_sms_delivery_attempts
      where id=${reservation.attemptId}::uuid for update`;
    if (attempt?.status !== "dispatching") return { status: "duplicate" as const, attemptId: reservation.attemptId };
    const sourceAllowed = !("reason" in gate) && (!options.guard || await options.guard(tx));
    const blocked = "reason" in gate ? gate.reason : gate.consentId !== reservation.consentId ? "no_current_consent" : !sourceAllowed ? "source_ineligible" : null;
    if (blocked) {
      await tx`update private.member_sms_delivery_attempts set status='blocked',blocked_reason=${blocked},updated_at=statement_timestamp()
        where id=${reservation.attemptId}::uuid`;
      return { status: "blocked" as const, reason: blocked };
    }
    let messageSid: string;
    try {
      messageSid = await send(reservation.phone);
      if (!/^SM[0-9a-f]{32}$/i.test(messageSid)) throw new Error("Invalid SMS provider response.");
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === 21610) {
        // Twilio's definitive opted-out response is number-level evidence even
        // when the original STOP webhook never reached this application.
        await tx`insert into private.member_sms_phone_suppressions(phone_e164,source,provider_attempt_id)
          values(${reservation.phone},'provider_opt_out',${reservation.attemptId}::uuid)
          on conflict(phone_e164) do update set stopped_at=statement_timestamp(),source='provider_opt_out',
            latest_message_sid=null,provider_attempt_id=excluded.provider_attempt_id`;
        await tx`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,evidence,dedupe_key)
          values(${input.memberId}::uuid,'communications',${MEMBER_COMMUNICATION_NOTICE_VERSION},'withdrawn',statement_timestamp(),'ops',
            ${tx.json({ context: CONTEXT, purpose: "membership_updates", channel: "sms", destination: reservation.phone,
              requested: false, marketingConsent: false, action: "twilio_provider_opt_out", providerErrorCode: 21610 })}::jsonb,
            ${`member-sms-provider-opt-out:${reservation.attemptId}`}) on conflict(dedupe_key) do nothing`;
        await tx`update private.member_sms_delivery_attempts set status='blocked',blocked_reason='phone_suppressed',updated_at=statement_timestamp()
          where id=${reservation.attemptId}::uuid`;
        return { status: "blocked" as const, reason: "phone_suppressed" as const };
      }
      // Never retain provider error text, which can contain credentials, bodies,
      // or phone numbers. Every uncertain outcome remains permanently blocked.
      await tx`update private.member_sms_delivery_attempts set status='unknown',updated_at=statement_timestamp()
        where id=${reservation.attemptId}::uuid`;
      return { status: "unknown" as const, attemptId: reservation.attemptId };
    }
    await tx`update private.member_sms_delivery_attempts set status='accepted',twilio_message_sid=${messageSid},updated_at=statement_timestamp()
      where id=${reservation.attemptId}::uuid`;
    return { status: "accepted" as const, attemptId: reservation.attemptId, messageSid };
  });
}

export async function applyMemberSmsInbound(sql: Sql, inbound: MemberSmsInbound): Promise<{ duplicate: boolean }> {
  return await sql.begin(async tx => {
    const [receipt] = await tx`insert into private.member_sms_inbound_receipts(message_sid,event_kind)
      values(${inbound.messageSid},${inbound.kind}) on conflict(message_sid) do nothing returning message_sid`;
    if (!receipt) return { duplicate: true };
    if (inbound.kind !== "STOP") return { duplicate: false };
    await lockPhone(tx, inbound.phone);
    await tx`insert into private.member_sms_phone_suppressions(phone_e164,latest_message_sid)
      values(${inbound.phone},${inbound.messageSid}) on conflict(phone_e164) do update
      set stopped_at=statement_timestamp(),source='inbound_stop',provider_attempt_id=null,latest_message_sid=excluded.latest_message_sid`;
    const members = await tx<Array<{ id: string }>>`select member.id from ruined_members member
      join person_private_profiles profile on profile.person_id=member.person_id
      where profile.mobile_e164=${inbound.phone} order by member.id
      for no key update of member for share of profile`;
    for (const member of members) {
      await tx`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,evidence,dedupe_key)
        values(${member.id}::uuid,'communications',${MEMBER_COMMUNICATION_NOTICE_VERSION},'withdrawn',statement_timestamp(),'ops',
          ${tx.json({ context: CONTEXT, purpose: "membership_updates", channel: "sms", destination: inbound.phone,
            requested: false, marketingConsent: false, action: "twilio_stop", messageSid: inbound.messageSid })}::jsonb,
          ${`member-sms-stop:${inbound.messageSid}:${member.id}`}) on conflict(dedupe_key) do nothing`;
    }
    // START is acknowledged and recorded, but cannot order safely against STOP
    // from signed timeless webhooks or create a fresh web checkbox consent.
    return { duplicate: false };
  });
}
