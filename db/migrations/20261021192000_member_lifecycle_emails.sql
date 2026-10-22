begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create table private.member_lifecycle_email_rules (
  key text primary key check (key in ('birthday','anniversary','ruined_birthday','thanksgiving','christmas','new_year','checkin_30','checkin_90','checkin_6_month')),
  enabled boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings)='object'),
  copy jsonb check (copy is null or (jsonb_typeof(copy)='object' and jsonb_typeof(copy->'subject')='string' and jsonb_typeof(copy->'body')='string')),
  design jsonb check (design is null or jsonb_typeof(design)='object'),
  activated_at timestamptz,
  approved_by uuid references public.platform_users(auth_user_id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp(),
  check (not enabled or (activated_at is not null and approved_by is not null and design is not null))
);
insert into private.member_lifecycle_email_rules(key) values
 ('birthday'),('anniversary'),('ruined_birthday'),('thanksgiving'),('christmas'),('new_year'),('checkin_30'),('checkin_90'),('checkin_6_month');

create table private.member_lifecycle_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null references private.member_lifecycle_email_rules(key),
  rule_revision integer not null,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  occurrence_key text not null,
  expected_email text not null,
  expected_consent_id bigint not null references public.member_consents(id),
  due_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > due_at),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','cancelled','manual_review')),
  attempts integer not null default 0,
  available_at timestamptz not null default statement_timestamp(),
  lock_token uuid,
  locked_at timestamptz,
  payload jsonb check (payload is null or jsonb_typeof(payload)='object'),
  first_attempt_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique(member_id,rule_key,occurrence_key)
);
create index member_lifecycle_emails_due_idx on private.member_lifecycle_email_deliveries(status,available_at,due_at);
create function private.preserve_member_lifecycle_email_delivery() returns trigger language plpgsql set search_path=pg_catalog as $$
declare erased boolean;
begin
  erased := exists(select 1 from public.ruined_members where id=new.member_id and deleted_at is not null);
  if erased and (new.payload is not null or new.expected_email<>'') then
    raise exception 'A deleted member cannot retain lifecycle email content';
  end if;
  if tg_op='INSERT' then return new; end if;
  if row(new.rule_key,new.rule_revision,new.member_id,new.occurrence_key,new.expected_consent_id,new.due_at,new.expires_at)
    is distinct from row(old.rule_key,old.rule_revision,old.member_id,old.occurrence_key,old.expected_consent_id,old.due_at,old.expires_at)
    or (new.expected_email is distinct from old.expected_email and not (erased and new.expected_email=''))
    or (old.payload is not null and new.payload is distinct from old.payload and not (erased and new.payload is null))
    or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at) then
    raise exception 'Lifecycle occurrence and prepared delivery are immutable';
  end if;
  return new;
end;
$$;
create trigger preserve_member_lifecycle_email_delivery before insert or update on private.member_lifecycle_email_deliveries
  for each row execute function private.preserve_member_lifecycle_email_delivery();
revoke all on function private.preserve_member_lifecycle_email_delivery() from public,anon,authenticated;

create function private.erase_member_lifecycle_email_content() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.member_lifecycle_email_deliveries set expected_email='',payload=null,
    status=case when status='sent' then 'sent' else 'cancelled' end,
    last_error=case when status='sent' then last_error else 'account_deleted' end,
    lock_token=null,locked_at=null,updated_at=clock_timestamp() where member_id=new.id;
  return new;
end $$;
create trigger erase_member_lifecycle_email_content after update of deleted_at on public.ruined_members
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.erase_member_lifecycle_email_content();
revoke all on function private.erase_member_lifecycle_email_content() from public,anon,authenticated;

alter table private.member_lifecycle_email_rules enable row level security;
alter table private.member_lifecycle_email_deliveries enable row level security;
revoke all on private.member_lifecycle_email_rules, private.member_lifecycle_email_deliveries from public,anon,authenticated;
-- No backfill, activation, benefit promise, Circle access change, or email send occurs in this migration.
commit;
