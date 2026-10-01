begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Public Timeline posts may be words or media without a life-event date/title.
-- Private Foundations milestones keep their existing requirements. This changes
-- constraints only: no current entry, consent choice, or history is rewritten.
alter table public.member_journal_entries
  drop constraint member_journal_entries_timeline_date_check,
  add constraint member_journal_entries_timeline_date_check
    check (not include_on_timeline or visibility = 'public'
      or (event_year is not null and nullif(btrim(title), '') is not null));

alter table public.member_journal_entry_versions
  drop constraint member_journal_entry_versions_check3,
  add constraint member_journal_entry_versions_timeline_date_check
    check (not include_on_timeline or visibility = 'public'
      or (event_year is not null and nullif(btrim(title), '') is not null));

-- Future Foundations completions require a private milestone. Public posts
-- never satisfy that separate exercise; existing completion receipts stay intact.
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
      and entry.deleted_at is null and entry.include_on_timeline and entry.visibility = 'private'
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

commit;
