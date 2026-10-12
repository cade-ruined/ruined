begin;

-- Approved event plans determine enrollment. Nothing is seeded or enabled.
create table private.member_email_cadence_plans (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null unique references public.experiences(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  active boolean not null default false,
  activated_at timestamptz not null default statement_timestamp(),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  approved_by uuid not null references public.platform_users(auth_user_id),
  updated_at timestamptz not null default statement_timestamp()
);
create table private.member_email_cadence_reviews (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  audience_hash text not null,
  expires_at timestamptz not null default statement_timestamp()+interval '30 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp()
);
create index member_email_cadence_reviews_expiry_idx on private.member_email_cadence_reviews(expires_at);
create table private.member_email_cadence_deliveries (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references private.member_email_cadence_plans(id) on delete restrict,
  plan_revision integer not null,
  experience_id uuid not null references public.experiences(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  starts_at timestamptz not null,
  stage text not null check (stage in ('orientation','one_week','two_days','day_before','day_of')),
  expected_email text not null,
  expected_consent_id bigint not null,
  due_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > due_at),
  status text not null default 'pending' check (status in ('pending','sending','failed','sent','cancelled','manual_review')),
  available_at timestamptz not null default statement_timestamp(),
  attempts integer not null default 0 check(attempts>=0),
  locked_at timestamptz,
  lock_token uuid,
  payload jsonb check(payload is null or jsonb_typeof(payload)='object'),
  first_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(member_id,experience_id,starts_at,stage)
);
create index member_email_cadence_deliveries_due_idx on private.member_email_cadence_deliveries(status,available_at,due_at);
create index member_email_cadence_deliveries_plan_idx on private.member_email_cadence_deliveries(plan_id,status);
create function private.preserve_member_email_cadence_delivery() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if row(new.plan_id,new.plan_revision,new.experience_id,new.member_id,new.starts_at,new.stage,
      new.expected_email,new.expected_consent_id,new.due_at,new.expires_at)
    is distinct from row(old.plan_id,old.plan_revision,old.experience_id,old.member_id,old.starts_at,old.stage,
      old.expected_email,old.expected_consent_id,old.due_at,old.expires_at)
    or (old.payload is not null and new.payload is distinct from old.payload)
    or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at) then
    raise exception 'Cadence occurrence and prepared delivery are immutable';
  end if;
  return new;
end;
$$;
create trigger preserve_member_email_cadence_delivery before update on private.member_email_cadence_deliveries
  for each row execute function private.preserve_member_email_cadence_delivery();
revoke all on function private.preserve_member_email_cadence_delivery() from public,anon,authenticated;
alter table private.member_email_cadence_plans enable row level security;
alter table private.member_email_cadence_reviews enable row level security;
alter table private.member_email_cadence_deliveries enable row level security;
revoke all on private.member_email_cadence_plans, private.member_email_cadence_reviews,
  private.member_email_cadence_deliveries from public,anon,authenticated;

commit;
