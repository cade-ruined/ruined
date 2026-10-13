begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create table private.admin_email_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name=btrim(name) and char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description)<=500),
  mode text not null check (mode in ('manual','rule')),
  rule jsonb,
  revision integer not null default 1 check (revision>0),
  archived_at timestamptz,
  created_by uuid not null references public.platform_users(auth_user_id),
  updated_by uuid not null references public.platform_users(auth_user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((mode='manual' and rule is null) or (mode='rule' and jsonb_typeof(rule)='object'
    and rule->>'kind' in ('general_subscribers','registered_members','event_registrants','call_audience','foundations_cohort')))
);
create unique index admin_email_groups_active_name_idx on private.admin_email_groups(lower(name)) where archived_at is null;
create table private.admin_email_group_entries (
  group_id uuid not null references private.admin_email_groups(id) on delete cascade,
  email_normalized text not null check (email_normalized=lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 254 and email_normalized ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'),
  display_name text not null default '' check (char_length(display_name)<=160),
  member_id uuid references public.ruined_members(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  added_by uuid not null references public.platform_users(auth_user_id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(group_id,email_normalized)
);
create index admin_email_group_entries_person_idx on private.admin_email_group_entries(person_id) where person_id is not null;
alter table private.admin_email_groups enable row level security;
alter table private.admin_email_group_entries enable row level security;
revoke all on private.admin_email_groups,private.admin_email_group_entries from public,anon,authenticated;
comment on table private.admin_email_groups is 'Ruined-owned audience definitions. Group membership never creates email permission or changes provider preferences.';
comment on table private.admin_email_group_entries is 'Explicitly selected local destinations; current identity and consent are rechecked before delivery.';
commit;
