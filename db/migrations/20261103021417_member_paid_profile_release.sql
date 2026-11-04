begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- A payment release records its actual evidence, never an invented administrator.
-- Nullable addition keeps deployed administrator-release writers compatible.
alter table public.member_registration_access add column profile_payment_reservation_id uuid
  references public.membership_commercial_reservations(id) on delete restrict;
do $$
declare prior_constraint text;
begin
  select conname into strict prior_constraint from pg_constraint
  where conrelid='public.member_registration_access'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%profile_activated_at%'
    and pg_get_constraintdef(oid) like '%registered_at%'
    and pg_get_constraintdef(oid) like '%activated_by_auth_user_id%';
  execute format('alter table public.member_registration_access drop constraint %I',prior_constraint);
end $$;
alter table public.member_registration_access add constraint registration_profile_release_evidence
  check (profile_activated_at is null or (registered_at is not null
    and num_nonnulls(activated_by_auth_user_id,profile_payment_reservation_id)=1));
alter table public.member_registration_access add constraint registration_profile_payment_release_identity
  check (profile_payment_reservation_id is null or (profile_activated_at is not null and activated_by_auth_user_id is null));
comment on column public.member_registration_access.profile_payment_reservation_id is
  'Immutable verified payment that automatically released this completed profile. Historical evidence survives later refunds; current access uses current eligibility.';

create function private.ruined_paid_profile_release_ready(target_member_id uuid) returns boolean
language sql stable security invoker set search_path=pg_catalog,public,private as $$
  select exists(select 1 from public.member_registration_access registration
    join public.ruined_members member on member.id=registration.member_id and member.deleted_at is null
    join public.member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state='active'
    join public.membership_commercial_reservations reservation on reservation.id=private.ruined_member_paid_reservation(member.id)
    join public.stripe_subscriptions subscription on subscription.id=reservation.stripe_subscription_id
    join public.member_lifecycle payer on payer.member_id=reservation.payer_member_id
    where member.id=target_member_id and registration.registered_at is not null and registration.profile_activated_at is null
      and private.ruined_registration_intake_ready(member.id)
      and lifecycle.standing_state in ('pre_active','active','cancellation_requested')
      and (lifecycle.standing_state<>'cancellation_requested' or lifecycle.cancellation_effective_at>statement_timestamp())
      and payer.account_state not in ('closed','suspended')
      and payer.standing_state in ('pre_active','active','cancellation_requested')
      and (payer.standing_state<>'cancellation_requested' or payer.cancellation_effective_at>statement_timestamp())
      and (subscription.cancel_at is null or subscription.cancel_at>statement_timestamp())
      and not exists(select 1 from public.membership_enrollment_episodes episode
        where episode.reservation_id=reservation.id and episode.member_id=member.id and episode.ended_at is not null)
      and exists(select 1 from public.platform_users account
        join public.platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
        join public.person_email_addresses email on email.person_id=member.person_id and email.email_normalized=member.email_normalized
          and email.verification_state='verified' and email.retired_at is null
        where account.person_id=member.person_id and account.status='active'
          and (account.member_id is null or account.member_id=member.id) and account.email_normalized=member.email_normalized))
$$;
revoke all on function private.ruined_paid_profile_release_ready(uuid) from public,anon,authenticated;

create function private.ruined_guard_profile_payment_release() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
begin
  if tg_op='UPDATE' and old.profile_payment_reservation_id is not null and
    row(new.profile_payment_reservation_id,new.profile_activated_at,new.activated_by_auth_user_id)
      is distinct from row(old.profile_payment_reservation_id,old.profile_activated_at,old.activated_by_auth_user_id) then
    raise exception 'Automatic profile release evidence is immutable.';
  end if;
  if new.profile_payment_reservation_id is not null and
    (tg_op='INSERT' or old.profile_payment_reservation_id is null) then
    if tg_op='INSERT' or old.profile_activated_at is not null or old.registered_at is null
      or new.profile_activated_at is null or new.activated_by_auth_user_id is not null
      or not private.ruined_paid_profile_release_ready(new.member_id)
      or new.profile_payment_reservation_id is distinct from private.ruined_member_paid_reservation(new.member_id) then
      raise exception 'Automatic profile release requires completed intake and current verified membership payment.';
    end if;
  end if;
  return new;
end $$;
create trigger registration_profile_payment_release before insert or update on public.member_registration_access
  for each row execute function private.ruined_guard_profile_payment_release();
revoke all on function private.ruined_guard_profile_payment_release() from public,anon,authenticated;

-- No member records, release timestamps, or messages are backfilled here.
commit;

