begin;

-- Deliberately separate from completed entries: drafts cannot become public,
-- contribute to badge progress, or appear in Journal/Timeline entry counts.
create table public.member_journal_drafts (
  id uuid primary key,
  member_id uuid not null references public.ruined_members(id),
  kind text not null check (kind in ('text','images','video')),
  title text check (title is null or char_length(title) between 1 and 200),
  body text check (body is null or char_length(body) <= 20000),
  event_year integer check (event_year between 1900 and 2200),
  event_month integer check (event_month is null or (event_year is not null and event_month between 1 and 12)),
  event_day integer check (event_day is null or (event_month is not null and event_day between 1 and extract(day from (make_date(event_year,event_month,1) + interval '1 month - 1 day'))::integer)),
  timeline_reflection jsonb,
  current_version bigint not null default 1 check (current_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  completed_at timestamptz,
  unique(member_id,id),
  check (deleted_at is null or completed_at is null),
  check (
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
  )
);
create index member_journal_drafts_owner_idx on public.member_journal_drafts(member_id,updated_at desc,id) where deleted_at is null and completed_at is null;
alter table public.member_journal_drafts enable row level security;
revoke all on public.member_journal_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.member_journal_drafts to service_role;

-- Verified attachments may belong to a private draft OR a completed entry,
-- never both. Pending-upload cleanup therefore never expires saved drafts.
alter table public.member_journal_media add column draft_id uuid;
alter table public.member_journal_media
  add constraint member_journal_media_draft_owner_fk foreign key(member_id,draft_id) references public.member_journal_drafts(member_id,id),
  drop constraint member_journal_media_check,
  add constraint member_journal_media_check check (
    (state='pending' and entry_id is null and draft_id is null) or
    (state='ready' and ((entry_id is not null and draft_id is null) or (entry_id is null and draft_id is not null)))
  );
create index member_journal_media_draft_idx on public.member_journal_media(draft_id,position) where draft_id is not null;

create function private.ruined_guard_journal_draft() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.member_id is distinct from old.member_id or new.created_at is distinct from old.created_at then
      raise exception 'Journal draft identity fields are immutable.';
    end if;
    if old.deleted_at is not null or old.completed_at is not null then raise exception 'A finished or deleted draft is immutable.'; end if;
    new.current_version := old.current_version + 1;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end $$;
create trigger member_journal_drafts_00_deleted_account_guard before insert or update on public.member_journal_drafts
  for each row execute function private.ruined_guard_erased_account_write();
create trigger member_journal_drafts_10_version before update on public.member_journal_drafts
  for each row execute function private.ruined_guard_journal_draft();

-- Existing account-erasure code captures all journal storage paths before this
-- update. Remove draft attachments here so the ownership FK remains satisfied.
create function private.ruined_erase_member_journal_drafts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.member_journal_media where member_id=new.id and draft_id is not null;
  delete from public.member_journal_drafts where member_id=new.id;
  return new;
end $$;
create trigger member_journal_drafts_erasure after update of deleted_at on public.ruined_members
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.ruined_erase_member_journal_drafts();
revoke all on function private.ruined_guard_journal_draft(),private.ruined_erase_member_journal_drafts() from public,anon,authenticated;
grant execute on function private.ruined_guard_journal_draft(),private.ruined_erase_member_journal_drafts() to service_role;
commit;
