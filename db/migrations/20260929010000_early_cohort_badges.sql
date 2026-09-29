begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The embroidered I Was Here award is exclusive to the first two permanent
-- cohorts. Canonical complimentary funding counts as active membership; an
-- unpaid signup with no funding never does.
create or replace function private.ruined_reconcile_early_cohort_badge(target_member_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.member_badge_awards(member_id, badge_key, earned_at, source_event_id, source_invoice_id, rule_version)
  select member.id, 'early-supporter', assignment.activated_at,
    'membership-activation:' || assignment.member_number::text, null, 2
  from public.ruined_members member
  join private.member_number_assignments assignment on assignment.member_id = member.id
    and assignment.member_number = member.member_number and assignment.member_number between 0 and 50
  join public.people person on person.id = member.person_id and person.status = 'active'
  join public.person_email_addresses email on email.person_id = member.person_id
    and email.email_normalized = member.email_normalized
    and email.verification_state = 'verified' and email.retired_at is null
  join public.membership_waitlist waitlist on waitlist.email_normalized = email.email_normalized
  where member.id = target_member_id and member.deleted_at is null
    and waitlist.joined_waitlist_at < assignment.activated_at
    and private.ruined_member_can_share_invitation(member.id)
  on conflict(member_id, badge_key) do nothing;
$$;

-- Reconcile after the allocator links the assignment to the member, inside the
-- same activation transaction. This covers both paid and complimentary entry.
create or replace function private.ruined_early_cohort_badge_assignment_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ruined_reconcile_early_cohort_badge(new.id);
  return new;
end
$$;
drop trigger if exists ruined_members_early_cohort_badge on public.ruined_members;
create trigger ruined_members_early_cohort_badge
after insert or update of member_number on public.ruined_members
for each row when (new.member_number between 0 and 50)
execute function private.ruined_early_cohort_badge_assignment_trigger();

create or replace function private.ruined_early_cohort_badge_membership_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ruined_reconcile_early_cohort_badge(new.member_id);
  return new;
end
$$;
drop trigger if exists member_lifecycle_early_cohort_badge on public.member_lifecycle;
create trigger member_lifecycle_early_cohort_badge
after insert or update of account_state, administrative_onboarding_state, billing_state,
  program_state, standing_state, cancellation_effective_at, access_started_at
on public.member_lifecycle for each row
execute function private.ruined_early_cohort_badge_membership_trigger();

drop trigger if exists complimentary_grants_early_cohort_badge on public.member_complimentary_grants;
create trigger complimentary_grants_early_cohort_badge after insert or update
on public.member_complimentary_grants for each row
execute function private.ruined_early_cohort_badge_membership_trigger();

create or replace function private.ruined_early_cohort_badge_account_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_member_id uuid;
begin
  for target_member_id in select account.member_id from public.platform_users account
    where account.auth_user_id = new.auth_user_id and account.member_id is not null
  loop
    perform private.ruined_reconcile_early_cohort_badge(target_member_id);
  end loop;
  return new;
end
$$;
drop trigger if exists role_grants_early_cohort_badge on public.platform_role_grants;
create trigger role_grants_early_cohort_badge after insert or update
on public.platform_role_grants for each row
execute function private.ruined_early_cohort_badge_account_trigger();

drop trigger if exists platform_users_early_cohort_badge on public.platform_users;
create trigger platform_users_early_cohort_badge
after insert or update of status, member_id, person_id on public.platform_users for each row
execute function private.ruined_early_cohort_badge_account_trigger();

revoke all on function private.ruined_reconcile_early_cohort_badge(uuid),
  private.ruined_early_cohort_badge_assignment_trigger(), private.ruined_early_cohort_badge_membership_trigger(),
  private.ruined_early_cohort_badge_account_trigger() from public, anon, authenticated;

-- Backfill from the immutable assignment and current active entitlement. Existing
-- awards are retained as history, never duplicated, renumbered, or re-dated.
-- Owner reads hide legacy early-supporter awards outside these two cohorts.
select private.ruined_reconcile_early_cohort_badge(member.id)
from public.ruined_members member
where member.deleted_at is null and member.member_number between 0 and 50;

commit;
