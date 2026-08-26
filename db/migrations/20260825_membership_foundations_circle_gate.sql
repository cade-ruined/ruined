begin;

-- Direct execution and the migration runner share this lock. The timeout keeps
-- deployment from waiting indefinitely for either another deploy or live app
-- writes; a caller can retry the entire atomic migration later.
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Quiesce every table changed or policy-rebound below in one fail-fast
-- maintenance-window boundary. NOWAIT avoids lock-order cycles with an app
-- transaction already in flight; the whole migration rolls back and can be
-- retried after traffic is drained. Keep progress before enrollment in the
-- explicit relation order for the same convention used by app transactions.
lock table
  public.foundation_unit_progress,
  public.foundation_enrollments,
  public.ruined_members,
  public.circle_member_assignments,
  public.circles,
  public.member_lifecycle,
  public.platform_users,
  public.passwordless_account_invites,
  public.member_state_history,
  public.foundation_submissions,
  public.foundation_submission_reviews,
  public.foundation_units,
  public.foundation_versions,
  public.foundation_programs,
  public.artifact_jobs,
  public.artifact_assets,
  public.artifact_job_events,
  public.artifact_template_versions,
  public.artifact_templates
in access exclusive mode nowait;

-- Account revocation must close both the server-rendered app path and the
-- Supabase Data API path in the same transaction. Lifecycle remains canonical;
-- suspended and closed members are projected onto their platform identity.
update public.platform_users platform_user
set
  status = case lifecycle.account_state
    when 'suspended' then 'suspended'
    else 'disabled'
  end,
  suspended_at = coalesce(platform_user.suspended_at, now()),
  updated_at = now()
from public.member_lifecycle lifecycle
where lifecycle.member_id = platform_user.member_id
  and platform_user.user_type = 'member'
  and lifecycle.account_state in ('suspended', 'closed')
  and platform_user.status is distinct from case lifecycle.account_state
    when 'suspended' then 'suspended'
    else 'disabled'
  end;

create or replace function private.ruined_sync_revoked_member_platform_access()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  projected_status text;
begin
  if new.account_state not in ('suspended', 'closed') then
    return new;
  end if;

  projected_status := case new.account_state
    when 'suspended' then 'suspended'
    else 'disabled'
  end;

  update public.platform_users
  set
    status = projected_status,
    suspended_at = coalesce(suspended_at, now()),
    updated_at = now()
  where member_id = new.member_id
    and user_type = 'member'
    and status is distinct from projected_status;

  return new;
end;
$$;

revoke all on function private.ruined_sync_revoked_member_platform_access()
  from public, anon, authenticated;

drop trigger if exists member_lifecycle_00_sync_revoked_platform_access
  on public.member_lifecycle;
create trigger member_lifecycle_00_sync_revoked_platform_access
after insert or update of account_state
on public.member_lifecycle
for each row execute function private.ruined_sync_revoked_member_platform_access();

-- The RLS identity helper is the final read boundary. A stale platform row can
-- never preserve member access after lifecycle suspension or closure.
create or replace function private.ruined_current_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select platform_user.member_id
  from public.platform_users platform_user
  join public.member_lifecycle lifecycle
    on lifecycle.member_id = platform_user.member_id
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.user_type = 'member'
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
  limit 1
$$;

revoke all on function private.ruined_current_member_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_member_id() to authenticated;

create or replace function private.ruined_current_active_access_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select platform_user.member_id
  from public.platform_users platform_user
  join public.member_lifecycle lifecycle
    on lifecycle.member_id = platform_user.member_id
  where platform_user.auth_user_id = private.ruined_current_auth_user_id()
    and platform_user.user_type = 'member'
    and platform_user.status = 'active'
    and lifecycle.account_state = 'active'
    and lifecycle.billing_state = 'active'
    and lifecycle.program_state in ('onboarding', 'active')
  limit 1
$$;

revoke all on function private.ruined_current_active_access_member_id()
  from public, anon, authenticated;
grant execute on function private.ruined_current_active_access_member_id() to authenticated;

-- Account/profile self-read remains available so invited members can enter
-- billing. Program, Circle, and artifact records require full active access.
drop policy if exists circle_member_assignments_select_self
  on public.circle_member_assignments;
create policy circle_member_assignments_select_self
on public.circle_member_assignments for select
to authenticated
using (member_id = private.ruined_current_active_access_member_id());

drop policy if exists circles_select_assigned on public.circles;
create policy circles_select_assigned
on public.circles for select
to authenticated
using (
  exists (
    select 1
    from public.circle_member_assignments assignment
    where assignment.circle_id = circles.id
      and assignment.member_id = private.ruined_current_active_access_member_id()
      and assignment.ended_at is null
  )
);

drop policy if exists foundation_enrollments_select_self
  on public.foundation_enrollments;
create policy foundation_enrollments_select_self
on public.foundation_enrollments for select
to authenticated
using (member_id = private.ruined_current_active_access_member_id());

drop policy if exists foundation_versions_select_enrolled
  on public.foundation_versions;
create policy foundation_versions_select_enrolled
on public.foundation_versions for select
to authenticated
using (
  exists (
    select 1
    from public.foundation_enrollments enrollment
    where enrollment.foundation_version_id = foundation_versions.id
      and enrollment.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists foundation_programs_select_enrolled
  on public.foundation_programs;
create policy foundation_programs_select_enrolled
on public.foundation_programs for select
to authenticated
using (
  exists (
    select 1
    from public.foundation_versions version_record
    join public.foundation_enrollments enrollment
      on enrollment.foundation_version_id = version_record.id
    where version_record.foundation_program_id = foundation_programs.id
      and enrollment.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists foundation_units_select_enrolled
  on public.foundation_units;
create policy foundation_units_select_enrolled
on public.foundation_units for select
to authenticated
using (
  exists (
    select 1
    from public.foundation_enrollments enrollment
    where enrollment.foundation_version_id = foundation_units.foundation_version_id
      and enrollment.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists foundation_unit_progress_select_self
  on public.foundation_unit_progress;
create policy foundation_unit_progress_select_self
on public.foundation_unit_progress for select
to authenticated
using (
  exists (
    select 1
    from public.foundation_enrollments enrollment
    where enrollment.id = foundation_unit_progress.enrollment_id
      and enrollment.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists foundation_submissions_select_self
  on public.foundation_submissions;
create policy foundation_submissions_select_self
on public.foundation_submissions for select
to authenticated
using (
  exists (
    select 1
    from public.foundation_enrollments enrollment
    where enrollment.id = foundation_submissions.enrollment_id
      and enrollment.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists foundation_submission_reviews_select_self
  on public.foundation_submission_reviews;
create policy foundation_submission_reviews_select_self
on public.foundation_submission_reviews for select
to authenticated
using (
  exists (
    select 1
    from public.foundation_submissions submission
    join public.foundation_enrollments enrollment
      on enrollment.id = submission.enrollment_id
    where submission.id = foundation_submission_reviews.foundation_submission_id
      and enrollment.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists artifact_jobs_select_self on public.artifact_jobs;
create policy artifact_jobs_select_self
on public.artifact_jobs for select
to authenticated
using (member_id = private.ruined_current_active_access_member_id());

drop policy if exists artifact_assets_select_self on public.artifact_assets;
create policy artifact_assets_select_self
on public.artifact_assets for select
to authenticated
using (
  exists (
    select 1
    from public.artifact_jobs job
    where job.id = artifact_assets.artifact_job_id
      and job.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists artifact_job_events_select_self
  on public.artifact_job_events;
create policy artifact_job_events_select_self
on public.artifact_job_events for select
to authenticated
using (
  exists (
    select 1
    from public.artifact_jobs job
    where job.id = artifact_job_events.artifact_job_id
      and job.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists artifact_template_versions_select_assigned
  on public.artifact_template_versions;
create policy artifact_template_versions_select_assigned
on public.artifact_template_versions for select
to authenticated
using (
  exists (
    select 1
    from public.artifact_jobs job
    where job.artifact_template_version_id = artifact_template_versions.id
      and job.member_id = private.ruined_current_active_access_member_id()
  )
);

drop policy if exists artifact_templates_select_assigned
  on public.artifact_templates;
create policy artifact_templates_select_assigned
on public.artifact_templates for select
to authenticated
using (
  exists (
    select 1
    from public.artifact_template_versions template_version
    join public.artifact_jobs job
      on job.artifact_template_version_id = template_version.id
    where template_version.artifact_template_id = artifact_templates.id
      and job.member_id = private.ruined_current_active_access_member_id()
  )
);

-- The pilot curriculum is a durable projection of FOUNDATION_MOMENTS from
-- src/data/foundations.ts. Moment IDs remain the public unit slugs; the UUIDs
-- below are internal identities kept stable across migration replays.
create temporary table ruined_pilot_foundation_moment_seed (
  id uuid primary key,
  unit_slug text not null unique,
  position integer not null unique,
  title text not null,
  stage text not null,
  moment_kind text not null,
  chapter_slug text
) on commit drop;

insert into ruined_pilot_foundation_moment_seed (
  id,
  unit_slug,
  position,
  title,
  stage,
  moment_kind,
  chapter_slug
)
values
  ('f0000000-0000-4000-8000-000000001001', 'entry-mark', 1, 'Ruined Foundations', 'entry', 'entry-mark', null),
  ('f0000000-0000-4000-8000-000000001002', 'entry-statement', 2, 'Before the community', 'entry', 'statement', null),
  ('f0000000-0000-4000-8000-000000001003', 'entry-purpose', 3, 'A shared starting point', 'entry', 'purpose', null),
  ('f0000000-0000-4000-8000-000000001004', 'path-overview', 4, 'The Path', 'path', 'chapter-path', null),
  ('f0000000-0000-4000-8000-000000001005', 'story-opening', 5, 'The Story', 'story', 'chapter-opening', 'story'),
  ('f0000000-0000-4000-8000-000000001006', 'story-founder', 6, 'Tyler / Founder Story', 'story', 'founder-artifact', 'story'),
  ('f0000000-0000-4000-8000-000000001007', 'story-teaching', 7, 'The Reframe', 'story', 'teaching', 'story'),
  ('f0000000-0000-4000-8000-000000001008', 'story-reflection', 8, 'Reflection / Story', 'story', 'reflection', 'story'),
  ('f0000000-0000-4000-8000-000000001009', 'philosophy-opening', 9, 'The Philosophy', 'philosophy', 'chapter-opening', 'philosophy'),
  ('f0000000-0000-4000-8000-000000001010', 'philosophy-founder', 10, 'Mitch / Founder Story', 'philosophy', 'founder-artifact', 'philosophy'),
  ('f0000000-0000-4000-8000-000000001011', 'philosophy-reframe', 11, 'The Philosophy / Responsibility', 'philosophy', 'philosophy-reframe', 'philosophy'),
  ('f0000000-0000-4000-8000-000000001012', 'philosophy-choice', 12, 'Choice', 'philosophy', 'noise-to-meaning', 'philosophy'),
  ('f0000000-0000-4000-8000-000000001013', 'philosophy-reflection', 13, 'Reflection / Philosophy', 'philosophy', 'reflection', 'philosophy'),
  ('f0000000-0000-4000-8000-000000001014', 'culture-opening', 14, 'The Culture', 'culture', 'chapter-opening', 'culture'),
  ('f0000000-0000-4000-8000-000000001015', 'culture-founder', 15, 'Cade / Brand and Culture', 'culture', 'founder-artifact', 'culture'),
  ('f0000000-0000-4000-8000-000000001016', 'culture-code', 16, 'Ruined DNA / How We Show Up', 'culture', 'culture-code', 'culture'),
  ('f0000000-0000-4000-8000-000000001017', 'culture-path', 17, 'The Path / Why Artifacts Matter', 'culture', 'path-and-artifacts', 'culture'),
  ('f0000000-0000-4000-8000-000000001018', 'culture-reflection', 18, 'Reflection / Culture', 'culture', 'reflection', 'culture'),
  ('f0000000-0000-4000-8000-000000001019', 'commitment-opening', 19, 'The Commitment', 'commitment', 'chapter-opening', 'commitment'),
  ('f0000000-0000-4000-8000-000000001020', 'commitment-founder-membership', 20, 'Lib / Membership', 'commitment', 'founder-and-membership', 'commitment'),
  ('f0000000-0000-4000-8000-000000001021', 'commitment-letter', 21, 'A Letter to Your Future Self', 'commitment', 'letter', 'commitment'),
  ('f0000000-0000-4000-8000-000000001022', 'closing', 22, 'Official Welcome / Foundations Overview', 'welcome', 'welcome-and-overview', null);

insert into public.foundation_programs (
  id,
  slug,
  name,
  status
)
values (
  'f0000000-0000-4000-8000-000000000001',
  'ruined-foundations',
  'Ruined Foundations',
  'active'
)
on conflict (slug) do nothing;

do $$
declare
  program_record public.foundation_programs%rowtype;
begin
  select *
  into program_record
  from public.foundation_programs
  where slug = 'ruined-foundations';

  if program_record.id is null then
    raise exception 'The Ruined Foundations pilot program could not be seeded.';
  end if;

  if program_record.name is distinct from 'Ruined Foundations' then
    raise exception 'The existing ruined-foundations program has incompatible content.';
  end if;

  if program_record.status = 'retired' then
    raise exception 'A retired Ruined Foundations program cannot be reused for the pilot.';
  end if;

  if program_record.status = 'draft' then
    update public.foundation_programs
    set status = 'active', updated_at = now()
    where id = program_record.id;
  end if;
end;
$$;

insert into public.foundation_versions (
  id,
  foundation_program_id,
  version,
  title,
  summary,
  configuration,
  status
)
select
  'f0000000-0000-4000-8000-000000000101',
  program_record.id,
  1,
  'Ruined Foundations / Pilot 01',
  'A shared beginning through Story, Philosophy, Culture, and Commitment.',
  jsonb_build_object(
    'pilot', true,
    'source', 'src/data/foundations.ts#FOUNDATION_MOMENTS',
    'moment_count', 22,
    'required_prior_unit_count', 21,
    'final_unit_slug', 'closing'
  ),
  'draft'
from public.foundation_programs program_record
where program_record.slug = 'ruined-foundations'
  and not exists (
    select 1
    from public.foundation_versions version_record
    where version_record.foundation_program_id = program_record.id
      and version_record.version = 1
  );

-- Published versions are immutable. Insert only while the pilot version is
-- draft; replays validate the already-published projection without touching it.
insert into public.foundation_units (
  id,
  foundation_version_id,
  unit_slug,
  position,
  title,
  is_required,
  configuration
)
select
  moment.id,
  version_record.id,
  moment.unit_slug,
  moment.position,
  moment.title,
  true,
  jsonb_strip_nulls(
    jsonb_build_object(
      'stage', moment.stage,
      'kind', moment.moment_kind,
      'chapter', moment.chapter_slug
    )
  )
from ruined_pilot_foundation_moment_seed moment
join public.foundation_programs program_record
  on program_record.slug = 'ruined-foundations'
join public.foundation_versions version_record
  on version_record.foundation_program_id = program_record.id
  and version_record.version = 1
  and version_record.status = 'draft'
on conflict (foundation_version_id, unit_slug) do nothing;

do $$
declare
  expected_configuration jsonb := jsonb_build_object(
    'pilot', true,
    'source', 'src/data/foundations.ts#FOUNDATION_MOMENTS',
    'moment_count', 22,
    'required_prior_unit_count', 21,
    'final_unit_slug', 'closing'
  );
  pilot_version public.foundation_versions%rowtype;
  unit_count integer;
begin
  select version_record.*
  into pilot_version
  from public.foundation_versions version_record
  join public.foundation_programs program_record
    on program_record.id = version_record.foundation_program_id
  where program_record.slug = 'ruined-foundations'
    and version_record.version = 1;

  if pilot_version.id is null then
    raise exception 'The Ruined Foundations pilot version could not be seeded.';
  end if;

  if pilot_version.status = 'retired' then
    raise exception 'A retired Ruined Foundations version cannot be reused for the pilot.';
  end if;

  if pilot_version.title is distinct from 'Ruined Foundations / Pilot 01'
    or pilot_version.summary is distinct from
      'A shared beginning through Story, Philosophy, Culture, and Commitment.'
    or pilot_version.configuration is distinct from expected_configuration
  then
    raise exception 'The existing Ruined Foundations pilot version has incompatible content.';
  end if;

  select count(*)
  into unit_count
  from public.foundation_units unit_record
  where unit_record.foundation_version_id = pilot_version.id;

  if unit_count <> 22 then
    raise exception 'The Ruined Foundations pilot must contain exactly 22 units; found %.', unit_count;
  end if;

  if exists (
    select 1
    from pg_temp.ruined_pilot_foundation_moment_seed moment
    left join public.foundation_units unit_record
      on unit_record.foundation_version_id = pilot_version.id
      and unit_record.unit_slug = moment.unit_slug
    where unit_record.id is distinct from moment.id
      or unit_record.position is distinct from moment.position
      or unit_record.title is distinct from moment.title
      or unit_record.is_required is distinct from true
      or unit_record.configuration is distinct from jsonb_strip_nulls(
        jsonb_build_object(
          'stage', moment.stage,
          'kind', moment.moment_kind,
          'chapter', moment.chapter_slug
        )
      )
  ) then
    raise exception 'The Ruined Foundations pilot units do not match FOUNDATION_MOMENTS.';
  end if;

  if pilot_version.status = 'draft' then
    update public.foundation_versions
    set
      status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
    where id = pilot_version.id;
  end if;
end;
$$;

-- Completion authority and terminal membership operations need durable actors.
-- These remain nullable only for rows that predate this migration.
alter table public.circles
  add column if not exists activated_by_auth_user_id uuid;

alter table public.circles
  add column if not exists activated_at timestamptz;

alter table public.passwordless_account_invites
  add column if not exists revoked_by_auth_user_id uuid;

alter table public.circle_member_assignments
  add column if not exists ended_by_auth_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_attribute attribute_record
    where attribute_record.attrelid = 'public.circles'::regclass
      and attribute_record.attname = 'activated_by_auth_user_id'
      and attribute_record.atttypid = 'pg_catalog.uuid'::regtype
      and attribute_record.attnotnull = false
      and attribute_record.attisdropped = false
  ) then
    raise exception 'circles.activated_by_auth_user_id must be a nullable uuid.';
  end if;

  if not exists (
    select 1
    from pg_attribute attribute_record
    where attribute_record.attrelid = 'public.circles'::regclass
      and attribute_record.attname = 'activated_at'
      and attribute_record.atttypid = 'pg_catalog.timestamptz'::regtype
      and attribute_record.attnotnull = false
      and attribute_record.attisdropped = false
  ) then
    raise exception 'circles.activated_at must be a nullable timestamptz.';
  end if;

  if not exists (
    select 1
    from pg_attribute attribute_record
    where attribute_record.attrelid = 'public.passwordless_account_invites'::regclass
      and attribute_record.attname = 'revoked_by_auth_user_id'
      and attribute_record.atttypid = 'pg_catalog.uuid'::regtype
      and attribute_record.attnotnull = false
      and attribute_record.attisdropped = false
  ) then
    raise exception 'passwordless_account_invites.revoked_by_auth_user_id must be a nullable uuid.';
  end if;

  if not exists (
    select 1
    from pg_attribute attribute_record
    where attribute_record.attrelid = 'public.circle_member_assignments'::regclass
      and attribute_record.attname = 'ended_by_auth_user_id'
      and attribute_record.atttypid = 'pg_catalog.uuid'::regtype
      and attribute_record.attnotnull = false
      and attribute_record.attisdropped = false
  ) then
    raise exception 'circle_member_assignments.ended_by_auth_user_id must be a nullable uuid.';
  end if;
end;
$$;

-- A same-named but malformed index must not silently satisfy IF NOT EXISTS.
-- Drop only incompatible definitions, then recreate each exact FK support index
-- while every affected table is quiesced in this transaction.
do $$
declare
  column_number smallint;
  index_is_compatible boolean;
  index_oid oid;
  specification record;
begin
  for specification in
    select *
    from (values
      (
        'public.circles'::regclass,
        'activated_by_auth_user_id'::text,
        'circles_activated_by_auth_user_idx'::text
      ),
      (
        'public.passwordless_account_invites'::regclass,
        'revoked_by_auth_user_id'::text,
        'passwordless_account_invites_revoked_by_idx'::text
      ),
      (
        'public.circle_member_assignments'::regclass,
        'ended_by_auth_user_id'::text,
        'circle_member_assignments_ended_by_idx'::text
      )
    ) as expected(table_oid, column_name, index_name)
  loop
    select attribute_record.attnum
    into column_number
    from pg_attribute attribute_record
    where attribute_record.attrelid = specification.table_oid
      and attribute_record.attname = specification.column_name
      and attribute_record.attisdropped = false;

    index_oid := to_regclass(format('public.%I', specification.index_name));

    if index_oid is not null then
      select exists (
        select 1
        from pg_index index_record
        join pg_class index_relation on index_relation.oid = index_record.indexrelid
        join pg_am access_method on access_method.oid = index_relation.relam
        where index_record.indexrelid = index_oid
          and index_record.indrelid = specification.table_oid
          and index_record.indisvalid
          and index_record.indisready
          and not index_record.indisunique
          and index_record.indnkeyatts = 1
          and index_record.indnatts = 1
          and index_record.indpred is null
          and index_record.indexprs is null
          and index_record.indkey::text = column_number::text
          and access_method.amname = 'btree'
      ) into index_is_compatible;

      if not index_is_compatible then
        execute format('drop index public.%I', specification.index_name);
      end if;
    end if;
  end loop;
end;
$$;

create index if not exists circles_activated_by_auth_user_idx
  on public.circles(activated_by_auth_user_id);
create index if not exists passwordless_account_invites_revoked_by_idx
  on public.passwordless_account_invites(revoked_by_auth_user_id);
create index if not exists circle_member_assignments_ended_by_idx
  on public.circle_member_assignments(ended_by_auth_user_id);

-- Validate the full FK shape, not only its name. Incompatible same-named
-- constraints are replaced atomically before existing rows are validated.
do $$
declare
  constraint_oid oid;
  local_attribute_number smallint;
  referenced_attribute_number smallint;
  specification record;
begin
  select attribute_record.attnum
  into referenced_attribute_number
  from pg_attribute attribute_record
  where attribute_record.attrelid = 'public.platform_users'::regclass
    and attribute_record.attname = 'auth_user_id'
    and attribute_record.attisdropped = false;

  for specification in
    select *
    from (values
      (
        'public.circles'::regclass,
        'activated_by_auth_user_id'::text,
        'circles_activated_by_auth_user_id_fkey'::text
      ),
      (
        'public.passwordless_account_invites'::regclass,
        'revoked_by_auth_user_id'::text,
        'passwordless_account_invites_revoked_by_auth_user_id_fkey'::text
      ),
      (
        'public.circle_member_assignments'::regclass,
        'ended_by_auth_user_id'::text,
        'circle_member_assignments_ended_by_auth_user_id_fkey'::text
      )
    ) as expected(table_oid, column_name, constraint_name)
  loop
    select attribute_record.attnum
    into local_attribute_number
    from pg_attribute attribute_record
    where attribute_record.attrelid = specification.table_oid
      and attribute_record.attname = specification.column_name
      and attribute_record.attisdropped = false;

    select constraint_record.oid
    into constraint_oid
    from pg_constraint constraint_record
    where constraint_record.conrelid = specification.table_oid
      and constraint_record.conname = specification.constraint_name;

    if constraint_oid is not null and not exists (
      select 1
      from pg_constraint constraint_record
      where constraint_record.oid = constraint_oid
        and constraint_record.contype = 'f'
        and constraint_record.conkey = array[local_attribute_number]::smallint[]
        and constraint_record.confrelid = 'public.platform_users'::regclass
        and constraint_record.confkey = array[referenced_attribute_number]::smallint[]
        and constraint_record.confupdtype = 'a'
        and constraint_record.confdeltype = 'r'
        and constraint_record.confmatchtype = 's'
        and not constraint_record.condeferrable
        and not constraint_record.condeferred
    ) then
      execute format(
        'alter table %s drop constraint %I',
        specification.table_oid,
        specification.constraint_name
      );
      constraint_oid := null;
    end if;

    if constraint_oid is null then
      execute format(
        'alter table %s add constraint %I foreign key (%I) '
          || 'references public.platform_users(auth_user_id) on delete restrict not valid',
        specification.table_oid,
        specification.constraint_name,
        specification.column_name
      );
    end if;

    execute format(
      'alter table %s validate constraint %I',
      specification.table_oid,
      specification.constraint_name
    );
  end loop;
end;
$$;

-- Staff identities are operational identities only. A malformed staff row must
-- never inherit a member's self-read or completion context.
do $$
declare
  constraint_oid oid;
begin
  select constraint_record.oid
  into constraint_oid
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.platform_users'::regclass
    and constraint_record.conname = 'platform_users_staff_has_no_member_check';

  if constraint_oid is not null and (
    select constraint_record.contype <> 'c'
      or obj_description(constraint_record.oid, 'pg_constraint') is distinct from
        'ruined:v1:user_type staff requires null member_id'
    from pg_constraint constraint_record
    where constraint_record.oid = constraint_oid
  ) then
    alter table public.platform_users
      drop constraint platform_users_staff_has_no_member_check;
    constraint_oid := null;
  end if;

  if constraint_oid is null then
    alter table public.platform_users
      add constraint platform_users_staff_has_no_member_check
      check (user_type <> 'staff' or member_id is null)
      not valid;
  end if;
end;
$$;

comment on constraint platform_users_staff_has_no_member_check
  on public.platform_users
  is 'ruined:v1:user_type staff requires null member_id';

alter table public.platform_users
  validate constraint platform_users_staff_has_no_member_check;

do $$
begin
  if exists (
    select 1
    from public.circles circle_record
    where circle_record.status in ('active', 'completed', 'archived')
      and (
        circle_record.starts_at is null
        or circle_record.starts_at > statement_timestamp()
        or circle_record.activated_at is null
        or circle_record.activated_at > statement_timestamp()
        or circle_record.starts_at > circle_record.activated_at
        or (
          circle_record.status = 'active'
          and circle_record.ends_at < statement_timestamp()
        )
        or (
          circle_record.status in ('completed', 'archived')
          and (
            circle_record.ends_at is null
            or circle_record.ends_at > statement_timestamp()
            or circle_record.ends_at < circle_record.activated_at
          )
        )
      )
  ) then
    raise exception 'Every activated Circle must have trustworthy start and activation times.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.circles circle_record
    where (
      circle_record.status = 'forming'
      and (
        circle_record.activated_by_auth_user_id is not null
        or circle_record.activated_at is not null
      )
    ) or (
      circle_record.activated_by_auth_user_id is not null
      and (
        circle_record.starts_at is null
        or circle_record.activated_at is null
      )
    )
  ) then
    raise exception 'Existing Circle activation attribution is inconsistent.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.passwordless_account_invites invitation
    where invitation.revoked_by_auth_user_id is not null
      and invitation.revoked_at is null
  ) then
    raise exception 'Existing invitation revocation attribution is inconsistent.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.circle_member_assignments assignment
    where assignment.ended_by_auth_user_id is not null
      and assignment.ended_at is null
  ) then
    raise exception 'Existing Circle assignment end attribution is inconsistent.'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function private.ruined_guard_circle_activation_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invalidates_completion_proof boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'forming' then
      raise exception 'A Circle must be created as forming before activation.'
        using errcode = '23514';
    end if;

    if new.activated_by_auth_user_id is not null or new.activated_at is not null then
      raise exception 'A forming Circle cannot carry activation evidence.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.status = 'forming' then
    if new.status not in ('forming', 'active') then
      raise exception 'A forming Circle may only remain forming or become active.'
        using errcode = '23514';
    end if;

    if new.status = 'forming' then
      if new.activated_by_auth_user_id is not null or new.activated_at is not null then
        raise exception 'A forming Circle cannot carry activation evidence.'
          using errcode = '23514';
      end if;

      return new;
    end if;

    if new.starts_at is null
      or new.starts_at > statement_timestamp()
      or new.activated_by_auth_user_id is null
    then
      raise exception 'Circle activation requires a start time and activation actor.'
        using errcode = '23514';
    end if;

    new.activated_at := statement_timestamp();
  else
    if not (
      (old.status = 'active' and new.status in ('active', 'completed', 'archived'))
      or (old.status = 'completed' and new.status in ('completed', 'archived'))
      or (old.status = 'archived' and new.status = 'archived')
    ) then
      raise exception 'That Circle status transition is not allowed.'
        using errcode = '23514';
    end if;

    if new.activated_by_auth_user_id is distinct from old.activated_by_auth_user_id then
      raise exception 'Circle activation attribution is immutable.'
        using errcode = '23514';
    end if;

    if new.activated_at is distinct from old.activated_at then
      raise exception 'Circle activation time is immutable.'
        using errcode = '23514';
    end if;

    if new.starts_at is distinct from old.starts_at then
      raise exception 'A Circle start time is immutable after activation.'
        using errcode = '23514';
    end if;

    if old.status in ('completed', 'archived')
      and new.ends_at is distinct from old.ends_at
    then
      raise exception 'A completed Circle end time is immutable.'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'active'
    and new.ends_at is not null
    and new.ends_at < statement_timestamp()
  then
    raise exception 'An active Circle cannot have an elapsed end time.'
      using errcode = '23514';
  end if;

  if new.status in ('completed', 'archived') and (
    new.ends_at is null
    or new.ends_at > statement_timestamp()
    or new.ends_at < new.activated_at
  ) then
    raise exception 'A completed Circle requires a trustworthy end time.'
      using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.circle_member_assignments assignment
    join public.foundation_enrollments enrollment
      on enrollment.completion_circle_assignment_id = assignment.id
    where assignment.circle_id = old.id
      and enrollment.status = 'completed'
      and (
        new.id is distinct from old.id
        or new.starts_at is null
        or new.starts_at > enrollment.completed_at
        or new.activated_at is null
        or new.activated_at > enrollment.completed_at
        or not (
          (
            new.status = 'active'
            and (
              new.ends_at is null
              or new.ends_at >= enrollment.completed_at
            )
          )
          or (
            new.status in ('completed', 'archived')
            and new.ends_at is not null
            and new.ends_at >= enrollment.completed_at
          )
        )
      )
  ) into invalidates_completion_proof;

  if invalidates_completion_proof then
    raise exception 'A Circle cannot invalidate Foundation completion proof.'
      using
        errcode = '23514',
        constraint = 'foundation_enrollments_completion_proof_check';
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_guard_circle_activation_audit()
  from public, anon, authenticated;

drop trigger if exists circles_00_activation_audit_guard on public.circles;
create trigger circles_00_activation_audit_guard
before insert or update of
  id,
  status,
  starts_at,
  ends_at,
  activated_at,
  activated_by_auth_user_id
on public.circles
for each row execute function private.ruined_guard_circle_activation_audit();

create or replace function private.ruined_guard_invitation_revocation_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.revoked_at is not null then
      raise exception 'Revoked invitation evidence cannot be deleted.'
        using errcode = '23514';
    end if;

    return old;
  end if;

  if tg_op = 'INSERT' then
    if (new.revoked_at is null) <> (new.revoked_by_auth_user_id is null) then
      raise exception 'Invitation revocation time and actor must be recorded together.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if old.revoked_at is not null then
    if new.revoked_at is distinct from old.revoked_at
      or new.revoked_by_auth_user_id is distinct from old.revoked_by_auth_user_id
    then
      raise exception 'Invitation revocation evidence is immutable.'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if (new.revoked_at is null) <> (new.revoked_by_auth_user_id is null) then
    raise exception 'Invitation revocation time and actor must be recorded together.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_guard_invitation_revocation_audit()
  from public, anon, authenticated;

drop trigger if exists passwordless_account_invites_00_revocation_audit_guard
  on public.passwordless_account_invites;
create trigger passwordless_account_invites_00_revocation_audit_guard
before insert or update of revoked_at, revoked_by_auth_user_id
on public.passwordless_account_invites
for each row execute function private.ruined_guard_invitation_revocation_audit();

drop trigger if exists passwordless_account_invites_revocation_delete_guard
  on public.passwordless_account_invites;
create trigger passwordless_account_invites_revocation_delete_guard
before delete
on public.passwordless_account_invites
for each row execute function private.ruined_guard_invitation_revocation_audit();

alter table public.foundation_enrollments
  add column if not exists completion_circle_assignment_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_attribute attribute_record
    where attribute_record.attrelid = 'public.foundation_enrollments'::regclass
      and attribute_record.attname = 'completion_circle_assignment_id'
      and attribute_record.atttypid = 'pg_catalog.int8'::regtype
      and attribute_record.attnotnull = false
      and attribute_record.attisdropped = false
  ) then
    raise exception 'completion_circle_assignment_id must be a nullable bigint.';
  end if;
end;
$$;

-- Existing completions must be proven from a single assignment whose interval
-- covers completed_at. A missing, ambiguous, or inactive proof stops migration.
do $$
declare
  completed_prior_count integer;
  enrollment_record record;
  expected_prior_count integer;
  final_position integer;
  final_unit_complete boolean;
  final_unit_slug text;
  proof_count integer;
  proof_id bigint;
  required_after_final_count integer;
  required_prior_count integer;
begin
  if exists (
    select 1
    from public.foundation_enrollments enrollment
    where enrollment.status <> 'completed'
      and (
        enrollment.completed_at is not null
        or enrollment.completion_circle_assignment_id is not null
      )
  ) then
    raise exception 'A non-completed Foundation enrollment contains completion proof.';
  end if;

  for enrollment_record in
    select
      enrollment.id,
      enrollment.member_id,
      enrollment.foundation_version_id,
      enrollment.completed_at,
      enrollment.completion_circle_assignment_id
    from public.foundation_enrollments enrollment
    where enrollment.status = 'completed'
    order by enrollment.id
  loop
    if enrollment_record.completed_at is null then
      raise exception 'Completed Foundation enrollment % has no completed_at proof.',
        enrollment_record.id;
    end if;

    select
      version_record.configuration ->> 'final_unit_slug',
      (version_record.configuration ->> 'required_prior_unit_count')::integer
    into final_unit_slug, expected_prior_count
    from public.foundation_versions version_record
    where version_record.id = enrollment_record.foundation_version_id;

    if nullif(btrim(final_unit_slug), '') is null
      or expected_prior_count is null
      or expected_prior_count < 0
    then
      raise exception 'Completed Foundation enrollment % has no valid completion contract.',
        enrollment_record.id;
    end if;

    select unit_record.position
    into final_position
    from public.foundation_units unit_record
    where unit_record.foundation_version_id = enrollment_record.foundation_version_id
      and unit_record.unit_slug = final_unit_slug
      and unit_record.is_required = true;

    if final_position is null then
      raise exception 'Completed Foundation enrollment % has no required final unit.',
        enrollment_record.id;
    end if;

    select
      count(*) filter (
        where unit_record.is_required = true
          and unit_record.position < final_position
      ),
      count(*) filter (
        where unit_record.is_required = true
          and unit_record.position < final_position
          and progress.status = 'completed'
      ),
      count(*) filter (
        where unit_record.is_required = true
          and unit_record.position > final_position
      ),
      coalesce(
        bool_or(
          unit_record.is_required = true
          and unit_record.position = final_position
          and progress.status = 'completed'
        ),
        false
      )
    into
      required_prior_count,
      completed_prior_count,
      required_after_final_count,
      final_unit_complete
    from public.foundation_units unit_record
    left join public.foundation_unit_progress progress
      on progress.enrollment_id = enrollment_record.id
      and progress.unit_id = unit_record.id
      and progress.foundation_version_id = enrollment_record.foundation_version_id
    where unit_record.foundation_version_id = enrollment_record.foundation_version_id;

    if required_prior_count <> expected_prior_count
      or completed_prior_count <> expected_prior_count
      or required_after_final_count <> 0
      or final_unit_complete is distinct from true
    then
      raise exception 'Completed Foundation enrollment % lacks provable required-unit progress.',
        enrollment_record.id;
    end if;

    if enrollment_record.completion_circle_assignment_id is not null then
      continue;
    end if;

    select count(*), min(assignment.id)
    into proof_count, proof_id
    from public.circle_member_assignments assignment
    join public.circles circle_record on circle_record.id = assignment.circle_id
    where assignment.member_id = enrollment_record.member_id
      and assignment.assigned_at <= enrollment_record.completed_at
      and (
        assignment.ended_at is null
        or assignment.ended_at >= enrollment_record.completed_at
      )
      and circle_record.starts_at is not null
      and circle_record.starts_at <= enrollment_record.completed_at
      and circle_record.activated_at is not null
      and circle_record.activated_at <= enrollment_record.completed_at
      and (
        (
          circle_record.status = 'active'
          and (
            circle_record.ends_at is null
            or circle_record.ends_at >= enrollment_record.completed_at
          )
        )
        or (
          circle_record.status in ('completed', 'archived')
          and circle_record.ends_at is not null
          and circle_record.ends_at >= enrollment_record.completed_at
        )
      );

    if proof_count <> 1 then
      raise exception
        'Completed Foundation enrollment % has % Circle assignments provably active at completion; expected 1.',
        enrollment_record.id,
        proof_count;
    end if;

    update public.foundation_enrollments
    set completion_circle_assignment_id = proof_id
    where id = enrollment_record.id;
  end loop;

  if exists (
    select 1
    from public.foundation_enrollments enrollment
    join public.circle_member_assignments assignment
      on assignment.id = enrollment.completion_circle_assignment_id
    join public.circles circle_record
      on circle_record.id = assignment.circle_id
    where enrollment.status = 'completed'
      and (
        assignment.member_id is distinct from enrollment.member_id
        or assignment.assigned_at > enrollment.completed_at
        or (
          assignment.ended_at is not null
          and assignment.ended_at < enrollment.completed_at
        )
        or circle_record.starts_at is null
        or circle_record.starts_at > enrollment.completed_at
        or circle_record.activated_at is null
        or circle_record.activated_at > enrollment.completed_at
        or not (
          (
            circle_record.status = 'active'
            and (
              circle_record.ends_at is null
              or circle_record.ends_at >= enrollment.completed_at
            )
          )
          or (
            circle_record.status in ('completed', 'archived')
            and circle_record.ends_at is not null
            and circle_record.ends_at >= enrollment.completed_at
          )
        )
      )
  ) then
    raise exception 'An existing Foundation completion has invalid Circle assignment proof.';
  end if;
end;
$$;

do $$
declare
  column_number smallint;
  index_is_compatible boolean;
  index_oid oid;
begin
  select attribute_record.attnum
  into column_number
  from pg_attribute attribute_record
  where attribute_record.attrelid = 'public.foundation_enrollments'::regclass
    and attribute_record.attname = 'completion_circle_assignment_id'
    and attribute_record.attisdropped = false;

  index_oid := to_regclass(
    'public.foundation_enrollments_completion_circle_assignment_idx'
  );

  if index_oid is not null then
    select exists (
      select 1
      from pg_index index_record
      join pg_class index_relation on index_relation.oid = index_record.indexrelid
      join pg_am access_method on access_method.oid = index_relation.relam
      where index_record.indexrelid = index_oid
        and index_record.indrelid = 'public.foundation_enrollments'::regclass
        and index_record.indisvalid
        and index_record.indisready
        and not index_record.indisunique
        and index_record.indnkeyatts = 1
        and index_record.indnatts = 1
        and index_record.indpred is null
        and index_record.indexprs is null
        and index_record.indkey::text = column_number::text
        and access_method.amname = 'btree'
    ) into index_is_compatible;

    if not index_is_compatible then
      drop index public.foundation_enrollments_completion_circle_assignment_idx;
    end if;
  end if;
end;
$$;

create index if not exists foundation_enrollments_completion_circle_assignment_idx
  on public.foundation_enrollments(completion_circle_assignment_id);

do $$
declare
  constraint_oid oid;
  local_attribute_number smallint;
  referenced_attribute_number smallint;
begin
  select attribute_record.attnum
  into local_attribute_number
  from pg_attribute attribute_record
  where attribute_record.attrelid = 'public.foundation_enrollments'::regclass
    and attribute_record.attname = 'completion_circle_assignment_id'
    and attribute_record.attisdropped = false;

  select attribute_record.attnum
  into referenced_attribute_number
  from pg_attribute attribute_record
  where attribute_record.attrelid = 'public.circle_member_assignments'::regclass
    and attribute_record.attname = 'id'
    and attribute_record.attisdropped = false;

  select constraint_record.oid
  into constraint_oid
  from pg_constraint constraint_record
  where constraint_record.conname =
      'foundation_enrollments_completion_circle_assignment_fkey'
    and constraint_record.conrelid = 'public.foundation_enrollments'::regclass;

  if constraint_oid is not null and not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.oid = constraint_oid
      and constraint_record.contype = 'f'
      and constraint_record.conkey = array[local_attribute_number]::smallint[]
      and constraint_record.confrelid = 'public.circle_member_assignments'::regclass
      and constraint_record.confkey = array[referenced_attribute_number]::smallint[]
      and constraint_record.confupdtype = 'a'
      and constraint_record.confdeltype = 'r'
      and constraint_record.confmatchtype = 's'
      and not constraint_record.condeferrable
      and not constraint_record.condeferred
  ) then
    alter table public.foundation_enrollments
      drop constraint foundation_enrollments_completion_circle_assignment_fkey;
    constraint_oid := null;
  end if;

  if constraint_oid is null then
    alter table public.foundation_enrollments
      add constraint foundation_enrollments_completion_circle_assignment_fkey
      foreign key (completion_circle_assignment_id)
      references public.circle_member_assignments(id)
      on delete restrict
      not valid;
  end if;
end;
$$;

alter table public.foundation_enrollments
  validate constraint foundation_enrollments_completion_circle_assignment_fkey;

do $$
declare
  constraint_oid oid;
begin
  select constraint_record.oid
  into constraint_oid
  from pg_constraint constraint_record
  where constraint_record.conname = 'foundation_enrollments_completion_proof_check'
    and constraint_record.conrelid = 'public.foundation_enrollments'::regclass;

  if constraint_oid is not null and (
    select constraint_record.contype <> 'c'
      or obj_description(constraint_record.oid, 'pg_constraint') is distinct from
        'ruined:v1:completed requires timestamp and Circle assignment proof'
    from pg_constraint constraint_record
    where constraint_record.oid = constraint_oid
  ) then
    alter table public.foundation_enrollments
      drop constraint foundation_enrollments_completion_proof_check;
    constraint_oid := null;
  end if;

  if constraint_oid is null then
    alter table public.foundation_enrollments
      add constraint foundation_enrollments_completion_proof_check
      check (
        (
          status = 'completed'
          and completed_at is not null
          and completion_circle_assignment_id is not null
        )
        or (
          status <> 'completed'
          and completed_at is null
          and completion_circle_assignment_id is null
        )
      )
      not valid;
  end if;
end;
$$;

comment on constraint foundation_enrollments_completion_proof_check
  on public.foundation_enrollments
  is 'ruined:v1:completed requires timestamp and Circle assignment proof';

alter table public.foundation_enrollments
  validate constraint foundation_enrollments_completion_proof_check;

-- Enrollment is the durable fact; repair a stale lifecycle projection only
-- after every completed enrollment has passed the unit and Circle proof checks.
with projection as (
  select
    lifecycle.member_id,
    lifecycle.foundations_state as previous_state,
    lifecycle.program_state as previous_program_state,
    max(enrollment.completed_at) as completed_at
  from public.member_lifecycle lifecycle
  join public.foundation_enrollments enrollment
    on enrollment.member_id = lifecycle.member_id
  where enrollment.status = 'completed'
    and enrollment.completed_at is not null
    and enrollment.completion_circle_assignment_id is not null
    and (
      lifecycle.foundations_state <> 'completed'
      or lifecycle.program_state = 'onboarding'
    )
  group by
    lifecycle.member_id,
    lifecycle.foundations_state,
    lifecycle.program_state
), history_projection as (
  insert into public.member_state_history (
    member_id,
    dimension,
    previous_state,
    next_state,
    reason_code,
    source,
    dedupe_key,
    occurred_at,
    metadata
  )
  select
    projection.member_id,
    'foundations',
    projection.previous_state,
    'completed',
    'migration_repaired_completed_enrollment_projection',
    'migration',
    'membership-foundations-circle-gate:lifecycle:' || projection.member_id::text,
    projection.completed_at,
    jsonb_build_object('completion_proof', 'foundation_enrollment')
  from projection
  where projection.previous_state <> 'completed'
  union all
  select
    projection.member_id,
    'program',
    projection.previous_program_state,
    'active',
    'migration_repaired_completed_foundations_program',
    'migration',
    'membership-foundations-circle-gate:program:' || projection.member_id::text,
    projection.completed_at,
    jsonb_build_object('completion_proof', 'foundation_enrollment')
  from projection
  where projection.previous_program_state = 'onboarding'
  on conflict (dedupe_key) do nothing
  returning member_id
)
update public.member_lifecycle lifecycle
set
  foundations_state = 'completed',
  program_state = case
    when lifecycle.program_state = 'onboarding' then 'active'
    else lifecycle.program_state
  end,
  version = lifecycle.version + 1,
  updated_at = greatest(lifecycle.updated_at, projection.completed_at)
from projection
where lifecycle.member_id = projection.member_id;

-- The lifecycle projection may only claim completion when the durable
-- enrollment record already carries its Circle proof. This validates legacy
-- rows before the write-time trigger is installed.
do $$
begin
  if exists (
    select 1
    from public.member_lifecycle lifecycle
    where lifecycle.foundations_state = 'completed'
      and not exists (
        select 1
        from public.foundation_enrollments enrollment
        where enrollment.member_id = lifecycle.member_id
          and enrollment.status = 'completed'
          and enrollment.completed_at is not null
          and enrollment.completion_circle_assignment_id is not null
      )
  ) then
    raise exception 'A completed Foundation lifecycle has no completed enrollment with Circle proof.'
      using
        errcode = '23514',
        constraint = 'member_lifecycle_foundations_completion_requires_enrollment';
  end if;
end;
$$;

create or replace function private.ruined_guard_completed_foundation_progress()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  first_member_id uuid;
  new_enrollment_id uuid;
  new_member_id uuid;
  old_enrollment_id uuid;
  old_member_id uuid;
  second_member_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_enrollment_id := old.enrollment_id;

    select enrollment.member_id
    into old_member_id
    from public.foundation_enrollments enrollment
    where enrollment.id = old_enrollment_id;

    if old_member_id is null then
      raise exception 'Foundation progress references an unknown enrollment.'
        using errcode = '23503';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    new_enrollment_id := new.enrollment_id;

    if new_enrollment_id = old_enrollment_id then
      new_member_id := old_member_id;
    else
      select enrollment.member_id
      into new_member_id
      from public.foundation_enrollments enrollment
      where enrollment.id = new_enrollment_id;
    end if;

    if new_member_id is null then
      raise exception 'Foundation progress references an unknown enrollment.'
        using errcode = '23503';
    end if;
  end if;

  if old_member_id is null then
    first_member_id := new_member_id;
  elsif new_member_id is null or old_member_id = new_member_id then
    first_member_id := old_member_id;
  elsif old_member_id < new_member_id then
    first_member_id := old_member_id;
    second_member_id := new_member_id;
  else
    first_member_id := new_member_id;
    second_member_id := old_member_id;
  end if;

  update public.ruined_members
  set updated_at = updated_at
  where id = first_member_id;

  if not found then
    raise exception 'Foundation progress references an unknown member.'
      using errcode = '23503';
  end if;

  if second_member_id is not null then
    update public.ruined_members
    set updated_at = updated_at
    where id = second_member_id;

    if not found then
      raise exception 'Foundation progress references an unknown member.'
        using errcode = '23503';
    end if;
  end if;

  if exists (
    select 1
    from public.foundation_enrollments enrollment
    where enrollment.id in (old_enrollment_id, new_enrollment_id)
      and enrollment.status = 'completed'
  ) then
    raise exception 'Unit progress for a completed Foundation enrollment is immutable.'
      using
        errcode = '23514',
        constraint = 'foundation_unit_progress_completed_enrollment_immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_guard_completed_foundation_progress()
  from public, anon, authenticated;

drop trigger if exists foundation_unit_progress_00_completed_enrollment_guard
  on public.foundation_unit_progress;
create trigger foundation_unit_progress_00_completed_enrollment_guard
before insert or update or delete
on public.foundation_unit_progress
for each row execute function private.ruined_guard_completed_foundation_progress();

create or replace function private.ruined_guard_circle_assignment_foundation_proof()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  invalidates_proof boolean;
  first_member_id uuid;
  second_member_id uuid;
begin
  if tg_op = 'INSERT' then
    first_member_id := new.member_id;
  elsif tg_op = 'DELETE' then
    first_member_id := old.member_id;
  elsif old.member_id = new.member_id then
    first_member_id := old.member_id;
  elsif old.member_id < new.member_id then
    first_member_id := old.member_id;
    second_member_id := new.member_id;
  else
    first_member_id := new.member_id;
    second_member_id := old.member_id;
  end if;

  update public.ruined_members
  set updated_at = updated_at
  where id = first_member_id;

  if not found then
    raise exception 'Circle assignment references an unknown member.'
      using errcode = '23503';
  end if;

  if second_member_id is not null then
    update public.ruined_members
    set updated_at = updated_at
    where id = second_member_id;

    if not found then
      raise exception 'Circle assignment references an unknown member.'
        using errcode = '23503';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if (new.ended_at is null) <> (new.ended_by_auth_user_id is null) then
      raise exception 'Circle assignment end time and actor must be recorded together.'
        using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.ended_at is not null then
      if new.circle_id is distinct from old.circle_id
        or new.member_id is distinct from old.member_id
        or new.assigned_at is distinct from old.assigned_at
        or new.ended_at is distinct from old.ended_at
        or new.end_reason is distinct from old.end_reason
        or new.ended_by_auth_user_id is distinct from old.ended_by_auth_user_id
      then
        raise exception 'Ended Circle assignment evidence is immutable.'
          using errcode = '23514';
      end if;
    elsif (new.ended_at is null) <> (new.ended_by_auth_user_id is null) then
      raise exception 'Circle assignment end time and actor must be recorded together.'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    if old.ended_at is not null then
      raise exception 'Ended Circle assignment evidence cannot be deleted.'
        using errcode = '23514';
    end if;

    select exists (
      select 1
      from public.foundation_enrollments enrollment
      where enrollment.completion_circle_assignment_id = old.id
    )
    into invalidates_proof;

    if invalidates_proof then
      raise exception 'A Circle assignment used as Foundation completion proof cannot be deleted.'
        using
          errcode = '23514',
          constraint = 'foundation_enrollments_completion_proof_check';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' then
    select exists (
      select 1
      from public.foundation_enrollments enrollment
      where enrollment.completion_circle_assignment_id = old.id
        and (
          new.member_id is distinct from old.member_id
          or new.circle_id is distinct from old.circle_id
          or new.assigned_at is distinct from old.assigned_at
          or (
            new.ended_at is not null
            and new.ended_at < enrollment.completed_at
          )
        )
    )
    into invalidates_proof;

    if invalidates_proof then
      raise exception 'A Circle assignment cannot invalidate Foundation completion proof.'
        using
          errcode = '23514',
          constraint = 'foundation_enrollments_completion_proof_check';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_guard_circle_assignment_foundation_proof()
  from public, anon, authenticated;

drop trigger if exists circle_member_assignments_00_foundation_proof_guard
  on public.circle_member_assignments;
create trigger circle_member_assignments_00_foundation_proof_guard
before insert or update or delete
on public.circle_member_assignments
for each row execute function private.ruined_guard_circle_assignment_foundation_proof();

create or replace function private.ruined_require_foundation_completion_circle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_assignment_id bigint;
  completed_prior_count integer;
  completion_time timestamptz := statement_timestamp();
  expected_prior_count integer;
  final_position integer;
  final_unit_complete boolean;
  final_unit_slug text;
  locked_member_id uuid;
  required_after_final_count integer;
  required_prior_count integer;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'completed' then
      return old;
    end if;

    update public.ruined_members
    set updated_at = updated_at
    where id = old.member_id
    returning id into locked_member_id;

    if locked_member_id is null then
      raise exception 'Foundation enrollment references an unknown member.'
        using errcode = '23503';
    end if;

    raise exception 'A completed Foundation enrollment and its Circle proof cannot be deleted.'
      using
        errcode = '23514',
        constraint = 'foundation_enrollments_completion_proof_check';
  end if;

  if tg_op = 'UPDATE' and old.status = 'completed' then
    if new.status is distinct from old.status
      or new.member_id is distinct from old.member_id
      or new.foundation_version_id is distinct from old.foundation_version_id
      or new.completed_at is distinct from old.completed_at
      or new.completion_circle_assignment_id is distinct from old.completion_circle_assignment_id
    then
      raise exception 'Foundation completion identity and proof are immutable.'
        using
          errcode = '23514',
          constraint = 'foundation_enrollments_completion_proof_check';
    end if;

    return new;
  end if;

  if new.status <> 'completed' then
    return new;
  end if;

  -- A real row update serializes against Stripe and Circle mutations at Read
  -- Committed and produces a retryable serialization failure at stricter levels.
  update public.ruined_members
  set updated_at = updated_at
  where id = new.member_id
  returning id into locked_member_id;

  if locked_member_id is null then
    raise exception 'Foundation enrollment references an unknown member.'
      using errcode = '23503';
  end if;

  select
    version_record.configuration ->> 'final_unit_slug',
    (version_record.configuration ->> 'required_prior_unit_count')::integer
  into final_unit_slug, expected_prior_count
  from public.foundation_versions version_record
  where version_record.id = new.foundation_version_id;

  if nullif(btrim(final_unit_slug), '') is null
    or expected_prior_count is null
    or expected_prior_count < 0
  then
    raise exception 'Foundation version is missing a valid completion contract.'
      using
        errcode = '23514',
        constraint = 'foundation_enrollments_completion_requirements';
  end if;

  select unit_record.position
  into final_position
  from public.foundation_units unit_record
  where unit_record.foundation_version_id = new.foundation_version_id
    and unit_record.unit_slug = final_unit_slug
    and unit_record.is_required = true;

  if final_position is null then
    raise exception 'Foundation version is missing its required final unit.'
      using
        errcode = '23514',
        constraint = 'foundation_enrollments_completion_requirements';
  end if;

  select
    count(*) filter (
      where unit_record.is_required = true
        and unit_record.position < final_position
    ),
    count(*) filter (
      where unit_record.is_required = true
        and unit_record.position < final_position
        and progress.status = 'completed'
    ),
    count(*) filter (
      where unit_record.is_required = true
        and unit_record.position > final_position
    ),
    coalesce(
      bool_or(
        unit_record.is_required = true
        and unit_record.position = final_position
        and progress.status = 'completed'
      ),
      false
    )
  into
    required_prior_count,
    completed_prior_count,
    required_after_final_count,
    final_unit_complete
  from public.foundation_units unit_record
  left join public.foundation_unit_progress progress
    on progress.enrollment_id = new.id
    and progress.unit_id = unit_record.id
    and progress.foundation_version_id = new.foundation_version_id
  where unit_record.foundation_version_id = new.foundation_version_id;

  if required_prior_count <> expected_prior_count
    or completed_prior_count <> expected_prior_count
    or required_after_final_count <> 0
    or final_unit_complete is distinct from true
  then
    raise exception
      'Foundation completion requires % prior required units and the final unit.',
      expected_prior_count
      using
        errcode = '23514',
        constraint = 'foundation_enrollments_completion_requirements';
  end if;

  -- The member-row lock serializes assignment changes. A no-key-update lock on
  -- the Circle row also serializes its status with the active-status check.
  select assignment.id
  into active_assignment_id
  from public.circle_member_assignments assignment
  join public.circles circle_record on circle_record.id = assignment.circle_id
  where assignment.member_id = new.member_id
    and assignment.ended_at is null
    and assignment.assigned_at <= completion_time
    and circle_record.status = 'active'
    and circle_record.starts_at is not null
    and circle_record.starts_at <= completion_time
    and circle_record.activated_at is not null
    and circle_record.activated_at <= completion_time
    and (
      circle_record.ends_at is null
      or circle_record.ends_at >= completion_time
    )
  order by assignment.assigned_at desc, assignment.id desc
  limit 1
  for no key update of circle_record;

  if active_assignment_id is null then
    raise exception 'An active Circle assignment is required to complete Foundations.'
      using
        errcode = '23514',
        constraint = 'foundation_completion_requires_circle';
  end if;

  new.progress_percent := 100;
  new.completed_at := completion_time;
  new.completion_circle_assignment_id := active_assignment_id;
  return new;
end;
$$;

revoke all on function private.ruined_require_foundation_completion_circle()
  from public, anon, authenticated;

drop trigger if exists foundation_enrollments_completion_circle_guard
  on public.foundation_enrollments;
create trigger foundation_enrollments_completion_circle_guard
before insert or update of
  status,
  member_id,
  foundation_version_id,
  completed_at,
  completion_circle_assignment_id
on public.foundation_enrollments
for each row execute function private.ruined_require_foundation_completion_circle();

drop trigger if exists foundation_enrollments_completed_delete_guard
  on public.foundation_enrollments;
create trigger foundation_enrollments_completed_delete_guard
before delete
on public.foundation_enrollments
for each row execute function private.ruined_require_foundation_completion_circle();

create or replace function private.ruined_require_completed_foundation_enrollment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  has_completed_enrollment boolean;
  locked_member_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.foundations_state = 'completed' then
      raise exception 'A completed Foundation lifecycle projection cannot be deleted.'
        using
          errcode = '23514',
          constraint = 'member_lifecycle_foundations_completion_requires_enrollment';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE'
    and old.foundations_state = 'completed'
  then
    if new.foundations_state is distinct from old.foundations_state
      or new.member_id is distinct from old.member_id
    then
      raise exception 'A completed Foundation lifecycle projection cannot regress.'
        using
          errcode = '23514',
          constraint = 'member_lifecycle_foundations_completion_requires_enrollment';
    end if;

    return new;
  end if;

  if new.foundations_state <> 'completed' then
    return new;
  end if;

  update public.ruined_members
  set updated_at = updated_at
  where id = new.member_id
  returning id into locked_member_id;

  if locked_member_id is null then
    raise exception 'Foundation lifecycle references an unknown member.'
      using errcode = '23503';
  end if;

  select exists (
    select 1
    from public.foundation_enrollments enrollment
    where enrollment.member_id = new.member_id
      and enrollment.status = 'completed'
      and enrollment.completed_at is not null
      and enrollment.completion_circle_assignment_id is not null
  )
  into has_completed_enrollment;

  if not has_completed_enrollment then
    raise exception 'Lifecycle completion requires a completed Foundation enrollment with Circle proof.'
      using
        errcode = '23514',
        constraint = 'member_lifecycle_foundations_completion_requires_enrollment';
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_require_completed_foundation_enrollment()
  from public, anon, authenticated;

drop trigger if exists member_lifecycle_foundations_completion_guard
  on public.member_lifecycle;
create trigger member_lifecycle_foundations_completion_guard
before insert or update of foundations_state, member_id
on public.member_lifecycle
for each row execute function private.ruined_require_completed_foundation_enrollment();

drop trigger if exists member_lifecycle_foundations_completion_delete_guard
  on public.member_lifecycle;
create trigger member_lifecycle_foundations_completion_delete_guard
before delete
on public.member_lifecycle
for each row execute function private.ruined_require_completed_foundation_enrollment();

create or replace function private.ruined_require_foundation_lifecycle_projection()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  checked_member_id uuid;
  locked_member_id uuid;
  new_member_id uuid;
  old_member_id uuid;
begin
  if tg_op <> 'INSERT' then
    old_member_id := old.member_id;
  end if;

  if tg_op <> 'DELETE' then
    new_member_id := new.member_id;
  end if;

  for checked_member_id in
    select distinct candidate.member_id
    from (values (old_member_id), (new_member_id)) as candidate(member_id)
    where candidate.member_id is not null
    order by candidate.member_id
  loop
    locked_member_id := null;

    update public.ruined_members
    set updated_at = updated_at
    where id = checked_member_id
    returning id into locked_member_id;

    if locked_member_id is null then
      raise exception 'Foundation enrollment references an unknown member.'
        using errcode = '23503';
    end if;

    if exists (
      select 1
      from public.foundation_enrollments enrollment
      where enrollment.member_id = checked_member_id
        and enrollment.status = 'completed'
        and enrollment.completed_at is not null
        and enrollment.completion_circle_assignment_id is not null
    ) and not exists (
      select 1
      from public.member_lifecycle lifecycle
      where lifecycle.member_id = checked_member_id
        and lifecycle.foundations_state = 'completed'
    ) then
      raise exception 'Completed Foundation enrollment requires a completed lifecycle projection.'
        using
          errcode = '23514',
          constraint = 'foundation_enrollment_requires_completed_lifecycle';
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function private.ruined_require_foundation_lifecycle_projection()
  from public, anon, authenticated;

drop trigger if exists foundation_enrollments_lifecycle_projection_guard
  on public.foundation_enrollments;
create constraint trigger foundation_enrollments_lifecycle_projection_guard
after insert or update or delete
on public.foundation_enrollments
deferrable initially deferred
for each row execute function private.ruined_require_foundation_lifecycle_projection();

commit;
