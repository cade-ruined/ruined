import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import type { MemberRegistrationSnapshot, OpsMemberRegistration, RegistrationFoundingPricing } from "./registration-model";

export class MemberRegistrationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MemberRegistrationError";
  }
}

type RegistrationRow = {
  member_id: string; registered_at: Date | string | null; profile_activated_at: Date | string | null;
  founding_pricing: RegistrationFoundingPricing | null;
  complimentary: boolean; profile_complete: boolean; ready: boolean; version: number | string;
};
const iso = (date: Date | string | null) => date ? new Date(date).toISOString() : null;
const snapshot = (row: RegistrationRow): MemberRegistrationSnapshot => ({
  memberId: row.member_id, state: row.profile_activated_at ? "activated" : row.registered_at ? "registered" : "collecting",
  foundingPricing: row.founding_pricing ?? null,
  registeredAt: iso(row.registered_at), profileActivatedAt: iso(row.profile_activated_at),
  requiresPaymentMethod: !row.complimentary, profileComplete: row.profile_complete, ready: row.ready, version: Number(row.version),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(id: string) { if (!UUID.test(id)) throw new MemberRegistrationError(400, "Choose a valid member."); }

/** Call only in the branch that INSERTs a new member. Never backfill returning accounts. */
export async function enrollNewMemberRegistration(tx: TransactionSql, memberId: string): Promise<void> {
  if (!getPlatformConfiguration().membershipRegistrationOnly) return;
  const configuredAccount = process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() || "";
  const keyMode = process.env.STRIPE_SECRET_KEY?.trim().match(/^(?:sk|rk)_(test|live)_/)?.[1];
  const accountId = keyMode && /^acct_[A-Za-z0-9]+$/.test(configuredAccount) ? configuredAccount : null;
  await tx`insert into member_registration_access(member_id,payment_setup_account_id,payment_setup_livemode)
    values(${memberId}::uuid,${accountId},${accountId ? keyMode === "live" : null}) on conflict(member_id) do nothing`;
}

async function ownerMemberId(tx: TransactionSql, authUserId: string, allowRestricted = false): Promise<string> {
  validId(authUserId);
  const [row] = await tx<Array<{ id: string }>>`select member.id from platform_users identity
    join ruined_members member on member.person_id=identity.person_id and member.deleted_at is null
      and (identity.member_id is null or identity.member_id=member.id)
    join people person on person.id=member.person_id and person.status='active'
    join member_lifecycle lifecycle on lifecycle.member_id=member.id and (${allowRestricted} or lifecycle.account_state not in ('closed','suspended'))
    join platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
    where identity.auth_user_id=${authUserId}::uuid and identity.status='active' limit 1`;
  if (!row) throw new MemberRegistrationError(403, "Registration is unavailable for this account.");
  return row.id;
}

async function readRegistration(tx: TransactionSql, memberId: string): Promise<MemberRegistrationSnapshot | null> {
  const [row] = await tx<Array<RegistrationRow>>`select registration.*,
    case when private.ruined_registration_founding_pricing_is_current(registration.member_id) then jsonb_build_object(
      'confirmed',true,'awardedAt',pricing.decided_at,'monthlyAmountCents',pricing.monthly_amount_cents,
      'annualAmountCents',pricing.annual_amount_cents,'currency',pricing.currency) end as founding_pricing,
    (private.ruined_member_has_complimentary_funding(registration.member_id) or private.ruined_member_has_operator_funding(registration.member_id)) as complimentary,
    (onboarding.profile_completed_at is not null and private.ruined_registration_legal_complete(registration.member_id)
      and (registration.profile_activated_at is not null
      or private.ruined_registration_intake_eligibility_error(profile.birth_date,
        profile.default_fulfillment_address->>'countryCode') is null)) as profile_complete,
    private.ruined_member_registration_ready(registration.member_id) as ready
    from member_registration_access registration
    join ruined_members member on member.id=registration.member_id
    left join member_registration_pricing_decisions pricing on pricing.member_id=registration.member_id
    left join person_private_profiles profile on profile.person_id=member.person_id
    left join member_onboardings onboarding on onboarding.member_id=registration.member_id
    where registration.member_id=${memberId}::uuid`;
  return row ? snapshot(row) : null;
}

/** Reads do not advance registration or queue messages. */
export async function getMemberRegistration(authUserId: string): Promise<MemberRegistrationSnapshot | null> {
  return getApplicationDatabase().begin(async tx => readRegistration(tx, await ownerMemberId(tx, authUserId, true)));
}

export async function getMemberRegistrationDestination(authUserId: string): Promise<string | null> {
  const registration = await getMemberRegistration(authUserId);
  if (!registration || registration.state === "activated") return null;
  if (!registration.profileComplete) return "/my/join";
  if (!registration.ready && registration.requiresPaymentMethod) return "/my/payment-method";
  return "/my/registered";
}

/** Caller holds funding and member locks, in that order. No billing state changes. */
export async function reconcileMemberRegistration(tx: TransactionSql, memberId: string): Promise<void> {
  // Operator-created complimentary entries can precede payment setup configuration.
  // Bind a previously unset context once, never replace an established mode/account.
  const accountId = process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() || null;
  const keyMode = process.env.STRIPE_SECRET_KEY?.trim().match(/^(?:sk|rk)_(test|live)_/)?.[1];
  if (accountId && keyMode && getPlatformConfiguration().stripePaymentSetupReady) {
    await tx`update member_registration_access set payment_setup_account_id=${accountId},payment_setup_livemode=${keyMode === "live"}
      where member_id=${memberId}::uuid and registered_at is null and payment_setup_account_id is null and payment_setup_livemode is null`;
  }
  const [completed] = await tx<Array<{ member_id: string }>>`update member_registration_access registration
    set registered_at=clock_timestamp(),
      completion_basis=case when private.ruined_member_has_complimentary_funding(registration.member_id)
        or private.ruined_member_has_operator_funding(registration.member_id) then 'complimentary' else 'saved_card' end,
      payment_setup_attempt_id=(select consent_attempt_id from member_payment_method_accounts account
        where account.member_id=registration.member_id and account.stripe_account_id=registration.payment_setup_account_id
          and account.livemode=registration.payment_setup_livemode),
      version=version+1,updated_at=clock_timestamp()
    where member_id=${memberId}::uuid and registered_at is null and private.ruined_member_registration_ready(member_id)
    returning member_id`;
  // The database trigger pins new completions before this point. Reconcile an
  // existing historical completion idempotently without queuing another welcome.
  await tx`select private.ruined_confirm_registration_pricing(${memberId}::uuid)`;
  if (completed) await tx`insert into member_registration_messages(member_id,kind) values(${memberId}::uuid,'welcome')
    on conflict(member_id,kind) do nothing`;
}

async function lockRegistrationMember(tx: TransactionSql, memberId: string) {
  await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`;
  await tx`select id from ruined_members where id=${memberId}::uuid for update`;
}

export async function completeMemberRegistration(authUserId: string): Promise<MemberRegistrationSnapshot | null> {
  try {
    return await getApplicationDatabase().begin(async tx => {
      const memberId = await ownerMemberId(tx, authUserId);
      await lockRegistrationMember(tx, memberId);
      await ownerMemberId(tx, authUserId);
      await reconcileMemberRegistration(tx, memberId);
      return readRegistration(tx, memberId);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P4205") {
      throw new MemberRegistrationError(409, "A Founding place is being confirmed in another checkout. Please try again shortly.");
    }
    throw error;
  }
}

async function requireAdministrator(tx: TransactionSql, actor: string) {
  validId(actor);
  const [authorized] = await tx`select identity.auth_user_id from platform_users identity
    join platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id
      and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
    where identity.auth_user_id=${actor}::uuid and identity.status='active' for share of identity,grant_row`;
  if (!authorized) throw new MemberRegistrationError(403, "Operations administrator access is required.");
}

export async function getOpsMemberRegistration(actor: string, memberId: string) {
  validId(memberId);
  return getApplicationDatabase().begin(async tx => { await requireAdministrator(tx, actor); return readRegistration(tx, memberId); });
}

export async function getOpsMemberRegistrations(actor: string): Promise<OpsMemberRegistration[]> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdministrator(tx, actor);
    const rows = await tx<Array<RegistrationRow & { display_name: string; email: string; welcome_status: string | null; profile_ready_status: string | null;
      couple_partner_email: string | null; couple_partner_member_id: string | null }>>`
      select registration.*,case when private.ruined_registration_founding_pricing_is_current(registration.member_id) then jsonb_build_object(
      'confirmed',true,'awardedAt',pricing.decided_at,'monthlyAmountCents',pricing.monthly_amount_cents,
      'annualAmountCents',pricing.annual_amount_cents,'currency',pricing.currency) end as founding_pricing,
        coalesce(nullif(profile.legal_name,''),nullif(public_profile.display_name,''),member.email) as display_name,member.email,
        (private.ruined_member_has_complimentary_funding(member.id) or private.ruined_member_has_operator_funding(member.id)) as complimentary,
        (onboarding.profile_completed_at is not null and private.ruined_registration_legal_complete(registration.member_id)
      and (registration.profile_activated_at is not null
          or private.ruined_registration_intake_eligibility_error(profile.birth_date,
            profile.default_fulfillment_address->>'countryCode') is null)) as profile_complete,
        private.ruined_member_registration_ready(member.id) as ready,
        welcome.status as welcome_status,ready_message.status as profile_ready_status,
        couple.partner_email_normalized as couple_partner_email,
        private.ruined_registration_circle_couple_partner(member.id) as couple_partner_member_id
      from member_registration_access registration join ruined_members member on member.id=registration.member_id and member.deleted_at is null
      left join member_registration_pricing_decisions pricing on pricing.member_id=registration.member_id
      join member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
      left join member_onboardings onboarding on onboarding.member_id=member.id
      left join person_private_profiles profile on profile.person_id=member.person_id
      left join person_profiles public_profile on public_profile.person_id=member.person_id
      left join member_registration_messages welcome on welcome.member_id=member.id and welcome.kind='welcome'
      left join member_registration_messages ready_message on ready_message.member_id=member.id and ready_message.kind='profile_ready'
      left join member_registration_couple_intents couple on couple.member_id=member.id
      order by registration.profile_activated_at nulls first,registration.created_at desc limit 200`;
    return rows.map(row => ({ ...snapshot(row), name: row.display_name, email: row.email,
      welcomeStatus: row.welcome_status, activationEmailStatus: row.profile_ready_status,
      coupleStatus: row.couple_partner_member_id ? "paired" : row.couple_partner_email ? "pending" : "none",
      couplePartnerEmail: row.couple_partner_email, couplePartnerMemberId: row.couple_partner_member_id }));
  });
}

export async function activateMemberRegistration(actor: string, memberId: string, expectedVersion: number): Promise<MemberRegistrationSnapshot> {
  validId(memberId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MemberRegistrationError(400, "Reload this registration before activating it.");
  return getApplicationDatabase().begin(async tx => {
    await requireAdministrator(tx, actor);
    await lockRegistrationMember(tx, memberId);
    const before = await readRegistration(tx, memberId);
    if (!before) throw new MemberRegistrationError(404, "This member has no registration hold.");
    if (before.state === "activated") return before;
    if (before.version !== expectedVersion) throw new MemberRegistrationError(409, "This registration changed. Reload it before activating.");
    if (!before.registeredAt || !before.ready) throw new MemberRegistrationError(409, "Complete the personal information and required card setup before activation.");
    await tx`update member_registration_access set profile_activated_at=clock_timestamp(),activated_by_auth_user_id=${actor}::uuid,
      version=version+1,updated_at=clock_timestamp() where member_id=${memberId}::uuid`;
    await tx`insert into member_registration_messages(member_id,kind) values(${memberId}::uuid,'profile_ready') on conflict(member_id,kind) do nothing`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,before_snapshot,after_snapshot,metadata,dedupe_key)
      values(${actor}::uuid,'member.profile_activated','member',${memberId},${tx.json(before)},
        '{"profileActivated":true,"billingChanged":false}'::jsonb,'{}'::jsonb,${`registration-activation:${memberId}`})`;
    return (await readRegistration(tx, memberId))!;
  });
}
