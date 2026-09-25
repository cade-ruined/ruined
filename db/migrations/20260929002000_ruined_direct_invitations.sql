begin;

-- Direct signups use the same recipient-bound card and durable delivery queue.
-- Ruined is an origin, never a fabricated member or referral owner.
alter table public.member_personal_invitations
  alter column member_id drop not null,
  add column origin text not null default 'member',
  add column billing_plan text,
  add column direct_joined_at timestamptz,
  add constraint personal_invitation_origin check (
    (origin = 'member' and member_id is not null and billing_plan is null and direct_joined_at is null)
    or (origin = 'ruined_direct' and member_id is null and membership_type = 'standard'
      and billing_plan is not null and billing_plan in ('monthly','annual')
      and inviter_name = 'Ruined' and inviter_tag is null and email_requested)
  ),
  add constraint direct_invitation_joined_after_acceptance check (
    direct_joined_at is null or (accepted_at is not null and direct_joined_at >= accepted_at)
  );
create unique index member_direct_invitations_request_idx on public.member_personal_invitations(request_id)
  where origin = 'ruined_direct';
create unique index member_direct_invitations_joining_idx on public.member_personal_invitations(accepted_member_id)
  where origin = 'ruined_direct' and accepted_member_id is not null;
create index member_direct_invitations_recipient_idx on public.member_personal_invitations(recipient_email_normalized, issued_at desc)
  where origin = 'ruined_direct';

create function private.ruined_direct_invitation_recipient_eligible(recipient_email text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select recipient_email is not null
    and not exists (select 1 from public.platform_users viewer where viewer.email_normalized = lower(btrim(recipient_email))
      and (viewer.status in ('disabled','suspended') or (
        exists(select 1 from public.platform_role_grants grant_row where grant_row.auth_user_id = viewer.auth_user_id
          and grant_row.role_slug = 'member' and grant_row.revoked_at is not null)
        and not exists(select 1 from public.platform_role_grants grant_row where grant_row.auth_user_id = viewer.auth_user_id
          and grant_row.role_slug = 'member' and grant_row.revoked_at is null))))
    and not exists (select 1 from public.ruined_members member
      left join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
      where (member.email_normalized = lower(btrim(recipient_email)) or member.person_id in (
        select person_id from public.person_email_addresses where email_normalized = lower(btrim(recipient_email)) and retired_at is null))
        and (member.deleted_at is not null or lifecycle.account_state in ('suspended','closed')
          or lifecycle.admission_state in ('declined','withdrawn')))
    and not exists (select 1 from public.people person where person.status <> 'active' and (
      person.id in (select person_id from public.person_email_addresses where email_normalized = lower(btrim(recipient_email)) and retired_at is null)
      or person.id in (select person_id from public.platform_users where email_normalized = lower(btrim(recipient_email)))))
$$;

-- A previously accepted invitation is bound to canonical identity IDs, not
-- only its original mailbox: account erasure intentionally removes that email.
create function private.ruined_direct_invitation_available(requested_invitation_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.member_personal_invitations invitation
    where invitation.id = requested_invitation_id and invitation.origin = 'ruined_direct'
      and invitation.member_id is null and invitation.membership_type = 'standard'
      and private.ruined_direct_invitation_recipient_eligible(invitation.recipient_email_normalized)
      and (invitation.accepted_member_id is null or exists (
        select 1 from public.ruined_members member
        join public.people person on person.id = member.person_id and person.status = 'active'
        join public.member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
        join public.platform_users viewer on viewer.auth_user_id = invitation.accepted_by_auth_user_id
          and viewer.member_id = member.id and viewer.person_id = member.person_id and viewer.status = 'active'
        join public.platform_role_grants grant_row on grant_row.auth_user_id = viewer.auth_user_id
          and grant_row.role_slug = 'member' and grant_row.revoked_at is null
        where member.id = invitation.accepted_member_id and member.deleted_at is null
      )))
$$;

create or replace function private.ruined_guard_personal_invitation() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Never invert a deletion's parent -> child lock order.
  if new.origin = 'member' then
    perform 1 from public.ruined_members where id = new.member_id for key share nowait;
  end if;
  if exists(select 1 from public.ruined_members where id = new.member_id and deleted_at is not null) then
    raise exception 'A deleted account cannot create or deliver invitations.';
  end if;
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.member_id is distinct from old.member_id
    or new.origin is distinct from old.origin or new.billing_plan is distinct from old.billing_plan
    or (old.direct_joined_at is not null and new.direct_joined_at is distinct from old.direct_joined_at)
    or new.request_id is distinct from old.request_id or new.public_token is distinct from old.public_token
    or new.recipient_name is distinct from old.recipient_name or new.recipient_email_normalized is distinct from old.recipient_email_normalized
    or new.inviter_name is distinct from old.inviter_name or new.inviter_tag is distinct from old.inviter_tag
    or new.email_requested is distinct from old.email_requested or new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at or new.created_at is distinct from old.created_at
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
    or (old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at)
    or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at)
    or (old.delivery_payload is not null and new.delivery_payload is distinct from old.delivery_payload)
    or (old.sent_at is not null and new.sent_at is distinct from old.sent_at)) then
    raise exception 'Create a new invitation to change its recipient or lifetime.';
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
    if new.revoked_at is not null or new.expires_at <= clock_timestamp()
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

-- Record actual paid completion once; later cancellation must not erase history.
create function private.ruined_direct_invitation_join_ready(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.ruined_member_can_share_invitation(target_member_id)
    and exists (select 1 from public.member_lifecycle lifecycle
      join public.member_onboardings onboarding on onboarding.member_id = lifecycle.member_id
      join public.ruined_members member on member.id = lifecycle.member_id and member.deleted_at is null
      where lifecycle.member_id = target_member_id and lifecycle.billing_state = 'active'
        and onboarding.state = 'completed' and onboarding.profile_completed_at is not null and onboarding.agreement_completed_at is not null
        and exists (select 1 from public.person_email_addresses address where address.person_id = member.person_id
          and address.email_normalized = member.email_normalized and address.verification_state = 'verified' and address.retired_at is null))
$$;

create function private.ruined_guard_direct_invitation_join() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.direct_joined_at is not null and (tg_op = 'INSERT' or old.direct_joined_at is null) then
    if new.origin <> 'ruined_direct' or new.accepted_at is null
      or not private.ruined_direct_invitation_join_ready(new.accepted_member_id)
      or not exists (select 1 from public.member_lifecycle lifecycle where lifecycle.member_id = new.accepted_member_id
        and lifecycle.access_started_at >= new.accepted_at)
    then raise exception 'Direct joining requires completed paid membership.'; end if;
  end if;
  return new;
end
$$;
create trigger member_direct_invitation_join_guard before insert or update on public.member_personal_invitations
  for each row execute function private.ruined_guard_direct_invitation_join();

create function private.ruined_record_direct_invitation_join() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.ruined_direct_invitation_join_ready(new.member_id) then
    update public.member_personal_invitations set direct_joined_at = clock_timestamp(), updated_at = clock_timestamp()
      where origin = 'ruined_direct' and accepted_member_id = new.member_id and accepted_at is not null and direct_joined_at is null
        and exists (select 1 from public.member_lifecycle lifecycle where lifecycle.member_id = new.member_id
          and lifecycle.access_started_at >= accepted_at);
  end if;
  return new;
end
$$;
create trigger member_direct_invitation_first_activation
  after insert or update of account_state, administrative_onboarding_state, billing_state, program_state, standing_state, access_started_at
  on public.member_lifecycle for each row
  when (new.administrative_onboarding_state = 'completed' and new.account_state = 'active')
  execute function private.ruined_record_direct_invitation_join();

-- Referral procedures continue to accept member-owned introductions only.
-- A direct invitation must never become an ordinary member's referral credit.
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
  if invitation.id is null or invitation.revoked_at is not null or invitation.expires_at <= clock_timestamp()
    or recipient_email is null or invitation.recipient_email_normalized <> lower(btrim(recipient_email))
    or not private.ruined_member_can_share_invitation(inviter_id) then
    raise exception using errcode = 'P4100', message = 'Invitation unavailable.';
  end if;
  return inviter_id;
end
$$;


revoke all on function private.ruined_direct_invitation_recipient_eligible(text),
  private.ruined_direct_invitation_available(uuid),
  private.ruined_direct_invitation_join_ready(uuid), private.ruined_guard_direct_invitation_join(),
  private.ruined_record_direct_invitation_join(), private.ruined_guard_personal_invitation(),
  private.ruined_guard_personal_invitation_acceptance(), private.ruined_require_member_invitation(text,text)
  from public, anon, authenticated;
comment on column public.member_personal_invitations.origin is 'Immutable invitation source: a member referral or a Ruined Direct self-serve signup.';
comment on column public.member_personal_invitations.billing_plan is 'Immutable direct signup plan; never grants billing benefits or complimentary access.';
comment on column public.member_personal_invitations.direct_joined_at is 'First completed paid joining from a Ruined Direct invitation; preserved after cancellation.';

commit;
