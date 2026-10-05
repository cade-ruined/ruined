begin;

-- One immutable email per recipient and local delivery slot, independent of
-- marketing consent. Account/role/email eligibility is rechecked at send time.
create table if not exists public.operator_work_queue_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  recipient_auth_user_id uuid references public.platform_users(auth_user_id) on delete set null,
  recipient_email_normalized text not null,
  local_date date not null,
  local_hour smallint not null check (local_hour in (10, 15)),
  time_zone text not null check (time_zone in ('America/Denver', 'Etc/GMT+7')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'failed', 'sent', 'cancelled', 'manual_review')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null,
  locked_at timestamptz,
  lock_token uuid,
  delivery_payload jsonb,
  first_send_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(recipient_email_normalized, local_date, local_hour),
  check (recipient_email_normalized = 'libby@theruinedproject.com'),
  check (delivery_payload is null or jsonb_typeof(delivery_payload) = 'object'),
  check (first_send_attempt_at is null or delivery_payload is not null),
  check (status <> 'sent' or (sent_at is not null and provider_message_id is not null))
);

create index if not exists operator_work_queue_digest_due_idx
  on public.operator_work_queue_digest_deliveries(available_at, scheduled_for)
  where status in ('pending', 'processing', 'failed');
alter table public.operator_work_queue_digest_deliveries enable row level security;
revoke all on public.operator_work_queue_digest_deliveries from public, anon, authenticated;

create or replace function private.ruined_preserve_work_queue_digest()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.delivery_payload is not null and new.delivery_payload is distinct from old.delivery_payload then
    raise exception 'Prepared operator digest payloads are immutable';
  end if;
  if old.first_send_attempt_at is not null and new.first_send_attempt_at is distinct from old.first_send_attempt_at then
    raise exception 'Operator digest send evidence is immutable';
  end if;
  if (new.recipient_email_normalized, new.local_date, new.local_hour, new.time_zone, new.scheduled_for)
      is distinct from (old.recipient_email_normalized, old.local_date, old.local_hour, old.time_zone, old.scheduled_for) then
    raise exception 'Operator digest slot identity is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists preserve_operator_work_queue_digest on public.operator_work_queue_digest_deliveries;
create trigger preserve_operator_work_queue_digest before update on public.operator_work_queue_digest_deliveries
  for each row execute function private.ruined_preserve_work_queue_digest();

commit;
