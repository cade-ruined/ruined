begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Structured Timeline answers are reviewed publication content. Older private
-- Foundations answers remain separate and are never copied by this migration.
alter table public.member_journal_entries
  add column timeline_reflection jsonb,
  add constraint member_journal_entries_reflection_shape check (
    timeline_reflection is null or case when jsonb_typeof(timeline_reflection) <> 'object' then false else (
      timeline_reflection ?& array['meaning','belief','presentImpact','perspective']
      and timeline_reflection - array['meaning','belief','presentImpact','perspective'] = '{}'::jsonb
      and jsonb_typeof(timeline_reflection -> 'meaning') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'meaning'), 0) <= 4000
      and jsonb_typeof(timeline_reflection -> 'belief') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'belief'), 0) <= 4000
      and jsonb_typeof(timeline_reflection -> 'presentImpact') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'presentImpact'), 0) <= 4000
      and jsonb_typeof(timeline_reflection -> 'perspective') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'perspective'), 0) <= 4000
    ) end
  ),
  add constraint member_journal_entries_reflection_date check (
    timeline_reflection is null or (event_year is not null and nullif(btrim(title), '') is not null)
  );
comment on column public.member_journal_entries.timeline_reflection is
  'Owner-authored guided Timeline answers. Public projection requires visibility=public and include_on_timeline; never populated from legacy private Foundations fields automatically.';

alter table public.member_journal_entry_versions
  add column timeline_reflection jsonb,
  add constraint member_journal_entry_versions_reflection_shape check (
    timeline_reflection is null or case when jsonb_typeof(timeline_reflection) <> 'object' then false else (
      timeline_reflection ?& array['meaning','belief','presentImpact','perspective']
      and timeline_reflection - array['meaning','belief','presentImpact','perspective'] = '{}'::jsonb
      and jsonb_typeof(timeline_reflection -> 'meaning') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'meaning'), 0) <= 4000
      and jsonb_typeof(timeline_reflection -> 'belief') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'belief'), 0) <= 4000
      and jsonb_typeof(timeline_reflection -> 'presentImpact') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'presentImpact'), 0) <= 4000
      and jsonb_typeof(timeline_reflection -> 'perspective') in ('string', 'null')
      and coalesce(char_length(timeline_reflection ->> 'perspective'), 0) <= 4000
    ) end
  ),
  add constraint member_journal_entry_versions_reflection_date check (
    timeline_reflection is null or (event_year is not null and nullif(btrim(title), '') is not null)
  );
comment on column public.member_journal_entry_versions.timeline_reflection is
  'Owner-authored guided Timeline answers. Public projection requires visibility=public and include_on_timeline; never populated from legacy private Foundations fields automatically.';

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
    if row(new.kind,new.title,new.body,new.saved,new.event_year,new.event_month,new.event_day,new.include_on_timeline,new.timeline_position,new.visibility,new.foundations_meaning,new.foundations_belief,new.foundations_present_impact,new.foundations_perspective,new.timeline_reflection,new.deleted_at,new.current_version)
      is not distinct from row(old.kind,old.title,old.body,old.saved,old.event_year,old.event_month,old.event_day,old.include_on_timeline,old.timeline_position,old.visibility,old.foundations_meaning,old.foundations_belief,old.foundations_present_impact,old.foundations_perspective,old.timeline_reflection,old.deleted_at,old.current_version) then
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
    include_on_timeline,timeline_position,visibility,foundations_meaning,foundations_belief,foundations_present_impact,foundations_perspective,timeline_reflection,media_ids,actor_auth_user_id,occurred_at
  ) values (
    new.id,new.member_id,new.current_version,
    case when new.deleted_at is not null then 'deleted' when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.kind,new.title,new.body,new.saved,new.event_year,new.event_month,new.event_day,new.include_on_timeline,new.timeline_position,new.visibility,new.foundations_meaning,new.foundations_belief,new.foundations_present_impact,new.foundations_perspective,new.timeline_reflection,
    coalesce((select array_agg(m.id order by m.position,m.id) from public.member_journal_media m
      where m.member_id = new.member_id and m.entry_id = new.id and m.state = 'ready' and m.removed_at is null), '{}'::uuid[]),
    new.updated_by_auth_user_id,new.updated_at
  );
  return new;
end; $$;

-- Completed public guided stories now satisfy the same Foundations exercise.
-- Keep old private exercises and all existing completion receipts intact.
create or replace function private.ruined_validate_foundation_requirement_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare enrollment_member_id uuid;
begin
  select enrollment.member_id into enrollment_member_id from public.foundation_enrollments enrollment
    where enrollment.id = new.foundation_enrollment_id;
  if enrollment_member_id is distinct from new.member_id then
    raise exception 'Foundation requirement completion does not belong to the enrollment member.';
  end if;
  if new.requirement_slug = 'timeline' and new.state = 'completed' and not exists (
    select 1 from public.member_journal_entries entry where entry.member_id = new.member_id
      and entry.deleted_at is null and entry.include_on_timeline
      and (entry.visibility = 'private' or (entry.visibility = 'public' and entry.timeline_reflection is not null))
  ) then raise exception 'At least one active Timeline entry is required for Timeline completion.'; end if;
  if new.state = 'revoked' and new.supersedes_completion_id is null then
    raise exception 'A revoked requirement marker must supersede a completion.';
  end if;
  if new.supersedes_completion_id is not null and not exists (
    select 1 from public.member_foundation_requirement_completions prior
    where prior.id = new.supersedes_completion_id and prior.member_id = new.member_id
      and prior.foundation_enrollment_id = new.foundation_enrollment_id
      and prior.requirement_slug = new.requirement_slug and prior.completion_version < new.completion_version
  ) then raise exception 'The superseded requirement marker is incompatible.'; end if;
  return new;
end; $$;

-- Existing table grants, RLS and authorized erasure apply to the new column.
revoke all on function private.ruined_version_journal_entry(), private.ruined_record_journal_entry_version()
  from public, anon, authenticated;

commit;
