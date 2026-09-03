begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The original ordinary SQL string doubled the backslash before +, causing
-- PostgreSQL to reject valid international phone numbers. A character class
-- expresses the literal plus independently of standard_conforming_strings.
-- Match the application's E.164 shape (2-15 digits); libphonenumber still
-- validates whether the complete number is possible before a member save.
-- Existing values, other constraints, privileges, and RLS remain unchanged.
alter table public.person_private_profiles
  drop constraint person_private_profiles_mobile_e164_check,
  add constraint person_private_profiles_mobile_e164_check
    check (mobile_e164 is null or mobile_e164 ~ '^[+][1-9][0-9]{1,14}$')
    not valid;

-- Fail atomically if unexpected legacy values exist; never rewrite a member's
-- contact details merely to make the migration pass.
alter table public.person_private_profiles
  validate constraint person_private_profiles_mobile_e164_check;

commit;
