begin;

set local lock_timeout = '10s';
set local statement_timeout = '30s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Internal procedures have a separate lifecycle and audience from member Academy.
create table if not exists public.operator_sops (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 2000),
  category text not null default 'General' check (char_length(btrim(category)) between 1 and 80),
  body_text text not null default '' check (char_length(body_text) <= 100000),
  external_url text check (external_url is null or (char_length(external_url) <= 2048 and external_url ~ '^https://[^/[:space:]]+')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  published_at timestamptz,
  updated_by_auth_user_id uuid not null,
  updated_by text not null,
  check (status <> 'published' or (published_at is not null and (btrim(body_text) <> '' or external_url is not null)))
);

create index if not exists operator_sops_library_idx
  on public.operator_sops(status, updated_at desc, id);

create table if not exists public.operator_sop_revisions (
  sop_id uuid not null references public.operator_sops(id) on delete restrict,
  revision bigint not null check (revision > 0),
  title text not null,
  summary text not null,
  category text not null,
  body_text text not null,
  external_url text,
  status text not null check (status in ('draft', 'published', 'archived')),
  updated_at timestamptz not null,
  updated_by_auth_user_id uuid not null,
  updated_by text not null,
  primary key (sop_id, revision)
);

alter table public.operator_sops enable row level security;
alter table public.operator_sop_revisions enable row level security;
revoke all on public.operator_sops, public.operator_sop_revisions from public, anon, authenticated;

create or replace function private.ruined_guard_operator_sop()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'SOPs are archived, never deleted.';
  end if;
  if tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception 'SOP revisions must start at one.';
    end if;
  else
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'SOP identity and creation time are immutable.';
    end if;
    if new.revision <> old.revision + 1 then
      raise exception 'SOP revisions must advance by exactly one.';
    end if;
    if old.published_at is not null and new.published_at is distinct from old.published_at then
      raise exception 'The first SOP publication time is immutable.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.ruined_record_operator_sop_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.operator_sop_revisions (
    sop_id, revision, title, summary, category, body_text, external_url, status,
    updated_at, updated_by_auth_user_id, updated_by
  ) values (
    new.id, new.revision, new.title, new.summary, new.category, new.body_text, new.external_url, new.status,
    new.updated_at, new.updated_by_auth_user_id, new.updated_by
  );
  return new;
end;
$$;

create or replace function private.ruined_guard_operator_sop_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'SOP revision history is append-only.';
end;
$$;

revoke all on function private.ruined_guard_operator_sop(), private.ruined_record_operator_sop_revision(),
  private.ruined_guard_operator_sop_revision() from public, anon, authenticated;

drop trigger if exists operator_sops_guard on public.operator_sops;
create trigger operator_sops_guard before insert or update or delete on public.operator_sops
  for each row execute function private.ruined_guard_operator_sop();
drop trigger if exists operator_sops_no_truncate on public.operator_sops;
create trigger operator_sops_no_truncate before truncate on public.operator_sops
  for each statement execute function private.ruined_guard_operator_sop();
drop trigger if exists operator_sops_record_revision on public.operator_sops;
create trigger operator_sops_record_revision after insert or update on public.operator_sops
  for each row execute function private.ruined_record_operator_sop_revision();
drop trigger if exists operator_sop_revisions_immutable on public.operator_sop_revisions;
create trigger operator_sop_revisions_immutable before update or delete or truncate on public.operator_sop_revisions
  for each statement execute function private.ruined_guard_operator_sop_revision();

comment on table public.operator_sops is 'Internal operator procedures. Server-only reads require a live operator grant; writes require a live administrator grant.';
comment on table public.operator_sop_revisions is 'Append-only SOP snapshots, recorded atomically by the projection trigger.';
comment on column public.operator_sop_revisions.updated_by_auth_user_id is 'Historical actor identity snapshot, retained independently of account deletion.';

commit;
