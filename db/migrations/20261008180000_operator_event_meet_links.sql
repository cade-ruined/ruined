begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- An operator may intentionally use the same Meet URL for separate events.
-- Those rows bind an existing meeting link to an Experience; they do not claim
-- exclusive ownership of the remote Meet space. Keep every other provider and
-- entity binding unique, including Calendar-generated Meet spaces.
drop index if exists public.integration_entity_links_external_mode_idx;
create unique index integration_entity_links_external_mode_idx
  on public.integration_entity_links(provider, external_entity_type, external_entity_id, livemode)
  where not (
    provider = 'google'
    and local_entity_type = 'experience'
    and external_entity_type = 'meet_space'
    and coalesce(metadata->>'source', '') = 'operator_event'
  );

-- The existing local-mode unique index still permits only one Meet binding
-- per Experience in each environment.

commit;
