begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- An unused draft may be retired without inventing publication evidence.
-- Keep the existing retirement timestamp, revision, and immutable-history guards.
alter table public.learning_collections
  drop constraint learning_collections_check,
  add constraint learning_collections_publication_state_check
    check (status in ('draft', 'retired') or published_at is not null);

alter table public.learning_resources
  drop constraint learning_resources_check,
  add constraint learning_resources_publication_state_check
    check (status in ('draft', 'retired') or (published_at is not null and current_version_id is not null));

commit;
