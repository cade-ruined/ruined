import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const uuid = id => `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
const person = id => ({ member: uuid(id), person: uuid(id + 100), auth: uuid(id + 200), email: `member-${id}@example.test` });
const first = person(1), second = person(2), newcomer = person(3);
async function load(path, dependencies = {}, globals = {}) {
  const output = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const model = await load("src/lib/membership/invitation-model.ts");
const waitlistModel = await load("src/lib/membership/waitlist-model.ts");
const policy = await load("src/lib/membership/access-policy.ts");
async function fixture(t, { applyExpiry = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite(); t.after(() => db.close());
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const outbox = foundation.match(/create table if not exists integration_outbox \([\s\S]*?\n\);/)[0];
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key);
    create table ruined_members(id uuid primary key, person_id uuid references people(id), email_normalized text unique, deleted_at timestamptz);
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text default 'active');
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
    await db.query("insert into platform_users values($1,$2,'active')", [who.auth, who.person]);
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
  return { db, sql, repository, waitlist, ops, opsReferrals, addMember, activate, enable, submit };
}

test("an invitation is private by default, independent of card sharing, and publishes only the current display name and chosen tag", async t => {
  const f = await fixture(t);
  const initial = await f.repository.getOwnMemberInvitation(first.auth);
  assert.equal(initial.expiresAt, null); assert.equal(initial.enabled, false); assert.equal(initial.version, 0); assert.equal(initial.url, null); assert.equal(initial.joinedCount, 0);
  assert.equal((await f.db.query("select * from member_invitations")).rows.length, 0, "GET never creates or enables a link");
  const enabled = await f.enable(), token = enabled.url.split("/").pop();
  assert.match(token, model.MEMBER_INVITATION_TOKEN); assert.equal(enabled.eligible, true);
  const publicInvite = await f.repository.getPublicMemberInvitation(token);
  assert.deepEqual(Object.keys(publicInvite), ["card", "expiresAt"]);
  assert.equal(publicInvite.expiresAt, enabled.expiresAt);
  assert.deepEqual(publicInvite.card, model.invitationCard("Member 1", publicInvite.card.wearSeed));
  assert.equal(publicInvite.card.memberTag, null, "legacy preferred names are never promoted to tags");
  assert.doesNotMatch(JSON.stringify(publicInvite), /PRIVATE|email|member_id|person_id|joinedCount|00000000-0000/);
  await f.db.query("update person_profiles set display_name='Current Name',member_tag='current_tag' where person_id=$1", [first.person]);
  assert.deepEqual((await f.repository.getPublicMemberInvitation(token)).card, model.invitationCard("Current Name", publicInvite.card.wearSeed, "current_tag"));
  const updated = await f.repository.getOwnMemberInvitation(first.auth);
  assert.equal(updated.card.memberTag, "current_tag"); assert.equal(updated.url, enabled.url);
  assert.equal(updated.enabled, enabled.enabled); assert.equal(updated.version, enabled.version);
  assert.equal((await f.repository.getOwnMemberInvitation(second.auth)).enabled, false);
  await assert.rejects(f.repository.getOwnMemberInvitation(uuid(999)), { status: 403 });
  await assert.rejects(f.repository.saveOwnMemberInvitation(first.auth, { enabled: false, version: 0 }), { status: 409 });
  const disabled = await f.repository.saveOwnMemberInvitation(first.auth, { enabled: false, version: enabled.version });
  assert.equal(await f.repository.getPublicMemberInvitation(token), null);
  assert.notEqual((await f.repository.saveOwnMemberInvitation(first.auth, { enabled: true, version: disabled.version })).url, enabled.url);
  await f.db.query("update member_lifecycle set standing_state='paused' where member_id=$1", [first.member]);
  assert.equal(await f.repository.getPublicMemberInvitation(token), null);
  const paused = await f.repository.getOwnMemberInvitation(first.auth);
  await assert.rejects(f.repository.saveOwnMemberInvitation(first.auth, { enabled: true, version: paused.version }), { status: 403 });
  assert.equal((await f.repository.saveOwnMemberInvitation(first.auth, { enabled: false, version: paused.version })).enabled, false, "withdrawal remains available while paused");
  assert.equal(await f.repository.getPublicMemberInvitation(first.member), null);
});

test("member tag changes keep invitation tokens and verified referral attribution stable", async t => {
  const f = await fixture(t);
  await f.db.query("update person_profiles set member_tag='first_tag' where person_id=$1", [first.person]);
  const enabled = await f.enable(), token = enabled.url.split("/").pop();
  await f.submit(newcomer, token);
  const captured = (await f.db.query("select * from member_referrals")).rows[0];
  await f.db.query("update person_profiles set member_tag='renamed_tag' where person_id=$1", [first.person]);
  const publicInvite = await f.repository.getPublicMemberInvitation(token);
  assert.equal(publicInvite.card.name, "Member 1"); assert.equal(publicInvite.card.memberTag, "renamed_tag");
  assert.deepEqual(Object.keys(publicInvite.card).sort(), ["name", "memberTag", "avatarUrl", "memberSince", "location", "bio", "buildingNow", "websiteUrl", "labels", "wearSeed"].sort());
  assert.deepEqual((await f.db.query("select * from member_referrals")).rows[0], captured);
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  const joined = (await f.db.query("select * from member_referrals")).rows[0];
  const current = await f.repository.getOwnMemberInvitation(first.auth);
  assert.equal(joined.inviter_member_id, first.member); assert.equal(joined.referred_member_id, newcomer.member);
  assert.ok(joined.joined_at); assert.equal(current.joinedCount, 1); assert.equal(current.url, enabled.url);
  assert.equal(current.version, enabled.version); assert.equal(current.enabled, true);
  assert.doesNotMatch(JSON.stringify(publicInvite), /PRIVATE|email|member_id|person_id|joinedCount|00000000-0000/);
  await f.repository.saveOwnMemberInvitation(first.auth, { enabled: false, version: current.version });
  assert.equal(await f.repository.getPublicMemberInvitation(token), null);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 1);
});

test("first interest pins the inviter; verification and completed activation count once through retries and renewal", async t => {
  const f = await fixture(t), a = await f.enable(), b = await f.enable(second);
  await f.submit(newcomer, a.url.split("/").pop());
  await f.submit(newcomer, b.url.split("/").pop(), "Attempted overwrite");
  let referral = (await f.db.query("select * from member_referrals")).rows[0];
  assert.equal(referral.inviter_member_id, first.member); assert.equal(referral.referred_person_id, null); assert.equal(referral.joined_at, null);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 1);
  assert.equal((await f.db.query("select name from membership_waitlist")).rows[0].name, "Interested Person");
  await f.addMember(newcomer);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 0);
  await f.db.query("update person_email_addresses set verification_state='verified' where email_normalized=$1", [newcomer.email]);
  referral = (await f.db.query("select * from member_referrals")).rows[0];
  assert.equal(referral.referred_person_id, newcomer.person); assert.equal(referral.referred_member_id, newcomer.member); assert.equal(referral.joined_at, null);
  await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1", [newcomer.member]);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 0, "payment alone is not joining");
  await f.activate(newcomer);
  const joinedAt = (await f.db.query("select joined_at from member_referrals")).rows[0].joined_at;
  assert.ok(joinedAt); assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 1);
  await f.activate(newcomer); await f.db.query("update member_lifecycle set standing_state='paused' where member_id=$1", [newcomer.member]); await f.activate(newcomer);
  await f.db.query("update person_email_addresses set verification_state='verified' where email_normalized=$1", [newcomer.email]);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 1);
  assert.equal((await f.repository.getOwnMemberInvitation(second.auth)).joinedCount, 0);
  assert.equal((await f.db.query("select joined_at from member_referrals")).rows[0].joined_at.toISOString(), joinedAt.toISOString());
  await assert.rejects(f.db.query("update member_referrals set inviter_member_id=$1", [second.member]), /immutable/);
  await assert.rejects(f.db.query("update member_referrals set joined_at=null"), /immutable/);
});

test("complimentary completion counts while unverified identity, closed accounts, self-referral and old memberships do not", async t => {
  const f = await fixture(t), enabled = await f.enable(), token = enabled.url.split("/").pop();
  await f.submit(first, token); await f.submit(second, token);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  await f.submit(newcomer, token); await f.addMember(newcomer);
  await f.activate(newcomer, true);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 0, "unverified interest cannot convert");
  // A normal verified entrant is bound before activating, including complimentary funding.
  const free = person(4); await f.submit(free, token); await f.addMember(free);
  await f.db.query("update person_email_addresses set verification_state='verified' where email_normalized=$1", [free.email]);
  await f.activate(free, true);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 1);
  const staff = person(6); await f.submit(staff, token); await f.addMember(staff, false, true, true);
  assert.equal((await f.db.query("select referred_person_id from member_referrals r join membership_waitlist w on w.id=r.waitlist_id where w.email_normalized=$1", [staff.email])).rows[0].referred_person_id, null);
  await f.activate(staff, true);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 2, "verification before complimentary provisioning still binds at completed activation");
  const closed = person(5); await f.submit(closed, token); await f.addMember(closed, false, true);
  await f.db.query("update member_lifecycle set account_state='closed' where member_id=$1", [closed.member]); await f.activate(closed);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 2);
  const alias = { ...first, email: "new-alias@example.test" };
  await f.submit(alias, token);
  await f.db.query("insert into person_email_addresses values($1,$2,'verified',null)", [first.person, alias.email]);
  assert.equal((await f.db.query("select referred_person_id from member_referrals r join membership_waitlist w on w.id=r.waitlist_id where w.email_normalized=$1", [alias.email])).rows[0].referred_person_id, null);
});

test("withdrawn links reject new attribution but preserve earned history and prior legitimate submissions", async t => {
  const f = await fixture(t), invitation = await f.enable(), token = invitation.url.split("/").pop();
  await f.submit(newcomer, token);
  await f.repository.saveOwnMemberInvitation(first.auth, { enabled: false, version: invitation.version });
  await assert.rejects(f.submit(person(4), token), { code: "P4100" });
  await assert.rejects(f.submit(person(5), "x".repeat(43)), { code: "P4100" });
  assert.equal((await f.db.query("select * from membership_waitlist")).rows.length, 1);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 1);
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 1);
});

test("referrals, counts and helper functions are unavailable to public database roles", async t => {
  const f = await fixture(t); await f.enable();
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["member_invitations", "member_referrals"]) {
      const { rows: [acl] } = await f.db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as allowed", [role, table]);
      assert.equal(acl.allowed, false);
      assert.equal((await f.db.query("select relrowsecurity from pg_class where oid=$1::regclass", [table])).rows[0].relrowsecurity, true);
    }
    for (const signature of ["private.ruined_require_member_invitation(text)", "private.ruined_capture_member_referral(uuid,text)", "private.ruined_bind_member_referral(uuid,text)", "private.ruined_record_member_referral_join(uuid)", "private.ruined_member_can_share_invitation(uuid)"]) {
      assert.equal((await f.db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed, false);
    }
  }
});

test("input validation bounds bodies and does not accept caller-selected identity or counts", async () => {
  assert.deepEqual(model.validateMemberInvitationInput({ enabled: true, version: 0 }), { enabled: true, version: 0 });
  assert.deepEqual(model.validateMemberInvitationInput({ enabled: true, version: 1, renew: true }), { enabled: true, version: 1, renew: true });
  for (const input of [null, [], {}, { enabled: true, version: 0, expiresAt: "2030-01-01" }, { enabled: true, version: 0, renew: 1 }, { enabled: false, version: 1, renew: true }, { enabled: false, version: 1, renew: false }, { enabled: 1, version: 0 }, { enabled: true, version: -1 }, { enabled: true, version: 0, memberId: first.member }, { enabled: true, version: 0, memberTag: "spoofed_tag" }, { enabled: true, version: 0, joinedCount: 8 }]) {
    assert.throws(() => model.validateMemberInvitationInput(input), { status: 400 });
  }
  assert.equal(waitlistModel.parseMembershipWaitlistInput({ name: "Test", email: "t@example.test", invitationToken: "bad" }), null);
  await assert.rejects(model.readMemberInvitationJson(new Request("https://example.test", { method: "PATCH", headers: { "content-type": "text/plain" }, body: "{}" })), { status: 415 });
  await assert.rejects(model.readMemberInvitationJson(new Request("https://example.test", { method: "PATCH", headers: { "content-type": "application/json" }, body: "x".repeat(1025) })), { status: 413 });
});

test("owner and public APIs enforce sign-in, origin, version, body and private-response boundaries", async t => {
  const f = await fixture(t); let current = null, mode = "connected";
  const route = await load("app/api/my/invitation/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: request => request.headers.get("origin") === "https://members.example.test" },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => current },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/invitation-repository": f.repository, "@/lib/membership/invitation-model": model,
  });
  const request = (body, origin = "https://members.example.test") => new Request("https://members.example.test/api/my/invitation", {
    method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await route.GET(new Request("https://members.example.test/api/my/invitation"))).status, 401);
  current = { authUserId: first.auth };
  assert.equal((await route.PATCH(request({ enabled: true, version: 0 }, "https://untrusted.example.test"))).status, 403);
  assert.equal((await route.PATCH(request({ enabled: true, version: 0, memberId: second.member }))).status, 400);
  const enabled = await route.PATCH(request({ enabled: true, version: 0 }));
  assert.equal(enabled.status, 200); assert.match(enabled.headers.get("cache-control"), /private, no-store/);
  const { snapshot } = await enabled.json(); assert.ok(snapshot.url); assert.equal(snapshot.enabled, true);
  assert.equal((await f.repository.getOwnMemberInvitation(second.auth)).enabled, false);
  const conflict = await route.PATCH(request({ enabled: false, version: 0 })); assert.equal(conflict.status, 409);
  assert.match(conflict.headers.get("cache-control"), /no-store/);
  mode = "preview"; assert.equal((await route.GET(new Request("https://members.example.test/api/my/invitation"))).status, 503);
  const publicRoute = await load("app/api/invitations/[token]/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/membership/invitation-repository": f.repository, "@/lib/membership/invitation-model": model,
  });
  const token = snapshot.url.split("/").pop();
  const publicResponse = await publicRoute.GET(new Request("https://members.example.test"), { params: Promise.resolve({ token }) });
  assert.equal(publicResponse.status, 200); assert.match(publicResponse.headers.get("cache-control"), /no-store/);
  assert.doesNotMatch(JSON.stringify(await publicResponse.json()), /PRIVATE|joinedCount|member_id|person_id|email/);
  assert.equal((await publicRoute.GET(new Request("https://members.example.test"), { params: Promise.resolve({ token: "invalid" }) })).status, 404);
});

test("only current ops administrators can read a bounded roster of completed joins", async t => {
  const f = await fixture(t), invitation = await f.enable();
  await f.submit(newcomer, invitation.url.split("/").pop());
  await assert.rejects(f.opsReferrals.getOpsMemberReferrals(first.auth, first.member), { code: "forbidden" });
  await f.db.query("insert into platform_role_grants values($1,'ops_admin',null)", [second.auth]);
  assert.deepEqual(await f.opsReferrals.getOpsMemberReferrals(second.auth, first.member), { joinedCount: 0, joins: [] });
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  const result = await f.opsReferrals.getOpsMemberReferrals(second.auth, first.member);
  assert.equal(result.joinedCount, 1); assert.equal(result.joins.length, 1);
  assert.deepEqual(Object.keys(result.joins[0]).sort(), ["joinedAt", "memberId", "name"]);
  assert.equal(result.joins[0].memberId, newcomer.member); assert.equal(result.joins[0].name, "Member 3");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|@example|email|phone|token/);
  const more = JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ ...person(i + 10), waitlist: uuid(i + 1000) })));
  await f.db.query("insert into people select (v->>'person')::uuid from jsonb_array_elements($1::jsonb) v", [more]);
  await f.db.query("insert into ruined_members select (v->>'member')::uuid,(v->>'person')::uuid,v->>'email' from jsonb_array_elements($1::jsonb) v", [more]);
  await f.db.query("insert into membership_waitlist(id,name,email_normalized) select (v->>'waitlist')::uuid,'Joined Person',v->>'email' from jsonb_array_elements($1::jsonb) v", [more]);
  await f.db.query("insert into member_referrals(waitlist_id,inviter_member_id,referred_person_id,referred_member_id,bound_at,joined_at) select (v->>'waitlist')::uuid,$2::uuid,(v->>'person')::uuid,(v->>'member')::uuid,statement_timestamp(),statement_timestamp() from jsonb_array_elements($1::jsonb) v", [more, first.member]);
  const bounded = await f.opsReferrals.getOpsMemberReferrals(second.auth, first.member);
  assert.equal(bounded.joinedCount, 52); assert.equal(bounded.joins.length, 50, "the total covers all joins but the roster is bounded");
  await assert.rejects(f.opsReferrals.getOpsMemberReferrals(second.auth, uuid(999)), { code: "not_found" });
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='ops_admin'", [second.auth]);
  await assert.rejects(f.opsReferrals.getOpsMemberReferrals(second.auth, first.member), { code: "forbidden" });
  await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [second.auth]);
  await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [second.auth]);
  await assert.rejects(f.opsReferrals.getOpsMemberReferrals(second.auth, first.member), { code: "forbidden" });
});

test("issuance is exactly 48 hours and reads, profile edits, and redundant enable never extend a link", async t => {
  const f = await fixture(t), enabled = await f.enable(), token = enabled.url.split("/").pop();
  const issued = (await f.db.query("select issued_at,expires_at from member_invitations where member_id=$1", [first.member])).rows[0];
  assert.equal(issued.expires_at.getTime() - issued.issued_at.getTime(), 48 * 60 * 60 * 1000);
  assert.equal(enabled.expiresAt, issued.expires_at.toISOString());
  await f.db.query("update person_profiles set display_name='Edited name',member_tag='edited_tag' where person_id=$1", [first.person]);
  for (let i = 0; i < 3; i++) {
    const own = await f.repository.getOwnMemberInvitation(first.auth);
    assert.equal(own.url, enabled.url, "copy/share read the same already-issued link");
    assert.equal(own.expiresAt, enabled.expiresAt);
    assert.equal((await f.repository.getPublicMemberInvitation(token)).expiresAt, enabled.expiresAt);
  }
  const redundant = await f.repository.saveOwnMemberInvitation(first.auth, { enabled: true, version: enabled.version });
  assert.equal(redundant.url, enabled.url); assert.equal(redundant.expiresAt, enabled.expiresAt);
  assert.deepEqual((await f.db.query("select issued_at,expires_at from member_invitations where member_id=$1", [first.member])).rows[0], issued);
  await f.submit(newcomer, token);
  const priorAttribution = (await f.db.query("select * from member_referrals")).rows;
  const renewed = await f.repository.saveOwnMemberInvitation(first.auth, { enabled: true, renew: true, version: redundant.version });
  assert.notEqual(renewed.url, enabled.url); assert.ok(Date.parse(renewed.expiresAt) > Date.parse(enabled.expiresAt));
  assert.equal(await f.repository.getPublicMemberInvitation(token), null);
  assert.deepEqual((await f.db.query("select * from member_referrals")).rows, priorAttribution);
  await assert.rejects(f.repository.saveOwnMemberInvitation(first.auth, { enabled: true, renew: true, version: redundant.version }), { status: 409 });
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 1);
  const replaced = (await f.db.query("select issued_at,expires_at from member_invitations where member_id=$1", [first.member])).rows[0];
  assert.equal(replaced.expires_at.getTime() - replaced.issued_at.getTime(), 172800000);
});

test("expiry rejects public reads and new or repeated submissions while preserving legitimate earlier referrals", async t => {
  const f = await fixture(t), invitation = await f.enable(), token = invitation.url.split("/").pop();
  await f.submit(newcomer, token);
  const priorInterest = (await f.db.query("select * from membership_waitlist")).rows;
  const priorOutbox = (await f.db.query("select * from integration_outbox")).rows;
  // Set the precise boundary from the database clock. At that instant and later,
  // the invitation is expired rather than inclusive of its final timestamp.
  await f.db.query("update member_invitations set expires_at=statement_timestamp(),issued_at=statement_timestamp()-interval '48 hours' where member_id=$1", [first.member]);
  const own = await f.repository.getOwnMemberInvitation(first.auth);
  assert.equal(own.enabled, true); assert.equal(own.url, null); assert.ok(own.expiresAt);
  assert.equal(await f.repository.getPublicMemberInvitation(token), null);
  await assert.rejects(f.submit(newcomer, token), { code: "P4100" });
  await assert.rejects(f.submit(person(4), token), { code: "P4100" });
  await assert.rejects(f.db.query("select private.ruined_capture_member_referral($1,$2)", [priorInterest[0].id, token]), { code: "P4100" });
  assert.deepEqual((await f.db.query("select * from membership_waitlist")).rows, priorInterest);
  assert.deepEqual((await f.db.query("select * from integration_outbox")).rows, priorOutbox);
  await f.addMember(newcomer, false, true); await f.activate(newcomer);
  assert.equal((await f.repository.getOwnMemberInvitation(first.auth)).joinedCount, 1, "a valid earlier acceptance may complete after expiration");
  const refreshed = await f.repository.saveOwnMemberInvitation(first.auth, { enabled: true, version: own.version });
  assert.notEqual(refreshed.url, invitation.url); assert.ok(Date.parse(refreshed.expiresAt) > Date.parse(own.expiresAt));
  assert.equal(refreshed.joinedCount, 1); assert.equal(await f.repository.getPublicMemberInvitation(token), null);
});

test("waitlist POST rejects expired, revoked, missing and malformed links consistently without new writes", async t => {
  const f = await fixture(t), invitation = await f.enable(), token = invitation.url.split("/").pop();
  await f.submit(newcomer, token);
  const before = (await f.db.query("select * from membership_waitlist")).rows;
  const deferred = [];
  const route = await load("app/api/members/waitlist/route.ts", {
    "node:crypto": crypto,
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) }, after: callback => deferred.push(callback) },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => true },
    "@/lib/membership/waitlist-model": waitlistModel,
    "@/lib/membership/waitlist-repository": f.waitlist,
    "@/lib/membership/waitlist-sheet-sync": { processMembershipWaitlistSheetOutboxBatch: async () => {} },
  }, { process: { env: { DATABASE_URL: "isolated-in-memory-only", COMMUNICATION_RATE_LIMIT_SECRET: "test-secret" } } });
  let attempts = 0;
  const post = invitationToken => route.POST(new Request("https://example.test/api/members/waitlist", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `test-${attempts++}` },
    body: JSON.stringify({ name: "Attempted replacement", email: attempts % 2 ? newcomer.email : "new@example.test", invitationToken }),
  }));
  await f.db.query("update member_invitations set expires_at=statement_timestamp(),issued_at=statement_timestamp()-interval '48 hours' where member_id=$1", [first.member]);
  const expected = { error: "This invitation is no longer available. Ask the member for a new invitation." };
  for (const unavailable of [token, token, "X".repeat(43), "X".repeat(43), "bad", "bad", null, null]) {
    const response = await post(unavailable);
    assert.equal(response.status, 410); assert.deepEqual(await response.json(), expected);
  }
  const renewed = await f.repository.saveOwnMemberInvitation(first.auth, { enabled: true, version: invitation.version });
  await f.repository.saveOwnMemberInvitation(first.auth, { enabled: false, version: renewed.version });
  for (let i = 0; i < 2; i++) {
    const response = await post(renewed.url.split("/").pop());
    assert.equal(response.status, 410); assert.deepEqual(await response.json(), expected);
  }
  assert.deepEqual((await f.db.query("select * from membership_waitlist")).rows, before);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 1);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 1);
  assert.deepEqual(deferred, []);
});

test("capture rolls back a waitlist insert if the invitation expires after prevalidation", async t => {
  const f = await fixture(t), invitation = await f.enable();
  await f.db.exec(`create function expire_during_test_insert() returns trigger language plpgsql as $$
    begin
      update member_invitations set expires_at=statement_timestamp(),issued_at=statement_timestamp()-interval '48 hours';
      return new;
    end $$;
    create trigger expire_during_test_insert before insert on membership_waitlist for each row execute function expire_during_test_insert();`);
  await assert.rejects(f.submit(newcomer, invitation.url.split("/").pop()), { code: "P4100" });
  assert.equal((await f.db.query("select * from membership_waitlist")).rows.length, 0);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 0);
});

test("migration preserves original issue dates and uses 48 absolute hours across daylight saving changes", async t => {
  const f = await fixture(t, { applyExpiry: false });
  await f.db.exec("set timezone='America/Denver'");
  await f.db.query("insert into member_invitations(member_id,public_token,enabled,created_at) values($1,$2,true,'2026-03-07 12:00:00-07'),($3,$4,true,'2026-10-31 12:00:00-06')", [first.member, "A".repeat(43), second.member, "B".repeat(43)]);
  await f.db.exec(await source("db/migrations/20260922200000_member_invitation_expiry.sql"));
  await f.db.exec(await source("db/migrations/20260923000000_personal_member_invitations.sql"));
  const rows = (await f.db.query("select issued_at=created_at as original,extract(epoch from expires_at-issued_at)::integer as duration from member_invitations")).rows;
  assert.deepEqual(rows, [{ original: true, duration: 172800 }, { original: true, duration: 172800 }]);
  assert.equal(await f.repository.getPublicMemberInvitation("A".repeat(43)), null, "an old invitation is not revived by the migration");
  await assert.rejects(f.db.query("update member_invitations set expires_at=issued_at+interval '2 days' where member_id=$1", [first.member]), { code: "23514" });
  await assert.rejects(f.db.query("update member_invitations set expires_at=issued_at+interval '48 hours 1 second' where member_id=$1", [first.member]), { code: "23514" });
  await assert.rejects(f.db.query("update member_invitations set issued_at=null where member_id=$1", [first.member]), { code: "23502" });
});


test("capture rechecks expiry after waiting for the email attribution lock", async t => {
  const f = await fixture(t), invitation = await f.enable();
  // This isolated engine's clock advances to the deadline on the third read:
  // prevalidation, capture before its email lock, then capture after that lock.
  // Only the clock dependency is substituted in this isolated validator; the
  // production capture function and its lock/recheck sequence run unchanged.
  await f.db.exec(`create table invitation_test_clock(ticks integer not null);
    insert into invitation_test_clock values(0);
    create function private.invitation_test_now() returns timestamptz
    language plpgsql volatile as $$
    declare current_tick integer; deadline timestamptz;
    begin
      update public.invitation_test_clock set ticks=ticks+1 returning ticks into current_tick;
      select expires_at into deadline from public.member_invitations limit 1;
      return case when current_tick >= 3 then deadline else deadline-interval '1 second' end;
    end $$;`);
  const migration = await source("db/migrations/20260922200000_member_invitation_expiry.sql");
  const validator = migration.match(/create function private\.ruined_require_member_invitation[\s\S]*?\n\$\$;/)[0];
  await f.db.exec(validator.replace("create function", "create or replace function").replace("clock_timestamp()", "private.invitation_test_now()"));
  await assert.rejects(f.submit(newcomer, invitation.url.split("/").pop()), { code: "P4100" });
  assert.equal((await f.db.query("select * from membership_waitlist")).rows.length, 0);
  assert.equal((await f.db.query("select * from member_referrals")).rows.length, 0);
  assert.equal((await f.db.query("select * from integration_outbox")).rows.length, 0);
});
