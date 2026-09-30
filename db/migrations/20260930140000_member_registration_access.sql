begin;

-- New registrations are collected separately from program/billing activation.
-- Deliberately no backfill: existing member records keep their access.
create table public.member_registration_access (
  member_id uuid primary key references public.ruined_members(id) on delete restrict,
  registered_at timestamptz,
  completion_basis text check (completion_basis in ('saved_card','complimentary')),
  payment_setup_attempt_id uuid references public.member_payment_method_setup_attempts(id) on delete restrict,
  payment_setup_account_id text,
  payment_setup_livemode boolean,
  profile_activated_at timestamptz,
  activated_by_auth_user_id uuid references public.platform_users(auth_user_id) on delete restrict,
  version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((registered_at is null) = (completion_basis is null)),
  check (profile_activated_at is null or (registered_at is not null and activated_by_auth_user_id is not null))
);
create table public.member_registration_messages (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  kind text not null check (kind in ('welcome','profile_ready')),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled','manual_review')),
  attempts integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  lock_token uuid,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  first_send_attempt_at timestamptz,
  delivery_payload jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(member_id,kind)
);
create index member_registration_messages_pending on public.member_registration_messages(available_at)
  where status in ('pending','failed','sending');
alter table public.member_registration_access enable row level security;
alter table public.member_registration_messages enable row level security;
revoke all on public.member_registration_access, public.member_registration_messages from public,anon,authenticated;

-- Retry bytes are immutable once prepared. Account erasure is the only reason
-- to remove them; retained delivery history must not retain email/card PII.
create function private.ruined_guard_registration_message_payload() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.member_id is distinct from old.member_id
    or new.kind is distinct from old.kind) then
    raise exception 'A registration message cannot change its identity.';
  end if;
  if new.delivery_payload is not null and exists (
    select 1 from public.ruined_members where id = new.member_id and deleted_at is not null
  ) then raise exception 'A deleted account cannot retain a registration email.'; end if;
  if tg_op = 'UPDATE' and old.delivery_payload is not null and new.delivery_payload is distinct from old.delivery_payload
    and not (new.delivery_payload is null and exists (
      select 1 from public.ruined_members where id = old.member_id and deleted_at is not null
    )) then raise exception 'Prepared registration email bytes are immutable.'; end if;
  return new;
end $$;
create trigger registration_message_payload_guard before insert or update on public.member_registration_messages
  for each row execute function private.ruined_guard_registration_message_payload();

create function private.ruined_erase_registration_message_payloads() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.member_registration_messages
    set delivery_payload = null,
      status = case when status = 'sent' then 'sent' else 'cancelled' end,
      last_error = case when status = 'sent' then last_error else 'account_deleted' end,
      locked_at = null, lock_token = null, updated_at = clock_timestamp()
    where member_id = new.id;
  return new;
end $$;
create trigger registration_message_payload_erasure after update of deleted_at on public.ruined_members
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.ruined_erase_registration_message_payloads();
revoke all on function private.ruined_guard_registration_message_payload(),
  private.ruined_erase_registration_message_payloads() from public,anon,authenticated;

create function private.ruined_member_profile_released(target_member_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog,public,private as $$
  select not exists(select 1 from public.member_registration_access
    where member_id=target_member_id and profile_activated_at is null)
$$;

create function private.ruined_member_registration_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog,public,private as $$
 select exists(
   select 1 from public.member_registration_access registration
   join public.ruined_members member on member.id=registration.member_id and member.deleted_at is null
   join public.people person on person.id=member.person_id and person.status='active'
   join public.member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
   join public.member_onboardings onboarding on onboarding.member_id=member.id and onboarding.profile_completed_at is not null
   where member.id=target_member_id
   and exists(select 1 from public.platform_users identity
     join public.platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
     join public.person_email_addresses email on email.person_id=identity.person_id and email.email_normalized=identity.email_normalized
       and email.verification_state='verified' and email.retired_at is null
     where identity.person_id=member.person_id and identity.status='active' and (identity.member_id is null or identity.member_id=member.id))
   and (private.ruined_member_has_complimentary_funding(member.id) or private.ruined_member_has_operator_funding(member.id)
     or exists(select 1 from public.member_payment_method_accounts account
       join public.member_payment_method_setup_attempts attempt on attempt.id=account.consent_attempt_id
         and attempt.member_id=account.member_id and attempt.stripe_account_id=account.stripe_account_id and attempt.livemode=account.livemode
       where account.member_id=member.id and account.stripe_account_id=registration.payment_setup_account_id
         and account.livemode=registration.payment_setup_livemode and account.stripe_payment_method_id is not null
         and account.saved_at is not null and account.consent_revoked_at is null and not account.cleanup_pending
         and attempt.status='saved' and attempt.consent_revoked_at is null
         and not exists(select 1 from public.member_payment_method_detachments detached
           where detached.stripe_account_id=account.stripe_account_id and detached.livemode=account.livemode
             and detached.stripe_payment_method_id=account.stripe_payment_method_id)))
 )
$$;
revoke all on function private.ruined_member_registration_ready(uuid) from public,anon,authenticated;
revoke all on function private.ruined_member_profile_released(uuid) from public,anon,authenticated;
grant execute on function private.ruined_member_profile_released(uuid) to authenticated;

-- Keep existing funding/standing rules verbatim, adding the independent hold.
-- Replacing function bodies preserves dependent RLS policies and function OIDs.
do $$
declare fn text; definition text;
begin
  foreach fn in array array['ruined_current_membership_id','ruined_current_member_id',
    'ruined_current_active_access_member_id','ruined_current_updates_member_id'] loop
    definition := pg_get_functiondef(('private.' || fn || '()')::regprocedure);
    -- These identity selectors all select from the canonical ruined_members alias.
    definition := regexp_replace(definition, '(where\s+)', E'\\1private.ruined_member_profile_released(member.id) and ', 'i');
    execute definition;
  end loop;
  definition := pg_get_functiondef('private.ruined_member_can_share_invitation(uuid)'::regprocedure);
  definition := regexp_replace(definition, '(where\s+)', E'\\1private.ruined_member_profile_released(member.id) and ', 'i');
  execute definition;
end $$;

-- Profile tables also have person-based policies, independent of member helpers.
create function private.ruined_person_profile_released(target_person_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select not exists(select 1 from public.ruined_members member
    where member.person_id=target_person_id and not private.ruined_member_profile_released(member.id))
$$;
revoke all on function private.ruined_person_profile_released(uuid) from public,anon,authenticated;
grant execute on function private.ruined_person_profile_released(uuid) to authenticated;
create policy registration_profile_hold on public.person_profiles as restrictive for all to authenticated
  using(private.ruined_person_profile_released(person_id)) with check(private.ruined_person_profile_released(person_id));
create policy registration_private_profile_hold on public.person_private_profiles as restrictive for all to authenticated
  using(private.ruined_person_profile_released(person_id)) with check(private.ruined_person_profile_released(person_id));

-- A held member cannot become a payer OR a second participant through another
-- member's checkout. Setup-mode sessions live in their separate storage tables.
create function private.ruined_guard_registration_checkout() returns trigger
language plpgsql set search_path=pg_catalog,public,private as $$
begin
  if not private.ruined_member_profile_released(new.member_id) then
    raise exception using errcode='P4201',message='This registration is not open for paid membership.';
  end if;
  return new;
end $$;
create trigger registration_hold_paid_checkout before insert on public.stripe_checkout_attempts
  for each row execute function private.ruined_guard_registration_checkout();
create trigger registration_hold_commercial_participant before insert on public.membership_commercial_participants
  for each row execute function private.ruined_guard_registration_checkout();
revoke all on function private.ruined_guard_registration_checkout() from public,anon,authenticated;

commit;
