import "server-only";

import parsePhoneNumber from "libphonenumber-js/min";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberCommunicationPreferences, saveMemberCommunicationPreferences, MemberCommunicationPreferencesError } from "./member-communication-preferences";
import { MEMBER_COMMUNICATION_NOTICE_VERSION } from "./member-communication-preferences-model";

export type MemberSmsPreferenceSnapshot = { phone: string | null; sms: boolean | null; revision: string; noticeVersion: string };
type Member = { memberId: string; personId: string; authUserId: string; email: string; phone: string | null };

async function memberForPreferences(tx: TransactionSql, actor: string): Promise<Member> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor)) {
    throw new MemberCommunicationPreferencesError(403, "Member access is required.");
  }
  const [owner] = await tx<Array<{ memberId: string }>>`select member.id as "memberId" from ruined_members member
    join platform_users account on account.person_id=member.person_id
      and (account.member_id is null or account.member_id=member.id)
    where account.auth_user_id=${actor}::uuid`;
  if (!owner) throw new MemberCommunicationPreferencesError(403, "Member access is required.");
  // Match onboarding/profile lock order before changing their shared phone field.
  // NO KEY UPDATE remains compatible with the phone trigger's consent FK check.
  await tx`select pg_advisory_xact_lock(hashtext(${owner.memberId}), 41)`;
  await tx`select pg_advisory_xact_lock(hashtext(${owner.memberId}), 44)`;
  await tx`select id from ruined_members where id=${owner.memberId}::uuid for no key update`;
  const [member] = await tx<Array<Omit<Member, "phone">>>`
    select member.id as "memberId",member.person_id as "personId",account.auth_user_id as "authUserId",member.email_normalized as email
    from ruined_members member join people person on person.id=member.person_id and person.status='active'
    join platform_users account on account.person_id=member.person_id and account.status='active'
      and (account.member_id is null or account.member_id=member.id) and account.email_normalized=member.email_normalized
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id
      and grant_row.role_slug='member' and grant_row.revoked_at is null
    join member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('suspended','closed')
    where account.auth_user_id=${actor}::uuid and member.id=${owner.memberId}::uuid and member.deleted_at is null
    for share of person,account,grant_row,lifecycle`;
  if (!member) throw new MemberCommunicationPreferencesError(403, "Member access is required.");
  const verified = await tx`select email_normalized from person_email_addresses
    where person_id=${member.personId}::uuid and email_normalized=${member.email}
      and verification_state='verified' and retired_at is null for share`;
  if (!verified.length) throw new MemberCommunicationPreferencesError(403, "Verify your email before changing text preferences.");
  const [profile] = await tx<Array<{ phone: string | null }>>`select mobile_e164 as phone from person_private_profiles
    where person_id=${member.personId}::uuid for update`;
  return { ...member, phone: profile?.phone ?? null };
}

async function snapshot(tx: TransactionSql, member: Member): Promise<MemberSmsPreferenceSnapshot> {
  const value = await getMemberCommunicationPreferences(tx, member.memberId, member);
  return { phone: member.phone, sms: value.sms, revision: value.revision, noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION };
}

export function getMemberSmsPreference(actor: string): Promise<MemberSmsPreferenceSnapshot> {
  return getApplicationDatabase().begin(async tx => snapshot(tx, await memberForPreferences(tx, actor)));
}

export function saveMemberSmsPreference(actor: string, value: unknown): Promise<MemberSmsPreferenceSnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberCommunicationPreferencesError(400, "Choose your text message preference.");
  const input = value as Record<string, unknown>;
  if (typeof input.phone !== "string" || input.phone.length > 64 || typeof input.sms !== "boolean"
    || typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision)
    || typeof input.noticeVersion !== "string" || input.noticeVersion.length > 80
    || Object.keys(input).some(key => !["phone", "sms", "expectedRevision", "noticeVersion", "smsOptIn"].includes(key))) {
    throw new MemberCommunicationPreferencesError(400, "Check your phone number and text preference.");
  }
  const phone = input.phone.trim();
  const parsed = phone.startsWith("+") ? parsePhoneNumber(phone, { extract: false }) : undefined;
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone) || !parsed?.isPossible() || parsed.ext || parsed.number !== phone) {
    throw new MemberCommunicationPreferencesError(400, "Use a complete mobile number with country code.");
  }
  if (input.smsOptIn !== undefined && (!input.smsOptIn || typeof input.smsOptIn !== "object" || Array.isArray(input.smsOptIn)
    || typeof (input.smsOptIn as Record<string, unknown>).phone !== "string"
    || Object.keys(input.smsOptIn).some(key => key !== "phone"))) {
    throw new MemberCommunicationPreferencesError(400, "Select text messages again to confirm this phone number.", "sms_opt_in_required");
  }
  const smsOptIn = input.smsOptIn as { phone: string } | undefined;
  // The standalone form always starts unchecked. A saved choice is never evidence
  // of a new affirmative action, even when submitting the same current number.
  if (input.sms && smsOptIn?.phone !== phone) {
    throw new MemberCommunicationPreferencesError(400, "Select text messages again to confirm this phone number.", "sms_opt_in_required");
  }
  const { sms, expectedRevision, noticeVersion } = input;
  return getApplicationDatabase().begin(async tx => {
    const member = await memberForPreferences(tx, actor);
    // Consent must precede the phone upsert so the existing trigger recognizes
    // only this transaction's explicit acceptance for a changed number.
    await saveMemberCommunicationPreferences(tx, { ...member, phone },
      { email: false, sms, expectedRevision, noticeVersion, ...(smsOptIn ? { smsOptIn } : {}) }, { smsOnly: true });
    await tx`insert into person_private_profiles(person_id,mobile_e164) values(${member.personId}::uuid,${phone})
      on conflict(person_id) do update set mobile_e164=excluded.mobile_e164,updated_at=statement_timestamp()
      where person_private_profiles.mobile_e164 is distinct from excluded.mobile_e164`;
    return snapshot(tx, { ...member, phone });
  });
}
