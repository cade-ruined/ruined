begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

alter table public.circles add column story text check (story is null or char_length(story) <= 2000);
comment on column public.circles.capacity is 'Target group size, including its Circle Supporter once. Normal range 8-12; reviewed exceptions may exceed it.';
create table public.member_circle_preferences (
  member_id uuid primary key references public.ruined_members(id) on delete restrict,
  timezone text not null check (char_length(timezone) between 1 and 100),
  availability text[] not null default '{}' check (cardinality(availability) <= 21),
  preferred_connection_id uuid references public.ruined_members(id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  check (preferred_connection_id is distinct from member_id)
);
create table public.circle_placement_reviews (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  circle_id uuid not null references public.circles(id) on delete restrict,
  previous_assignment_id bigint references public.circle_member_assignments(id) on delete restrict,
  requested_by_auth_user_id uuid not null references public.platform_users(auth_user_id),
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'placed', 'declined')),
  reviewed_by_auth_user_id uuid references public.platform_users(auth_user_id),
  reviewed_at timestamptz,
  projected_count integer,
  created_at timestamptz not null default statement_timestamp(),
  check ((status in ('approved', 'placed', 'declined')) = (reviewed_by_auth_user_id is not null and reviewed_at is not null))
);
create unique index circle_placement_one_pending on public.circle_placement_reviews(member_id, circle_id) where status = 'pending';
alter table public.member_circle_preferences enable row level security;
alter table public.circle_placement_reviews enable row level security;
revoke all on public.member_circle_preferences, public.circle_placement_reviews from public, anon, authenticated;

-- Staff may be legacy non-members; deduplicate by person when also on the roster.
create or replace function private.ruined_circle_participant_count(target_circle_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from (
    select coalesce(member.person_id::text, 'member:' || member.id::text) as identity
    from public.circle_member_assignments assignment
    join public.ruined_members member on member.id = assignment.member_id
    where assignment.circle_id = target_circle_id and assignment.ended_at is null
    union
    select coalesce(platform_user.person_id::text, 'staff:' || staff.auth_user_id::text)
    from public.circle_staff_assignments staff
    join public.platform_users platform_user on platform_user.auth_user_id = staff.auth_user_id
    where staff.circle_id = target_circle_id and staff.ended_at is null and staff.role_slug = 'circle_leader'
  ) people
$$;
revoke all on function private.ruined_circle_participant_count(uuid) from public, anon, authenticated;

-- Preserve the row-write serialization that made the old hard cap race-safe.
-- The new limit is an approval boundary rather than an arbitrary enlarged cap.
create or replace function public.ruined_enforce_circle_capacity()
returns trigger language plpgsql set search_path = '' as $$
declare projected integer; already_counted boolean; approval_id uuid;
begin
  if new.ended_at is not null then return new; end if;
  update public.circles set updated_at = statement_timestamp() where id = new.circle_id;
  if not found then raise exception 'Circle does not exist.'; end if;
  select exists (
    select 1 from public.circle_member_assignments assignment
    where assignment.circle_id = new.circle_id and assignment.member_id = new.member_id and assignment.ended_at is null
    union all
    select 1 from public.circle_staff_assignments staff
    join public.platform_users platform_user on platform_user.auth_user_id = staff.auth_user_id
    join public.ruined_members member on member.person_id = platform_user.person_id
    where staff.circle_id = new.circle_id and staff.ended_at is null and staff.role_slug = 'circle_leader' and member.id = new.member_id
  ) into already_counted;
  projected := private.ruined_circle_participant_count(new.circle_id) + case when already_counted then 0 else 1 end;
  if projected > 12 and not already_counted then
    select review.id into approval_id from public.circle_placement_reviews review
    where review.member_id = new.member_id and review.circle_id = new.circle_id and review.status = 'approved'
      and review.reviewed_by_auth_user_id = new.assigned_by_auth_user_id
      and review.projected_count = projected
      and review.reviewed_at >= statement_timestamp() - interval '5 minutes'
      and private.ruined_has_leadership_responsibility(review.reviewed_by_auth_user_id, 'circle_exception')
    order by review.reviewed_at desc limit 1 for update;
    if approval_id is null then raise exception 'Placement above 12 requires a current exception review.'; end if;
    update public.circle_placement_reviews set status = 'placed' where id = approval_id;
  end if;
  return new;
end
$$;
-- Capacity is now a target, so lowering it cannot invalidate existing people.
drop trigger if exists circles_capacity_guard on public.circles;
commit;
