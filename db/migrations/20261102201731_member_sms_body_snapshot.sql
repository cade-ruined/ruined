begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Additive: older deployments keep working and historical text is not guessed.
-- Private, admin-only operations reads retain the exact future outbound body.
alter table private.member_sms_delivery_attempts
  add column body_text text check (body_text is null or char_length(body_text) between 1 and 4096);
create index member_sms_delivery_attempts_history_idx
  on private.member_sms_delivery_attempts(created_at desc,id desc);

commit;
