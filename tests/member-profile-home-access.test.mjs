import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { installCurrentOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";
import { installRegistrationProfileReleaseFunction } from "./helpers/registration-access-fixture.mjs";
import { installCircleRevealFunction } from "./helpers/circle-reveal-fixture.mjs";
import { taggedSqlBridge } from "./helpers/postgres-fragments.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const a = { auth: uuid(1), member: uuid(2), person: uuid(3) };
const b = { auth: uuid(4), member: uuid(5), person: uuid(6) };

function evaluate(text, values = {}) {
  const compiled = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", ...Object.keys(values), compiled)(loaded, loaded.exports, ...Object.values(values));
  return loaded.exports;
}

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  // Minimal related tables; all identity/funding/access SQL below is shipped
  // code. No credentials, network queries, fake identity rows or provider calls.
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,email text,deleted_at timestamptz,
      membership_activated_at timestamptz default '2024-01-01T00:00:00Z',member_number integer);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text default 'active');
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active',billing_state text default 'active',
      administrative_onboarding_state text default 'completed',program_state text default 'active',
      foundations_state text default 'in_progress',standing_state text default 'active',cancellation_effective_at timestamptz);
    create table person_email_addresses(person_id uuid,email text,is_primary boolean default true,
      retired_at timestamptz,created_at timestamptz default now());
    create table person_profiles(person_id uuid primary key,display_name text,preferred_name text,member_tag text,
      avatar_storage_path text,timezone text,city text,state text,location_label text,bio text,building_now text,website_url text);
    create table person_private_profiles(person_id uuid primary key,legal_name text,mobile_e164 text,birth_date date,
      default_fulfillment_address jsonb,apparel_sizing jsonb,accessibility_notes text);
    create table member_directory_preferences(member_id uuid primary key,directory_status text,avatar_visible boolean,
      location_visible boolean,bio_visible boolean,building_visible boolean,email_scope text,phone_scope text,version integer);
  `);
  await installCurrentOperatorFundingFunctions(db);
  await installRegistrationProfileReleaseFunction(db);
  await installCircleRevealFunction(db);
  for (const [member, label, number] of [[a, "First Member", 11], [b, "Second Member", 12]]) {
    await db.query("insert into people(id) values($1)", [member.person]);
    await db.query("insert into ruined_members(id,person_id,email,member_number) values($1,$2,$3,$4)", [member.member, member.person, `${number}@example.test`, number]);
    await db.query("insert into platform_users(auth_user_id,member_id,person_id) values($1,$2,$3)", [member.auth, member.member, member.person]);
    await db.query("insert into platform_role_grants values($1,'member',null)", [member.auth]);
    await db.query("insert into member_lifecycle(member_id) values($1)", [member.member]);
    await db.query("insert into person_profiles(person_id,display_name,member_tag,bio,avatar_storage_path) values($1,$2,$3,$4,$5)", [member.person, label, `tag${number}`, `${label} bio`, `/portraits/${number}.webp`]);
    await db.query("insert into person_private_profiles(person_id,legal_name,mobile_e164,default_fulfillment_address,apparel_sizing,accessibility_notes) values($1,$2,'PRIVATE PHONE','{\"street\":\"PRIVATE ADDRESS\"}','{\"size\":\"PRIVATE SIZE\"}','PRIVATE NOTES')", [member.person, label]);
  }
  const policy = evaluate(await source("src/lib/membership/access-policy.ts"));
  const photoPolicy = evaluate(await source("src/lib/membership/photo-policy.ts"));
  const avatarSource = (await source("src/lib/membership/avatar-url.ts")).replace(/^import .*$/gm, "");
  const avatars = evaluate(avatarSource, photoPolicy);
  const text = await source("src/lib/membership/repository.ts");
  const ast = ts.createSourceFile("repository.ts", text, ts.ScriptTarget.Latest, true);
  const names = new Set(["MembershipAccessDeniedError", "toIso", "identityFromRow", "getMemberIdentity",
    "requireMemberIdentity", "requireMemberCapability", "profileRevision", "getMemberProfile", "getMemberProfileHome"]);
  const parts = ast.statements.filter(node => node.name && names.has(node.name.text));
  assert.equal(parts.length, names.size, "Use exact production functions rather than a second implementation");
  const queries = [], badgeCalls = [];
  const sql = taggedSqlBridge(async (query, params) => {
    queries.push(query);
    return (await db.query(query, params)).rows;
  });
  const repository = evaluate(parts.map(node => node.getText(ast)).join("\n"), {
    ...policy, ...avatars, getApplicationDatabase: () => sql,
    // Badge reconciliation has its own full-schema suite. This boundary only
    // proves which authorized member ID the lean loader passes to it.
    getMemberBadges: async memberId => { badgeCalls.push(memberId); return [{ memberId, key: "fixture" }]; },
  });
  async function isolated(run) {
    await db.exec("begin");
    try { await run(); } finally { await db.exec("rollback"); }
  }
  return { db, repository, queries, badgeCalls, isolated };
}

test("lean home keeps real identity and current funding access without private-profile payloads", async t => {
  const f = await fixture(t), home = auth => f.repository.getMemberProfileHome(auth);
  await t.test("paid member projection is owner scoped and contains no private profile values", async () => {
    f.queries.length = 0; f.badgeCalls.length = 0;
    const [first, second] = await Promise.all([home(a.auth), home(b.auth)]);
    assert.equal(f.queries.length, 6, "Exactly identity, profile and membership metadata SQL per owner");
    assert.equal(f.queries.filter(query => query.includes("from platform_users platform_user")).length, 2);
    assert.deepEqual([...f.badgeCalls].sort(), [a.member, b.member].sort(), "One existing badge read boundary per owner");
    assert.equal(first.identity.authUserId, a.auth);
    assert.equal(first.profile.fullName, "First Member");
    assert.equal(first.memberNumber, 11);
    assert.equal(first.memberSince, "2024-01-01T00:00:00.000Z");
    assert.equal(first.access.mode, "full");
    assert.equal(first.identity.membershipFunding, "self");
    assert.equal(second.identity.authUserId, b.auth);
    assert.equal(second.profile.fullName, "Second Member");
    assert.equal(second.memberNumber, 12);
    assert.equal(first.badges[0].memberId, a.member);
    assert.equal(second.badges[0].memberId, b.member);
    assert.doesNotMatch(JSON.stringify([first, second]), /PRIVATE (?:PHONE|ADDRESS|SIZE|NOTES)/);
    assert.equal("privateProfile" in first, false);
    assert.equal("upcomingExperiences" in first, false);
  });
  await t.test("current complimentary grant still opens the same participating profile", () => f.isolated(async () => {
    await f.db.query("update member_lifecycle set billing_state='pending' where member_id=$1", [a.member]);
    await f.db.query("insert into member_complimentary_grants(member_id) values($1)", [a.member]);
    const member = await home(a.auth);
    assert.equal(member.identity.membershipFunding, "complimentary");
    assert.equal(member.access.mode, "full");
    await f.db.query("update member_complimentary_grants set revoked_at=now() where member_id=$1", [a.member]);
    const revoked = await home(a.auth);
    assert.equal(revoked.identity.membershipFunding, "self");
    assert.equal(revoked.access.mode, "entry");
    assert.equal(revoked.access.capabilities.includes("foundations.write"), false);
  }));
  await t.test("couple participant follows the live payer rather than their pending billing row", () => f.isolated(async () => {
    await f.db.query("update member_lifecycle set billing_state='pending' where member_id=$1", [a.member]);
    await f.db.query("insert into membership_commercial_reservations(id,payer_member_id,kind,status,stripe_subscription_id,created_at) values($1,$2,'couple','activated','sub_fixture',now())", [uuid(20), b.member]);
    await f.db.query("insert into membership_commercial_participants values($1,$2)", [uuid(20), a.member]);
    await f.db.query("insert into stripe_subscriptions(id,member_id,stripe_status) values('sub_fixture',$1,'active')", [b.member]);
    const active = await home(a.auth);
    assert.equal(active.identity.membershipFunding, "couple");
    assert.equal(active.identity.billingState, "active");
    assert.equal(active.access.mode, "full");
    await f.db.exec("update stripe_subscriptions set stripe_status='past_due'");
    const attention = await home(a.auth);
    assert.equal(attention.identity.billingState, "attention_required");
    assert.equal(attention.access.mode, "limited");
    assert.equal(attention.access.capabilities.includes("profile.write"), false);
  }));
  for (const [name, mutate, denied] of [
    ["revoked member role", "update platform_role_grants set revoked_at=now() where auth_user_id=$1", a.auth],
    ["inactive platform user", "update platform_users set status='inactive' where auth_user_id=$1", a.auth],
    ["suspended member account", "update member_lifecycle set account_state='suspended' where member_id=$1", a.member],
    ["closed member account", "update member_lifecycle set account_state='closed' where member_id=$1", a.member],
    ["held registration", "insert into member_registration_access(member_id,profile_activated_at) values($1,null)", a.member],
  ]) {
    await t.test(`${name} denies before profile or badge reads`, () => f.isolated(async () => {
      await f.db.query(mutate, [denied]);
      f.queries.length = 0; f.badgeCalls.length = 0;
      await assert.rejects(home(a.auth), f.repository.MembershipAccessDeniedError);
      assert.equal(f.queries.length, 1, "Only current identity was read");
      assert.deepEqual(f.badgeCalls, []);
    }));
  }
  await t.test("unknown identity never falls back to a previously loaded member", async () => {
    await home(a.auth);
    await assert.rejects(home(uuid(99)), f.repository.MembershipAccessDeniedError);
    assert.equal((await home(b.auth)).identity.memberId, b.member);
  });
});
