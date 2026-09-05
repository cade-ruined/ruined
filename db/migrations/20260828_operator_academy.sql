begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Learning versions are already append-only. These projection fields add the
-- lifecycle and optimistic concurrency needed by the operator Academy without
-- changing the immutable member-facing version records.
alter table public.learning_collections
  add column if not exists revision bigint not null default 1,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null;

alter table public.learning_resources
  add column if not exists revision bigint not null default 1,
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null;

alter table public.learning_collections
  drop constraint if exists learning_collections_status_check;
alter table public.learning_resources
  drop constraint if exists learning_resources_status_check;

update public.learning_collections
set
  status = 'retired',
  retired_at = coalesce(retired_at, updated_at, statement_timestamp())
where status = 'archived';

update public.learning_resources
set
  status = 'retired',
  retired_at = coalesce(retired_at, updated_at, statement_timestamp())
where status = 'archived';

alter table public.learning_collections
  add constraint learning_collections_status_check
    check (status in ('draft', 'published', 'unpublished', 'retired')),
  add constraint learning_collections_retired_state_check
    check ((status = 'retired') = (retired_at is not null));

alter table public.learning_resources
  add constraint learning_resources_status_check
    check (status in ('draft', 'published', 'unpublished', 'retired')),
  add constraint learning_resources_retired_state_check
    check ((status = 'retired') = (retired_at is not null));

create index if not exists learning_collections_operator_queue_idx
  on public.learning_collections(status, updated_at desc, id);
create index if not exists learning_resources_operator_queue_idx
  on public.learning_resources(status, updated_at desc, id);

create or replace function private.ruined_guard_learning_projection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Academy records are retired, never deleted.';
  end if;

  if old.status = 'retired' then
    raise exception 'A retired Academy record is immutable.';
  end if;

  if new.revision <> old.revision + 1 then
    raise exception 'Academy projection revisions must advance by exactly one.';
  end if;

  if old.published_at is not null and new.slug is distinct from old.slug then
    raise exception 'A published Academy slug is immutable.';
  end if;

  if old.published_at is not null
     and new.published_at is distinct from old.published_at then
    raise exception 'The first Academy publication time is immutable.';
  end if;

  if old.status = 'draft' and new.status = 'unpublished' then
    raise exception 'A draft Academy record cannot be unpublished.';
  end if;

  if old.status in ('published', 'unpublished') and new.status = 'draft' then
    raise exception 'A published Academy record cannot return to draft.';
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_guard_learning_projection()
  from public, anon, authenticated;

drop trigger if exists learning_collections_projection_guard
  on public.learning_collections;
create trigger learning_collections_projection_guard
before update or delete on public.learning_collections
for each row execute function private.ruined_guard_learning_projection();

drop trigger if exists learning_resources_projection_guard
  on public.learning_resources;
create trigger learning_resources_projection_guard
before update or delete on public.learning_resources
for each row execute function private.ruined_guard_learning_projection();

comment on column public.learning_resources.revision is
  'Optimistic concurrency token for the mutable resource projection. Learning versions remain append-only.';
comment on column public.learning_collections.revision is
  'Optimistic concurrency token for operator collection changes.';

commit;
