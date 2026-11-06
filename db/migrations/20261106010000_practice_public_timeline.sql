begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- F1 can be completed through the public Timeline composer. Existing private
-- Foundations work still counts; publishing a reviewed/redacted version does
-- not erase that evidence. No entry, visibility, answer or history is changed.
-- Journal drafts and Practice autosaves remain outside this completed-entry set.
create or replace function private.ruined_complete_practice_timeline_entries(target_member_id uuid)
returns table(id uuid,updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select entry.id,entry.updated_at from public.member_journal_entries entry
  where entry.member_id = target_member_id and entry.deleted_at is null and entry.include_on_timeline
    and nullif(btrim(entry.title),'') is not null
    and (
      (nullif(btrim(entry.foundations_meaning),'') is not null
        and nullif(btrim(entry.foundations_present_impact),'') is not null)
      or (entry.visibility = 'public'
        and nullif(btrim(entry.timeline_reflection ->> 'meaning'),'') is not null
        and nullif(btrim(entry.timeline_reflection ->> 'presentImpact'),'') is not null)
    )
$$;

revoke all on function private.ruined_complete_practice_timeline_entries(uuid) from public,anon,authenticated;

commit;
