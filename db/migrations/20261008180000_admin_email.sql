begin;

create table public.admin_email_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by_auth_user_id uuid not null references public.platform_users(auth_user_id),
  updated_by_auth_user_id uuid not null references public.platform_users(auth_user_id),
  subject text not null check (char_length(subject) between 1 and 200),
  preheader text not null default '' check (char_length(preheader) <= 200),
  body text not null check (char_length(body) between 1 and 12000),
  purpose text not null check (purpose in ('marketing','service')),
  audience text not null check (audience in ('individual','updates','members')),
  recipients jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients)='array'),
  status text not null default 'draft' check (status in ('draft','queued')),
  version integer not null default 1 check (version > 0),
  reviewed_recipient_hash text,
  reviewed_recipient_count integer,
  reviewed_by_auth_user_id uuid references public.platform_users(auth_user_id),
  reviewed_at timestamptz,
  queued_at timestamptz,
  recipient_count integer not null default 0 check (recipient_count between 0 and 250),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (audience <> 'updates' or purpose='marketing'),
  check ((status='draft' and queued_at is null) or (status='queued' and queued_at is not null))
);
create table public.admin_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.admin_email_drafts(id),
  recipient_email text not null,
  recipient_name text not null default '',
  contact_id uuid references public.communication_contacts(id) on delete set null,
  purpose text not null check (purpose in ('marketing','service')),
  audience text not null check (audience in ('individual','updates','members')),
  unsubscribe_token text,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped','manual_review')),
  attempts integer not null default 0 check (attempts between 0 and 6),
  available_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  lock_token uuid,
  first_send_attempt_at timestamptz,
  delivery_payload jsonb check (delivery_payload is null or jsonb_typeof(delivery_payload)='object'),
  provider_email_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (draft_id,recipient_email),
  check (recipient_email=lower(btrim(recipient_email))),
  check ((status='sending' and locked_at is not null and lock_token is not null) or (status<>'sending' and locked_at is null and lock_token is null))
);
create table public.admin_email_delivery_events (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references public.admin_email_deliveries(id),
  status text not null,
  reason text,
  occurred_at timestamptz not null default clock_timestamp()
);
create table public.admin_email_unsubscribe_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  contact_id uuid not null references public.communication_contacts(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  used_at timestamptz
);
create table public.admin_email_generation_limits (
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 30),
  primary key (actor_auth_user_id,window_started_at)
);
create index admin_email_drafts_updated_idx on public.admin_email_drafts(updated_at desc);
create index admin_email_deliveries_queue_idx on public.admin_email_deliveries(status,available_at,created_at);
create index admin_email_deliveries_contact_idx on public.admin_email_deliveries(contact_id);
create index admin_email_events_delivery_idx on public.admin_email_delivery_events(delivery_id,occurred_at);
create index admin_email_unsubscribe_contact_idx on public.admin_email_unsubscribe_tokens(contact_id);

create function private.ruined_guard_admin_email_draft() returns trigger language plpgsql as $$
begin
  if old.status='queued' then raise exception 'Queued emails are immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger admin_email_draft_immutable before update or delete on public.admin_email_drafts
  for each row execute function private.ruined_guard_admin_email_draft();
create function private.ruined_guard_admin_email_delivery() returns trigger language plpgsql as $$
begin
  if new.draft_id is distinct from old.draft_id or new.recipient_email is distinct from old.recipient_email
    or new.purpose is distinct from old.purpose or new.audience is distinct from old.audience
    or (old.delivery_payload is not null and new.delivery_payload is distinct from old.delivery_payload)
    or (old.first_send_attempt_at is not null and new.first_send_attempt_at is distinct from old.first_send_attempt_at)
    then raise exception 'Queued email delivery bytes are immutable'; end if;
  return new;
end $$;
create trigger admin_email_delivery_immutable before update on public.admin_email_deliveries
  for each row execute function private.ruined_guard_admin_email_delivery();
create function private.ruined_record_admin_email_delivery() returns trigger language plpgsql as $$
begin
  if tg_op='INSERT' or new.status is distinct from old.status then
    insert into public.admin_email_delivery_events(delivery_id,status,reason) values(new.id,new.status,new.last_error);
  end if;
  return new;
end $$;
create trigger admin_email_delivery_history after insert or update on public.admin_email_deliveries
  for each row execute function private.ruined_record_admin_email_delivery();
create trigger admin_email_delivery_events_append_only before update or delete on public.admin_email_delivery_events
  for each row execute function public.ruined_reject_append_only_mutation();

alter table public.admin_email_drafts enable row level security;
alter table public.admin_email_deliveries enable row level security;
alter table public.admin_email_delivery_events enable row level security;
alter table public.admin_email_unsubscribe_tokens enable row level security;
alter table public.admin_email_generation_limits enable row level security;
revoke all on table public.admin_email_drafts,public.admin_email_deliveries,public.admin_email_delivery_events,
  public.admin_email_unsubscribe_tokens,public.admin_email_generation_limits from public,anon,authenticated;
revoke all on sequence public.admin_email_delivery_events_id_seq from public,anon,authenticated;
revoke all on function private.ruined_guard_admin_email_draft(),private.ruined_guard_admin_email_delivery(),private.ruined_record_admin_email_delivery() from public,anon,authenticated;
commit;
