begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Keep the cardholder/operator distinct from the member, using the existing
-- immutable actor, target, consent text and timestamp. No billing grant implied.
alter table public.member_payment_method_setup_attempts
  drop constraint member_payment_method_setup_attempts_consent_version_check,
  add constraint member_payment_method_setup_attempts_consent_version_check
    check (consent_version in ('save-payment-method-v1', 'save-payment-method-v2', 'operator-save-member-card-v1'));

commit;
