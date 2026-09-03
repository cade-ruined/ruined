begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Account support is independent of paid membership. The server rechecks
-- identity and (for the shared queue) the active ops_admin grant.
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  requester_auth_user_id uuid not null references public.platform_users(auth_user_id) on delete restrict,
  requester_email text not null,
  requester_name text not null,
  category text not null check (category in ('account', 'billing', 'circle', 'foundations', 'academy', 'experiences', 'artifacts', 'other')),
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_on_member', 'resolved')),
  request_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (requester_auth_user_id, request_key),
  check (requester_email = lower(btrim(requester_email))),
  check (char_length(requester_email) between 3 and 254),
  check (char_length(requester_name) between 1 and 254)
);
create index support_tickets_requester_idx on public.support_tickets(requester_auth_user_id, updated_at desc);
create index support_tickets_queue_idx on public.support_tickets(status, updated_at desc);
create index support_tickets_recent_idx on public.support_tickets(updated_at desc);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  author_auth_user_id uuid not null references public.platform_users(auth_user_id) on delete restrict,
  author_type text not null check (author_type in ('member', 'operator')),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  request_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (ticket_id, author_auth_user_id, request_key),
  unique (id, ticket_id)
);
create index support_messages_ticket_idx on public.support_messages(ticket_id, created_at, id);
create index support_messages_author_idx on public.support_messages(author_auth_user_id, created_at);

create table public.support_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  message_id uuid not null,
  audience text not null check (audience in ('operator', 'member')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default clock_timestamp(),
  first_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  unique (message_id, audience),
  foreign key (message_id, ticket_id) references public.support_messages(id, ticket_id) on delete restrict
);
create index support_email_deliveries_ticket_idx on public.support_email_deliveries(ticket_id);
create index support_email_deliveries_queue_idx on public.support_email_deliveries(available_at, created_at)
  where status in ('pending', 'failed', 'processing');

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_email_deliveries enable row level security;
revoke all on public.support_tickets, public.support_messages, public.support_email_deliveries from public, anon, authenticated;
revoke all on sequence public.support_tickets_ticket_number_seq from public, anon, authenticated;

comment on table public.support_tickets is 'Private account support. Server-authorized requester or active ops_admin only.';
comment on table public.support_messages is 'Private support conversation. Not exposed through the client data API.';
comment on table public.support_email_deliveries is 'Transactional support notification queue. No message bodies or email addresses are duplicated here.';

commit;
