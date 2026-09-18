begin;

-- A reusable introduction from a member, not an admission or authentication token.
create table public.member_invitations (
  member_id uuid primary key references public.ruined_members(id) on delete restrict,
  public_token text not null unique check (public_token ~ '^[A-Za-z0-9_-]{43}$'),
  enabled boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
create table public.member_referrals (
  waitlist_id uuid primary key references public.membership_waitlist(id) on delete restrict,
  inviter_member_id uuid not null references public.ruined_members(id) on delete restrict,
  referred_person_id uuid unique references public.people(id) on delete restrict,
  referred_member_id uuid unique references public.ruined_members(id) on delete restrict,
  submitted_at timestamptz not null default statement_timestamp(),
  bound_at timestamptz,
  joined_at timestamptz,
  check ((referred_person_id is null) = (referred_member_id is null)),
  check ((bound_at is null) = (referred_member_id is null)),
  check (referred_member_id is null or referred_member_id <> inviter_member_id),
  check (joined_at is null or (bound_at is not null and joined_at >= submitted_at))
);
create index member_referrals_inviter_joined_idx on public.member_referrals(inviter_member_id, joined_at);
alter table public.member_invitations enable row level security;
alter table public.member_referrals enable row level security;
revoke all on public.member_invitations, public.member_referrals from public, anon, authenticated;
comment on table public.member_invitations is 'Explicit name-only sharing consent. A reusable public introduction grants no admission or account access.';
comment on table public.member_referrals is 'First submitted attribution, bound only to a verified admitted member identity; one completed joining per Person.';

create function private.ruined_member_can_share_invitation(target_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ruined_members member
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
    where member.id = target_member_id and lifecycle.account_state = 'active'
      and lifecycle.administrative_onboarding_state = 'completed'
      and lifecycle.program_state in ('onboarding', 'active')
      and (lifecycle.billing_state = 'active' or private.ruined_member_has_operator_funding(member.id))
      and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested'
        and lifecycle.cancellation_effective_at > statement_timestamp()))
      and exists (select 1 from public.platform_users viewer
        join public.platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id
          and grant_row.role_slug = 'member' and grant_row.revoked_at is null
        where viewer.person_id = member.person_id and viewer.status = 'active')
  )
$$;

-- Called only for a newly inserted waitlist row, in the same transaction.
-- Invalid/withdrawn links leave an ordinary interest submission, never an allowance.
create function private.ruined_capture_member_referral(target_waitlist_id uuid, invitation_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_email text; inviter_id uuid; inviter_person uuid;
begin
  if invitation_token !~ '^[A-Za-z0-9_-]{43}$' then return; end if;
  select email_normalized into target_email from public.membership_waitlist where id = target_waitlist_id;
  if target_email is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(target_email), 1);
  select invitation.member_id, member.person_id into inviter_id, inviter_person
  from public.member_invitations invitation join public.ruined_members member on member.id = invitation.member_id
  where invitation.public_token = invitation_token and invitation.enabled
    and private.ruined_member_can_share_invitation(invitation.member_id)
  for share of invitation;
  if inviter_id is null then return; end if;
  if exists (select 1 from public.person_email_addresses address
    where address.person_id = inviter_person and address.email_normalized = target_email and address.retired_at is null)
    or exists (select 1 from public.ruined_members member where member.id = inviter_id and member.email_normalized = target_email)
    or exists (select 1 from public.person_email_addresses address
      join public.ruined_members member on member.person_id = address.person_id
      join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
      where address.email_normalized = target_email and address.retired_at is null
        and (lifecycle.access_started_at is not null or lifecycle.administrative_onboarding_state = 'completed'))
  then return; end if;
  insert into public.member_referrals(waitlist_id, inviter_member_id)
  values (target_waitlist_id, inviter_id) on conflict (waitlist_id) do nothing;
end
$$;

create function private.ruined_record_member_referral_join(target_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Completion is shared by paid webhook activation and authorized complimentary entry.
  -- Billing activation timestamps alone are not evidence of completed joining.
  if not private.ruined_member_can_share_invitation(target_member_id) then return; end if;
  if not exists (select 1 from public.member_onboardings onboarding
    where onboarding.member_id = target_member_id and onboarding.state = 'completed'
      and onboarding.profile_completed_at is not null and onboarding.agreement_completed_at is not null)
  then return; end if;
  update public.member_referrals referral set joined_at = statement_timestamp()
  from public.ruined_members joined_member, public.ruined_members inviter
  where referral.referred_member_id = target_member_id and referral.joined_at is null
    and joined_member.id = referral.referred_member_id and inviter.id = referral.inviter_member_id
    and joined_member.person_id = referral.referred_person_id and inviter.person_id <> joined_member.person_id
    and exists (select 1 from public.person_email_addresses address
      where address.person_id = joined_member.person_id and address.verification_state = 'verified' and address.retired_at is null);
end
$$;

create function private.ruined_bind_member_referral(target_person_id uuid, verified_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_member_id uuid; candidate_waitlist_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(verified_email), 1);
  if not exists (select 1 from public.person_email_addresses address
    where address.person_id = target_person_id and address.email_normalized = verified_email
      and address.verification_state = 'verified' and address.retired_at is null) then return; end if;
  select member.id into target_member_id from public.ruined_members member
  where member.person_id = target_person_id and member.email_normalized = verified_email
    and exists (select 1 from public.platform_users viewer
      join public.platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id
        and grant_row.role_slug = 'member' and grant_row.revoked_at is null
      where viewer.person_id = target_person_id and viewer.status = 'active')
  for update of member;
  if target_member_id is null then return; end if;
  if exists (select 1 from public.member_referrals where referred_person_id = target_person_id) then return; end if;
  select referral.waitlist_id into candidate_waitlist_id
  from public.member_referrals referral
  join public.membership_waitlist waitlist on waitlist.id = referral.waitlist_id
  join public.ruined_members inviter on inviter.id = referral.inviter_member_id
  join public.member_lifecycle lifecycle on lifecycle.member_id = target_member_id
  where waitlist.email_normalized = verified_email and referral.referred_person_id is null
    and inviter.person_id <> target_person_id and inviter.id <> target_member_id
    and (lifecycle.access_started_at is null or lifecycle.access_started_at > referral.submitted_at)
  order by referral.submitted_at, referral.waitlist_id limit 1 for update of referral;
  if candidate_waitlist_id is null then return; end if;
  update public.member_referrals set referred_person_id = target_person_id, referred_member_id = target_member_id,
    bound_at = statement_timestamp() where waitlist_id = candidate_waitlist_id;
  perform private.ruined_record_member_referral_join(target_member_id);
end
$$;

create function private.ruined_member_referral_verified_email_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ruined_bind_member_referral(new.person_id, new.email_normalized);
  return new;
end
$$;
create trigger member_referral_verified_email
after insert or update of verification_state, retired_at, person_id, email_normalized on public.person_email_addresses
for each row when (new.verification_state = 'verified' and new.retired_at is null)
execute function private.ruined_member_referral_verified_email_trigger();

create function private.ruined_member_referral_activation_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare member_person_id uuid; member_email text;
begin
  -- Staff may verify their email before a complimentary member record exists.
  -- Recheck the same verified identity at completion; this never grants access.
  select person_id, email_normalized into member_person_id, member_email
  from public.ruined_members where id = new.member_id;
  if member_person_id is not null and member_email is not null then
    perform private.ruined_bind_member_referral(member_person_id, member_email);
  end if;
  perform private.ruined_record_member_referral_join(new.member_id);
  return new;
end
$$;
create trigger member_referral_first_activation
after insert or update of account_state, administrative_onboarding_state, billing_state, program_state, standing_state, access_started_at
on public.member_lifecycle for each row
when (new.administrative_onboarding_state = 'completed' and new.account_state = 'active')
execute function private.ruined_member_referral_activation_trigger();

create function private.ruined_member_referral_immutable_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.waitlist_id <> old.waitlist_id or new.inviter_member_id <> old.inviter_member_id or new.submitted_at <> old.submitted_at
    or (old.referred_person_id is not null and (new.referred_person_id is distinct from old.referred_person_id
      or new.referred_member_id is distinct from old.referred_member_id or new.bound_at is distinct from old.bound_at))
    or (old.joined_at is not null and new.joined_at is distinct from old.joined_at)
  then raise exception 'Referral attribution and completed joining are immutable.'; end if;
  return new;
end
$$;
create trigger member_referral_immutable before update on public.member_referrals
for each row execute function private.ruined_member_referral_immutable_trigger();

revoke all on function private.ruined_member_can_share_invitation(uuid),
  private.ruined_capture_member_referral(uuid, text), private.ruined_record_member_referral_join(uuid),
  private.ruined_bind_member_referral(uuid, text), private.ruined_member_referral_verified_email_trigger(),
  private.ruined_member_referral_activation_trigger(), private.ruined_member_referral_immutable_trigger()
from public, anon, authenticated;
commit;
