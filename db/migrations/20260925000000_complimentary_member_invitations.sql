begin;

-- The invitation grants admission. Its independently recorded funding benefit
-- waives payment without granting any operator role or changing member order.
alter table public.member_personal_invitations
  add column membership_type text not null default 'standard',
  add column complimentary_reason text,
  add column complimentary_ends_at timestamptz,
  add column complimentary_authorized_by_auth_user_id uuid,
  add constraint personal_invitation_membership_benefit check (
    (membership_type = 'standard' and complimentary_reason is null
      and complimentary_ends_at is null and complimentary_authorized_by_auth_user_id is null)
    or (membership_type = 'complimentary'
      and char_length(btrim(complimentary_reason)) between 1 and 500
      and complimentary_reason is not null and complimentary_authorized_by_auth_user_id is not null
      and (complimentary_ends_at is null or (isfinite(complimentary_ends_at) and complimentary_ends_at > issued_at)))
  );

create function private.ruined_can_authorize_complimentary_invitation(requested_member_id uuid, requested_auth_user_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.platform_users viewer
    join public.platform_role_grants admin_grant on admin_grant.auth_user_id = viewer.auth_user_id
      and admin_grant.role_slug = 'ops_admin' and admin_grant.revoked_at is null
    join public.platform_role_grants member_grant on member_grant.auth_user_id = viewer.auth_user_id
      and member_grant.role_slug = 'member' and member_grant.revoked_at is null
    join public.ruined_members member on member.id = requested_member_id and member.person_id = viewer.person_id
      and member.deleted_at is null
    join public.people person on person.id = member.person_id and person.status = 'active'
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
    where viewer.auth_user_id = requested_auth_user_id and viewer.member_id = member.id and viewer.status = 'active'
  )
$$;

create function private.ruined_guard_personal_invitation_benefit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.membership_type is distinct from old.membership_type
      or new.complimentary_reason is distinct from old.complimentary_reason
      or new.complimentary_ends_at is distinct from old.complimentary_ends_at
      or new.complimentary_authorized_by_auth_user_id is distinct from old.complimentary_authorized_by_auth_user_id
    then raise exception 'Create a new invitation to change its membership benefit.'; end if;
  elsif new.membership_type = 'complimentary' then
    -- The application supplies the authenticated actor, never a request-body
    -- actor. This second check pins their current canonical admin grant.
    perform grant_row.id from public.platform_role_grants grant_row
    join public.platform_users viewer on viewer.auth_user_id = grant_row.auth_user_id
    join public.ruined_members member on member.id = new.member_id
      and member.person_id = viewer.person_id and member.deleted_at is null
    join public.people person on person.id = member.person_id and person.status = 'active'
    where viewer.auth_user_id = new.complimentary_authorized_by_auth_user_id
      and viewer.member_id = member.id and viewer.status = 'active'
      and grant_row.role_slug = 'ops_admin' and grant_row.revoked_at is null
    for share of viewer, grant_row;
    if not found or not private.ruined_can_authorize_complimentary_invitation(new.member_id, new.complimentary_authorized_by_auth_user_id)
      or (new.complimentary_ends_at is not null and new.complimentary_ends_at <= clock_timestamp()) then
      raise exception using errcode = 'P4101', message = 'Only an active administrator may authorize complimentary membership.';
    end if;
  end if;
  return new;
end
$$;
create trigger member_personal_invitation_benefit_guard before insert or update on public.member_personal_invitations
  for each row execute function private.ruined_guard_personal_invitation_benefit();

create table public.member_complimentary_grants (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  source_invitation_id uuid unique references public.member_personal_invitations(id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  granted_by_auth_user_id uuid not null,
  starts_at timestamptz not null default statement_timestamp() check (isfinite(starts_at)),
  ends_at timestamptz check (ends_at is null or (isfinite(ends_at) and ends_at > starts_at)),
  revoked_at timestamptz check (revoked_at is null or (isfinite(revoked_at) and revoked_at >= starts_at)),
  revoked_by_auth_user_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (revoked_by_auth_user_id is null or revoked_at is not null)
);
create index member_complimentary_grants_current_idx on public.member_complimentary_grants(member_id, ends_at)
  where revoked_at is null;
alter table public.member_complimentary_grants enable row level security;
revoke all on public.member_complimentary_grants from public, anon, authenticated;

create function private.ruined_personal_invitation_benefit_available(requested_invitation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select invitation.membership_type = 'standard' or (
    invitation.membership_type = 'complimentary' and (
      (invitation.accepted_at is null
        and (invitation.complimentary_ends_at is null or invitation.complimentary_ends_at > clock_timestamp())
        and private.ruined_can_authorize_complimentary_invitation(invitation.member_id, invitation.complimentary_authorized_by_auth_user_id))
      or (invitation.accepted_at is not null and exists (
        select 1 from public.member_complimentary_grants funding where funding.source_invitation_id = invitation.id
          and funding.member_id = invitation.accepted_member_id and funding.revoked_at is null
          and funding.starts_at <= clock_timestamp() and (funding.ends_at is null or funding.ends_at > clock_timestamp())
      ))
    )) from public.member_personal_invitations invitation where invitation.id = requested_invitation_id), false)
$$;

create function private.ruined_guard_member_complimentary_grant() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Complimentary funding history must be retained.'; end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.member_personal_invitations invitation
      where invitation.id = new.source_invitation_id and invitation.membership_type = 'complimentary'
        and invitation.accepted_member_id = new.member_id and invitation.accepted_at = new.starts_at
        and invitation.complimentary_reason = new.reason
        and invitation.complimentary_ends_at is not distinct from new.ends_at
        and invitation.complimentary_authorized_by_auth_user_id = new.granted_by_auth_user_id
        and private.ruined_can_authorize_complimentary_invitation(invitation.member_id, new.granted_by_auth_user_id)
        and invitation.revoked_at is null and invitation.expires_at > clock_timestamp()
        and (invitation.complimentary_ends_at is null or invitation.complimentary_ends_at > clock_timestamp()))
    then raise exception 'Complimentary funding requires a matching accepted invitation.'; end if;
  elsif new.id is distinct from old.id or new.member_id is distinct from old.member_id
    or new.reason is distinct from old.reason or new.granted_by_auth_user_id is distinct from old.granted_by_auth_user_id
    or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
    or new.created_at is distinct from old.created_at
    or (new.source_invitation_id is distinct from old.source_invitation_id
      and not (new.source_invitation_id is null and old.source_invitation_id is not null and not exists (
        select 1 from public.member_personal_invitations invitation where invitation.id = old.source_invitation_id)))
    or (old.revoked_at is not null and (new.revoked_at is distinct from old.revoked_at
      or new.revoked_by_auth_user_id is distinct from old.revoked_by_auth_user_id))
  then raise exception 'Complimentary funding history is immutable; revoked access cannot be restored.'; end if;
  if new.revoked_at is not null and (tg_op = 'INSERT' or old.revoked_at is null) then
    perform admin_grant.id from public.platform_role_grants admin_grant
    join public.platform_users viewer on viewer.auth_user_id = admin_grant.auth_user_id and viewer.status = 'active'
    join public.people person on person.id = viewer.person_id and person.status = 'active'
    where viewer.auth_user_id = new.revoked_by_auth_user_id and admin_grant.role_slug = 'ops_admin' and admin_grant.revoked_at is null
    for share of viewer, admin_grant;
    if not found then raise exception using errcode = 'P4101', message = 'Only an active administrator may end complimentary membership.'; end if;
  end if;
  return new;
end
$$;
create trigger member_complimentary_grant_guard before insert or update or delete on public.member_complimentary_grants
  for each row execute function private.ruined_guard_member_complimentary_grant();

create or replace function private.ruined_member_has_complimentary_funding(requested_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.ruined_member_has_operator_funding(requested_member_id) or exists (
    select 1 from public.member_complimentary_grants funding
    join public.ruined_members member on member.id = funding.member_id and member.deleted_at is null
    join public.people person on person.id = member.person_id and person.status = 'active'
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
    join public.platform_users viewer on viewer.member_id = member.id and viewer.person_id = member.person_id
      and viewer.status = 'active'
    join public.platform_role_grants member_grant on member_grant.auth_user_id = viewer.auth_user_id
      and member_grant.role_slug = 'member' and member_grant.revoked_at is null
    where funding.member_id = requested_member_id and funding.revoked_at is null
      and funding.starts_at <= clock_timestamp() and (funding.ends_at is null or funding.ends_at > clock_timestamp())
  )
$$;

create or replace function private.ruined_lock_member_complimentary_funding(requested_member_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform private.ruined_lock_member_operator_funding(requested_member_id);
  perform funding.id from public.member_complimentary_grants funding
  where funding.member_id = requested_member_id and funding.revoked_at is null
  order by funding.id for share of funding;
  return private.ruined_member_has_complimentary_funding(requested_member_id);
end
$$;

create function private.ruined_redeem_complimentary_invitation(invitation_id uuid, member_id uuid, auth_user_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare invitation public.member_personal_invitations%rowtype; grant_id uuid;
begin
  select * into invitation from public.member_personal_invitations where id = invitation_id for update;
  if invitation.id is null or invitation.accepted_member_id is distinct from $2
    or invitation.accepted_by_auth_user_id is distinct from $3 or invitation.accepted_at is null
  then raise exception using errcode = 'P4100', message = 'Invitation unavailable.'; end if;
  if invitation.membership_type = 'standard' then return null; end if;
  -- An already redeemed invitation can never extend or restore its funding.
  select funding.id into grant_id from public.member_complimentary_grants funding where funding.source_invitation_id = invitation_id;
  if grant_id is not null then return grant_id; end if;
  -- Claim already holds this row. Keep the same serialization contract for any
  -- future direct server caller; checkout reserves against this member too.
  perform member.id from public.ruined_members member where member.id = $2 for update;
  -- Do not promise a payment waiver while a recurring paid subscription keeps
  -- charging, or an existing open checkout can still be paid. Existing billing
  -- must be resolved deliberately, never cancelled by accepting a link.
  if exists (select 1 from public.member_lifecycle lifecycle where lifecycle.member_id = $2 and lifecycle.billing_state = 'active')
    or exists (select 1 from public.stripe_subscriptions subscription where subscription.member_id = $2
      and subscription.stripe_status not in ('canceled', 'incomplete_expired'))
    or exists (select 1 from public.stripe_checkout_attempts attempt where attempt.member_id = $2
      and attempt.status not in ('completed', 'expired', 'failed'))
    or exists (select 1 from public.stripe_checkout_sessions checkout where checkout.member_id = $2
      and (checkout.session_status is null or checkout.session_status not in ('complete', 'expired')))
  then raise exception using errcode = 'P4102', message = 'Resolve existing membership billing before accepting complimentary membership.'; end if;
  perform grant_row.id from public.platform_role_grants grant_row
  join public.platform_users viewer on viewer.auth_user_id = grant_row.auth_user_id
  join public.ruined_members owner on owner.id = invitation.member_id
    and owner.person_id = viewer.person_id and owner.deleted_at is null
  join public.people person on person.id = owner.person_id and person.status = 'active'
  where viewer.auth_user_id = invitation.complimentary_authorized_by_auth_user_id
    and viewer.member_id = owner.id and viewer.status = 'active'
    and grant_row.role_slug = 'ops_admin' and grant_row.revoked_at is null
  for share of viewer, grant_row;
  if not found or not private.ruined_can_authorize_complimentary_invitation(invitation.member_id, invitation.complimentary_authorized_by_auth_user_id)
    or invitation.revoked_at is not null or invitation.expires_at <= clock_timestamp()
    or (invitation.complimentary_ends_at is not null and invitation.complimentary_ends_at <= clock_timestamp())
    or not private.ruined_member_can_share_invitation(invitation.member_id)
    or not exists (
      select 1 from public.platform_users viewer
      join public.ruined_members member on member.id = $2 and member.person_id = viewer.person_id and member.deleted_at is null
      join public.people person on person.id = member.person_id and person.status = 'active'
      join public.member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
      join public.platform_role_grants member_grant on member_grant.auth_user_id = viewer.auth_user_id
        and member_grant.role_slug = 'member' and member_grant.revoked_at is null
      join public.person_email_addresses address on address.person_id = member.person_id
        and address.email_normalized = invitation.recipient_email_normalized
        and address.verification_state = 'verified' and address.retired_at is null
      where viewer.auth_user_id = $3 and viewer.member_id = member.id and viewer.status = 'active'
        and viewer.email_normalized = invitation.recipient_email_normalized and member.email_normalized = invitation.recipient_email_normalized
    ) then raise exception using errcode = 'P4100', message = 'Invitation unavailable.'; end if;
  insert into public.member_complimentary_grants(member_id, source_invitation_id, reason, granted_by_auth_user_id, starts_at, ends_at)
  values ($2, invitation.id, invitation.complimentary_reason, invitation.complimentary_authorized_by_auth_user_id,
    invitation.accepted_at, invitation.complimentary_ends_at)
  returning id into grant_id;
  return grant_id;
end
$$;

revoke all on function private.ruined_guard_personal_invitation_benefit(), private.ruined_guard_member_complimentary_grant(),
  private.ruined_member_has_complimentary_funding(uuid), private.ruined_lock_member_complimentary_funding(uuid),
  private.ruined_redeem_complimentary_invitation(uuid,uuid,uuid),
  private.ruined_can_authorize_complimentary_invitation(uuid,uuid),
  private.ruined_personal_invitation_benefit_available(uuid) from public, anon, authenticated;

comment on table public.member_complimentary_grants is 'Independent payment waivers issued through verified personal invitations. No staff role is granted. Audit survives owner invitation erasure and recipient account deletion.';
comment on column public.member_personal_invitations.membership_type is 'Immutable membership payment terms authorized at invitation creation. Standard is paid; complimentary requires a current administrator.';

-- Replace only funding predicates. Existing lifecycle, verification, agreement,
-- referral and permanent member-number safeguards remain unchanged.
create or replace function private.ruined_validate_member_onboarding_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle_record public.member_lifecycle%rowtype;
  member_person_id uuid;
begin
  if new.state <> 'completed'
     or (tg_op = 'UPDATE' and old.state = 'completed') then
    return new;
  end if;

  select lifecycle.*
  into lifecycle_record
  from public.member_lifecycle lifecycle
  where lifecycle.member_id = new.member_id;

  select member.person_id
  into member_person_id
  from public.ruined_members member
  where member.id = new.member_id;

  if lifecycle_record.billing_state <> 'active'
     and not private.ruined_member_has_complimentary_funding(new.member_id) then
    raise exception 'Active billing or complimentary membership access is required to complete administrative onboarding.';
  end if;

  if new.profile_completed_at is null
     or new.agreement_completed_at is null
     or (new.billing_confirmed_at is null
       and not private.ruined_member_has_complimentary_funding(new.member_id)) then
    raise exception 'Profile, agreement, and billing checkpoints are required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.person_profiles profile
    where profile.person_id = member_person_id
      and coalesce(profile.preferred_name, profile.display_name) is not null
  ) then
    raise exception 'A named Person profile is required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.platform_users platform_user
    join public.platform_role_grants role_grant
      on role_grant.auth_user_id = platform_user.auth_user_id
      and role_grant.role_slug = 'member'
      and role_grant.revoked_at is null
    join public.person_email_addresses email_address
      on email_address.person_id = platform_user.person_id
      and email_address.verification_state = 'verified'
      and email_address.retired_at is null
    where platform_user.person_id = member_person_id
      and platform_user.status = 'active'
  ) then
    raise exception 'An active member login and verified email are required to complete administrative onboarding.';
  end if;

  if not exists (
    select 1
    from public.membership_agreement_acceptances acceptance
    where acceptance.member_id = new.member_id
      and acceptance.person_id = member_person_id
      and acceptance.accepted_at <= new.agreement_completed_at
  ) then
    raise exception 'A durable agreement acceptance is required to complete administrative onboarding.';
  end if;

  if new.started_at is null then
    new.started_at := statement_timestamp();
  end if;
  if new.completed_at is null then
    new.completed_at := statement_timestamp();
  end if;

  return new;
end;
$$;

create or replace function private.ruined_current_active_access_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member on member.person_id = platform_user.person_id
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  join public.platform_role_grants member_grant
    on member_grant.auth_user_id = platform_user.auth_user_id
    and member_grant.role_slug = 'member' and member_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
    and (lifecycle.billing_state = 'active' or private.ruined_member_has_complimentary_funding(member.id))
    and lifecycle.administrative_onboarding_state = 'completed'
    and (
      lifecycle.standing_state = 'active'
      or (lifecycle.standing_state = 'cancellation_requested'
          and lifecycle.cancellation_effective_at > statement_timestamp())
    )
  limit 1
$$;

create or replace function private.ruined_current_updates_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select member.id
  from public.platform_users platform_user
  join public.ruined_members member on member.person_id = platform_user.person_id
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  join public.platform_role_grants member_grant
    on member_grant.auth_user_id = platform_user.auth_user_id
    and member_grant.role_slug = 'member' and member_grant.revoked_at is null
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
    and (lifecycle.billing_state = 'active' or private.ruined_member_has_complimentary_funding(member.id))
    and lifecycle.administrative_onboarding_state = 'completed'
    and (
      lifecycle.standing_state = 'active'
      or (lifecycle.standing_state = 'cancellation_requested'
          and lifecycle.cancellation_effective_at > statement_timestamp())
    )
  limit 1
$$;

create or replace function private.ruined_member_can_share_invitation(target_member_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ruined_members member
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
    where member.id = target_member_id and lifecycle.account_state = 'active'
      and lifecycle.administrative_onboarding_state = 'completed'
      and lifecycle.program_state in ('onboarding', 'active')
      and (lifecycle.billing_state = 'active' or private.ruined_member_has_complimentary_funding(member.id))
      and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested'
        and lifecycle.cancellation_effective_at > statement_timestamp()))
      and exists (select 1 from public.platform_users viewer
        join public.platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id
          and grant_row.role_slug = 'member' and grant_row.revoked_at is null
        where viewer.person_id = member.person_id and viewer.status = 'active')
  )
$$;

create or replace function private.ruined_allocate_member_number(target_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare existing_number integer; first_access timestamptz; next_number integer; eligibility_check integer;
begin
  -- Immutable assigned numbers, incomplete entries, and test-only accounts do
  -- not add a member row lock to unrelated lifecycle updates.
  select member_number into existing_number from public.ruined_members
  where id = target_member_id;
  if not found or existing_number is not null then return; end if;
  -- Check eligibility before taking the member lock, then again after obtaining
  -- it. Actual first-entry writers use member-before-lifecycle order.
  for eligibility_check in 1..2 loop
  select coalesce(lifecycle.access_started_at, onboarding.completed_at, member.membership_activated_at)
  into first_access
  from public.ruined_members member
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  join public.member_onboardings onboarding on onboarding.member_id = member.id
  where member.id = target_member_id and member.person_id is not null
    and lifecycle.account_state = 'active' and lifecycle.administrative_onboarding_state = 'completed'
    and lifecycle.program_state in ('onboarding', 'active')
    and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested'
      and lifecycle.cancellation_effective_at > statement_timestamp()))
    and onboarding.state = 'completed'
    and (private.ruined_member_has_complimentary_funding(member.id) or (lifecycle.billing_state = 'active' and exists (
      select 1 from public.stripe_invoices invoice join public.stripe_webhook_events event
        on event.object_id = invoice.id and event.event_type = 'invoice.paid' and event.livemode
          and event.status in ('processing', 'processed')
      where invoice.member_id = member.id and invoice.purpose = 'membership' and invoice.stripe_status = 'paid'
    )));
  if first_access is null or not isfinite(first_access) or first_access > statement_timestamp() then return; end if;
  if eligibility_check = 1 then
    select member_number into existing_number from public.ruined_members
    where id = target_member_id for update;
    if not found or existing_number is not null then return; end if;
  end if;
  end loop;
  update private.member_number_counter set last_number = last_number + 1
  where singleton returning last_number into next_number;
  if next_number is null then raise exception 'The member number counter is unavailable.'; end if;
  insert into private.member_number_assignments(member_number, member_id, activated_at)
  values (next_number, target_member_id, first_access);
  update public.ruined_members set member_number = next_number where id = target_member_id;
end
$$;

commit;
