begin;

-- Text sharing uses the same private invitation and referral record. A phone
-- number is a delivery destination, never evidence of verified phone ownership.
alter table public.member_personal_invitations
  alter column recipient_email_normalized drop not null,
  add column recipient_phone text check (recipient_phone ~ '^[+][1-9][0-9]{6,14}$'),
  add column recipient_email_bound_at timestamptz,
  add constraint personal_invitation_contact_required check (
    recipient_email_normalized is not null or (
      origin = 'member' and membership_type = 'standard' and recipient_phone is not null
      and not email_requested and accepted_at is null
    )
  ),
  add constraint personal_invitation_bound_email check (
    recipient_email_bound_at is null or (
      origin = 'member' and membership_type = 'standard' and recipient_phone is not null
      and not email_requested and recipient_email_normalized is not null and accepted_at is not null
      and recipient_email_bound_at >= issued_at and recipient_email_bound_at < expires_at
    )
  );
create index member_personal_invitations_phone_idx
  on public.member_personal_invitations(member_id, recipient_phone, expires_at)
  where recipient_phone is not null;

create or replace function private.ruined_guard_personal_invitation() returns trigger
language plpgsql set search_path = '' as $$
declare binding_email boolean := false;
begin
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

-- An unbound text invitation is accepted only through verified sign-in. Raw
-- waitlist submissions and referral helpers must not claim its email first.
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
    or recipient_email is null or invitation.recipient_email_normalized is null
    or invitation.recipient_email_normalized is distinct from lower(btrim(recipient_email))
    or not private.ruined_member_can_share_invitation(inviter_id) then
    raise exception using errcode = 'P4100', message = 'Invitation unavailable.';
  end if;
  return inviter_id;
end
$$;

comment on column public.member_personal_invitations.recipient_phone is
  'Owner-private E.164 destination for user-controlled text sharing. Not verified ownership or SMS delivery evidence.';
comment on column public.member_personal_invitations.recipient_email_bound_at is
  'Only phone-only standard invitations bind an email during their first verified acceptance; this binding is immutable.';
revoke all on function private.ruined_guard_personal_invitation(), private.ruined_require_member_invitation(text,text)
  from public, anon, authenticated;

commit;
