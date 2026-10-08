begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create schema if not exists private;

-- Number-level suppression survives member erasure and applies to every member
-- using that number. START never clears it automatically in this release.
create table if not exists private.member_sms_phone_suppressions (
  phone_e164 text primary key check (phone_e164 ~ '^[+][1-9][0-9]{1,14}$'),
  stopped_at timestamptz not null default statement_timestamp(),
  source text not null default 'inbound_stop' check (source in ('inbound_stop','provider_opt_out')),
  latest_message_sid text check (latest_message_sid ~ '^SM[0-9a-fA-F]{32}$'),
  provider_attempt_id uuid,
  check ((source='inbound_stop' and latest_message_sid is not null and provider_attempt_id is null)
    or (source='provider_opt_out' and latest_message_sid is null and provider_attempt_id is not null))
);

-- Twilio signatures have no event timestamp. Retain MessageSid receipts so a
-- replay cannot change consent or process an inbound message twice.
create table if not exists private.member_sms_inbound_receipts (
  message_sid text primary key check (message_sid ~ '^SM[0-9a-fA-F]{32}$'),
  event_kind text not null check (event_kind in ('STOP','START','HELP','message')),
  processed_at timestamptz not null default statement_timestamp()
);

-- Dispatching commits before the network request. Neither dispatching nor
-- unknown may be retried: a timeout can still represent a billable delivery.
create table if not exists private.member_sms_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete cascade,
  reminder_key text not null check (char_length(reminder_key) between 1 and 160),
  reminder_kind text not null check (reminder_kind in ('call_reminder','membership_reminder','opt_in_confirmation')),
  destination_e164 text not null check (destination_e164 ~ '^[+][1-9][0-9]{1,14}$'),
  consent_id bigint references public.member_consents(id) on delete set null,
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'dispatching' check (status in ('dispatching','accepted','blocked','unknown')),
  blocked_reason text check (blocked_reason in ('member_inactive','phone_missing','no_current_consent','phone_suppressed')),
  twilio_message_sid text unique check (twilio_message_sid ~ '^SM[0-9a-fA-F]{32}$'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(member_id,reminder_kind,reminder_key),
  check ((status='accepted') = (twilio_message_sid is not null)),
  check ((status='blocked') = (blocked_reason is not null))
);

alter table private.member_sms_phone_suppressions enable row level security;
alter table private.member_sms_inbound_receipts enable row level security;
alter table private.member_sms_delivery_attempts enable row level security;
revoke all on private.member_sms_phone_suppressions,private.member_sms_inbound_receipts,
  private.member_sms_delivery_attempts from public,anon,authenticated;

commit;
