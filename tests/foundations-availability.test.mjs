import { existingMemberIntakeDependencies, existingMemberRegistration } from "./helpers/registration-access-fixture.mjs";
import { loadFoundationsAvailability } from "./helpers/foundations-availability-fixture.mjs";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compiled = new Map();
async function load(path, dependencies = {}, environment = {}) {
  if (!compiled.has(path)) compiled.set(path, ts.transpileModule(
    await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText);
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "process", compiled.get(path))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports, { env: environment });
  return loadedModule.exports;
}
const availability = loadFoundationsAvailability;
const actions = [{ action: "start" }, { action: "progress", momentId: "story" }, { action: "complete" },
  { action: "complete_requirement", requirement: "future_letter" }];
const request = body => new Request("https://members.example.test/api/my/foundations", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://members.example.test" }, body: JSON.stringify(body),
});

test("Foundations stays closed by default and opens globally only with an explicit true flag", async () => {
  for (const NODE_ENV of ["development", "test", "production"]) {
    for (const flag of [undefined, "", "false", "1", "yes", "on", "true-ish"]) {
      const gate = availability({ NODE_ENV, MEMBERSHIP_FOUNDATIONS_LAUNCHED: flag,
        STRIPE_MEMBERSHIP_LIVE_ENABLED: "true", STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED: "true" });
      assert.equal(gate.isFoundationsLaunched(), false);
      await assert.rejects(() => gate.requireFoundationsAvailableToMember("member"), gate.FoundationsNotLaunchedError);
    }
    for (const flag of ["true", " TRUE ", "TrUe"]) {
      const gate = availability({ NODE_ENV, MEMBERSHIP_FOUNDATIONS_LAUNCHED: flag }, {
        getOperatorRole: async () => { throw Error("An open launch must not depend on operator access"); },
      });
      assert.equal(gate.isFoundationsLaunched(), true);
      assert.equal(await gate.isFoundationsAvailableToMember(null), true);
      await assert.doesNotReject(() => gate.requireFoundationsAvailableToMember("member"));
    }
  }
});

test("the prelaunch exception requires a current Administrator role and rechecks revocation", async () => {
  const reads = [];
  let role = "ops_admin";
  const gate = availability({}, { getOperatorRole: async id => { reads.push(id); return role; } });
  for (const id of [undefined, null, ""]) assert.equal(await gate.isFoundationsAvailableToMember(id), false);
  assert.deepEqual(reads, []);
  assert.equal(gate.isFoundationsLaunched(), false);
  assert.equal(await gate.isFoundationsAvailableToMember("administrator"), true);
  await assert.doesNotReject(() => gate.requireFoundationsAvailableToMember("administrator"));
  for (role of [null, "guide", "circle_leader", "member"]) {
    assert.equal(await gate.isFoundationsAvailableToMember("administrator"), false);
    await assert.rejects(() => gate.requireFoundationsAvailableToMember("administrator"), gate.FoundationsNotLaunchedError);
  }
  assert.equal(reads.length, 10);
  assert.ok(reads.every(id => id === "administrator"));
});

test("Administrator verification errors fail closed without exposing database messages or identities", async () => {
  const logs = [];
  const gate = availability({}, { getOperatorRole: async () => { throw Error("private database credentials for admin@example.test"); },
    logger: { error: (...args) => logs.push(args) } });
  assert.equal(await gate.isFoundationsAvailableToMember("private-auth-id"), false);
  await assert.rejects(() => gate.requireFoundationsAvailableToMember("private-auth-id"), gate.FoundationsNotLaunchedError);
  assert.equal(logs.length, 2);
  assert.doesNotMatch(JSON.stringify(logs), /credentials|admin@example|private-auth-id/);
});

test("real role lookup excludes revoked grants and inactive accounts before the Foundations exception", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create table platform_users (auth_user_id uuid primary key, status text not null);
    create table platform_role_grants (auth_user_id uuid, role_slug text not null, revoked_at timestamptz);`);
  const authId = "00000000-0000-4000-8000-000000000001";
  await db.query("insert into platform_users values ($1, 'active')", [authId]);
  await db.query("insert into platform_role_grants values ($1, 'ops_admin', null), ($1, 'circle_leader', null)", [authId]);
  const sql = async (strings, ...values) => (await db.query(strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, ""), values)).rows;
  const realRepository = await load("src/lib/platform/repository.ts", {
    "server-only": {}, "@/lib/membership/personal-invitation-admission": {}, "@/lib/membership/public-signup-admission": {},
    "@/lib/membership/registration-repository": {},
    "@/lib/identity/repository": {}, "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/stripe/database": { getBillingDatabase: () => sql }, "@/lib/stripe/membership-state": {}, "@/lib/platform/model": {},
  });
  const gate = availability({}, { getOperatorRole: realRepository.getOperatorRole });
  assert.equal(await gate.isFoundationsAvailableToMember(authId), true);
  await db.query("update platform_role_grants set revoked_at = now() where auth_user_id = $1 and role_slug = 'ops_admin'", [authId]);
  assert.equal(await gate.isFoundationsAvailableToMember(authId), false, "a remaining Circle role does not preserve admin access");
  await db.query("update platform_role_grants set revoked_at = null where auth_user_id = $1", [authId]);
  assert.equal(await gate.isFoundationsAvailableToMember(authId), true);
  await db.query("update platform_users set status = 'suspended' where auth_user_id = $1", [authId]);
  assert.equal(await gate.isFoundationsAvailableToMember(authId), false);
});

async function apiFixture({ launched = false, trusted = true, authenticated = true, mode = "connected", role = null } = {}) {
  const calls = [];
  const gate = availability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) }, {
    getOperatorRole: async id => { calls.push({ name: "role", args: [id] }); return role; },
  });
  let failure = null;
  const operation = name => async (...args) => { calls.push({ name, args }); if (failure) throw failure; return { fixture: name }; };
  class AccessError extends Error {}
  const repository = {
    CircleRequiredForFoundationCompletionError: class extends Error {}, FoundationSequenceError: class extends Error {},
    FoundationAccessError: AccessError, FoundationUnavailableError: class extends Error {},
    startMemberFoundations: operation("start"), recordMemberFoundationProgress: operation("progress"), completeMemberFoundations: operation("complete"),
  };
  const api = await load("app/api/my/foundations/route.ts", {
    "next/server": { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), options) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => { calls.push({ name: "viewer" }); return authenticated ? { authUserId: "member", roles: ["ops_admin"] } : null; } },
    "@/lib/foundations/availability": gate,
    "@/lib/foundations/repository": repository,
    "@/lib/platform/config": { getPlatformConfiguration: () => { calls.push({ name: "config" }); return { mode }; } },
    "@/lib/membership/repository": { completeMemberFoundationRequirement: operation("requirement"),
      MembershipAccessDeniedError: class extends Error {}, MembershipConflictError: class extends Error {} },
    "@/lib/workflows/worker": { processWorkflowBatch: operation("workflow") },
  });
  return { api, calls, gate, AccessError, repository, setFailure: value => { failure = value; } };
}

test("closed API blocks every valid action for a nonadmin despite a forged or stale viewer role", async () => {
  for (const role of [null, "guide", "circle_leader"]) {
    const fixture = await apiFixture({ role });
    for (const body of actions) {
      const response = await fixture.api.POST(request(body));
      assert.equal(response.status, 423);
      assert.deepEqual(await response.json(), { code: "foundations_not_launched", error: "Foundations is not open yet." });
    }
    assert.deepEqual(fixture.calls.map(call => call.name), Array(4).fill(["config", "viewer", "role"]).flat());
    assert.ok(fixture.calls.filter(call => call.name === "role").every(call => call.args[0] === "member"));
  }
});

test("prelaunch API preserves request, connected-mode and authentication boundaries before admin lookup", async () => {
  for (const options of [{ mode: "preview" }, { authenticated: false }]) {
    const fixture = await apiFixture({ ...options, role: "ops_admin" });
    assert.equal((await fixture.api.POST(request(actions[0]))).status, options.mode ? 503 : 401);
    assert.deepEqual(fixture.calls.map(call => call.name), options.mode ? ["config"] : ["config", "viewer"]);
  }
  const fixture = await apiFixture({ role: "ops_admin" });
  assert.equal((await fixture.api.POST(request({ action: "complete", state: "completed", memberId: "other", percent: 100 }))).status, 400);
  assert.deepEqual(fixture.calls.map(call => call.name), ["config"]);
});

test("untrusted requests remain forbidden even for Administrators", async () => {
  const fixture = await apiFixture({ trusted: false, role: "ops_admin" });
  const response = await fixture.api.POST(request(actions[0]));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "origin_denied");
  assert.deepEqual(fixture.calls, []);
});

test("Administrator access dispatches all prelaunch actions while preserving membership and completion errors", async () => {
  const fixture = await apiFixture({ role: "ops_admin" });
  for (const body of actions) assert.equal((await fixture.api.POST(request(body))).status, 200);
  assert.deepEqual(fixture.calls.map(call => call.name), ["config", "viewer", "role", "start", "config", "viewer", "role", "progress",
    "config", "viewer", "role", "complete", "workflow", "config", "viewer", "role", "requirement"]);
  fixture.setFailure(new fixture.AccessError("Membership is required."));
  assert.equal((await fixture.api.POST(request(actions[0]))).status, 403);
  fixture.setFailure(new fixture.repository.CircleRequiredForFoundationCompletionError());
  assert.equal((await fixture.api.POST(request(actions[2]))).status, 409);
  fixture.setFailure(new fixture.repository.FoundationSequenceError());
  assert.equal((await fixture.api.POST(request(actions[1]))).status, 409);
});

test("open API retains identity and request validation then dispatches only supported actions", async () => {
  const unauthenticated = await apiFixture({ launched: true, authenticated: false });
  assert.equal((await unauthenticated.api.POST(request(actions[0]))).status, 401);
  assert.deepEqual(unauthenticated.calls.map(call => call.name), ["config", "viewer"]);
  const fixture = await apiFixture({ launched: true });
  assert.equal((await fixture.api.POST(request({ action: "complete", memberId: "other" }))).status, 400);
  assert.deepEqual(fixture.calls.map(call => call.name), ["config"]);
  fixture.calls.length = 0;
  for (const body of actions) assert.equal((await fixture.api.POST(request(body))).status, 200);
  assert.deepEqual(fixture.calls.map(call => call.name), ["config", "viewer", "start", "config", "viewer", "progress",
    "config", "viewer", "complete", "workflow", "config", "viewer", "requirement"]);
  fixture.setFailure(new fixture.AccessError("Membership is required."));
  assert.equal((await fixture.api.POST(request(actions[0]))).status, 403);
  fixture.setFailure(new fixture.gate.FoundationsNotLaunchedError());
  assert.equal((await fixture.api.POST(request(actions[0]))).status, 423);
});

async function repositoryFixture({ launched = false, role = null } = {}) {
  const calls = [];
  const gate = availability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) }, {
    getOperatorRole: async id => { calls.push(`role:${id}`); return role; },
  });
  const query = async () => { calls.push("query"); return []; };
  query.begin = async work => { calls.push("transaction"); return work(query); };
  const repository = await load("src/lib/foundations/repository.ts", {
    "server-only": {}, "node:crypto": {},
    "@/lib/foundations/availability": gate,
    "@/lib/database/server": { getApplicationDatabase: () => { calls.push("database"); return query; } },
    "@/lib/membership/access-policy": { deriveMemberAccessPolicy: () => ({}), memberCan: () => false },
    "@/lib/membership/repository": { getMemberIdentity: async () => { calls.push("identity"); return null; } },
    "@/lib/platform/calendar-audience-invalidation": {},
  });
  return { gate, repository, calls };
}

test("direct Foundations repository reads and writes cannot trust viewer roles or completed state", async () => {
  const { gate, repository, calls } = await repositoryFixture();
  const viewer = { authUserId: "operator", roles: ["ops_admin"], foundationsState: "completed" };
  for (const work of [() => repository.getMemberFoundationsState("operator"), () => repository.startMemberFoundations(viewer),
    () => repository.recordMemberFoundationProgress(viewer, "last-moment"), () => repository.completeMemberFoundations(viewer)]) {
    await assert.rejects(work, gate.FoundationsNotLaunchedError);
  }
  assert.deepEqual(calls, Array(4).fill("role:operator"));
});

test("the Administrator exception and global launch both retain repository member eligibility checks", async () => {
  for (const options of [{ launched: true }, { role: "ops_admin" }]) {
    const { repository, calls } = await repositoryFixture(options);
    const roleRead = options.role ? ["role:unknown"] : [];
    await assert.rejects(() => repository.getMemberFoundationsState("unknown"), repository.FoundationAccessError);
    assert.deepEqual(calls, [...roleRead, "identity"]);
    calls.length = 0;
    for (const work of [() => repository.startMemberFoundations({ authUserId: "unknown" }),
      () => repository.recordMemberFoundationProgress({ authUserId: "unknown" }, "story"),
      () => repository.completeMemberFoundations({ authUserId: "unknown" })]) await assert.rejects(work, repository.FoundationAccessError);
    assert.deepEqual(calls, Array(3).fill([...roleRead, "database", "transaction", "query"]).flat());
  }
});

test("future-letter completion verifies the actual owner before membership work while timeline remains independent", async () => {
  const gate = availability({}, { getOperatorRole: async id => id === "administrator" ? "ops_admin" : null });
  let databaseCalls = 0;
  const databaseSentinel = new Error("Reached the existing membership check");
  const repository = await load("src/lib/membership/repository.ts", {
    "server-only": {}, "./badge-repository": {}, "libphonenumber-js/min": {},
    "./registration-repository": existingMemberRegistration,
    ...existingMemberIntakeDependencies,
    "@/lib/foundations/availability": gate,
    "@/lib/database/server": { getApplicationDatabase: () => { databaseCalls++; throw databaseSentinel; } },
    "@/lib/events/member-experiences": {}, "@/lib/events/community-event-repository": {}, "@/lib/google/communications": {},
    "@/lib/membership/access-policy": {}, "@/lib/membership/artifact-products": {}, "@/lib/membership/avatar-url": {},
    "@/lib/membership/phone": {}, "@/lib/membership/member-tag": {}, "@/lib/platform/ops-calendar-repository": {},
    "@/lib/platform/calendar-audience-invalidation": {}, "@/lib/platform/experience-member-access": {},
  });
  await assert.rejects(() => repository.completeMemberFoundationRequirement("member", "future_letter"), gate.FoundationsNotLaunchedError);
  assert.equal(databaseCalls, 0);
  await assert.rejects(() => repository.completeMemberFoundationRequirement("administrator", "future_letter"), error => error === databaseSentinel);
  assert.equal(databaseCalls, 1);
  await assert.rejects(() => repository.completeMemberFoundationRequirement("member", "timeline"), error => error === databaseSentinel);
  assert.equal(databaseCalls, 2);
});
