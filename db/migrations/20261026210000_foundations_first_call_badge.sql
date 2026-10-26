begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Recognize the first confirmed real Foundations or Membership call and align
-- First Words with the actual private Journal collection. Preserve all other
-- progress rules and existing award history/visibility. No attendance,
-- awards or messages are created here; the existing reconciler awards once when
-- an eligible member next opens their profile or badges.
create or replace function private.ruined_member_badge_progress(target_member_id uuid)
returns table(badge_key text, progress integer, target integer, earned_at timestamptz, source_event_id text)
language sql stable security invoker set search_path = '' as $$
with owner as (
  select member.id, member.person_id from public.ruined_members member
  join public.people person on person.id = member.person_id and person.status = 'active'
  where member.id = target_member_id and member.deleted_at is null
), registration_anniversary as (
  select access.registered_at,
    private.ruined_registration_anniversary_at(access.registered_at) as earned_at
  from owner
  join public.member_registration_access access on access.member_id = owner.id
  where access.registered_at is not null and isfinite(access.registered_at)
    and access.registered_at <= statement_timestamp()
    and private.ruined_member_profile_released(owner.id)
    and private.ruined_member_can_share_invitation(owner.id)
    and exists (select 1 from public.platform_users account
      join public.platform_role_grants member_grant on member_grant.auth_user_id = account.auth_user_id
        and member_grant.role_slug = 'member' and member_grant.revoked_at is null
      where account.person_id = owner.person_id and (account.member_id is null or account.member_id = owner.id)
        and account.status = 'active')
), profile_progress as (
  select ((nullif(btrim(profile.avatar_storage_path), '') is not null)::integer
      + (nullif(btrim(profile.bio), '') is not null)::integer
      + (nullif(btrim(profile.member_tag), '') is not null)::integer) as progress,
    profile.updated_at as earned_at
  from owner join public.person_profiles profile on profile.person_id = owner.person_id
), private_entry as (
  select entry.id, entry.created_at from public.member_journal_entries entry
  where entry.member_id = target_member_id
    and not (entry.visibility = 'public' and entry.include_on_timeline) and entry.deleted_at is null
    and entry.created_at <= statement_timestamp()
  order by entry.created_at, entry.id limit 1
), public_entry as (
  select entry.id, entry.created_at from public.member_journal_entries entry
  where entry.member_id = target_member_id and entry.visibility = 'public'
    and entry.include_on_timeline and entry.deleted_at is null and entry.created_at <= statement_timestamp()
  order by entry.created_at, entry.id limit 1
), timeline_completion as (
  select completion.id, completion.completed_at
  from public.member_foundation_requirement_completions completion
  join public.foundation_enrollments enrollment on enrollment.id = completion.foundation_enrollment_id
    and enrollment.member_id = completion.member_id and enrollment.status <> 'withdrawn'
  where completion.member_id = target_member_id and completion.requirement_slug = 'timeline'
    and completion.state = 'completed' and completion.completed_at <= statement_timestamp()
    and not exists (select 1 from public.member_foundation_requirement_completions revocation
      where revocation.supersedes_completion_id = completion.id and revocation.state = 'revoked')
  order by completion.completed_at, completion.id limit 1
), foundation_candidates as (
  select enrollment.id, enrollment.progress_percent, enrollment.completed_at, enrollment.status, enrollment.enrolled_at,
    not exists (
      select 1 from jsonb_array_elements_text(coalesce(
        version_record.configuration -> 'required_member_requirements',
        case when program.slug = 'ruined-foundations' then '["timeline", "future_letter"]'::jsonb else '[]'::jsonb end
      )) as requirement(slug)
      where requirement.slug not in ('timeline', 'future_letter') or not exists (
        select 1 from public.member_foundation_requirement_completions completion
        where completion.foundation_enrollment_id = enrollment.id and completion.member_id = enrollment.member_id
          and completion.requirement_slug = requirement.slug and completion.state = 'completed'
          and completion.completed_at <= statement_timestamp()
          and not exists (select 1 from public.member_foundation_requirement_completions revocation
            where revocation.supersedes_completion_id = completion.id and revocation.state = 'revoked')
      )
    ) as requirements_valid
  from public.foundation_enrollments enrollment
  join public.foundation_versions version_record on version_record.id = enrollment.foundation_version_id
  join public.foundation_programs program on program.id = version_record.foundation_program_id
  where enrollment.member_id = target_member_id and enrollment.status <> 'withdrawn'
), foundations as (
  select * from foundation_candidates
  order by (status = 'completed' and completed_at <= statement_timestamp() and requirements_valid) desc,
    progress_percent desc, enrolled_at desc limit 1
), latest_attendance as (
  select distinct on (attendance.experience_id, attendance.person_id)
    attendance.id, attendance.experience_id, attendance.member_id, attendance.event_type, attendance.source,
    attendance.occurred_at
  from public.experience_attendance_events attendance join owner on owner.person_id = attendance.person_id
  where attendance.occurred_at <= statement_timestamp()
  order by attendance.experience_id, attendance.person_id, attendance.occurred_at desc, attendance.id desc
), attended as (
  select event.id, event.circle_id, event.kind, event.location_label,
    event.metadata -> 'badge_credit' ->> 'track' as track,
    event.metadata -> 'badge_credit' ->> 'stage' as stage,
    event.metadata -> 'badge_credit' ->> 'month' as month,
    greatest(event.starts_at, coalesce(event.ends_at, event.starts_at), attendance.occurred_at) as earned_at,
    attendance.id as attendance_id
  from latest_attendance attendance join public.experiences event on event.id = attendance.experience_id
  where (attendance.member_id = target_member_id or attendance.member_id is null)
    and attendance.event_type = 'attended' and attendance.source in ('ops', 'system', 'import', 'external')
    and event.starts_at <= statement_timestamp() and coalesce(event.ends_at, event.starts_at) <= statement_timestamp()
    and event.status in ('published', 'completed', 'archived') and event.cancelled_at is null
    and jsonb_typeof(event.metadata -> 'badge_credit') = 'object'
    and (event.metadata -> 'badge_credit') ?& array['track', 'stage', 'month']
    and (select count(*) from jsonb_object_keys(case
      when jsonb_typeof(event.metadata -> 'badge_credit') = 'object' then event.metadata -> 'badge_credit'
      else '{}'::jsonb end)) = 3
    and (event.circle_id is null or exists (select 1 from public.circle_member_assignments assignment
      where assignment.member_id = target_member_id and assignment.circle_id = event.circle_id
        and assignment.assigned_at <= event.starts_at
        and (assignment.ended_at is null or assignment.ended_at >= event.starts_at)))
), membership_calls as (
  select * from attended where track = 'membership' and kind = 'weekly_call' and circle_id is null
    and stage in ('see', 'face', 'cut', 'grow') and month ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
), foundations_calls as (
  -- The reviewed call classification is independent of email activation/consent.
  -- A title, invitation, registration, Meet link or practice call is not evidence.
  select greatest(event.ends_at, attendance.occurred_at) as earned_at,
    attendance.id as attendance_id
  from latest_attendance attendance
  join public.experiences event on event.id = attendance.experience_id
  join private.member_email_cadence_event_bindings binding on binding.experience_id = event.id
  where (attendance.member_id = target_member_id or attendance.member_id is null)
    and attendance.event_type = 'attended' and attendance.source in ('ops', 'system', 'import', 'external')
    and event.starts_at <= statement_timestamp() and event.ends_at <= statement_timestamp()
    and event.ends_at > event.starts_at
    and event.status in ('published', 'completed', 'archived') and event.cancelled_at is null
    and event.kind in ('member_event', 'weekly_call') and event.circle_id is null
    and event.visibility = 'invite_only' and event.registration_mode = 'internal'
    and binding.kind in ('foundations_01', 'foundations_02', 'foundations_03', 'foundations_04')
    and binding.track = 'members' and binding.approved_by is not null
    and binding.cohort_month ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
    and binding.cohort_month between '2026-11' and '9998-12'
), first_call as (
  select earned_at, attendance_id from (
    select earned_at, attendance_id from membership_calls
    union all
    select earned_at, attendance_id from foundations_calls
  ) calls order by earned_at, attendance_id limit 1
), circle_stages as (
  select distinct on (circle_id, month, stage) * from attended
  where track = 'circle' and kind = 'circle_meeting' and circle_id is not null
    and stage in ('why', 'implementation') and month ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
  order by circle_id, month, stage, earned_at, attendance_id
), circle_month as (
  select circle_id, month, count(*)::integer as progress, max(earned_at) as earned_at
  from circle_stages group by circle_id, month order by count(*) desc, max(earned_at), circle_id, month limit 1
), membership_stages as (
  select distinct on (month, stage) * from membership_calls order by month, stage, earned_at, attendance_id
), membership_month as (
  select month, count(*)::integer as progress, max(earned_at) as earned_at
  from membership_stages group by month order by count(*) desc, max(earned_at), month limit 1
), joined_referral as (
  select referral.waitlist_id, referral.joined_at from public.member_referrals referral
  where referral.inviter_member_id = target_member_id and referral.joined_at <= statement_timestamp()
  order by referral.joined_at, referral.waitlist_id limit 1
), in_person as (
  select * from attended where track = 'in_person' and kind in ('public_event', 'member_event', 'retreat')
    and nullif(btrim(location_label), '') is not null and stage is null and month is null
    and btrim(location_label) !~* '^(https?://|online\y|virtual\y|remote\y|google meet\y|zoom\y|teams\y)'
    and not exists (select 1 from public.integration_entity_links link
      where link.provider = 'google' and link.local_entity_type = 'experience' and link.local_entity_id = attended.id::text
        and link.external_entity_type = 'meet_space' and nullif(link.metadata ->> 'meetingUri', '') is not null)
  order by earned_at, attendance_id limit 1
), results as (
  select 'make-it-yours'::text as badge_key, coalesce((select progress from profile_progress), 0) as progress,
    3 as target, (select earned_at from profile_progress where progress = 3) as earned_at,
    'profile:' || target_member_id::text as source_event_id
  union all select 'first-words', (select count(*)::integer from private_entry), 1,
    (select created_at from private_entry), (select 'journal-entry:' || id::text from private_entry)
  union all select 'your-story', (select count(*)::integer from timeline_completion), 1,
    (select completed_at from timeline_completion), (select 'foundation-requirement:' || id::text from timeline_completion)
  union all select 'on-the-record', (select count(*)::integer from public_entry), 1,
    (select created_at from public_entry), (select 'public-entry:' || id::text from public_entry)
  union all select 'groundwork', coalesce((select case when status = 'completed' and completed_at <= statement_timestamp() and requirements_valid
      then 100 else least(floor(progress_percent)::integer, 99) end from foundations), 0), 100,
    (select completed_at from foundations where status = 'completed' and completed_at <= statement_timestamp() and requirements_valid),
    (select 'foundations:' || id::text from foundations)
  union all select 'in-the-room', (select count(*)::integer from first_call), 1,
    (select earned_at from first_call), (select 'attendance:' || attendance_id::text from first_call)
  union all select 'full-circle', coalesce((select progress from circle_month), 0), 2,
    (select earned_at from circle_month where progress = 2),
    (select 'circle-month:' || circle_id::text || ':' || month from circle_month)
  union all select 'the-whole-month', coalesce((select progress from membership_month), 0), 4,
    (select earned_at from membership_month where progress = 4), (select 'membership-month:' || month from membership_month)
  union all select 'open-door', (select count(*)::integer from joined_referral), 1,
    (select joined_at from joined_referral), (select 'joined-referral:' || waitlist_id::text from joined_referral)
  union all select 'in-real-life', (select count(*)::integer from in_person), 1,
    (select earned_at from in_person), (select 'attendance:' || attendance_id::text from in_person)
  union all select 'one-year', (select count(*)::integer from registration_anniversary where earned_at <= statement_timestamp()), 1,
    (select earned_at from registration_anniversary where earned_at <= statement_timestamp()),
    (select 'registration-anniversary:' || target_member_id::text || ':' || extract(epoch from registered_at)::text
      from registration_anniversary where earned_at <= statement_timestamp())
)
select results.* from results where exists (select 1 from owner)
$$;
revoke all on function private.ruined_member_badge_progress(uuid) from public, anon, authenticated;

commit;
