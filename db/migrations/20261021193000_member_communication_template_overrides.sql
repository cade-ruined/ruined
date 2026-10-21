begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));
create table private.member_communication_template_overrides (
  key text primary key check (key in ('registration:welcome','registration:pre_foundations','registration:profile_ready',
    'manual:clothing-drop','manual:new-product','manual:platform-update','manual:urgent-update','manual:circle-change','manual:urgent-text')),
  subject text not null check (length(subject)<=200 and (key='manual:urgent-text' or length(btrim(subject))>0)),
  body text not null check (length(btrim(body))>0 and length(body)<=12000),
  revision integer not null check (revision>0),
  updated_by uuid not null references public.platform_users(auth_user_id) on delete restrict,
  updated_at timestamptz not null default statement_timestamp()
);
alter table private.member_communication_template_overrides enable row level security;
revoke all on private.member_communication_template_overrides from public,anon,authenticated;
-- Prepared outbox payloads retain their exact original bytes. No delivery or automation is enabled here.
commit;
