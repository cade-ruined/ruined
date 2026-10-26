begin;

-- Private, resumable profile guidance. Actual profile/Journal progress is derived
-- from existing evidence, rather than accepting completion claims from a client.
create table public.member_welcome_state (
  member_id uuid primary key references public.ruined_members(id) on delete cascade,
  dismissed_at timestamptz,
  calendar_viewed_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);

alter table public.member_welcome_state enable row level security;
revoke all on public.member_welcome_state from public, anon, authenticated;
grant select, insert, update, delete on public.member_welcome_state to service_role;

comment on table public.member_welcome_state is
  'Server-only, owner-bound profile welcome preferences. Contains no Journal content or public profile fields.';

commit;
