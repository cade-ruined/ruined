begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('ruined-first-coin-artifact-template-v1'));

insert into public.artifact_templates (
  id,
  template_slug,
  name,
  description,
  status
) values (
  '21935b51-7cbf-4cad-9564-380662b75c1b',
  'the-first-coin',
  'The First Coin',
  'A hand-forged artifact.',
  'active'
)
on conflict (template_slug) do nothing;

do $$
declare
  template_record public.artifact_templates%rowtype;
begin
  select *
  into strict template_record
  from public.artifact_templates
  where template_slug = 'the-first-coin';

  if template_record.id <> '21935b51-7cbf-4cad-9564-380662b75c1b'::uuid
    or template_record.name <> 'The First Coin'
    or template_record.description is distinct from 'A hand-forged artifact.'
    or template_record.status <> 'active'
  then
    raise exception 'The First Coin Artifact template conflicts with the approved v1 record.';
  end if;
end;
$$;

insert into public.artifact_template_versions (
  id,
  artifact_template_id,
  version,
  name,
  input_schema,
  production_specification,
  fulfillment_configuration,
  status,
  published_at
)
select
  '2a1df4c5-7e44-4d50-a832-ec78c21de0ab',
  template.id,
  1,
  'The First Coin / v1',
  '{}'::jsonb,
  jsonb_build_object(
    'shopify',
    jsonb_build_object(
      'product_gid', 'gid://shopify/Product/10356658274625',
      'product_handle', 'the-first-coin'
    )
  ),
  '{}'::jsonb,
  'published',
  statement_timestamp()
from public.artifact_templates template
where template.template_slug = 'the-first-coin'
on conflict (artifact_template_id, version) do nothing;

do $$
declare
  version_record public.artifact_template_versions%rowtype;
  approved_specification constant jsonb := jsonb_build_object(
    'shopify',
    jsonb_build_object(
      'product_gid', 'gid://shopify/Product/10356658274625',
      'product_handle', 'the-first-coin'
    )
  );
begin
  select version.*
  into strict version_record
  from public.artifact_template_versions version
  join public.artifact_templates template
    on template.id = version.artifact_template_id
  where template.template_slug = 'the-first-coin'
    and version.version = 1;

  if version_record.id <> '2a1df4c5-7e44-4d50-a832-ec78c21de0ab'::uuid
    or version_record.name <> 'The First Coin / v1'
    or version_record.input_schema <> '{}'::jsonb
    or version_record.production_specification <> approved_specification
    or version_record.fulfillment_configuration <> '{}'::jsonb
    or version_record.status <> 'published'
    or version_record.published_at is null
  then
    raise exception 'The First Coin Artifact template v1 conflicts with the approved Shopify binding.';
  end if;
end;
$$;

commit;
