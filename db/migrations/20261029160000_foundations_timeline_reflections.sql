begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Continue the private Foundations reflection without rewriting any existing
-- event, meaning, timestamp, completion receipt or append-only history.
-- These answers must never be copied into the publishable Journal title/body.
alter table public.member_journal_entries
  add column foundations_belief text check (foundations_belief is null or char_length(foundations_belief) <= 4000),
  add column foundations_present_impact text check (foundations_present_impact is null or char_length(foundations_present_impact) <= 4000),
  add column foundations_perspective text check (foundations_perspective is null or char_length(foundations_perspective) <= 4000);

comment on column public.member_journal_entries.foundations_belief is
  'Private Foundations reflection; exclude from public Journal/card projections. Covered by existing journal history erasure.';
comment on column public.member_journal_entries.foundations_present_impact is
  'Private Foundations reflection; exclude from public Journal/card projections. Covered by existing journal history erasure.';
comment on column public.member_journal_entries.foundations_perspective is
  'Private Foundations reflection; exclude from public Journal/card projections. Covered by existing journal history erasure.';

alter table public.member_journal_entry_versions
  add column foundations_belief text check (foundations_belief is null or char_length(foundations_belief) <= 4000),
  add column foundations_present_impact text check (foundations_present_impact is null or char_length(foundations_present_impact) <= 4000),
  add column foundations_perspective text check (foundations_perspective is null or char_length(foundations_perspective) <= 4000);

comment on column public.member_journal_entry_versions.foundations_belief is
  'Private Foundations reflection; exclude from public Journal/card projections. Covered by existing journal history erasure.';
comment on column public.member_journal_entry_versions.foundations_present_impact is
  'Private Foundations reflection; exclude from public Journal/card projections. Covered by existing journal history erasure.';
comment on column public.member_journal_entry_versions.foundations_perspective is
  'Private Foundations reflection; exclude from public Journal/card projections. Covered by existing journal history erasure.';

create or replace function private.ruined_version_journal_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.member_id is distinct from old.member_id or new.created_at is distinct from old.created_at then
      raise exception 'Journal entry identity fields are immutable.';
    end if;
    if old.deleted_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'A deleted journal entry is immutable.';
    end if;
    if row(new.kind,new.title,new.body,new.saved,new.event_year,new.event_month,new.event_day,new.include_on_timeline,new.timeline_position,new.visibility,new.foundations_meaning,new.foundations_belief,new.foundations_present_impact,new.foundations_perspective,new.deleted_at,new.current_version)
      is not distinct from row(old.kind,old.title,old.body,old.saved,old.event_year,old.event_month,old.event_day,old.include_on_timeline,old.timeline_position,old.visibility,old.foundations_meaning,old.foundations_belief,old.foundations_present_impact,old.foundations_perspective,old.deleted_at,old.current_version) then
      new.updated_at := old.updated_at;
      new.updated_by_auth_user_id := old.updated_by_auth_user_id;
      return new;
    end if;
    new.current_version := old.current_version + 1;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end; $$;

create or replace function private.ruined_record_journal_entry_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.current_version = old.current_version then return new; end if;
  insert into public.member_journal_entry_versions (
    journal_entry_id,member_id,version,action,kind,title,body,saved,event_year,event_month,event_day,
    include_on_timeline,timeline_position,visibility,foundations_meaning,foundations_belief,foundations_present_impact,foundations_perspective,media_ids,actor_auth_user_id,occurred_at
  ) values (
    new.id,new.member_id,new.current_version,
    case when new.deleted_at is not null then 'deleted' when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.kind,new.title,new.body,new.saved,new.event_year,new.event_month,new.event_day,new.include_on_timeline,new.timeline_position,new.visibility,new.foundations_meaning,new.foundations_belief,new.foundations_present_impact,new.foundations_perspective,
    coalesce((select array_agg(m.id order by m.position,m.id) from public.member_journal_media m
      where m.member_id = new.member_id and m.entry_id = new.id and m.state = 'ready' and m.removed_at is null), '{}'::uuid[]),
    new.updated_by_auth_user_id,new.updated_at
  );
  return new;
end; $$;

-- Existing table RLS/grants, append-only protections and authorized member
-- erasure already cover these columns. Reflection-only writes use the same
-- revision sequence and actor attribution as every other Journal mutation.
revoke all on function private.ruined_version_journal_entry(), private.ruined_record_journal_entry_version()
  from public, anon, authenticated;

commit;
