begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Release is a server decision. A member cannot advance the call calendar.
create table public.member_practice_releases (
  course text primary key check (course in ('f2','f3','f4','time')),
  release_at timestamptz check (release_at is null or isfinite(release_at)),
  updated_at timestamptz not null default statement_timestamp()
);
insert into public.member_practice_releases(course, release_at) values
  ('f2',null),('f3',null),('f4',null),('time','2026-12-01T07:00:00Z');
alter table public.member_practice_releases enable row level security;
revoke all on public.member_practice_releases from public,anon,authenticated;

create table public.member_practice_work (
  member_id uuid primary key references public.ruined_members(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  timeline_draft jsonb check (timeline_draft is null or (jsonb_typeof(timeline_draft) = 'object' and octet_length(timeline_draft::text) <= 200000)),
  last_timeline_entry_id uuid,
  letter_body text not null default '' check (length(letter_body) <= 20000),
  letter_kept_at timestamptz check (letter_kept_at is null or isfinite(letter_kept_at)),
  time_action text not null default '' check (length(time_action) <= 2000),
  time_category text not null default '' check (time_category in ('','sleep','work','family','relationship','health','growth','community','recreation','media','responsibilities','unstructured')),
  time_minutes integer not null default 0 check (time_minutes between 0 and 10080),
  time_source_category text not null default '' check (time_source_category in ('','sleep','work','family','relationship','health','growth','community','recreation','media','responsibilities','unstructured')),
  time_source_minutes integer not null default 0 check (time_source_minutes between 0 and 10080),
  time_kept_at timestamptz check (time_kept_at is null or isfinite(time_kept_at)),
  updated_by_auth_user_id uuid not null,
  updated_at timestamptz not null default statement_timestamp(),
  check (letter_kept_at is null or nullif(btrim(letter_body),'') is not null),
  check (time_kept_at is null or (nullif(btrim(time_action),'') is not null and time_category <> '' and time_source_category <> ''
    and time_category <> time_source_category and time_minutes > 0 and time_minutes <= time_source_minutes))
);
alter table public.member_practice_work enable row level security;
revoke all on public.member_practice_work from public,anon,authenticated;
comment on table public.member_practice_work is 'Private account-saved Practice drafts and deliberate completion receipts. No review-browser content is imported.';

create function private.ruined_practice_course_released(target_course text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.member_practice_releases
    where course = target_course and release_at is not null and release_at <= statement_timestamp())
$$;

create function private.ruined_guard_practice_work() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then raise exception 'Practice work cannot change owner.'; end if;
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    if btrim(new.letter_body) is distinct from btrim(old.letter_body) and new.letter_kept_at is not distinct from old.letter_kept_at then new.letter_kept_at := null; end if;
    if row(btrim(new.time_action),new.time_category,new.time_minutes,new.time_source_category,new.time_source_minutes)
      is distinct from row(btrim(old.time_action),old.time_category,old.time_minutes,old.time_source_category,old.time_source_minutes)
      and new.time_kept_at is not distinct from old.time_kept_at then new.time_kept_at := null; end if;
  end if;
  if new.letter_kept_at is not null and (tg_op = 'INSERT' or new.letter_kept_at is distinct from old.letter_kept_at) and (new.letter_kept_at > statement_timestamp() or not private.ruined_practice_course_released('f4')) then
    raise exception 'Foundations 4 is not available for completion.';
  end if;
  if new.time_kept_at is not null and (tg_op = 'INSERT' or new.time_kept_at is distinct from old.time_kept_at) and (new.time_kept_at > statement_timestamp() or not private.ruined_practice_course_released('time')) then
    raise exception 'TIME is not available for completion.';
  end if;
  new.updated_at := statement_timestamp();
  return new;
end $$;
create trigger member_practice_work_00_deleted_account_guard before insert or update on public.member_practice_work
  for each row execute function private.ruined_guard_erased_account_write();
create trigger member_practice_work_10_version before insert or update on public.member_practice_work
  for each row execute function private.ruined_guard_practice_work();

-- Preserve the actual valid F1 achievements earned under the previous rule.
-- Merely having an old completion marker is not a new three-entry achievement.
create table private.member_practice_legacy_f1_awards (
  member_id uuid primary key references public.ruined_members(id) on delete cascade,
  earned_at timestamptz not null,
  source_event_id text not null
);
alter table private.member_practice_legacy_f1_awards enable row level security;
revoke all on private.member_practice_legacy_f1_awards from public,anon,authenticated;
insert into private.member_practice_legacy_f1_awards(member_id,earned_at,source_event_id)
select award.member_id,award.earned_at,award.source_event_id
from public.member_badge_awards award
cross join lateral private.ruined_member_badge_progress(award.member_id) progress
where award.badge_key = 'your-story' and progress.badge_key = 'your-story'
  and progress.progress >= progress.target and progress.earned_at <= statement_timestamp()
  and award.earned_at <= statement_timestamp();

create function private.ruined_erase_member_practice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.member_practice_work where member_id = new.id;
  delete from private.member_practice_legacy_f1_awards where member_id = new.id;
  return new;
end $$;
create trigger member_practice_erasure after update of deleted_at on public.ruined_members
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.ruined_erase_member_practice();

create function private.ruined_complete_practice_timeline_entries(target_member_id uuid)
returns table(id uuid,updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select entry.id,entry.updated_at from public.member_journal_entries entry
  where entry.member_id = target_member_id and entry.deleted_at is null and entry.visibility = 'private' and entry.include_on_timeline
    and nullif(btrim(entry.title),'') is not null
    and nullif(btrim(entry.foundations_meaning),'') is not null
    and nullif(btrim(entry.foundations_present_impact),'') is not null
$$;

create function private.ruined_practice_badge_progress(target_member_id uuid)
returns table(badge_key text,progress integer,target integer,earned_at timestamptz,source_event_id text)
language sql stable security invoker set search_path = '' as $$
with owner as (
  select member.id from public.ruined_members member
  join public.people person on person.id = member.person_id and person.status = 'active'
  where member.id = target_member_id and member.deleted_at is null
), complete_entries as (
  select * from private.ruined_complete_practice_timeline_entries(target_member_id)
  order by updated_at,id limit 3
), legacy as (
  select * from private.member_practice_legacy_f1_awards where member_id = target_member_id
), work as (
  select * from public.member_practice_work where member_id = target_member_id
), results as (
  select 'your-story'::text as badge_key,
    case when exists(select 1 from legacy) then 3 else (select count(*)::integer from complete_entries) end as progress,3 as target,
    coalesce((select earned_at from legacy),(select max(updated_at) from complete_entries having count(*) = 3)) as earned_at,
    coalesce((select source_event_id from legacy),(select 'practice-f1:' || string_agg(id::text,',' order by id) from complete_entries having count(*) = 3)) as source_event_id
  union all select 'foundations-4',
    (select count(*)::integer from work where letter_kept_at is not null and nullif(btrim(letter_body),'') is not null and private.ruined_practice_course_released('f4')),1,
    (select letter_kept_at from work where private.ruined_practice_course_released('f4')),
    (select 'practice-f4:' || member_id::text || ':' || revision::text from work)
  union all select 'time-2026-12',
    coalesce((select (nullif(btrim(time_action),'') is not null)::integer +
      (time_kept_at is not null and time_category <> '' and time_source_category <> '' and time_category <> time_source_category
        and time_minutes > 0 and time_minutes <= time_source_minutes and private.ruined_practice_course_released('time'))::integer from work),0),2,
    (select time_kept_at from work where private.ruined_practice_course_released('time')),
    (select 'practice-time-2026-12:' || member_id::text || ':' || revision::text from work)
)
select results.* from results where exists(select 1 from owner)
$$;

-- Keep the established evidence rules for every other badge unchanged.
alter function private.ruined_member_badge_progress(uuid) rename to ruined_member_badge_progress_before_practice;
create function private.ruined_member_badge_progress(target_member_id uuid)
returns table(badge_key text,progress integer,target integer,earned_at timestamptz,source_event_id text)
language sql stable security invoker set search_path = '' as $$
  select * from private.ruined_member_badge_progress_before_practice(target_member_id) where badge_key <> 'your-story'
  union all select * from private.ruined_practice_badge_progress(target_member_id)
$$;

revoke all on function private.ruined_practice_course_released(text), private.ruined_guard_practice_work(),
  private.ruined_erase_member_practice(),private.ruined_complete_practice_timeline_entries(uuid),private.ruined_practice_badge_progress(uuid),
  private.ruined_member_badge_progress_before_practice(uuid),private.ruined_member_badge_progress(uuid)
  from public,anon,authenticated;

commit;
