begin;

-- Blocks are the durable layer above Circles. Assignments are temporal so a
-- Circle can move without erasing where it previously belonged.
create table if not exists public.membership_blocks (
  id uuid primary key,
  name text not null
    check (char_length(btrim(name)) between 2 and 80),
  slug text not null unique
    check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'forming'
    check (status in ('forming', 'active', 'completed', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  activated_at timestamptz,
  created_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  activated_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  check (
    status <> 'active'
    or (
      starts_at is not null
      and activated_at is not null
      and activated_by_auth_user_id is not null
    )
  )
);

create table if not exists public.block_circle_assignments (
  id bigint generated always as identity primary key,
  block_id uuid not null
    references public.membership_blocks(id) on delete restrict,
  circle_id uuid not null
    references public.circles(id) on delete restrict,
  assigned_by_auth_user_id uuid not null
    references public.platform_users(auth_user_id) on delete restrict,
  assigned_at timestamptz not null default statement_timestamp(),
  ended_at timestamptz,
  ended_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete restrict,
  end_reason text,
  created_at timestamptz not null default statement_timestamp(),
  check (ended_at is null or ended_at >= assigned_at),
  check (
    (ended_at is null and ended_by_auth_user_id is null and end_reason is null)
    or
    (ended_at is not null and ended_by_auth_user_id is not null and nullif(btrim(end_reason), '') is not null)
  )
);

-- A Circle can belong to exactly one current Block. Historical assignments
-- remain queryable after ended_at is recorded.
create unique index if not exists block_circle_assignments_one_current_circle_idx
  on public.block_circle_assignments(circle_id)
  where ended_at is null;

-- PostgreSQL does not create indexes for referencing columns. Keep complete
-- indexes for FK maintenance and narrow partial indexes for current rosters.
create index if not exists membership_blocks_created_by_idx
  on public.membership_blocks(created_by_auth_user_id);
create index if not exists membership_blocks_activated_by_idx
  on public.membership_blocks(activated_by_auth_user_id);
create index if not exists block_circle_assignments_block_idx
  on public.block_circle_assignments(block_id);
create index if not exists block_circle_assignments_circle_idx
  on public.block_circle_assignments(circle_id);
create index if not exists block_circle_assignments_assigned_by_idx
  on public.block_circle_assignments(assigned_by_auth_user_id);
create index if not exists block_circle_assignments_ended_by_idx
  on public.block_circle_assignments(ended_by_auth_user_id);
create index if not exists block_circle_assignments_current_block_idx
  on public.block_circle_assignments(block_id, circle_id)
  where ended_at is null;

-- Lock the Block before accepting a current Circle assignment. Block
-- activation takes the same lock, so it cannot race the two-Circle count.
create or replace function private.ruined_guard_block_circle_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  block_status text;
  circle_status text;
begin
  if new.ended_at is not null then
    return new;
  end if;

  select block_record.status
  into block_status
  from public.membership_blocks block_record
  where block_record.id = new.block_id
  for update;

  if block_status is null then
    raise exception 'Block % does not exist.', new.block_id;
  end if;
  if block_status not in ('forming', 'active') then
    raise exception 'Block % is not accepting Circles.', new.block_id;
  end if;

  select circle.status
  into circle_status
  from public.circles circle
  where circle.id = new.circle_id
  for update;

  if circle_status is null then
    raise exception 'Circle % does not exist.', new.circle_id;
  end if;
  if circle_status not in ('forming', 'active') then
    raise exception 'Circle % is not current.', new.circle_id;
  end if;

  return new;
end;
$$;

drop trigger if exists block_circle_assignments_current_guard
  on public.block_circle_assignments;
create trigger block_circle_assignments_current_guard
before insert or update of block_id, circle_id, ended_at
on public.block_circle_assignments
for each row execute function private.ruined_guard_block_circle_assignment();

-- The two-Circle rule lives in Postgres as well as the operator repository so
-- another trusted writer cannot accidentally activate an empty Block.
create or replace function private.ruined_enforce_block_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_circle_count integer;
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    select count(*)
    into current_circle_count
    from public.block_circle_assignments assignment
    join public.circles circle on circle.id = assignment.circle_id
    where assignment.block_id = new.id
      and assignment.ended_at is null
      and circle.status in ('forming', 'active');

    if current_circle_count < 2 then
      raise exception 'A Block needs at least two current Circles before activation.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists membership_blocks_activation_guard
  on public.membership_blocks;
create trigger membership_blocks_activation_guard
before update of status
on public.membership_blocks
for each row execute function private.ruined_enforce_block_activation();

revoke all on function private.ruined_guard_block_circle_assignment()
  from public, anon, authenticated;
revoke all on function private.ruined_enforce_block_activation()
  from public, anon, authenticated;

-- Resolve the current member's Block inside the private schema. The helper is
-- used by RLS so the Data API never needs access to assignment rows.
create or replace function private.ruined_current_active_access_block_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select block_assignment.block_id
  from public.circle_member_assignments member_assignment
  join public.block_circle_assignments block_assignment
    on block_assignment.circle_id = member_assignment.circle_id
    and block_assignment.ended_at is null
  where member_assignment.member_id = private.ruined_current_active_access_member_id()
    and member_assignment.ended_at is null
  order by block_assignment.assigned_at desc
  limit 1
$$;

revoke all on function private.ruined_current_active_access_block_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_active_access_block_id()
  to authenticated;

alter table public.membership_blocks enable row level security;
alter table public.block_circle_assignments enable row level security;

revoke all on table
  public.membership_blocks,
  public.block_circle_assignments
from anon, authenticated;

-- Members can read only the name and status columns of their own Block. The
-- assignment table stays server-only, preventing client enumeration of sibling
-- Circle IDs or assignment history.
grant select (name, status) on table public.membership_blocks to authenticated;

drop policy if exists block_circle_assignments_select_own
  on public.block_circle_assignments;
create policy block_circle_assignments_select_own
on public.block_circle_assignments for select
to authenticated
using (
  ended_at is null
  and exists (
    select 1
    from public.circle_member_assignments member_assignment
    where member_assignment.circle_id = block_circle_assignments.circle_id
      and member_assignment.member_id = private.ruined_current_active_access_member_id()
      and member_assignment.ended_at is null
  )
);

drop policy if exists membership_blocks_select_own
  on public.membership_blocks;
create policy membership_blocks_select_own
on public.membership_blocks for select
to authenticated
using (
  id = private.ruined_current_active_access_block_id()
);

comment on table public.membership_blocks is
  'Durable membership groups above Circles. Blocks do not participate in Foundations eligibility.';
comment on table public.block_circle_assignments is
  'Temporal Circle-to-Block assignments. ended_at preserves prior Block membership.';

commit;
