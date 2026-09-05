begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Shopify mode belongs to the immutable template version. Keeping it only on
-- the mutable integration pointer allowed a test binding to appear live when
-- an operator selected the published version later.
alter table public.artifact_template_versions
  add column if not exists shopify_livemode boolean;

-- Prefer an already version-pinned link when one exists.
update public.artifact_template_versions version_record
set shopify_livemode = binding.livemode
from public.integration_entity_links binding
where version_record.shopify_livemode is null
  and version_record.production_specification ? 'shopify'
  and binding.provider = 'shopify'
  and binding.local_entity_type = 'artifact_template'
  and binding.local_entity_id = version_record.artifact_template_id::text
  and binding.external_entity_type = 'product'
  and binding.external_entity_id = version_record.production_specification #>> '{shopify,product_gid}'
  and binding.metadata ->> 'artifact_template_version_id' = version_record.id::text;

-- Older links did not carry a version id. They are safe to infer only when a
-- single mode exists for that template and product.
update public.artifact_template_versions version_record
set shopify_livemode = (
  select bool_or(binding.livemode)
  from public.integration_entity_links binding
  where binding.provider = 'shopify'
    and binding.local_entity_type = 'artifact_template'
    and binding.local_entity_id = version_record.artifact_template_id::text
    and binding.external_entity_type = 'product'
    and binding.external_entity_id = version_record.production_specification #>> '{shopify,product_gid}'
  having count(distinct binding.livemode) = 1
)
where version_record.shopify_livemode is null
  and version_record.production_specification ? 'shopify';

do $$
begin
  if exists (
    select 1
    from public.artifact_template_versions version_record
    where version_record.production_specification ? 'shopify'
      and version_record.shopify_livemode is null
  ) then
    raise exception 'A Shopify Artifact version has an ambiguous or missing live/test binding. Resolve it before applying this migration.';
  end if;
end;
$$;

alter table public.artifact_template_versions
  drop constraint if exists artifact_template_versions_shopify_mode_check;
alter table public.artifact_template_versions
  add constraint artifact_template_versions_shopify_mode_check
  check (
    (
      not (production_specification ? 'shopify')
      and shopify_livemode is null
    )
    or (
      production_specification ? 'shopify'
      and shopify_livemode is not null
      and jsonb_typeof(production_specification -> 'shopify') = 'object'
      and production_specification #>> '{shopify,product_gid}'
        ~ '^gid://shopify/Product/[1-9][0-9]*$'
      and production_specification #>> '{shopify,product_handle}'
        ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    )
  ) not valid;
alter table public.artifact_template_versions
  validate constraint artifact_template_versions_shopify_mode_check;

create unique index if not exists artifact_template_versions_one_published_idx
  on public.artifact_template_versions(artifact_template_id)
  where status = 'published';

-- Pin the mutable integration pointer to the exact current published version.
update public.integration_entity_links binding
set
  metadata = coalesce(binding.metadata, '{}'::jsonb) || jsonb_build_object(
    'artifact_template_version_id', version_record.id::text,
    'product_handle', version_record.production_specification #>> '{shopify,product_handle}'
  ),
  updated_at = statement_timestamp()
from public.artifact_template_versions version_record
where binding.provider = 'shopify'
  and binding.local_entity_type = 'artifact_template'
  and binding.local_entity_id = version_record.artifact_template_id::text
  and binding.external_entity_type = 'product'
  and binding.external_entity_id = version_record.production_specification #>> '{shopify,product_gid}'
  and binding.livemode = version_record.shopify_livemode
  and version_record.status = 'published';

do $$
begin
  if exists (
    select 1
    from public.artifact_template_versions version_record
    where version_record.status = 'published'
      and version_record.production_specification ? 'shopify'
      and not exists (
        select 1
        from public.integration_entity_links binding
        where binding.provider = 'shopify'
          and binding.local_entity_type = 'artifact_template'
          and binding.local_entity_id = version_record.artifact_template_id::text
          and binding.external_entity_type = 'product'
          and binding.external_entity_id = version_record.production_specification #>> '{shopify,product_gid}'
          and binding.livemode = version_record.shopify_livemode
          and binding.metadata ->> 'artifact_template_version_id' = version_record.id::text
          and binding.metadata ->> 'product_handle'
            = version_record.production_specification #>> '{shopify,product_handle}'
      )
  ) then
    raise exception 'A published Shopify Artifact version is not pinned to its exact integration link.';
  end if;
end;
$$;

create or replace function public.ruined_protect_artifact_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception 'Published Artifact template versions cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status in ('published', 'retired') and (
    new.artifact_template_id is distinct from old.artifact_template_id
    or new.version is distinct from old.version
    or new.name is distinct from old.name
    or new.input_schema is distinct from old.input_schema
    or new.production_specification is distinct from old.production_specification
    or new.fulfillment_configuration is distinct from old.fulfillment_configuration
    or new.shopify_livemode is distinct from old.shopify_livemode
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'Published Artifact template content is immutable; publish a new version.';
  end if;

  if old.status = 'published' and new.status not in ('published', 'retired') then
    raise exception 'Published Artifact template versions may only remain published or be retired.';
  end if;

  if old.status = 'retired' and new.status <> 'retired' then
    raise exception 'Retired Artifact template versions cannot be reactivated.';
  end if;

  return new;
end;
$$;

-- A caller-generated request key survives transport retries. Existing awards
-- remain valid; new operator awards always persist a UUID request key.
alter table public.artifact_awards
  add column if not exists operator_request_key uuid;

create unique index if not exists artifact_awards_operator_request_key_idx
  on public.artifact_awards(operator_request_key)
  where operator_request_key is not null;

create or replace function private.ruined_require_live_artifact_award_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  template_id uuid;
  template_status text;
  version_status text;
  version_livemode boolean;
  product_gid text;
  product_handle text;
begin
  if new.artifact_template_version_id is null or new.status = 'revoked' then
    return new;
  end if;

  select
    template.id,
    template.status,
    version_record.status,
    version_record.shopify_livemode,
    version_record.production_specification #>> '{shopify,product_gid}',
    version_record.production_specification #>> '{shopify,product_handle}'
  into
    template_id,
    template_status,
    version_status,
    version_livemode,
    product_gid,
    product_handle
  from public.artifact_template_versions version_record
  join public.artifact_templates template
    on template.id = version_record.artifact_template_id
  where version_record.id = new.artifact_template_version_id;

  if template_id is null
    or template_status is distinct from 'active'
    or version_status is distinct from 'published'
    or version_livemode is distinct from true
  then
    raise exception 'Artifact awards require an active, published, live Shopify Artifact version.';
  end if;

  if not exists (
    select 1
    from public.integration_entity_links binding
    where binding.provider = 'shopify'
      and binding.local_entity_type = 'artifact_template'
      and binding.local_entity_id = template_id::text
      and binding.external_entity_type = 'product'
      and binding.external_entity_id = product_gid
      and binding.livemode = true
      and binding.metadata ->> 'artifact_template_version_id'
        = new.artifact_template_version_id::text
      and binding.metadata ->> 'product_handle' = product_handle
  ) then
    raise exception 'Artifact awards require a verified live Shopify binding for the exact template version.';
  end if;

  return new;
end;
$$;

drop trigger if exists artifact_awards_live_binding_guard
  on public.artifact_awards;
create trigger artifact_awards_live_binding_guard
before insert or update of artifact_template_version_id
on public.artifact_awards
for each row execute function private.ruined_require_live_artifact_award_binding();

revoke all on function private.ruined_require_live_artifact_award_binding()
  from public, anon, authenticated;

do $$
begin
  if exists (
    select 1
    from public.artifact_awards award
    join public.artifact_template_versions version_record
      on version_record.id = award.artifact_template_version_id
    where award.status <> 'revoked'
      and version_record.shopify_livemode is distinct from true
  ) then
    raise exception 'An existing active Artifact award references a test-mode Shopify version.';
  end if;
end;
$$;

create or replace function private.ruined_guard_artifact_shipment_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'label_created' and new.status in ('in_transit', 'delivered', 'exception', 'cancelled'))
    or (old.status = 'in_transit' and new.status in ('delivered', 'exception', 'returned'))
    or (old.status = 'exception' and new.status in ('in_transit', 'delivered', 'returned', 'cancelled'))
  ) then
    raise exception 'Invalid Artifact shipment transition from % to %.', old.status, new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists artifact_fulfillment_shipments_transition_guard
  on public.artifact_fulfillment_shipments;
create trigger artifact_fulfillment_shipments_transition_guard
before update of status on public.artifact_fulfillment_shipments
for each row execute function private.ruined_guard_artifact_shipment_transition();

revoke all on function private.ruined_guard_artifact_shipment_transition()
  from public, anon, authenticated;

create or replace function private.ruined_validate_delivered_artifact_shipment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  award_id uuid;
  award_status text;
  expected_artifact_state text;
  job_completed_at timestamptz;
  job_member_id uuid;
  job_status text;
  lifecycle_artifact_state text;
begin
  if new.status <> 'delivered' then
    return null;
  end if;

  select
    job.member_id,
    job.status,
    job.completed_at,
    job.artifact_award_id,
    award.status
  into
    job_member_id,
    job_status,
    job_completed_at,
    award_id,
    award_status
  from public.artifact_jobs job
  left join public.artifact_awards award on award.id = job.artifact_award_id
  where job.id = new.artifact_job_id;

  if job_status is distinct from 'fulfilled' or job_completed_at is null then
    raise exception 'A delivered Artifact shipment requires its production job to be fulfilled in the same transaction.';
  end if;

  if award_id is not null and award_status is distinct from 'fulfilled' then
    raise exception 'A delivered Artifact shipment requires its award to be fulfilled in the same transaction.';
  end if;

  select case
    when exists (
      select 1 from public.artifact_jobs other_job
      where other_job.member_id = job_member_id
        and other_job.status in ('in_production', 'review', 'ready')
    ) then 'in_production'
    when exists (
      select 1 from public.artifact_jobs other_job
      where other_job.member_id = job_member_id
        and other_job.status in ('requested', 'collecting', 'ready_for_production')
    ) then 'collecting'
    when exists (
      select 1 from public.artifact_jobs other_job
      where other_job.member_id = job_member_id
        and other_job.status = 'fulfilled'
    ) then 'fulfilled'
    else 'not_started'
  end
  into expected_artifact_state;

  select lifecycle.artifact_state
  into lifecycle_artifact_state
  from public.member_lifecycle lifecycle
  where lifecycle.member_id = job_member_id;

  if lifecycle_artifact_state is distinct from expected_artifact_state then
    raise exception 'A delivered Artifact shipment requires member Artifact state % in the same transaction.', expected_artifact_state;
  end if;

  return null;
end;
$$;

drop trigger if exists artifact_fulfillment_shipments_delivery_consistency
  on public.artifact_fulfillment_shipments;
create constraint trigger artifact_fulfillment_shipments_delivery_consistency
after insert or update of status on public.artifact_fulfillment_shipments
deferrable initially deferred
for each row execute function private.ruined_validate_delivered_artifact_shipment();

revoke all on function private.ruined_validate_delivered_artifact_shipment()
  from public, anon, authenticated;

comment on column public.artifact_template_versions.shopify_livemode is
  'Immutable live/test classification for the Shopify product bound to this exact Artifact version.';
comment on column public.artifact_awards.operator_request_key is
  'Caller-generated UUID used to make operator award submissions idempotent across retries.';

commit;
