begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- The first founder's permanent number is 0000. This enables that value only:
-- correcting existing assignments requires a separate audited administrative
-- transaction. Allocation, immutable guards, and historical reservations stay
-- unchanged, including any vacated place retained in the assignment ledger.
alter table public.ruined_members
  drop constraint ruined_members_member_number_positive,
  add constraint ruined_members_member_number_nonnegative
    check (member_number is null or member_number >= 0);

alter table private.member_number_assignments
  drop constraint member_number_assignments_member_number_check,
  add constraint member_number_assignments_member_number_nonnegative
    check (member_number >= 0);

commit;
