import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as crypto from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const self = { auth: uuid(1), person: uuid(2), member: uuid(3) };
const other = { auth: uuid(4), person: uuid(5), member: uuid(6) };
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const output = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const model = await load("src/lib/membership/public-card-model.ts");
const policy = await load("src/lib/membership/access-policy.ts");
const photoPolicy = await load("src/lib/membership/photo-policy.ts");
async function fixture() {
  const PGlite = await loadPGliteForSchemaChecks(); const pg = new PGlite();
  await pg.exec(`
    set timezone='UTC'; create role anon; create role authenticated; create schema private;
    create table ruined_members(id uuid primary key, person_id uuid, email text, membership_activated_at timestamptz);
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text default 'active');
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key, account_state text default 'active', billing_state text default 'active', program_state text default 'active', foundations_state text default 'completed', administrative_onboarding_state text default 'completed', standing_state text default 'active', cancellation_effective_at timestamptz);
    create table person_profiles(person_id uuid primary key, display_name text, preferred_name text, member_tag text, avatar_storage_path text, location_label text, bio text, building_now text);
    create table member_milestones(id uuid primary key, member_id uuid, person_id uuid, title text, visibility text, occurred_at timestamptz, source_entity_type text, source_entity_id text, evidence jsonb);
    create table artifact_awards(id uuid primary key, member_id uuid, person_id uuid, status text, revoked_at timestamptz, awarded_at timestamptz);
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql stable as 'select false';
    create function private.ruined_member_has_complimentary_funding(uuid) returns boolean language sql stable as 'select false';
  `);
  await pg.exec(await source("db/migrations/20260917200000_public_member_cards.sql"));
  await pg.exec(await source("db/migrations/20260919210000_member_profile_card_sync.sql"));
  for (const person of [self, other]) {
    await pg.query("insert into ruined_members values($1,$2,'PRIVATE EMAIL','2020-09-17')", [person.member, person.person]);
    await pg.query("insert into platform_users(auth_user_id,person_id) values($1,$2)", [person.auth, person.person]);
    await pg.query("insert into platform_role_grants values($1,'member',null)", [person.auth]);
    await pg.query("insert into member_lifecycle(member_id) values($1)", [person.member]);
    await pg.query("insert into person_profiles(person_id,display_name,preferred_name,avatar_storage_path,location_label,bio,building_now) values($1,$2,'PRIVATE PREFERRED',$3,'PRIVATE LOCATION','PRIVATE BIO','PRIVATE BUILDING')", [person.person, person === self ? "Cade" : "Other", `/api/member-photos/${person.member}/${uuid(90)}.webp`]);
  }
  const queries = [];
  let afterQuery = null;
  function makeSql(client) {
    const sql = (strings, ...params) => {
      const text = strings.reduce((result, part, i) => result + (i ? `$${i}` : "") + part, "");
      queries.push(text);
      return client.query(text, params).then(async result => { if (afterQuery) await afterQuery(text); return result.rows; });
    };
    sql.json = JSON.stringify;
    sql.begin = callback => client.transaction(tx => callback(makeSql(tx)));
    return sql;
  }
  const sql = makeSql(pg);
  async function getMemberIdentity(auth) {
    const rows = await pg.query(`select member.id,member.person_id,lifecycle.* from platform_users viewer
      join platform_role_grants g on g.auth_user_id=viewer.auth_user_id and g.role_slug='member' and g.revoked_at is null
      join ruined_members member on member.person_id=viewer.person_id join member_lifecycle lifecycle on lifecycle.member_id=member.id
      where viewer.auth_user_id=$1 and viewer.status='active'`, [auth]);
    const row = rows.rows[0]; if (!row) return null;
    return { memberId: row.id, personId: row.person_id, authUserId: auth, email: "PRIVATE EMAIL", accountState: row.account_state,
      billingState: row.billing_state, programState: row.program_state, foundationsState: row.foundations_state,
      administrativeOnboardingState: row.administrative_onboarding_state, standingState: row.standing_state,
      cancellationEffectiveAt: row.cancellation_effective_at, membershipFunding: "self" };
  }
  let storageHook = null; let downloaded = [];
  const repository = await load("src/lib/membership/public-card-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/membership/access-policy": policy, "@/lib/membership/repository": { getMemberIdentity },
    "@/lib/membership/photo-policy": photoPolicy, "./public-card-model": model,
    "@supabase/supabase-js": { createClient: () => ({ storage: { from: bucket => ({ download: async path => {
      downloaded.push({ bucket, path }); if (storageHook) await storageHook(); return { data: new Blob(["portrait"]), error: null };
    } }) } }) },
  });
  async function milestone(id, { person = self, title = "Foundations completed", visibility = "member", award = null, future = false } = {}) {
    await pg.query("insert into member_milestones values($1,$2,$3,$4,$5,$6,$7,$8,'{\"private\":\"PRIVATE EVIDENCE\"}')",
      [uuid(id), person.member, person.person, title, visibility, future ? "2200-01-01" : "2020-01-01", award ? "artifact_award" : null, award ? uuid(award) : null]);
  }
  async function input(changes = {}) {
    const snapshot = await repository.getOwnMemberCard(self.auth);
    return { ...snapshot.settings, version: snapshot.version, ...changes };
  }
  return { pg, sql, repository, queries, input, milestone, downloaded, setStorageHook: value => { storageHook = value; }, setAfterQuery: value => { afterQuery = value; } };
}

test("public settings start private with every optional field off; publication projects only chosen fields", async () => {
  const f = await fixture();
  try {
    const snapshot = await f.repository.getOwnMemberCard(self.auth);
    assert.equal(snapshot.publicUrl, null); assert.equal(snapshot.version, 0); assert.equal(snapshot.eligible, true);
    assert.deepEqual(snapshot.card, { name: "Cade", memberTag: null, avatarUrl: null, memberSince: null, location: null, bio: null, buildingNow: null, websiteUrl: null, labels: [], wearSeed: snapshot.card.wearSeed });
    assert.equal(snapshot.settings.publicEnabled, false);
    await f.pg.query("update person_profiles set display_name='Public Cade',bio='Approved words' where person_id=$1", [self.person]);
    const saved = await f.repository.saveOwnMemberCard(self.auth, await f.input({ publicEnabled: true, showBio: true }));
    const token = saved.publicUrl.split("/").pop(); assert.match(token, model.MEMBER_CARD_TOKEN);
    assert.equal(saved.card.wearSeed, snapshot.card.wearSeed);
    const card = await f.repository.getPublicMemberCard(token);
    assert.equal(card.name, "Public Cade"); assert.equal(card.bio, "Approved words");
    assert.deepEqual(Object.keys(card).sort(), ["name", "memberTag", "avatarUrl", "memberSince", "location", "bio", "buildingNow", "websiteUrl", "labels", "wearSeed"].sort());
    assert.doesNotMatch(JSON.stringify(card), /PRIVATE|memberId|personId|email|version|settings|00000000-0000/);
    assert.equal((await f.repository.getOwnMemberCard(other.auth)).publicUrl, null);
    await assert.rejects(f.repository.getOwnMemberCard(uuid(999)), { status: 403 });
    await assert.rejects(f.repository.saveOwnMemberCard(uuid(999), await f.input()), { status: 403 });
  } finally { await f.pg.close(); }
});

test("chosen member tags follow the profile without changing names, sharing scope or card links", async () => {
  const f = await fixture();
  try {
    const initial = await f.repository.getOwnMemberCard(self.auth);
    assert.equal(initial.source.memberTag, null, "legacy preferred names are never converted into tags");
    await f.pg.query("update person_profiles set member_tag='cade' where person_id=$1", [self.person]);
    const saved = await f.repository.saveOwnMemberCard(self.auth, await f.input({ publicEnabled: true }));
    const token = saved.publicUrl.split("/").pop();
    assert.equal((await f.repository.getPublicMemberCard(token)).memberTag, "cade");
    await f.pg.query("update person_profiles set member_tag='cade_studio' where person_id=$1", [self.person]);
    const current = await f.repository.getOwnMemberCard(self.auth);
    const card = await f.repository.getPublicMemberCard(token);
    assert.equal(current.source.memberTag, "cade_studio"); assert.equal(card.memberTag, "cade_studio");
    assert.equal(card.name, "Cade"); assert.equal(current.publicUrl, saved.publicUrl); assert.equal(current.version, saved.version);
    assert.deepEqual(current.settings, saved.settings); assert.equal(card.wearSeed, saved.card.wearSeed);
    assert.notEqual(current.sourceRevision, saved.sourceRevision, "tag changes participate in stale-source protection");
    assert.deepEqual({ ...card, memberTag: "cade" }, saved.card);
    assert.doesNotMatch(JSON.stringify(card), /PRIVATE|email|preferred|personId|memberId/);
    await f.repository.saveOwnMemberCard(self.auth, { ...current.settings, publicEnabled: false, version: current.version });
    assert.equal(await f.repository.getPublicMemberCard(token), null, "a chosen tag never enables sharing");
  } finally { await f.pg.close(); }
});

test("a tag changed during public projection does not return a stale public identity", async () => {
  const f = await fixture();
  try {
    await f.pg.query("update person_profiles set member_tag='before' where person_id=$1", [self.person]);
    const saved = await f.repository.saveOwnMemberCard(self.auth, await f.input({ publicEnabled: true }));
    const token = saved.publicUrl.split("/").pop();
    f.setAfterQuery(async query => {
      if (!query.includes("from member_milestones milestone")) return;
      f.setAfterQuery(null);
      await f.pg.query("update person_profiles set member_tag='after' where person_id=$1", [self.person]);
    });
    assert.equal(await f.repository.getPublicMemberCard(token), null);
    assert.equal((await f.repository.getPublicMemberCard(token)).memberTag, "after");
  } finally { await f.pg.close(); }
});

test("public identity formatting keeps tags exact and avoids repeated tag names", () => {
  assert.equal(model.publicMemberCardIdentity({ name: "Cade", memberTag: null }), "Cade");
  assert.equal(model.publicMemberCardIdentity({ name: "Cade", memberTag: "cade_studio" }), "Cade (@cade_studio)");
  assert.equal(model.publicMemberCardIdentity({ name: "@cade_studio", memberTag: "cade_studio" }), "@cade_studio");
});

test("revocation, membership changes and auth-role withdrawal close card and portrait access", async () => {
  const f = await fixture();
  try {
    let saved = await f.repository.saveOwnMemberCard(self.auth, await f.input({ publicEnabled: true, showPortrait: true }));
    const token = saved.publicUrl.split("/").pop();
    saved = await f.repository.saveOwnMemberCard(self.auth, { ...saved.settings, publicEnabled: false, version: saved.version });
    assert.equal(await f.repository.getPublicMemberCard(token), null);
    assert.equal(await f.repository.getPublicMemberCardPortrait(token), null);
    saved = await f.repository.saveOwnMemberCard(self.auth, { ...saved.settings, publicEnabled: true, version: saved.version });
    assert.equal(saved.publicUrl, `/card/${token}`, "re-enabling preserves the member's stable link");
    for (const assignment of ["standing_state='paused'", "standing_state='inactive'", "standing_state='alumni'", "account_state='suspended'", "account_state='closed'", "billing_state='ended'", "program_state='offboarded'", "standing_state='cancellation_requested',cancellation_effective_at='2001-01-01'"]) {
      await f.pg.query(`update member_lifecycle set ${assignment} where member_id=$1`, [self.member]);
      assert.equal(await f.repository.getPublicMemberCard(token), null, assignment);
      assert.equal(await f.repository.getPublicMemberCardPortrait(token), null, assignment);
      await f.pg.query("update member_lifecycle set standing_state='active',account_state='active',billing_state='active',program_state='active',cancellation_effective_at=null where member_id=$1", [self.member]);
    }
    await f.pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [self.auth]);
    assert.equal(await f.repository.getPublicMemberCard(token), null);
    await f.pg.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [self.auth]);
    await f.pg.query("update ruined_members set membership_activated_at=null where id=$1", [self.member]);
    assert.equal(await f.repository.getPublicMemberCard(token), null);
    await assert.rejects(f.repository.saveOwnMemberCard(self.auth, { ...saved.settings, version: saved.version }), { status: 403 });
    assert.equal(await f.repository.getPublicMemberCard("guess"), null);
    assert.equal(await f.repository.getPublicMemberCard(self.member), null);
  } finally { await f.pg.close(); }
});

test("selected portrait and location follow the current profile; revocation during download still discards bytes", async () => {
  const f = await fixture();
  const oldURL = process.env.NEXT_PUBLIC_SUPABASE_URL; const oldKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage.example.test"; process.env.SUPABASE_SECRET_KEY = "test-key";
  try {
    const saved = await f.repository.saveOwnMemberCard(self.auth, await f.input({ publicEnabled: true, showPortrait: true, showLocation: true, showMemberSince: true }));
    const token = saved.publicUrl.split("/").pop();
    let card = await f.repository.getPublicMemberCard(token);
    assert.match(card.avatarUrl, new RegExp(`^/api/cards/${token}/portrait\\?v=[0-9a-f]{20}$`)); assert.equal(card.memberSince, "2020-09-17T00:00:00.000Z");
    assert.equal(await (await f.repository.getPublicMemberCardPortrait(token)).text(), "portrait");
    assert.deepEqual(f.downloaded, [{ bucket: "member-portraits", path: `${self.member}/${uuid(90)}.webp` }]);
    await f.pg.query("update person_profiles set avatar_storage_path=$1,location_label='NEW PRIVATE LOCATION' where person_id=$2", [`/api/member-photos/${self.member}/${uuid(91)}.webp`, self.person]);
    card = await f.repository.getPublicMemberCard(token); assert.ok(card.avatarUrl); assert.equal(card.location, "NEW PRIVATE LOCATION");
    assert.equal(await (await f.repository.getPublicMemberCardPortrait(token)).text(), "portrait");
    assert.equal(f.downloaded.at(-1).path, `${self.member}/${uuid(91)}.webp`);
    const updated = await f.repository.saveOwnMemberCard(self.auth, await f.input());
    assert.equal(updated.card.location, "NEW PRIVATE LOCATION");
    f.setStorageHook(() => f.pg.query("update member_public_cards set public_enabled=false,version=version+1 where member_id=$1", [self.member]));
    assert.equal(await f.repository.getPublicMemberCardPortrait(token), null, "revocation during download must discard bytes");
  } finally {
    if (oldURL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldURL;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldKey;
    await f.pg.close();
  }
});

test("only selected verified milestone labels survive, including award revocation; version conflicts never overwrite", async () => {
  const f = await fixture();
  try {
    await f.milestone(20); await f.milestone(21, { person: other, title: "OTHER MEMBER" });
    await f.milestone(22, { visibility: "ops", title: "OPS" }); await f.milestone(23, { visibility: "private", title: "PRIVATE" });
    await f.milestone(24, { future: true });
    await f.pg.query("insert into artifact_awards values($1,$2,$3,'awarded',null,'2020-01-01')", [uuid(30), self.member, self.person]);
    await f.milestone(25, { award: 30, title: "The First Coin" });
    const snapshot = await f.repository.getOwnMemberCard(self.auth);
    assert.deepEqual(snapshot.availableLabels.map(label => label.id).sort(), [uuid(20), uuid(25)]);
    await assert.rejects(f.repository.saveOwnMemberCard(self.auth, await f.input({ labelIds: [uuid(21)] })), { status: 400 });
    const saved = await f.repository.saveOwnMemberCard(self.auth, await f.input({ publicEnabled: true, labelIds: [uuid(20), uuid(25)] }));
    const token = saved.publicUrl.split("/").pop();
    assert.deepEqual((await f.repository.getPublicMemberCard(token)).labels, ["Foundations completed", "The First Coin"]);
    await f.pg.query("update artifact_awards set status='revoked',revoked_at=now() where id=$1", [uuid(30)]);
    assert.deepEqual((await f.repository.getPublicMemberCard(token)).labels, ["Foundations completed"]);
    await assert.rejects(f.repository.saveOwnMemberCard(self.auth, { ...saved.settings, version: 0 }), { status: 409 });
    assert.equal((await f.repository.getPublicMemberCard(token)).name, "Cade");
    const grants = await f.pg.query("select has_table_privilege('anon','member_public_cards','SELECT') as anon,has_table_privilege('authenticated','member_public_cards','SELECT') as authenticated");
    assert.deepEqual(grants.rows, [{ anon: false, authenticated: false }]);
  } finally { await f.pg.close(); }
});

test("validation rejects excess public fields, non-boolean consent, unsafe URLs, oversize streamed requests", async () => {
  const base = { ...model.defaultMemberCardSettings({ name: "Cade", bio: "", buildingNow: "", avatarUrl: null, memberSince: null, location: null }), version: 0 };
  for (const change of [{ memberId: self.member }, { memberTag: "spoofed_tag" }, { publicEnabled: "true" }, { publicName: " " }, { cardBio: "x".repeat(181) }, { labelIds: [uuid(20), uuid(20)] }, { labelIds: [uuid(20), uuid(21), uuid(22)] }, { version: -1 }, { publicWebsite: "javascript:alert(1)" }, { publicWebsite: "https://user:pass@example.test" }, { publicWebsite: "data:text/html,hello" }]) {
    assert.throws(() => model.validateMemberCardInput({ ...base, ...change }), { status: 400 });
  }
  assert.equal(model.normalizeCardWebsite("https://example.test"), "https://example.test/");
  for (const url of ["javascript:alert(1)", "https://user:pass@example.test", "data:text/html,hello"]) assert.throws(() => model.normalizeCardWebsite(url), { status: 400 });
  const request = new Request("https://example.test/api/my/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(8001))); controller.close(); } }), duplex: "half" });
  await assert.rejects(model.readMemberCardJson(request), { status: 413 });
  await assert.rejects(model.readMemberCardJson(new Request("https://example.test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), { status: 400 });
});

test("concurrent first saves cannot replace each other, and revoked labels never block withdrawal", async () => {
  const f = await fixture();
  try {
    await f.milestone(20);
    const initial = await f.input({ publicEnabled: true, labelIds: [uuid(20)] });
    const outcomes = await Promise.allSettled([
      f.repository.saveOwnMemberCard(self.auth, { ...initial, showLocation: true }),
      f.repository.saveOwnMemberCard(self.auth, { ...initial, showBio: true }),
    ]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.find(result => result.status === "rejected").reason.status, 409);
    const current = await f.repository.getOwnMemberCard(self.auth); const token = current.publicUrl.split("/").pop();
    await f.pg.query("update member_milestones set visibility='private' where id=$1", [uuid(20)]);
    await f.pg.query("update person_profiles set location_label='A new city' where person_id=$1", [self.person]);
    await f.pg.query("update member_lifecycle set standing_state='paused' where member_id=$1", [self.member]);
    assert.equal((await f.repository.getOwnMemberCard(self.auth)).writable, false);
    const withdrawn = await f.repository.saveOwnMemberCard(self.auth, { ...current.settings, publicEnabled: false, version: current.version });
    await assert.rejects(f.repository.saveOwnMemberCard(self.auth, { ...withdrawn.settings, publicEnabled: true, labelIds: [], version: withdrawn.version }), { status: 403 });
    assert.equal(withdrawn.publicUrl, null); assert.equal(await f.repository.getPublicMemberCard(token), null);
  } finally { await f.pg.close(); }
});

test("owner routes enforce session, trusted origin and bounded input without revealing errors", async () => {
  let auth = null; let trusted = true; let connected = true; let saveCalls = 0; let readCalls = 0;
  const route = await load("app/api/my/card/route.ts", {
    "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => auth },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: connected ? "connected" : "preview" }) },
    "@/lib/membership/public-card-model": model,
    "@/lib/membership/public-card-repository": {
      getOwnMemberCard: async user => { readCalls++; assert.equal(user, self.auth); return { publicUrl: null }; },
      saveOwnMemberCard: async user => { saveCalls++; assert.equal(user, self.auth); return { publicUrl: null }; },
    },
  });
  const base = { ...model.defaultMemberCardSettings({ name: "Cade", bio: "", buildingNow: "", avatarUrl: null, memberSince: null, location: null }), version: 0 };
  const request = body => new Request("https://ruined.test/api/my/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await route.GET(new Request("https://ruined.test/api/my/card"))).status, 401);
  assert.equal((await route.POST(request(base))).status, 401);
  auth = { authUserId: self.auth }; trusted = false;
  assert.equal((await route.POST(request(base))).status, 403);
  trusted = true;
  assert.equal((await route.POST(request({ ...base, memberId: other.member }))).status, 400);
  assert.equal((await route.POST(request({ ...base, publicName: "x".repeat(9000) }))).status, 413);
  assert.equal(saveCalls, 0);
  const response = await route.POST(request(base)); assert.equal(response.status, 200); assert.equal(saveCalls, 1);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), { snapshot: { publicUrl: null } });
  assert.equal((await route.GET(new Request("https://ruined.test/api/my/card"))).status, 200); assert.equal(readCalls, 1);
  connected = false;
  assert.equal((await route.POST(request(base))).status, 503); assert.equal(saveCalls, 1);
});

test("selected earned labels follow current titles and disappear when their visibility is withdrawn", async () => {
  const f = await fixture();
  try {
    await f.milestone(20, { title: "Original label" });
    const choices = await f.input({ publicEnabled: true, labelIds: [uuid(20)] });
    await f.pg.query("update member_milestones set title='Changed label' where id=$1", [uuid(20)]);
    const saved = await f.repository.saveOwnMemberCard(self.auth, choices);
    const token = saved.publicUrl.split("/").pop();
    assert.deepEqual((await f.repository.getPublicMemberCard(token)).labels, ["Changed label"]);
    await f.pg.query("update member_milestones set title='Current earned label' where id=$1", [uuid(20)]);
    assert.deepEqual((await f.repository.getPublicMemberCard(token)).labels, ["Current earned label"]);
    await f.pg.query("update member_milestones set visibility='private' where id=$1", [uuid(20)]);
    assert.deepEqual((await f.repository.getPublicMemberCard(token)).labels, []);
  } finally { await f.pg.close(); }
});

test("full selected profile fields sync without another card save; unselected fields stay private", async () => {
  const f = await fixture();
  try {
    const saved = await f.repository.saveOwnMemberCard(self.auth, await f.input({ publicEnabled: true, showBio: true, showBuilding: true, showWebsite: true }));
    const token = saved.publicUrl.split("/").pop();
    await f.pg.query("update person_profiles set display_name=$1,bio=$2,building_now=$3,website_url=$4,location_label='HIDDEN LOCATION' where person_id=$5", ["N".repeat(120), "B".repeat(1200), "W".repeat(500), "https://example.test/", self.person]);
    const card = await f.repository.getPublicMemberCard(token);
    assert.equal(card.name.length, 120); assert.equal(card.bio.length, 1200); assert.equal(card.buildingNow.length, 500);
    assert.equal(card.websiteUrl, "https://example.test/"); assert.equal(card.location, null); assert.equal(card.avatarUrl, null);
    const owner = await f.repository.getOwnMemberCard(self.auth);
    assert.equal(owner.version, saved.version, "A profile save does not overwrite public scope.");
    assert.equal(owner.card.bio, card.bio);
    assert.equal(model.memberCardExcerpt(card.bio, 180).length, 180); assert.ok(model.memberCardExcerpt(card.bio, 180).endsWith("…"));
    assert.equal(model.memberCardExcerpt("🫶".repeat(100), 4), "🫶🫶🫶…");
  } finally { await f.pg.close(); }
});

test("normal profile API accepts sharing scope atomically, rejects duplicate card text and returns safe conflicts", async () => {
  class MembershipInputError extends Error {}
  class MembershipAccessDeniedError extends Error {}
  class MembershipConflictError extends Error {}
  let calls = 0, failConflict = false;
  const profile = { revision: "1".repeat(64), directory: { bio: "Full profile text" } };
  const card = { settings: model.defaultMemberCardSettings(), version: 1, publicUrl: null };
  const route = await load("app/api/my/profile/route.ts", {
    "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => true },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => ({ authUserId: self.auth }) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/membership/public-card-model": model,
    "@/lib/membership/public-card-repository": { getOwnMemberCard: async () => card },
    "@/lib/membership/repository": { MembershipInputError, MembershipAccessDeniedError, MembershipConflictError,
      saveMemberProfile: async (_auth, input) => { calls++; if (failConflict) throw new MembershipConflictError("Reload before saving."); assert.equal(input.bio.length, 1200); assert.equal(input.card.showBio, false); return profile; } },
  });
  const input = { revision: "0".repeat(64), displayName: "Cade", memberTag: "cade", bio: "B".repeat(1200), buildingNow: "W".repeat(500), websiteUrl: "https://example.test", accessibilityNotes: "Private", timezone: "UTC", location: "Utah",
    directory: { directoryStatus: "hidden", avatarVisible: false, locationVisible: false, bioVisible: false, buildingVisible: false, emailScope: "none", phoneScope: "none" },
    card: { ...model.defaultMemberCardSettings(), version: 0 } };
  const request = body => new Request("https://ruined.test/api/my/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  for (const change of [{ revision: undefined }, { privateContact: "unexpected" }, { card: { ...input.card, publicName: "Second name editor" } }]) assert.equal((await route.POST(request({ ...input, ...change }))).status, 400);
  assert.equal(calls, 0);
  const result = await route.POST(request(input)); assert.equal(result.status, 200); assert.match(result.headers.get("Cache-Control"), /no-store/); assert.deepEqual(await result.json(), { profile, card });
  failConflict = true; const conflict = await route.POST(request(input)); assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { error: "Reload before saving." });
  const oversized = new Request("https://ruined.test/api/my/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(24001))); controller.close(); } }), duplex: "half" });
  assert.equal((await route.POST(oversized)).status, 413);
});
