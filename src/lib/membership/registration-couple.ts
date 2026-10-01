import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";

export type RegistrationCouple = {
  status: "none" | "pending" | "paired";
  /** Only the address this member entered, never a discovered account detail. */
  partnerEmail: string | null;
};

export class RegistrationCoupleError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalizePartnerEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) {
    throw new RegistrationCoupleError(400, "Enter your partner’s email address.");
  }
  return email;
}

async function owner(tx: TransactionSql, authUserId: string) {
  if (!UUID.test(authUserId)) throw new RegistrationCoupleError(403, "Verify your member email to manage your registration.");
  const [row] = await tx<Array<{ member_id: string; email: string; profile_complete: boolean; eligibility_error: string | null }>>`
    select member.id as member_id, member.email_normalized as email,
      onboarding.profile_completed_at is not null as profile_complete,
      private.ruined_registration_intake_eligibility_error(profile.birth_date,
        profile.default_fulfillment_address->>'countryCode') as eligibility_error
    from platform_users identity
    join ruined_members member on member.person_id=identity.person_id and member.deleted_at is null
      and (identity.member_id is null or identity.member_id=member.id) and identity.email_normalized=member.email_normalized
    join member_registration_access registration on registration.member_id=member.id
    join people person on person.id=member.person_id and person.status='active'
    join member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
    join person_email_addresses email on email.person_id=member.person_id and email.email_normalized=member.email_normalized
      and email.verification_state='verified' and email.retired_at is null
    join platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id
      and grant_row.role_slug='member' and grant_row.revoked_at is null
    left join member_onboardings onboarding on onboarding.member_id=member.id
    left join person_private_profiles profile on profile.person_id=member.person_id
    where identity.auth_user_id=${authUserId}::uuid and identity.status='active'
  `;
  if (!row) throw new RegistrationCoupleError(403, "Verify your member email to manage your registration.");
  return row;
}

async function read(tx: TransactionSql, memberId: string): Promise<RegistrationCouple> {
  const [row] = await tx<Array<{ partner_email_normalized: string; paired: boolean }>>`
    select intent.partner_email_normalized,
      private.ruined_registration_circle_couple_partner(intent.member_id) is not null as paired
    from member_registration_couple_intents intent where member_id=${memberId}::uuid
  `;
  return row ? { status: row.paired ? "paired" : "pending", partnerEmail: row.partner_email_normalized }
    : { status: "none", partnerEmail: null };
}

export async function getRegistrationCouple(authUserId: string) {
  return getApplicationDatabase().begin(async tx => read(tx, (await owner(tx, authUserId)).member_id));
}

export async function saveRegistrationCouple(authUserId: string, partnerEmail: string) {
  const email = normalizePartnerEmail(partnerEmail);
  return getApplicationDatabase().begin(async tx => {
    const member = await owner(tx, authUserId);
    if (!member.profile_complete) throw new RegistrationCoupleError(409, "Save your personal information before linking your registrations.");
    if (member.eligibility_error) throw new RegistrationCoupleError(400, member.eligibility_error);
    if (member.email === email) throw new RegistrationCoupleError(400, "Use your partner’s email, not your own.");
    // The database trigger locks both identities, validates consent, and refuses
    // to change a confirmed pair. A missing recipient remains an ordinary pending
    // request; registration does not send an unsolicited partner invitation.
    await tx`insert into member_registration_couple_intents(member_id,partner_email_normalized,consented_by_auth_user_id)
      values(${member.member_id}::uuid,${email},${authUserId}::uuid)
      on conflict(member_id) do update set partner_email_normalized=excluded.partner_email_normalized,
        consented_by_auth_user_id=excluded.consented_by_auth_user_id,updated_at=clock_timestamp()`;
    return read(tx, member.member_id);
  });
}

export async function clearRegistrationCouple(authUserId: string) {
  return getApplicationDatabase().begin(async tx => {
    const member = await owner(tx, authUserId);
    await tx`delete from member_registration_couple_intents where member_id=${member.member_id}::uuid`;
    return { status: "none", partnerEmail: null } satisfies RegistrationCouple;
  });
}
