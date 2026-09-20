begin;

alter table public.member_personal_invitations
  add column accepted_at timestamptz,
  add column accepted_by_auth_user_id uuid,
  add column accepted_member_id uuid references public.ruined_members(id) on delete restrict,
  add constraint personal_invitation_acceptance_complete check (
    (accepted_at is null and accepted_by_auth_user_id is null and accepted_member_id is null)
    or (accepted_at is not null and accepted_by_auth_user_id is not null and accepted_member_id is not null
      and accepted_at >= issued_at and accepted_at < expires_at)
  );

-- Auth identities are removed by account erasure. Their audit UUID must not
-- introduce a foreign key that prevents that existing cleanup workflow.
create function private.ruined_guard_personal_invitation_acceptance() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.accepted_at is not null and (
    new.accepted_at is distinct from old.accepted_at
    or new.accepted_by_auth_user_id is distinct from old.accepted_by_auth_user_id
    or new.accepted_member_id is distinct from old.accepted_member_id
  ) then raise exception 'Invitation acceptance is immutable.'; end if;
  if new.accepted_at is not null and (tg_op = 'INSERT' or old.accepted_at is null) then
    if new.revoked_at is not null or new.expires_at <= clock_timestamp()
      or not private.ruined_member_can_share_invitation(new.member_id)
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
          and member.id <> new.member_id
      ) then raise exception using errcode = 'P4100', message = 'Invitation unavailable.'; end if;
  end if;
  return new;
end
$$;
create trigger member_personal_invitation_acceptance_guard before insert or update on public.member_personal_invitations
  for each row execute function private.ruined_guard_personal_invitation_acceptance();
revoke all on function private.ruined_guard_personal_invitation_acceptance() from public, anon, authenticated;

comment on column public.member_personal_invitations.accepted_at is
  'Verified acceptance before the fixed deadline. Grants standard membership onboarding, never paid benefits or staff access.';
comment on table public.member_personal_invitations is
  'Owner-private personalized membership invitations and durable email queue. The matching verified recipient may accept within 48 hours; public reads expose only recipient name and card.';

commit;
