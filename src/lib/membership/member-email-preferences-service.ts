import "server-only";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberCommunicationPreferences, saveMemberCommunicationPreferences, MemberCommunicationPreferencesError } from "./member-communication-preferences";
import { MEMBER_COMMUNICATION_NOTICE_VERSION } from "./member-communication-preferences-model";

export type MemberEmailPreferenceSnapshot = { email: boolean | null; revision: string; noticeVersion: string };
type Member = { memberId: string; personId: string; authUserId: string; email: string; phone: string | null };
async function memberForPreferences(tx: TransactionSql, actor: string): Promise<Member> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor)) {
    throw new MemberCommunicationPreferencesError(403, "Member access is required.");
  }
  // Preference withdrawal remains available regardless of billing or programme state.
  // The same member lock is held by reminder dispatch and other preference writers.
  const [member] = await tx<Array<Omit<Member, "phone">>>`
    select member.id as "memberId",member.person_id as "personId",account.auth_user_id as "authUserId",member.email_normalized as email
    from ruined_members member join people person on person.id=member.person_id and person.status='active'
    join platform_users account on account.person_id=member.person_id and account.status='active'
      and (account.member_id is null or account.member_id=member.id) and account.email_normalized=member.email_normalized
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id
      and grant_row.role_slug='member' and grant_row.revoked_at is null
    where account.auth_user_id=${actor}::uuid and member.deleted_at is null
    for update of member for share of person,account,grant_row`;
  if (!member) throw new MemberCommunicationPreferencesError(403, "Member access is required.");
  const verified = await tx`select email_normalized from person_email_addresses
    where person_id=${member.personId}::uuid and email_normalized=${member.email}
      and verification_state='verified' and retired_at is null for share`;
  if (!verified.length) throw new MemberCommunicationPreferencesError(403, "Verify your email before changing reminder preferences.");
  const [profile] = await tx<Array<{ phone: string | null }>>`select mobile_e164 as phone from person_private_profiles
    where person_id=${member.personId}::uuid for share`;
  return { ...member, phone: profile?.phone ?? null };
}
function snapshot(value: { email: boolean | null; revision: string }): MemberEmailPreferenceSnapshot {
  return { email: value.email, revision: value.revision, noticeVersion: MEMBER_COMMUNICATION_NOTICE_VERSION };
}
export function getMemberEmailPreference(actor: string): Promise<MemberEmailPreferenceSnapshot> {
  return getApplicationDatabase().begin(async tx => {
    const member = await memberForPreferences(tx, actor);
    return snapshot(await getMemberCommunicationPreferences(tx, member.memberId, member));
  });
}
export function saveMemberEmailPreference(actor: string, value: unknown): Promise<MemberEmailPreferenceSnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberCommunicationPreferencesError(400, "Choose your email reminder preference.");
  const input = value as Record<string, unknown>;
  if (typeof input.email !== "boolean" || typeof input.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedRevision)
    || typeof input.noticeVersion !== "string" || Object.keys(input).some(key => !["email", "expectedRevision", "noticeVersion"].includes(key))) {
    throw new MemberCommunicationPreferencesError(400, "Choose your email reminder preference.");
  }
  const { email, expectedRevision, noticeVersion } = input;
  return getApplicationDatabase().begin(async tx => {
    const member = await memberForPreferences(tx, actor);
    await saveMemberCommunicationPreferences(tx, { ...member, phone: member.phone ?? "" },
      { email, sms: false, expectedRevision, noticeVersion }, { emailOnly: true });
    return snapshot(await getMemberCommunicationPreferences(tx, member.memberId, member));
  });
}
