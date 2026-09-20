begin;

-- A new row is a new invitation. Legacy reusable links keep their own table and
-- deadlines; creating one recipient's invitation never replaces another's.
create table public.member_personal_invitations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete cascade,
  request_id uuid not null,
  public_token text not null unique check (public_token ~ '^[A-Za-z0-9_-]{43}$'),
  recipient_name text not null check (char_length(btrim(recipient_name)) between 1 and 100),
  recipient_email_normalized text not null check (char_length(recipient_email_normalized) between 3 and 254
    and recipient_email_normalized = lower(btrim(recipient_email_normalized))
    and recipient_email_normalized ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'),
  inviter_name text not null,
  inviter_tag text,
  email_requested boolean not null,
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '48 hours'),
  revoked_at timestamptz,
  submitted_at timestamptz,
  version integer not null default 1 check (version > 0),
  delivery_status text not null default 'not_requested'
    check (delivery_status in ('not_requested','queued','sending','sent','failed','cancelled')),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz,
  delivery_locked_at timestamptz,
  delivery_lock_token uuid,
  last_error_code text check (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  resend_email_id text,
  sent_at timestamptz,
  delivery_payload jsonb,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (member_id, request_id),
  constraint personal_invitation_fixed_lifetime check (expires_at - issued_at = interval '48 hours')
);
create index member_personal_invitations_owner_idx on public.member_personal_invitations(member_id, issued_at desc, id);
create index member_personal_invitations_recipient_idx on public.member_personal_invitations(member_id, recipient_email_normalized, expires_at);
create index member_personal_invitations_delivery_idx on public.member_personal_invitations(next_attempt_at, id)
  where delivery_status in ('queued','sending','failed');
alter table public.member_personal_invitations enable row level security;
revoke all on public.member_personal_invitations from public, anon, authenticated;
comment on table public.member_personal_invitations is 'Owner-private recipient history and durable email queue. Public reads expose only the recipient name and invitation card. Each link expires exactly 48 hours after creation.';

alter table public.member_referrals add column personal_invitation_id uuid
  references public.member_personal_invitations(id) on delete set null;
create unique index member_referrals_personal_invitation_idx on public.member_referrals(personal_invitation_id)
  where personal_invitation_id is not null;

create function private.ruined_guard_personal_invitation() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Never invert a deletion's parent -> child lock order.
  perform 1 from public.ruined_members where id = new.member_id for key share nowait;
  if exists(select 1 from public.ruined_members where id = new.member_id and deleted_at is not null) then
    raise exception 'A deleted account cannot create or deliver invitations.';
  end if;
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.member_id is distinct from old.member_id
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
create trigger member_personal_invitation_guard before insert or update on public.member_personal_invitations
  for each row execute function private.ruined_guard_personal_invitation();

create function private.ruined_guard_personal_referral() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.personal_invitation_id is distinct from old.personal_invitation_id then
    if not (new.personal_invitation_id is null and exists(
      select 1 from public.ruined_members where id = old.inviter_member_id and deleted_at is not null
    )) then raise exception 'The original personal invitation cannot be replaced.'; end if;
  end if;
  if new.personal_invitation_id is not null and not exists(
    select 1 from public.member_personal_invitations where id = new.personal_invitation_id and member_id = new.inviter_member_id
  ) then raise exception 'The invitation must belong to the original inviter.'; end if;
  return new;
end
$$;
create trigger member_personal_referral_guard before insert or update on public.member_referrals
  for each row execute function private.ruined_guard_personal_referral();

create function private.ruined_erase_personal_invitations() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Member deletion retains the existing historical record, not recipient PII
  -- or email payloads. Referral totals survive with their original inviter.
  delete from public.member_personal_invitations where member_id = new.id;
  return new;
end
$$;
create trigger member_personal_invitations_erasure after update of deleted_at on public.ruined_members
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.ruined_erase_personal_invitations();

-- The original one-argument validator still protects legacy links. Personal
-- links require the matching recipient email before any waitlist write.
create function private.ruined_require_member_invitation(invitation_token text, recipient_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inviter_id uuid; invitation public.member_personal_invitations%rowtype;
begin
  if invitation_token is null or invitation_token !~ '^[A-Za-z0-9_-]{43}$' then
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

create function private.ruined_mark_personal_invitation_submission(invitation_token text, recipient_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ruined_require_member_invitation(invitation_token, recipient_email);
  update public.member_personal_invitations set submitted_at = coalesce(submitted_at, clock_timestamp()), updated_at = statement_timestamp()
    where public_token = invitation_token and submitted_at is null;
end
$$;

create or replace function private.ruined_capture_member_referral(target_waitlist_id uuid, invitation_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_email text; inviter_id uuid; inviter_person uuid; personal_id uuid;
begin
  select email_normalized into target_email from public.membership_waitlist where id = target_waitlist_id;
  if target_email is null then return; end if;
  inviter_id := private.ruined_require_member_invitation(invitation_token, target_email);
  select person_id into inviter_person from public.ruined_members where id = inviter_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(target_email), 1);
  perform private.ruined_require_member_invitation(invitation_token, target_email);
  perform private.ruined_mark_personal_invitation_submission(invitation_token, target_email);
  select id into personal_id from public.member_personal_invitations where public_token = invitation_token;
  if exists (select 1 from public.person_email_addresses address
    where address.person_id = inviter_person and address.email_normalized = target_email and address.retired_at is null)
    or exists (select 1 from public.ruined_members member where member.id = inviter_id and member.email_normalized = target_email)
    or exists (select 1 from public.person_email_addresses address
      join public.ruined_members member on member.person_id = address.person_id
      join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
      where address.email_normalized = target_email and address.retired_at is null
        and (lifecycle.access_started_at is not null or lifecycle.administrative_onboarding_state = 'completed'))
  then return; end if;
  insert into public.member_referrals(waitlist_id, inviter_member_id, personal_invitation_id)
  values (target_waitlist_id, inviter_id, personal_id) on conflict (waitlist_id) do nothing;
end
$$;

revoke all on function private.ruined_guard_personal_invitation(), private.ruined_guard_personal_referral(),
  private.ruined_erase_personal_invitations(), private.ruined_require_member_invitation(text,text),
  private.ruined_mark_personal_invitation_submission(text,text), private.ruined_capture_member_referral(uuid,text)
  from public, anon, authenticated;

commit;
