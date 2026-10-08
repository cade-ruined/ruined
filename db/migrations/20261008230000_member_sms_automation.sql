begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

alter table private.member_sms_delivery_attempts
  drop constraint member_sms_delivery_attempts_blocked_reason_check;
alter table private.member_sms_delivery_attempts add constraint member_sms_delivery_attempts_blocked_reason_check
  check (blocked_reason in ('member_inactive','phone_missing','no_current_consent','phone_suppressed','source_ineligible'));

-- Provider acceptance and delivery are different facts. Signed callbacks may
-- recover an uncertain dispatch but never create another outbound request.
alter table private.member_sms_delivery_attempts
  add column delivery_status text check (delivery_status in ('queued','sending','sent','delivered','undelivered','failed')),
  add column delivery_error_code integer check (delivery_error_code between 10000 and 99999),
  add column delivery_updated_at timestamptz,
  add column delivery_opt_out_recorded_at timestamptz;

create table private.member_sms_automation_jobs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('opt_in_confirmation','call_reminder')),
  reminder_key text not null check (char_length(reminder_key) between 1 and 160),
  expected_consent_id bigint references public.member_consents(id) on delete set null,
  experience_id uuid references public.experiences(id) on delete cascade,
  starts_at timestamptz,
  due_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','finished')),
  outcome text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(member_id,reminder_kind,reminder_key)
);
create index member_sms_automation_jobs_due_idx on private.member_sms_automation_jobs(status,due_at,id);
alter table private.member_sms_automation_jobs enable row level security;
revoke all on private.member_sms_automation_jobs from public,anon,authenticated;
commit;
