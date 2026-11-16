begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The present-impact question is no longer part of Timeline prompts. Keep
-- completion tied to saved, titled Timeline work with meaning, without making
-- members answer a removed question. Existing answers and visibility stay intact.
-- Private Journal reflections, Journal drafts and Practice autosaves still do
-- not count; only existing Foundations evidence or published Timeline work does.
create or replace function private.ruined_complete_practice_timeline_entries(target_member_id uuid)
returns table(id uuid,updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select entry.id,entry.updated_at from public.member_journal_entries entry
  where entry.member_id = target_member_id and entry.deleted_at is null and entry.include_on_timeline
    and nullif(btrim(entry.title),'') is not null
    and (
      nullif(btrim(entry.foundations_meaning),'') is not null
      or (entry.visibility = 'public'
        and nullif(btrim(entry.timeline_reflection ->> 'meaning'),'') is not null)
    )
$$;

revoke all on function private.ruined_complete_practice_timeline_entries(uuid) from public,anon,authenticated;

commit;
