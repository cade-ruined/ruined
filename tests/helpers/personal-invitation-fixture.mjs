import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
export const uuid = id => `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
export const person = id => ({ member: uuid(id), person: uuid(id + 100), auth: uuid(id + 200), email: `member-${id}@example.test` });
export const first = person(1), second = person(2), newcomer = person(3);
export async function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
export const model = await load("src/lib/membership/invitation-model.ts");
const waitlistModel = await load("src/lib/membership/waitlist-model.ts");
const policy = await load("src/lib/membership/access-policy.ts");
export async function fixture(t, { applyExpiry = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite(); t.after(() => db.close());
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const outbox = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)[0];
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key);
    create table ruined_members(id uuid primary key, person_id uuid references people(id), email_normalized text unique, deleted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text default 'active', member_id uuid, email_normalized text);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table person_profiles(person_id uuid primary key, display_name text, preferred_name text, member_tag text, bio text default 'PRIVATE BIO', avatar_storage_path text default 'PRIVATE PHOTO');
    create table person_email_addresses(person_id uuid, email_normalized text primary key, verification_state text, retired_at timestamptz);
    create table member_lifecycle(member_id uuid primary key, account_state text default 'active', billing_state text default 'pending', program_state text default 'prospect', foundations_state text default 'not_started', administrative_onboarding_state text default 'in_progress', standing_state text default 'pre_active', cancellation_effective_at timestamptz, access_started_at timestamptz);
    create table member_onboardings(member_id uuid primary key, state text default 'in_progress', profile_completed_at timestamptz, agreement_completed_at timestamptz);
    create table operator_funding(member_id uuid primary key);
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql stable as 'select exists(select 1 from public.operator_funding where member_id=$1)';
    ${outbox}
  `);
  await db.exec(await source("db/migrations/20260914225359_membership_waitlist.sql"));
  await db.exec(await source("db/migrations/20260919211000_member_referrals.sql"));
  if (applyExpiry) await db.exec(await source("db/migrations/20260922200000_member_invitation_expiry.sql"));
  if (applyExpiry) await db.exec(await source("db/migrations/20260923000000_personal_member_invitations.sql"));
  if (applyExpiry) await db.exec(await source("db/migrations/20260924000000_personal_invitation_admission.sql"));
  function wrap(client) {
    const sql = (strings, ...params) => client.query(strings.reduce((result, part, i) => result + (i ? `$${i}` : "") + part, ""), params).then(result => result.rows);
    sql.begin = callback => client.transaction(tx => callback(wrap(tx))); sql.json = JSON.stringify; return sql;
  }
  const sql = wrap(db);
  async function identity(auth) {
    const { rows: [row] } = await db.query(`select m.id,m.person_id,l.*,exists(select 1 from operator_funding f where f.member_id=m.id) as operator from platform_users u
      join ruined_members m on m.person_id=u.person_id join member_lifecycle l on l.member_id=m.id
      join platform_role_grants g on g.auth_user_id=u.auth_user_id and g.role_slug='member' and g.revoked_at is null
      where u.auth_user_id=$1 and u.status='active'`, [auth]);
    if (!row) return null;
    return { memberId: row.id, personId: row.person_id, accountState: row.account_state, billingState: row.billing_state,
      programState: row.program_state, foundationsState: row.foundations_state, administrativeOnboardingState: row.administrative_onboarding_state,
      standingState: row.standing_state, cancellationEffectiveAt: row.cancellation_effective_at, membershipFunding: row.operator ? "operator" : "self" };
  }
  const repository = await load("src/lib/membership/invitation-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql, withFreshApplicationDatabaseRead: (_stage, read) => read() },
    "@/lib/membership/access-policy": policy, "@/lib/membership/repository": { getMemberIdentity: identity }, "./invitation-model": model,
  });
  const personalModel = await load("src/lib/membership/personal-invitation-model.ts", { "./invitation-model": model });
  const personalRepository = await load("src/lib/membership/personal-invitation-repository.ts", {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/database/server": { getApplicationDatabase: () => sql, withFreshApplicationDatabaseRead: (_stage, read) => read() },
    "@/lib/membership/access-policy": policy, "@/lib/membership/repository": { getMemberIdentity: identity },
    "./invitation-model": model, "./personal-invitation-model": personalModel,
  });
  const waitlist = await load("src/lib/membership/waitlist-repository.ts", { "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql } });
  const ops = await load("src/lib/platform/ops-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/identity/repository": {}, "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/stripe/database": { getBillingDatabase: () => sql }, "@/lib/stripe/membership-state": {},
  });
  const opsReferrals = await load("src/lib/platform/ops-member-referrals-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql }, "@/lib/platform/ops-repository": ops,
  });
  async function addMember(who, active = false, verified = false, emailFirst = false) {
    await db.query("insert into people values($1)", [who.person]);
    if (emailFirst) await db.query("insert into person_email_addresses values($1,$2,'verified',null)", [who.person, who.email]);
    await db.query("insert into ruined_members(id,person_id,email_normalized) values($1,$2,$3)", [who.member, who.person, who.email]);
    await db.query("insert into platform_users(auth_user_id,person_id,status,member_id,email_normalized) values($1,$2,'active',$3,$4)", [who.auth, who.person, who.member, who.email]);
    await db.query("insert into platform_role_grants values($1,'member',null)", [who.auth]);
    await db.query("insert into person_profiles(person_id,display_name,preferred_name) values($1,$2,'PRIVATE PREFERRED')", [who.person, `Member ${who.member.slice(-1)}`]);
    await db.query("insert into member_onboardings(member_id) values($1)", [who.member]);
    await db.query("insert into member_lifecycle(member_id) values($1)", [who.member]);
    if (!emailFirst) await db.query("insert into person_email_addresses values($1,$2,$3,null)", [who.person, who.email, verified ? "verified" : "unverified"]);
    if (active) await activate(who);
  }
  async function activate(who, complimentary = false) {
    if (complimentary) await db.query("insert into operator_funding values($1) on conflict do nothing", [who.member]);
    await db.query("update member_onboardings set state='completed',profile_completed_at=now(),agreement_completed_at=now() where member_id=$1", [who.member]);
    await db.query("update member_lifecycle set billing_state=$2,administrative_onboarding_state='completed',program_state='onboarding',standing_state='active',access_started_at=coalesce(access_started_at,statement_timestamp()) where member_id=$1", [who.member, complimentary ? "pending" : "active"]);
  }
  async function enable(who = first) { const own = await repository.getOwnMemberInvitation(who.auth); return repository.saveOwnMemberInvitation(who.auth, { enabled: true, version: own.version }); }
  async function submit(who, token, name = "Interested Person") { return waitlist.joinMembershipWaitlist(waitlistModel.parseMembershipWaitlistInput({ name, email: who.email, ...(token ? { invitationToken: token } : {}) })); }
  await addMember(first, true, true); await addMember(second, true, true);
  return { db, sql, repository, personalRepository, personalModel, waitlist, ops, opsReferrals, addMember, activate, enable, submit };
}
