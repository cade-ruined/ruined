begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- An adult consents only for their own account. A reciprocal request from the
-- other verified adult is required; an address alone never binds an account.
-- This records Circle placement intent, not payment authorization or funding.
create table public.member_registration_couple_intents (
  member_id uuid primary key references public.ruined_members(id) on delete cascade,
  partner_email_normalized text not null check (
    partner_email_normalized=lower(btrim(partner_email_normalized))
    and char_length(partner_email_normalized) between 3 and 254
    and partner_email_normalized like '%_@_%._%'
  ),
  consented_by_auth_user_id uuid not null references public.platform_users(auth_user_id),
  consented_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index member_registration_couple_intents_partner_email on public.member_registration_couple_intents(partner_email_normalized);
alter table public.member_registration_couple_intents enable row level security;
revoke all on public.member_registration_couple_intents from public,anon,authenticated;

create function private.ruined_registration_circle_couple_partner(target_member_id uuid)
returns uuid language sql stable security invoker set search_path='' as $$
  select partner.member_id
  from public.member_registration_couple_intents own
  join public.ruined_members own_member on own_member.id=own.member_id and own_member.deleted_at is null
  join public.ruined_members partner_member on partner_member.email_normalized=own.partner_email_normalized
    and partner_member.id<>own.member_id and partner_member.person_id<>own_member.person_id and partner_member.deleted_at is null
  join public.member_registration_couple_intents partner on partner.member_id=partner_member.id
    and partner.partner_email_normalized=own_member.email_normalized
  join public.people own_person on own_person.id=own_member.person_id and own_person.status='active'
  join public.people partner_person on partner_person.id=partner_member.person_id and partner_person.status='active'
  join public.member_lifecycle own_lifecycle on own_lifecycle.member_id=own.member_id and own_lifecycle.account_state not in ('closed','suspended')
  join public.member_lifecycle partner_lifecycle on partner_lifecycle.member_id=partner.member_id and partner_lifecycle.account_state not in ('closed','suspended')
  where own.member_id=target_member_id
    and not exists (
      select 1 from (values(own.member_id,own.consented_by_auth_user_id),(partner.member_id,partner.consented_by_auth_user_id)) required(member_id,auth_user_id)
      where not exists (
        select 1 from public.ruined_members member
        join public.platform_users identity on identity.auth_user_id=required.auth_user_id
          and identity.person_id=member.person_id and identity.email_normalized=member.email_normalized
          and (identity.member_id is null or identity.member_id=member.id) and identity.status='active'
        join public.platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id
          and grant_row.role_slug='member' and grant_row.revoked_at is null
        join public.person_email_addresses email on email.person_id=member.person_id and email.email_normalized=member.email_normalized
          and email.verification_state='verified' and email.retired_at is null
        where member.id=required.member_id
      )
    )
$$;

-- Keep the established paid-couple lifecycle predicate intact. A conflicting
-- paid pair and registration pair produces a cardinality error instead of
-- silently selecting one or allowing a third member into the relationship.
alter function private.ruined_circle_couple_partner(uuid) rename to ruined_commercial_circle_couple_partner;
create function private.ruined_circle_couple_partner(target_member_id uuid)
returns uuid language sql stable security invoker set search_path='' as $$
  select (select distinct partner from (
    select private.ruined_commercial_circle_couple_partner(target_member_id) as partner
    union all select private.ruined_registration_circle_couple_partner(target_member_id)
  ) pairs where partner is not null)
$$;

-- Include both pending directions in the same placement lock protocol so
-- reciprocal confirmation and a concurrent placement cannot pass independently.
alter function private.ruined_lock_circle_couple_members(uuid[]) rename to ruined_lock_commercial_circle_couple_members;
create function private.ruined_lock_circle_couple_members(requested_members uuid[])
returns void language plpgsql security invoker set search_path='' as $$
declare affected uuid[];
begin
  affected := requested_members || array(
    select partner.id from public.member_registration_couple_intents intent
    join public.ruined_members partner on partner.email_normalized=intent.partner_email_normalized
    where intent.member_id=any(requested_members)
    union
    select intent.member_id from public.member_registration_couple_intents intent
    join public.ruined_members target on target.email_normalized=intent.partner_email_normalized
    where target.id=any(requested_members)
  );
  perform private.ruined_lock_commercial_circle_couple_members(affected);
end
$$;

alter function private.ruined_circle_couple_row_members(text,jsonb) rename to ruined_commercial_circle_couple_row_members;
create function private.ruined_circle_couple_row_members(source_table text,row_data jsonb)
returns uuid[] language plpgsql stable security invoker set search_path='' as $$
declare members uuid[] := '{}'::uuid[];
begin
  if row_data is null then return members; end if;
  case source_table
    when 'member_registration_couple_intents' then
      members := array[(row_data->>'member_id')::uuid] || array(
        select id from public.ruined_members where email_normalized=row_data->>'partner_email_normalized');
    when 'people' then
      members := array(select id from public.ruined_members where person_id=(row_data->>'id')::uuid);
    when 'person_email_addresses' then
      members := array(select id from public.ruined_members where person_id=(row_data->>'person_id')::uuid);
    when 'platform_users' then
      members := array(select id from public.ruined_members where person_id=(row_data->>'person_id')::uuid);
    when 'platform_role_grants' then
      members := array(select member.id from public.ruined_members member join public.platform_users identity
        on identity.person_id=member.person_id where identity.auth_user_id=(row_data->>'auth_user_id')::uuid);
    else members := private.ruined_commercial_circle_couple_row_members(source_table,row_data);
  end case;
  if source_table='ruined_members' then
    members := members || array(select member_id from public.member_registration_couple_intents
      where partner_email_normalized=row_data->>'email_normalized');
  end if;
  return members;
end
$$;

create function private.ruined_guard_registration_couple_consent()
returns trigger language plpgsql security invoker set search_path='' as $$
declare target_id uuid; paired_id uuid; previous_email text; own_email text;
begin
  target_id := case when tg_op='DELETE' then old.member_id else new.member_id end;
  paired_id := private.ruined_registration_circle_couple_partner(target_id);
  if paired_id is not null then
    if tg_op='DELETE' then
      raise exception using errcode='P4210',message='Confirmed registration pairs require operator assistance to change.';
    end if;
    select partner_email_normalized into previous_email from public.member_registration_couple_intents where member_id=target_id;
    if previous_email is distinct from new.partner_email_normalized then
      raise exception using errcode='P4210',message='Confirmed registration pairs require operator assistance to change.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and old.member_id<>new.member_id then
    raise exception using errcode='P4212',message='Registration consent belongs to its member.';
  end if;
  select member.email_normalized into own_email
  from public.ruined_members member
  join public.member_registration_access registration on registration.member_id=member.id
  join public.member_onboardings onboarding on onboarding.member_id=member.id and onboarding.profile_completed_at is not null
  join public.people person on person.id=member.person_id and person.status='active'
  join public.member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
  join public.person_private_profiles profile on profile.person_id=member.person_id
  join public.platform_users identity on identity.auth_user_id=new.consented_by_auth_user_id
    and identity.person_id=member.person_id and identity.email_normalized=member.email_normalized
    and (identity.member_id is null or identity.member_id=member.id) and identity.status='active'
  join public.platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id
    and grant_row.role_slug='member' and grant_row.revoked_at is null
  join public.person_email_addresses email on email.person_id=member.person_id and email.email_normalized=member.email_normalized
    and email.verification_state='verified' and email.retired_at is null
  where member.id=new.member_id and member.deleted_at is null
    and private.ruined_registration_intake_eligibility_error(profile.birth_date,profile.default_fulfillment_address->>'countryCode') is null;
  if own_email is null or own_email=new.partner_email_normalized then
    raise exception using errcode='P4212',message='Eligible verified adults must consent separately.';
  end if;
  if tg_op='UPDATE' and old.partner_email_normalized is distinct from new.partner_email_normalized then
    new.consented_at := clock_timestamp();
  end if;
  return new;
end
$$;

do $$ declare table_name text; begin
  foreach table_name in array array['member_registration_couple_intents','people','person_email_addresses','platform_users','platform_role_grants'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.ruined_lock_couple_circle_write()',table_name || '_01_couple_lock',table_name);
    execute format('create constraint trigger %I after insert or update or delete on public.%I deferrable initially deferred for each row execute function private.ruined_check_couple_circle_write()',table_name || '_couple_circle_check',table_name);
  end loop;
end $$;
create trigger member_registration_couple_intents_02_consent_guard before insert or update or delete
  on public.member_registration_couple_intents for each row execute function private.ruined_guard_registration_couple_consent();

-- Member erasure anonymizes the member row before deleting person emails. Use
-- the old identity and still-available aliases to erase both owned requests and
-- requests addressed to them. Running after the authorized soft deletion means
-- the existing mutual-consent guard naturally sees the pair as unavailable;
-- there is no session flag or general-purpose confirmed-pair deletion bypass.
create function private.ruined_erase_registration_couple_intents()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if not private.ruined_member_deletion_authorized(old.id) then
      raise exception 'Use the authorized member deletion action.';
    end if;
    delete from public.member_registration_couple_intents intent
      where intent.member_id=old.id or intent.partner_email_normalized=old.email_normalized
        or intent.partner_email_normalized in (
          select email_normalized from public.person_email_addresses where person_id=old.person_id
        );
  end if;
  return new;
end
$$;
create trigger ruined_members_erase_registration_couple_intents after update of deleted_at on public.ruined_members
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.ruined_erase_registration_couple_intents();

revoke all on function private.ruined_registration_circle_couple_partner(uuid),private.ruined_circle_couple_partner(uuid),
  private.ruined_commercial_circle_couple_partner(uuid),private.ruined_lock_circle_couple_members(uuid[]),
  private.ruined_lock_commercial_circle_couple_members(uuid[]),private.ruined_circle_couple_row_members(text,jsonb),
  private.ruined_commercial_circle_couple_row_members(text,jsonb),private.ruined_guard_registration_couple_consent(),
  private.ruined_erase_registration_couple_intents()
  from public,anon,authenticated;
commit;
