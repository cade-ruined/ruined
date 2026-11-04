begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Keep the actual grant that opened access; never invent an administrator or payment.
alter table public.member_registration_access
  add column profile_complimentary_grant_id uuid references public.member_complimentary_grants(id) on delete restrict,
  add column profile_operator_grant_id bigint references public.platform_role_grants(id) on delete restrict;
alter table public.member_registration_access drop constraint registration_profile_release_evidence;
alter table public.member_registration_access add constraint registration_profile_release_evidence
  check (profile_activated_at is null or (registered_at is not null
    and num_nonnulls(activated_by_auth_user_id,profile_payment_reservation_id,
      profile_complimentary_grant_id,profile_operator_grant_id)=1));
alter table public.member_registration_access add constraint registration_profile_complimentary_release_identity
  check ((profile_complimentary_grant_id is null and profile_operator_grant_id is null)
    or (profile_activated_at is not null and activated_by_auth_user_id is null
      and profile_payment_reservation_id is null
      and num_nonnulls(profile_complimentary_grant_id,profile_operator_grant_id)=1));
comment on column public.member_registration_access.profile_complimentary_grant_id is
  'Immutable current complimentary grant that automatically opened a completed profile. Historical evidence does not bypass current access eligibility.';
comment on column public.member_registration_access.profile_operator_grant_id is
  'Immutable active ops_admin grant that automatically opened its member profile after completed registration. Historical evidence does not fund current access.';

create function private.ruined_complimentary_profile_release_ready(target_member_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog,public,private as $$
  select exists(select 1 from public.member_registration_access registration
    join public.ruined_members member on member.id=registration.member_id and member.deleted_at is null
    join public.member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state='active'
    where member.id=target_member_id and registration.registered_at is not null and registration.profile_activated_at is null
      and private.ruined_registration_intake_ready(member.id)
      and private.ruined_member_has_complimentary_funding(member.id)
      and lifecycle.standing_state in ('pre_active','active','cancellation_requested')
      and (lifecycle.standing_state<>'cancellation_requested' or lifecycle.cancellation_effective_at>clock_timestamp())
      and exists(select 1 from public.platform_users account
        join public.platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id
          and grant_row.role_slug='member' and grant_row.revoked_at is null
        join public.person_email_addresses email on email.person_id=member.person_id and email.email_normalized=member.email_normalized
          and email.verification_state='verified' and email.retired_at is null
        where account.person_id=member.person_id and account.status='active'
          and account.member_id=member.id and account.email_normalized=member.email_normalized))
$$;
revoke all on function private.ruined_complimentary_profile_release_ready(uuid) from public,anon,authenticated;

create function private.ruined_guard_profile_complimentary_release() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
begin
  if tg_op='UPDATE' and (old.profile_complimentary_grant_id is not null or old.profile_operator_grant_id is not null)
    and row(new.member_id,new.profile_complimentary_grant_id,new.profile_operator_grant_id,new.profile_activated_at,
      new.activated_by_auth_user_id,new.profile_payment_reservation_id)
      is distinct from row(old.member_id,old.profile_complimentary_grant_id,old.profile_operator_grant_id,old.profile_activated_at,
        old.activated_by_auth_user_id,old.profile_payment_reservation_id) then
    raise exception 'Automatic complimentary profile release evidence is immutable.';
  end if;
  if (new.profile_complimentary_grant_id is not null or new.profile_operator_grant_id is not null)
    and (tg_op='INSERT' or (old.profile_complimentary_grant_id is null and old.profile_operator_grant_id is null)) then
    if tg_op='INSERT' or new.member_id is distinct from old.member_id or old.profile_activated_at is not null or old.registered_at is null
      or new.profile_activated_at is null or new.activated_by_auth_user_id is not null or new.profile_payment_reservation_id is not null
      or num_nonnulls(new.profile_complimentary_grant_id,new.profile_operator_grant_id)<>1
      or not private.ruined_complimentary_profile_release_ready(new.member_id) then
      raise exception 'Automatic complimentary profile release requires completed intake and current eligible funding.';
    end if;
    if new.profile_complimentary_grant_id is not null and not exists (
      select 1 from public.member_complimentary_grants funding
      where funding.id=new.profile_complimentary_grant_id and funding.member_id=new.member_id
        and funding.revoked_at is null and funding.starts_at<=clock_timestamp()
        and (funding.ends_at is null or funding.ends_at>clock_timestamp())) then
      raise exception 'Automatic profile release requires this member''s current complimentary grant.';
    end if;
    if new.profile_operator_grant_id is not null and not exists (
      select 1 from public.platform_role_grants grant_row
      join public.platform_users account on account.auth_user_id=grant_row.auth_user_id
      join public.ruined_members member on member.id=new.member_id and account.person_id=member.person_id
        and account.email_normalized=member.email_normalized
      where grant_row.id=new.profile_operator_grant_id and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
        and account.member_id=new.member_id and account.status='active'
        and private.ruined_member_has_operator_funding(new.member_id)) then
      raise exception 'Automatic profile release requires this member''s current operator funding grant.';
    end if;
  end if;
  return new;
end $$;
create trigger registration_profile_complimentary_release before insert or update on public.member_registration_access
  for each row execute function private.ruined_guard_profile_complimentary_release();
revoke all on function private.ruined_guard_profile_complimentary_release() from public,anon,authenticated;

-- New and explicitly reconciled registrations use the runtime transaction.
-- Do not backfill historical access or enqueue historical messages in a migration.
commit;
