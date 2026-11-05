import { installMemberSmsFundingFixture } from "./member-sms-funding-fixture.mjs";

/** Shared partial-schema fixtures use the current shipped funding proofs, never a true stub. */
export async function installPublicProfileFundingFixture(db) {
  await db.exec(`
    create table if not exists people(id uuid primary key,status text default 'active');
    alter table ruined_members add column if not exists membership_state text default 'pending';
  `);
  await installMemberSmsFundingFixture(db);
  await db.exec(`
    alter table member_registration_access add column if not exists registered_at timestamptz;
    insert into people(id) select distinct person_id from ruined_members where person_id is not null on conflict(id) do nothing;
    insert into person_email_addresses(person_id,email_normalized,verification_state,retired_at)
      select member.person_id,member.email_normalized,'verified',null from ruined_members member
      where not exists(select 1 from person_email_addresses address where address.person_id=member.person_id
        and address.email_normalized=member.email_normalized);
  `);
}
