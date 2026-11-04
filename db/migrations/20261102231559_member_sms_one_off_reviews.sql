begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

alter table private.member_sms_delivery_attempts drop constraint member_sms_delivery_attempts_reminder_kind_check;
alter table private.member_sms_delivery_attempts add constraint member_sms_delivery_attempts_reminder_kind_check
  check (reminder_kind in ('call_reminder','membership_reminder','opt_in_confirmation','one_off'));

-- A review is immutable recipient/body evidence. Claimed requests are never
-- reclaimed, including a crash before a delivery attempt can be reserved.
create table private.member_sms_one_off_reviews (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  actor_name text not null,
  request_id uuid not null,
  member_id uuid not null references public.ruined_members(id) on delete cascade,
  person_id uuid not null references public.people(id),
  recipient_auth_user_id uuid not null references public.platform_users(auth_user_id),
  recipient_email text not null,
  recipient_name text not null,
  destination_e164 text not null check (destination_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  shared_phone boolean not null,
  consent_id bigint not null references public.member_consents(id) on delete cascade,
  body_text text not null check (char_length(body_text) between 1 and 1000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '15 minutes'),
  status text not null default 'reviewed' check (status in ('reviewed','claimed','finished')),
  claimed_at timestamptz,
  finished_at timestamptz,
  outcome text check (outcome in ('accepted','blocked','unknown','duplicate')),
  unique(actor_auth_user_id,request_id),
  check (expires_at > created_at),
  check ((status='reviewed') = (claimed_at is null)),
  check ((status='finished') = (finished_at is not null and outcome is not null))
);
create index member_sms_one_off_reviews_activity_idx
  on private.member_sms_one_off_reviews(status,created_at desc,id desc);
create table private.member_sms_one_off_limits (
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  window_started_at timestamptz not null,
  reviews integer not null default 0 check (reviews between 0 and 30),
  sends integer not null default 0 check (sends between 0 and 30),
  primary key(actor_auth_user_id,window_started_at)
);
alter table private.member_sms_one_off_reviews enable row level security;
alter table private.member_sms_one_off_limits enable row level security;
revoke all on private.member_sms_one_off_reviews,private.member_sms_one_off_limits from public,anon,authenticated;

commit;
