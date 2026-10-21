import "server-only";
import type { TransactionSql } from "postgres";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import type { MemberIdentity } from "@/lib/membership/model";
import type { LifecycleCopy } from "./member-lifecycle-email-copy";
import type { CadenceDesignPlan } from "./member-email-cadence-renderer";
import type { LifecycleEmailKey, LifecycleMemberDates, LifecycleSettings } from "./member-lifecycle-email-model";

export type LifecycleRule = { key: LifecycleEmailKey; enabled: boolean; revision: number; settings: LifecycleSettings; copy?: LifecycleCopy | null;
  design: CadenceDesignPlan | null; activatedAt: string | null; approvedBy: string | null; authorized: boolean };
export type LifecycleMember = LifecycleMemberDates & { id: string; name: string; email: string; consentId: string | null;
  enrolledAt: string; eligible: boolean; reason: string; completedRequirements: string[]; canRevisit: boolean; foundationsCompleted: boolean; circleAssigned: boolean };
export function lifecycleRecipientQualifies(key: LifecycleEmailKey, member: LifecycleMember, settings: LifecycleSettings): boolean {
  if (!member.eligible) return false;
  if (key === "anniversary") return member.foundationsCompleted && member.circleAssigned && Boolean(member.firstMembershipCallAt);
  if (key.startsWith("checkin_")) {
    if (!member.foundationsCompleted || !member.firstMembershipCallAt) return false;
    if (key === "checkin_6_month") return member.canRevisit && member.completedRequirements.includes(settings.foundationsWorkType);
  }
  return true;
}
export async function readLifecycleRules(tx: TransactionSql, lock = false): Promise<LifecycleRule[]> {
  const rows = await tx<Array<Omit<LifecycleRule,"activatedAt"> & {activatedAt: Date | string | null}>>`
    select rule.key,rule.enabled,rule.revision,rule.settings,rule.copy,rule.design,rule.activated_at as "activatedAt",rule.approved_by as "approvedBy",
      exists(select 1 from platform_users actor join platform_role_grants role on role.auth_user_id=actor.auth_user_id
        where actor.auth_user_id=rule.approved_by and actor.status='active' and role.role_slug='ops_admin' and role.revoked_at is null) as authorized
    from private.member_lifecycle_email_rules rule order by rule.key ${lock ? tx`for share of rule` : tx``}`;
  return rows.map(row => ({...row, activatedAt: row.activatedAt ? new Date(row.activatedAt).toISOString() : null}));
}

/** The same member lock used by preference changes fences withdrawal against dispatch. */
export async function readLifecycleMembers(tx: TransactionSql, memberId?: string, lock = false): Promise<LifecycleMember[]> {
  if (lock && memberId) {
    await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid), private.ruined_lock_member_operator_funding(${memberId}::uuid)`;
    await tx`select id from ruined_members where id=${memberId}::uuid for update`;
    await tx`select person.id from people person join ruined_members member on member.person_id=person.id where member.id=${memberId}::uuid for share of person`;
    await tx`select auth_user_id from platform_users where member_id=${memberId}::uuid for share`;
    await tx`select role.auth_user_id from platform_role_grants role join platform_users account on account.auth_user_id=role.auth_user_id
      where account.member_id=${memberId}::uuid and role.role_slug='member' for share of role`;
    await tx`select member_id from member_lifecycle where member_id=${memberId}::uuid for share`;
    await tx`select member_id from member_registration_access where member_id=${memberId}::uuid for share`;
    await tx`select address.id from person_email_addresses address join ruined_members member on member.person_id=address.person_id
      where member.id=${memberId}::uuid for share of address`;
    await tx`select contact.id from communication_contacts contact join ruined_members member on member.email_normalized=contact.email_normalized
      where member.id=${memberId}::uuid for share of contact`;
    // Event/requirement writers may take their own lock before the member lock.
    // Never wait in the reverse order: defer this attempt if evidence is being
    // changed, then read it again while these locks remain held through dispatch.
    const [requirements] = await tx<Array<{ locked: boolean }>>`
      select pg_try_advisory_xact_lock(hashtext(${memberId}),46) as locked`;
    if (!requirements?.locked) throw new Error("Lifecycle requirement evidence is being updated");
    await tx`select id from foundation_enrollments where member_id=${memberId}::uuid for share nowait`;
    // FOR UPDATE also fences a new revocation's supersedes-completion FK check.
    await tx`select id from member_foundation_requirement_completions where member_id=${memberId}::uuid for update nowait`;
    await tx`select assignment.member_id from circle_member_assignments assignment join circles circle on circle.id=assignment.circle_id
      where assignment.member_id=${memberId}::uuid and assignment.ended_at is null for share of assignment,circle nowait`;
    await tx`select profile.person_id from person_private_profiles profile join ruined_members member on member.person_id=profile.person_id
      where member.id=${memberId}::uuid for share of profile nowait`;
    // Lock every existing registered/attended event, including events whose
    // classification may be edited. Attendance writers lock the event before
    // appending a new mark; locking only today's latest mark would miss revoke.
    const events = await tx<Array<{ id: string }>>`
      select event.id from experiences event join ruined_members member on member.id=${memberId}::uuid
      where exists(select 1 from experience_registrations roster where roster.experience_id=event.id and roster.person_id=member.person_id)
        or exists(select 1 from experience_attendance_events attendance where attendance.experience_id=event.id and attendance.person_id=member.person_id)
      order by event.id limit 1001 for share of event nowait`;
    if (events.length>1000) throw new Error("Lifecycle event evidence exceeds dispatch capacity");
  }
  type Row = MemberIdentity & { id: string; name: string; verified: boolean; available: boolean; suppressed: boolean;
    consent: boolean; consentId: string | null; consentAt: Date | string | null; registeredAt: Date | string | null;
    profileAt: Date | string | null; createdAt: Date | string; birthDate: Date | string | null; firstMembershipCallAt: Date | string | null;
    completedRequirements:string[];circleAssigned:boolean };
  const rows = await tx<Row[]>`
    select member.id,member.email_normalized as email,coalesce(nullif(btrim(profile.display_name),''),'Friend') as name,
      member.person_id as "personId",lifecycle.account_state as "accountState",lifecycle.administrative_onboarding_state as "administrativeOnboardingState",
      lifecycle.billing_state as "billingState",lifecycle.cancellation_effective_at as "cancellationEffectiveAt",
      lifecycle.foundations_state as "foundationsState",lifecycle.program_state as "programState",lifecycle.standing_state as "standingState",
      not private.ruined_member_profile_released(member.id) as "registrationHeld",
      case when private.ruined_member_has_complimentary_funding(member.id) then 'complimentary'
        when private.ruined_member_has_operator_funding(member.id) then 'operator' else 'self' end as "membershipFunding",
      (member.deleted_at is null and person.status='active' and exists(select 1 from platform_users account
        join platform_role_grants role on role.auth_user_id=account.auth_user_id where account.member_id=member.id
        and account.person_id=member.person_id and account.status='active' and role.role_slug='member' and role.revoked_at is null)) as available,
      exists(select 1 from person_email_addresses address where address.person_id=member.person_id and address.email_normalized=member.email_normalized
        and address.verification_state='verified' and address.retired_at is null) as verified,
      exists(select 1 from communication_contacts contact where contact.email_normalized=member.email_normalized and contact.delivery_state<>'active') as suppressed,
      consent.id::text as "consentId",consent.accepted_at as "consentAt",
      coalesce(consent.decision='accepted' and consent.evidence->>'destination'=member.email_normalized and consent.actor_auth_user_id is not null
        and consent.evidence->>'requested'='true' and consent.evidence->>'marketingConsent'='false'
        and (consent.source='member' or (consent.source='ops' and consent.evidence->>'action'='operator_email_preference_enabled'
        and consent.evidence->>'operatorApproved'='true' and consent.evidence->>'memberAffirmed'='false'
        and jsonb_typeof(consent.evidence->'approvalReference')='string' and consent.evidence->>'approvalReference' ~ '[^[:space:]]')),false) as consent,
      access.registered_at as "registeredAt",access.profile_activated_at as "profileAt",member.created_at as "createdAt",private_profile.birth_date as "birthDate",
      first_call.starts_at as "firstMembershipCallAt",
      array(select distinct completion.requirement_slug from member_foundation_requirement_completions completion
        join foundation_enrollments enrollment on enrollment.id=completion.foundation_enrollment_id and enrollment.member_id=member.id and enrollment.status<>'withdrawn'
        where completion.member_id=member.id and completion.state='completed' and completion.completed_at<=statement_timestamp()
          and not exists(select 1 from member_foundation_requirement_completions revocation where revocation.supersedes_completion_id=completion.id and revocation.state='revoked')) as "completedRequirements",
      exists(select 1 from circle_member_assignments assignment join circles circle on circle.id=assignment.circle_id
        where assignment.member_id=member.id and assignment.ended_at is null and assignment.assigned_at<=statement_timestamp()
          and circle.status='active' and circle.activated_at<=statement_timestamp() and (circle.ends_at is null or circle.ends_at>=statement_timestamp())) as "circleAssigned"
    from ruined_members member join people person on person.id=member.person_id
    join member_lifecycle lifecycle on lifecycle.member_id=member.id
    left join person_profiles profile on profile.person_id=member.person_id
    left join person_private_profiles private_profile on private_profile.person_id=member.person_id
    left join member_registration_access access on access.member_id=member.id
    left join lateral(select * from member_consents decision where decision.member_id=member.id and decision.consent_type='communications'
      and decision.evidence->>'context'='member_communication_preferences_v1' and decision.evidence->>'purpose'='membership_updates'
      and decision.evidence->>'channel'='email' order by decision.id desc limit 1) consent on true
    left join lateral(
      select event.starts_at from experiences event join lateral(
        select attendance.event_type,attendance.source,attendance.member_id from experience_attendance_events attendance
        where attendance.experience_id=event.id and attendance.person_id=member.person_id and attendance.occurred_at<=statement_timestamp()
        order by attendance.occurred_at desc,attendance.id desc limit 1
      ) latest on latest.event_type='attended' and latest.source in ('ops','system','import','external')
        and (latest.member_id=member.id or latest.member_id is null)
      where event.kind='weekly_call' and event.circle_id is null and event.metadata->'badge_credit'->>'track'='membership'
        and event.metadata->'badge_credit'->>'stage' in ('see','face','cut','grow')
        and event.status in ('published','completed','archived') and event.cancelled_at is null
        and coalesce(event.ends_at,event.starts_at)<=statement_timestamp()
      order by event.starts_at,event.id limit 1
    ) first_call on true
    where (${memberId ?? null}::uuid is null or member.id=${memberId ?? null}::uuid) and member.deleted_at is null
    order by member.id limit 2001`;
  if (rows.length > 2000) throw new Error("Lifecycle audience exceeds review capacity");
  const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
  return rows.map(row => {
    const access = deriveMemberAccessPolicy({...row,cancellationEffectiveAt: iso(row.cancellationEffectiveAt)});
    const reason = !row.available ? "Account unavailable" : !row.verified ? "Email not verified" : row.suppressed ? "Email suppressed"
      : !row.consent ? "Membership emails are off" : !memberCan(access,"updates.read") ? "Membership is not currently active" : "";
    const enrolled = [row.createdAt,row.registeredAt,row.profileAt,row.consentAt].filter(Boolean).map(value => new Date(value!).getTime());
    return {id:row.id,name:row.name,email:row.email,registeredAt:iso(row.registeredAt),firstMembershipCallAt:iso(row.firstMembershipCallAt),
      birthDate:iso(row.birthDate)?.slice(0,10) ?? null,consentId:row.consentId,enrolledAt:new Date(Math.max(...enrolled)).toISOString(),eligible:!reason,reason,
      completedRequirements:row.completedRequirements,canRevisit:memberCan(access,"foundations.revisit"),foundationsCompleted:row.foundationsState==="completed",circleAssigned:row.circleAssigned};
  });
}
