begin;

-- Public signups use the guarded Next.js API and server database connection.
-- Contact details must never be exposed through the Supabase Data API.
create table public.membership_waitlist (
  id uuid primary key default gen_random_uuid(),
  sheet_row bigint generated always as identity (start with 2) not null unique,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  email_normalized text not null unique check (
    email_normalized = lower(btrim(email_normalized))
    and char_length(email_normalized) between 3 and 254
    and email_normalized ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  phone text check (
    phone is null or (
      phone = btrim(phone) and char_length(phone) between 7 and 40
      and phone ~ '^\+?[0-9 ().-]+$'
      and char_length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15
    )
  ),
  created_at timestamptz not null default statement_timestamp(),
  check (sheet_row >= 2)
);

comment on table public.membership_waitlist is
  'Canonical membership interest. Joining does not create a member or subscribe to general marketing.';
comment on column public.membership_waitlist.sheet_row is
  'Stable row in the dedicated Waitlist sheet. Never reorder, insert or delete managed sheet rows; use filter views.';

create table public.membership_waitlist_rate_limits (
  fingerprint_hash text not null check (fingerprint_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 8),
  primary key (fingerprint_hash, window_started_at)
);
create index membership_waitlist_rate_limits_expiry_idx
  on public.membership_waitlist_rate_limits (window_started_at);

alter table public.membership_waitlist enable row level security;
alter table public.membership_waitlist_rate_limits enable row level security;
revoke all on public.membership_waitlist, public.membership_waitlist_rate_limits
  from public, anon, authenticated;
revoke all on sequence public.membership_waitlist_sheet_row_seq
  from public, anon, authenticated;

create index integration_outbox_membership_waitlist_pending_idx
  on public.integration_outbox (available_at, id)
  where destination = 'google'
    and event_type = 'membership_waitlist.sheet_sync_requested'
    and status in ('pending', 'failed', 'processing');

commit;
