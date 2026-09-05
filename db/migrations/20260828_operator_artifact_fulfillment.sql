begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The versioned production specification remains the historical source of
-- truth. This explicit integration link gives operators one canonical place
-- to inspect and update the live Shopify binding.
insert into public.integration_entity_links (
  provider,
  local_entity_type,
  local_entity_id,
  external_entity_type,
  external_entity_id,
  livemode,
  metadata
)
select
  'shopify',
  'artifact_template',
  template.id::text,
  'product',
  version_record.production_specification #>> '{shopify,product_gid}',
  true,
  jsonb_build_object(
    'product_handle',
    version_record.production_specification #>> '{shopify,product_handle}'
  )
from public.artifact_templates template
join public.artifact_template_versions version_record
  on version_record.artifact_template_id = template.id
where template.template_slug = 'the-first-coin'
  and version_record.version = 1
  and version_record.production_specification #>> '{shopify,product_gid}' is not null
on conflict (provider, local_entity_type, local_entity_id, external_entity_type, livemode)
do update set
  external_entity_id = excluded.external_entity_id,
  metadata = excluded.metadata,
  updated_at = statement_timestamp();

create table if not exists public.artifact_fulfillment_shipments (
  id uuid primary key default gen_random_uuid(),
  artifact_job_id uuid not null
    references public.artifact_jobs(id) on delete restrict,
  carrier text not null,
  service_level text,
  tracking_number text not null,
  tracking_url text,
  status text not null default 'label_created'
    check (status in ('label_created', 'in_transit', 'delivered', 'exception', 'returned', 'cancelled')),
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_by_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (char_length(btrim(carrier)) between 1 and 120),
  check (service_level is null or char_length(btrim(service_level)) between 1 and 120),
  check (char_length(btrim(tracking_number)) between 3 and 240),
  check (tracking_url is null or char_length(tracking_url) <= 2000),
  check (status <> 'delivered' or delivered_at is not null),
  check (delivered_at is null or shipped_at is null or delivered_at >= shipped_at)
);

create unique index if not exists artifact_fulfillment_shipments_tracking_idx
  on public.artifact_fulfillment_shipments(lower(carrier), tracking_number);
create index if not exists artifact_fulfillment_shipments_job_idx
  on public.artifact_fulfillment_shipments(artifact_job_id, created_at desc);
create index if not exists artifact_fulfillment_shipments_status_idx
  on public.artifact_fulfillment_shipments(status, updated_at desc);
create index if not exists artifact_fulfillment_shipments_updater_idx
  on public.artifact_fulfillment_shipments(updated_by_auth_user_id);

create table if not exists public.artifact_fulfillment_events (
  id bigint generated always as identity primary key,
  shipment_id uuid not null
    references public.artifact_fulfillment_shipments(id) on delete restrict,
  event_type text not null
    check (event_type in ('created', 'status_changed', 'tracking_updated')),
  previous_status text,
  next_status text not null,
  actor_auth_user_id uuid
    references public.platform_users(auth_user_id) on delete set null,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  dedupe_key text not null unique,
  occurred_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp()
);

create index if not exists artifact_fulfillment_events_shipment_idx
  on public.artifact_fulfillment_events(shipment_id, occurred_at desc);
create index if not exists artifact_fulfillment_events_actor_idx
  on public.artifact_fulfillment_events(actor_auth_user_id);

drop trigger if exists artifact_fulfillment_events_append_only
  on public.artifact_fulfillment_events;
create trigger artifact_fulfillment_events_append_only
before update or delete on public.artifact_fulfillment_events
for each row execute function public.ruined_reject_append_only_mutation();

alter table public.artifact_fulfillment_shipments enable row level security;
alter table public.artifact_fulfillment_events enable row level security;

revoke all on table
  public.artifact_fulfillment_shipments,
  public.artifact_fulfillment_events
from public, anon, authenticated;

comment on table public.artifact_fulfillment_shipments is
  'Server-managed Artifact shipment and tracking records. Member delivery views must expose only the member-owned job.';
comment on table public.artifact_fulfillment_events is
  'Append-only evidence for Artifact shipment and tracking changes.';

commit;
