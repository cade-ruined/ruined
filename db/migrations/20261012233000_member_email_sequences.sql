begin;

-- A reviewed design can be inherited by explicitly classified future calls.
-- No rules, event bindings, memberships, or consent are seeded here.
create table private.member_email_cadence_sequences (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('foundations_01','foundations_02','foundations_03','foundations_04','membership','circle')),
  track text not null check(track in ('founder_test','members')),
  active boolean not null default false,
  revision integer not null default 1 check(revision>0),
  activated_at timestamptz not null default clock_timestamp(),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  approved_by uuid not null references public.platform_users(auth_user_id),
  updated_at timestamptz not null default clock_timestamp(),
  unique(kind,track)
);

create table private.member_email_cadence_event_bindings (
  experience_id uuid primary key references public.experiences(id) on delete restrict,
  kind text not null check(kind in ('none','foundations_01','foundations_02','foundations_03','foundations_04','membership','circle')),
  track text not null check(track in ('founder_test','members')),
  cohort_month text check(cohort_month is null or cohort_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  approved_by uuid not null references public.platform_users(auth_user_id),
  updated_at timestamptz not null default clock_timestamp(),
  check((kind like 'foundations_%' and track='members' and cohort_month is not null)
    or ((kind not like 'foundations_%' or track='founder_test') and cohort_month is null))
);

alter table private.member_email_cadence_plans
  add column sequence_id uuid references private.member_email_cadence_sequences(id) on delete restrict,
  add column sequence_revision integer,
  add constraint member_email_cadence_sequence_version check(
    (sequence_id is null and sequence_revision is null)
    or (sequence_id is not null and sequence_revision is not null and sequence_revision>0));
create index member_email_cadence_plans_sequence_idx on private.member_email_cadence_plans(sequence_id);

alter table private.member_email_cadence_sequences enable row level security;
alter table private.member_email_cadence_event_bindings enable row level security;
revoke all on private.member_email_cadence_sequences,private.member_email_cadence_event_bindings from public,anon,authenticated;

commit;
