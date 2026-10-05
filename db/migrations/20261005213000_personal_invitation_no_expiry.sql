begin;

-- Personal member invitations remain valid until canceled. Direct self-signup
-- cards and legacy reusable member links retain their existing finite lifetime.
alter table public.member_personal_invitations
  alter column expires_at drop not null,
  drop constraint personal_invitation_fixed_lifetime,
  drop constraint personal_invitation_acceptance_complete,
  drop constraint personal_invitation_bound_email;

-- This one-time conversion deliberately revives old expired personal cards.
-- Revocation, acceptance, attribution, delivery and complimentary end dates are
-- retained. Serialize against writes; only the immutable-field guard is paused.
alter table public.member_personal_invitations disable trigger member_personal_invitation_guard;
update public.member_personal_invitations set expires_at=null, version=version+1, updated_at=clock_timestamp()
  where origin='member' and expires_at is not null;
alter table public.member_personal_invitations enable trigger member_personal_invitation_guard;

alter table public.member_personal_invitations
  add constraint personal_invitation_fixed_lifetime check (
    (origin='member' and expires_at is null)
    or (origin='ruined_direct' and expires_at is not null and expires_at-issued_at=interval '48 hours')
  ),
  add constraint personal_invitation_acceptance_complete check (
    (accepted_at is null and accepted_by_auth_user_id is null and accepted_member_id is null)
    or (accepted_at is not null and accepted_by_auth_user_id is not null and accepted_member_id is not null
      and accepted_at >= issued_at and (expires_at is null or accepted_at < expires_at))
  ),
  add constraint personal_invitation_bound_email check (
    recipient_email_bound_at is null or (
      origin='member' and membership_type='standard' and recipient_phone is not null and not email_requested
      and recipient_email_normalized is not null and accepted_at is not null
      and recipient_email_bound_at >= issued_at and (expires_at is null or recipient_email_bound_at < expires_at)
    )
  );

create or replace function private.ruined_guard_personal_invitation() returns trigger
language plpgsql set search_path = '' as $$
declare binding_email boolean := false;
begin
  -- Direct self-signup still uses the table's fixed 48-hour default. Member
  -- invitations have no deadline, including writes from an older app version.
  if tg_op = 'INSERT' and new.origin = 'member' then new.expires_at := null; end if;
  -- Keep the existing parent -> invitation lock order and erasure contract.
  if new.origin = 'member' then
    perform 1 from public.ruined_members where id = new.member_id for key share nowait;
  end if;
  if exists(select 1 from public.ruined_members where id = new.member_id and deleted_at is not null) then
    raise exception 'A deleted account cannot create or deliver invitations.';
  end if;
  if tg_op = 'INSERT' and new.recipient_email_bound_at is not null then
    raise exception 'An invitation email can only be bound during verified acceptance.';
  end if;
  if tg_op = 'UPDATE' then
    -- The acceptance guard independently requires the matching verified email,
    -- active member identity and unexpired invitation on this same row update.
    binding_email := old.recipient_email_normalized is null and new.recipient_email_normalized is not null
      and old.recipient_email_bound_at is null and new.recipient_email_bound_at is not null
      and old.origin = 'member' and old.membership_type = 'standard' and old.recipient_phone is not null
      and not old.email_requested and old.accepted_at is null and new.accepted_at is not null;
    if new.id is distinct from old.id or new.member_id is distinct from old.member_id
      or new.origin is distinct from old.origin or new.billing_plan is distinct from old.billing_plan
      or (old.direct_joined_at is not null and new.direct_joined_at is distinct from old.direct_joined_at)
      or new.request_id is distinct from old.request_id or new.public_token is distinct from old.public_token
      or new.recipient_name is distinct from old.recipient_name or new.recipient_phone is distinct from old.recipient_phone
      or ((new.recipient_email_normalized is distinct from old.recipient_email_normalized
        or new.recipient_email_bound_at is distinct from old.recipient_email_bound_at) and not binding_email)
      or new.inviter_name is distinct from old.inviter_name or new.inviter_tag is distinct from old.inviter_tag
      or new.email_requested is distinct from old.email_requested or new.issued_at is distinct from old.issued_at
      or new.expires_at is distinct from old.expires_at or new.created_at is distinct from old.created_at
      or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
      or (old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at)
      or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at)
      or (old.delivery_payload is not null and new.delivery_payload is distinct from old.delivery_payload)
      or (old.sent_at is not null and new.sent_at is distinct from old.sent_at) then
      raise exception 'Create a new invitation to change its recipient or lifetime.';
    end if;
  end if;
  return new;
end
$$;

create or replace function private.ruined_guard_personal_invitation_acceptance() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.accepted_at is not null and (
    new.accepted_at is distinct from old.accepted_at
    or new.accepted_by_auth_user_id is distinct from old.accepted_by_auth_user_id
    or new.accepted_member_id is distinct from old.accepted_member_id
  ) then raise exception 'Invitation acceptance is immutable.'; end if;
  if new.accepted_at is not null and (tg_op = 'INSERT' or old.accepted_at is null) then
    if new.revoked_at is not null or (new.expires_at is not null and new.expires_at <= clock_timestamp())
      or (new.origin = 'member' and not private.ruined_member_can_share_invitation(new.member_id))
      or (new.origin = 'ruined_direct' and not private.ruined_direct_invitation_recipient_eligible(new.recipient_email_normalized))
      or not exists (
        select 1 from public.platform_users viewer
        join public.ruined_members member on member.id = new.accepted_member_id
          and member.person_id = viewer.person_id and member.deleted_at is null
        join public.member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
        join public.platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id
          and grant_row.role_slug = 'member' and grant_row.revoked_at is null
        join public.person_email_addresses address on address.person_id = member.person_id
          and address.email_normalized = new.recipient_email_normalized
          and address.verification_state = 'verified' and address.retired_at is null
        where viewer.auth_user_id = new.accepted_by_auth_user_id and viewer.status = 'active'
          and viewer.member_id = member.id
          and viewer.email_normalized = new.recipient_email_normalized
          and member.email_normalized = new.recipient_email_normalized
          and (new.origin = 'ruined_direct' or member.id <> new.member_id)
      ) then raise exception using errcode = 'P4100', message = 'Invitation unavailable.'; end if;
  end if;
  return new;
end
$$;

create or replace function private.ruined_guard_member_complimentary_grant() returns trigger
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
        and invitation.revoked_at is null and (invitation.expires_at is null or invitation.expires_at > clock_timestamp())
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

create or replace function private.ruined_redeem_complimentary_invitation(invitation_id uuid, member_id uuid, auth_user_id uuid)
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
    or invitation.revoked_at is not null or (invitation.expires_at is not null and invitation.expires_at <= clock_timestamp())
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

create or replace function private.ruined_require_member_invitation(invitation_token text, recipient_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inviter_id uuid; invitation public.member_personal_invitations%rowtype;
begin
  if invitation_token is null or invitation_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'P4100', message = 'Invitation unavailable.';
  end if;
  if exists (select 1 from public.member_personal_invitations where public_token = invitation_token and origin = 'ruined_direct') then
    raise exception using errcode = 'P4100', message = 'Invitation unavailable.';
  end if;
  select member_id into inviter_id from public.member_personal_invitations where public_token = invitation_token;
  if inviter_id is null then return private.ruined_require_member_invitation(invitation_token); end if;
  perform 1 from public.ruined_members where id = inviter_id for key share;
  select * into invitation from public.member_personal_invitations where public_token = invitation_token for update;
  if invitation.id is null or invitation.revoked_at is not null or (invitation.expires_at is not null and invitation.expires_at <= clock_timestamp())
    or recipient_email is null or invitation.recipient_email_normalized is null
    or invitation.recipient_email_normalized is distinct from lower(btrim(recipient_email))
    or not private.ruined_member_can_share_invitation(inviter_id) then
    raise exception using errcode = 'P4100', message = 'Invitation unavailable.';
  end if;
  return inviter_id;
end
$$;

comment on column public.member_personal_invitations.expires_at is
  'Null for member-source personal invitations. Ruined Direct self-signup invitations retain their fixed 48-hour deadline.';
comment on column public.member_personal_invitations.accepted_at is
  'Verified, immutable acceptance. Member-source cards last until canceled; direct signup must be accepted before its deadline.';
comment on table public.member_personal_invitations is
  'Owner-private personalized membership invitations and durable email queue. Personal member cards have no expiration; direct signup cards keep their deadline. Public reads expose only recipient name and card.';
revoke all on function private.ruined_guard_personal_invitation(), private.ruined_guard_personal_invitation_acceptance(),
  private.ruined_guard_member_complimentary_grant(), private.ruined_redeem_complimentary_invitation(uuid,uuid,uuid),
  private.ruined_require_member_invitation(text,text) from public, anon, authenticated;

commit;
