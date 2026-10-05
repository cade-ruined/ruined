begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Expand supported evidence versions without rewriting any accepted wording.
-- The immutable-consent trigger continues to protect existing v1 attempts.
alter table public.member_payment_method_setup_attempts
  drop constraint member_payment_method_setup_attempts_consent_version_check,
  add constraint member_payment_method_setup_attempts_consent_version_check
    check (consent_version in ('save-payment-method-v1', 'save-payment-method-v2'));

commit;
