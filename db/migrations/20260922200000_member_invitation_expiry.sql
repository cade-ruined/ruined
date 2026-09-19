begin;

-- Old links retain their original issuance date; deploying this change must not
-- give already-shared invitations another 48 hours.
alter table public.member_invitations
  add column issued_at timestamptz,
  add column expires_at timestamptz;
update public.member_invitations
  set issued_at = created_at, expires_at = created_at + interval '48 hours';
alter table public.member_invitations
  alter column issued_at set not null,
  alter column issued_at set default statement_timestamp(),
  alter column expires_at set not null,
  alter column expires_at set default (statement_timestamp() + interval '48 hours'),
  add constraint member_invitation_fixed_lifetime
    check (expires_at - issued_at = interval '48 hours');
comment on table public.member_invitations is 'Explicit member sharing consent. Each opaque public introduction expires 48 hours after issue and grants no admission or account access.';

-- Hold the invitation through the waitlist transaction, so renewal/withdrawal
-- cannot replace the token between validation and attribution. Check the clock
-- after acquiring the lock: a transaction waiting on another write may expire.
create function private.ruined_require_member_invitation(invitation_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inviter_id uuid; invitation_expires_at timestamptz;
begin
  if invitation_token is null or invitation_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'P4100', message = 'Invitation unavailable.';
  end if;
  -- Renewal and deletion lock the member before its invitation. Acquire the
  -- referenced member first too, avoiding the reverse order when the referral
  -- insert later checks its foreign key.
  select member_id into inviter_id from public.member_invitations where public_token = invitation_token;
  perform 1 from public.ruined_members where id = inviter_id for key share;
  select member_id, expires_at into inviter_id, invitation_expires_at
  from public.member_invitations
  where public_token = invitation_token and enabled
  for share;
  if inviter_id is null or invitation_expires_at <= clock_timestamp()
    or not private.ruined_member_can_share_invitation(inviter_id) then
    raise exception using errcode = 'P4100', message = 'Invitation unavailable.';
  end if;
  return inviter_id;
end
$$;

-- The waitlist endpoint checks before inserting. Keep the same protection here
-- for other server callers, with no fallback to an unattributed submission.
create or replace function private.ruined_capture_member_referral(target_waitlist_id uuid, invitation_token text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_email text; inviter_id uuid; inviter_person uuid;
begin
  -- Validate even direct database calls; any failure rolls back the new interest row.
  inviter_id := private.ruined_require_member_invitation(invitation_token);
  select person_id into inviter_person from public.ruined_members where id = inviter_id;
  select email_normalized into target_email from public.membership_waitlist where id = target_waitlist_id;
  if target_email is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(target_email), 1);
  -- Waiting for another submission of this email can cross the deadline even
  -- while this transaction holds the invitation row. Recheck after that wait.
  perform private.ruined_require_member_invitation(invitation_token);
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

revoke all on function private.ruined_require_member_invitation(text),
  private.ruined_capture_member_referral(uuid, text) from public, anon, authenticated;

commit;
