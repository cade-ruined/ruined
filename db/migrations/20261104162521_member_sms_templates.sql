begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create table private.member_sms_templates (
  id text primary key check (id in ('opt_in_confirmation','call_reminder','foundations_01','day_before')),
  body text not null check (char_length(btrim(body)) between 1 and 900),
  enabled boolean not null,
  notice_minutes integer,
  revision integer not null default 0 check (revision>=0),
  effective_at timestamptz not null default '1970-01-01T00:00:00Z',
  updated_at timestamptz not null default '1970-01-01T00:00:00Z',
  updated_by uuid references public.platform_users(auth_user_id) on delete restrict,
  check ((id='opt_in_confirmation' and enabled and notice_minutes is null)
    or (id in ('call_reminder','foundations_01') and notice_minutes is not null and notice_minutes between 15 and 720)
    or (id='day_before' and notice_minutes is not null and notice_minutes=1440)),
  check (revision=0 or updated_by is not null)
);
alter table private.member_sms_templates enable row level security;
revoke all on private.member_sms_templates from public,anon,authenticated;

insert into private.member_sms_templates(id,body,enabled,notice_minutes) values
  ('opt_in_confirmation','Ruined: You opted in to membership updates and call reminders.',true,null),
  ('call_reminder','Ruined: {{call_title}} starts {{call_date_time}}. View details and join: {{call_link}}.',true,60),
  ('foundations_01','RU/NED Foundations starts today at {{call_time}}. Your Google Meet link: {{meeting_link}}. We’ll see you soon.',true,150),
  ('day_before','Ruined: {{call_title}} is tomorrow at {{call_time}}. View details and join: {{call_link}}.',false,1440);
comment on table private.member_sms_templates is 'Four administrator-reviewed automatic SMS templates. Browser roles have no access. Exact dispatched bodies remain in the delivery ledger; saving a template never sends messages.';
commit;
