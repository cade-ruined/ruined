begin;

-- Inline signup shows the invitation before requesting an email code. It keeps
-- the same recipient-bound attribution, standard funding, and 48-hour lifetime
-- without also enqueuing an invitation email. Existing emailed cards are unchanged.
alter table public.member_personal_invitations
  drop constraint personal_invitation_origin,
  add constraint personal_invitation_origin check (
    (origin = 'member' and member_id is not null and billing_plan is null and direct_joined_at is null)
    or (origin = 'ruined_direct' and member_id is null and membership_type = 'standard'
      and billing_plan is not null and billing_plan in ('monthly','annual')
      and inviter_name = 'Ruined' and inviter_tag is null)
  );

commit;
