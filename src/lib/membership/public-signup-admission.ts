import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { ensurePersonForEmail, markPersonEmailVerified, PersonIdentityConflictError } from "@/lib/identity/repository";
import { isMembershipBillingPlan, type MembershipBillingPlan } from "@/lib/membership/pricing";
import type { PlatformViewer } from "@/lib/platform/model";

export class PublicMembershipSignupDeniedError extends Error {
  constructor() { super("Membership signup is unavailable for this identity."); this.name = "PublicMembershipSignupDeniedError"; }
}
const deny = (): never => { throw new PublicMembershipSignupDeniedError(); };

/** Public signup never restores deliberately withdrawn access. Rechecked under locks at claim. */
export async function getPublicMembershipSignupEligibility(email: string): Promise<boolean> {
  const sql = getApplicationDatabase();
  const normalized = email.trim().toLowerCase();
  const [row] = await sql<Array<{ eligible: boolean }>>`select
    not exists (select 1 from platform_users u where u.email_normalized = ${normalized}
      and (u.status in ('disabled', 'suspended') or (
        exists(select 1 from platform_role_grants g where g.auth_user_id = u.auth_user_id and g.role_slug = 'member' and g.revoked_at is not null)
        and not exists(select 1 from platform_role_grants g where g.auth_user_id = u.auth_user_id and g.role_slug = 'member' and g.revoked_at is null))))
    and not exists (select 1 from ruined_members m left join member_lifecycle l on l.member_id = m.id
      where (m.email_normalized = ${normalized} or m.person_id in (
        select person_id from person_email_addresses where email_normalized = ${normalized} and retired_at is null))
      and (m.deleted_at is not null or l.account_state in ('suspended', 'closed') or l.admission_state in ('declined', 'withdrawn')))
    and not exists (select 1 from people p where p.status <> 'active' and (
      p.id in (select person_id from person_email_addresses where email_normalized = ${normalized} and retired_at is null)
      or p.id in (select person_id from platform_users where email_normalized = ${normalized}))) as eligible`;
  return row?.eligible === true;
}

/** Hashes only for abuse prevention; raw IP and email are never retained here. */
export async function consumePublicMembershipSignupRateLimit(email: string, request: Request): Promise<boolean> {
  const sql = getApplicationDatabase();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const fingerprints = [createHash("sha256").update(`member-signup:email:${email.trim().toLowerCase()}`).digest("hex"),
    createHash("sha256").update(`member-signup:ip:${ip}`).digest("hex")];
  return sql.begin(async tx => {
    await tx`delete from member_signup_rate_limits where window_started_at < now() - interval '48 hours'`;
    for (const fingerprint of fingerprints.sort()) {
      const rows = await tx<Array<{ attempts: number }>>`insert into member_signup_rate_limits(fingerprint_hash,window_started_at,attempts)
        values(${fingerprint}, date_trunc('hour',now()),1)
        on conflict(fingerprint_hash,window_started_at) do update set attempts = member_signup_rate_limits.attempts + 1
        where member_signup_rate_limits.attempts < 8 returning attempts`;
      if (!rows.length) return false;
    }
    return true;
  });
}

/** Call only after provider verification. Active account means entry access, never paid membership. */
export async function claimPublicMembershipSignup(viewer: PlatformViewer, plan: MembershipBillingPlan): Promise<void> {
  if (!isMembershipBillingPlan(plan)) deny();
  const email = viewer.email.trim().toLowerCase();
  const sql = getApplicationDatabase();
  try {
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${email}), 1)`;
      const links = await tx<Array<{ auth_user_id: string; email_normalized: string; person_id: string | null; member_id: string | null; status: string }>>`
        select auth_user_id,email_normalized,person_id,member_id,status from platform_users
        where auth_user_id = ${viewer.authUserId}::uuid or email_normalized = ${email} order by auth_user_id for update`;
      if (links.length > 1) deny();
      const link = links[0];
      if (link && (link.auth_user_id !== viewer.authUserId || link.email_normalized !== email || !['active','invited'].includes(link.status))) deny();
      const grants = await tx<Array<{ revoked_at: Date | null }>>`select revoked_at from platform_role_grants
        where auth_user_id = ${viewer.authUserId}::uuid and role_slug = 'member' for update`;
      if (grants.some(g => g.revoked_at) && !grants.some(g => !g.revoked_at)) deny();

      const personId = await ensurePersonForEmail(tx, { email, emailNormalized: email, preferredPersonId: link?.person_id,
        source: 'platform_auth', verified: true });
      const [person] = await tx<Array<{ status: string }>>`select status from people where id = ${personId}::uuid for update`;
      if (!person || person.status !== 'active') deny();
      const members = await tx<Array<{ id: string; person_id: string; email_normalized: string; membership_state: string; deleted_at: Date | null }>>`
        select id,person_id,email_normalized,membership_state,deleted_at from ruined_members
        where person_id = ${personId}::uuid or email_normalized = ${email}
          or (${link?.member_id ?? null}::uuid is not null and id = ${link?.member_id ?? null}::uuid)
        order by id for update`;
      if (members.length > 1) deny();
      let member = members[0];
      if (member && (member.deleted_at || member.person_id !== personId || member.email_normalized !== email || (link?.member_id && link.member_id !== member.id))) deny();
      if (link?.member_id && !member) deny();
      if (!member) {
        if (grants.some(g => !g.revoked_at)) deny();
        [member] = await tx<typeof members>`insert into ruined_members(id,person_id,email,email_normalized,membership_state)
          values(${randomUUID()}::uuid,${personId}::uuid,${email},${email},'pending')
          returning id,person_id,email_normalized,membership_state,deleted_at`;
      }
      if (!member) deny();
      const conflicting = await tx<Array<{ auth_user_id: string }>>`select auth_user_id from platform_users
        where (member_id = ${member.id}::uuid or person_id = ${personId}::uuid) and auth_user_id <> ${viewer.authUserId}::uuid for update`;
      if (conflicting.length) deny();
      const [lifecycle] = await tx<Array<{ account_state: string; admission_state: string; billing_state: string }>>`
        select account_state,admission_state,billing_state from member_lifecycle where member_id = ${member.id}::uuid for update`;
      if (lifecycle && (['suspended','closed'].includes(lifecycle.account_state) || ['declined','withdrawn'].includes(lifecycle.admission_state))) deny();

      if (link) {
        await tx`update platform_users set member_id = ${member.id}::uuid, person_id = ${personId}::uuid,
          status = 'active', activated_at = coalesce(activated_at,now()), last_signed_in_at = now(), updated_at = now()
          where auth_user_id = ${viewer.authUserId}::uuid`;
      } else {
        await tx`insert into platform_users(auth_user_id,member_id,person_id,email_normalized,user_type,status,activated_at,last_signed_in_at)
          values(${viewer.authUserId}::uuid,${member.id}::uuid,${personId}::uuid,${email},'member','active',now(),now())`;
      }
      if (!lifecycle) {
        await tx`insert into member_lifecycle(member_id,account_state,billing_state,program_state,admission_state,administrative_onboarding_state,standing_state)
          values(${member.id}::uuid,'active',${member.membership_state},'prospect','accepted','in_progress','pre_active')`;
      } else if (lifecycle.account_state !== 'active') {
        await tx`update member_lifecycle set account_state = 'active', admission_state = 'accepted',
          administrative_onboarding_state = case when administrative_onboarding_state = 'not_started' then 'in_progress' else administrative_onboarding_state end,
          version = version + 1, updated_at = now() where member_id = ${member.id}::uuid`;
      }
      await tx`insert into member_onboardings(member_id,state,form_version,requirements_snapshot,started_at,billing_plan)
        values(${member.id}::uuid,'in_progress','administrative-v1',
          jsonb_build_object('legal_name',true,'preferred_name',true,'mobile',true,'birth_date_or_age_attestation',true,
            'shipping_address',true,'apparel_sizing',true,'profile_photo','progressive'),statement_timestamp(),${plan})
        on conflict(member_id) do update set billing_plan = coalesce(member_onboardings.billing_plan,excluded.billing_plan),
          started_at = coalesce(member_onboardings.started_at,excluded.started_at), updated_at = statement_timestamp()`;
      await tx`insert into platform_role_grants(auth_user_id,role_slug,granted_at)
        select ${viewer.authUserId}::uuid,'member',now() where not exists(
          select 1 from platform_role_grants where auth_user_id = ${viewer.authUserId}::uuid and role_slug = 'member' and revoked_at is null)`;
      if (lifecycle?.account_state !== 'active') {
        await tx`insert into member_state_history(member_id,dimension,previous_state,next_state,reason_code,source,actor_auth_user_id,dedupe_key)
          values(${member.id}::uuid,'account',${lifecycle?.account_state ?? null},'active','verified_public_signup','system',
            ${viewer.authUserId}::uuid,${`public-signup-account:${viewer.authUserId}`}) on conflict(dedupe_key) do nothing`;
      }
      await markPersonEmailVerified(tx, { email, emailNormalized: email, personId });
    });
  } catch (error) {
    if (error instanceof PersonIdentityConflictError) deny();
    throw error;
  }
}

export async function getMemberSignupPlan(authUserId: string): Promise<MembershipBillingPlan | null> {
  const sql = getApplicationDatabase();
  const [row] = await sql<Array<{ billing_plan: unknown }>>`select o.billing_plan from member_onboardings o
    join platform_users u on u.member_id = o.member_id and u.status = 'active'
    join ruined_members m on m.id = o.member_id and m.deleted_at is null
    join platform_role_grants g on g.auth_user_id = u.auth_user_id and g.role_slug = 'member' and g.revoked_at is null
    where u.auth_user_id = ${authUserId}::uuid limit 1`;
  return isMembershipBillingPlan(row?.billing_plan) ? row.billing_plan : null;
}
