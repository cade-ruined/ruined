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
const availability = env => load("src/lib/foundations/availability.ts", { "server-only": {} }, env);
const actions = [{ action: "start" }, { action: "progress", momentId: "story" }, { action: "complete" },
  { action: "complete_requirement", requirement: "future_letter" }];
const request = body => new Request("https://members.example.test/api/my/foundations", {
  method: "POST", headers: { "content-type": "application/json", origin: "https://members.example.test" }, body: JSON.stringify(body),
});

test("Foundations is closed by default across environments and needs an explicit true flag", async () => {
  for (const NODE_ENV of ["development", "test", "production"]) {
    for (const flag of [undefined, "", "false", "1", "yes", "on", "true-ish"]) {
      const gate = await availability({ NODE_ENV, MEMBERSHIP_FOUNDATIONS_LAUNCHED: flag,
        STRIPE_MEMBERSHIP_LIVE_ENABLED: "true", STRIPE_MEMBERSHIP_PAYMENT_SETUP_ENABLED: "true" });
      assert.equal(gate.isFoundationsLaunched(), false);
      assert.throws(() => gate.requireFoundationsLaunched(), gate.FoundationsNotLaunchedError);
    }
    for (const flag of ["true", " TRUE ", "TrUe"]) {
      const gate = await availability({ NODE_ENV, MEMBERSHIP_FOUNDATIONS_LAUNCHED: flag });
      assert.equal(gate.isFoundationsLaunched(), true);
      assert.doesNotThrow(() => gate.requireFoundationsLaunched());
    }
  }
});

async function apiFixture({ launched = false, trusted = true, authenticated = true, mode = "connected" } = {}) {
  const calls = [];
  const gate = await availability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) });
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
  return { api, calls, gate, AccessError, setFailure: value => { failure = value; } };
}

test("closed API blocks every action, including forged completed state, before identity or repository work", async () => {
  for (const mode of ["connected", "preview"]) {
    const fixture = await apiFixture({ mode });
    for (const body of [...actions, { action: "complete", state: "completed", memberId: "other", percent: 100 }]) {
      const response = await fixture.api.POST(request(body));
      assert.equal(response.status, 423);
      assert.deepEqual(await response.json(), { code: "foundations_not_launched", error: "Foundations is not open yet." });
    }
    assert.deepEqual(fixture.calls, []);
  }
});

test("untrusted requests remain forbidden even when Foundations is closed", async () => {
  const fixture = await apiFixture({ trusted: false });
  const response = await fixture.api.POST(request(actions[0]));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "origin_denied");
  assert.deepEqual(fixture.calls, []);
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

async function repositoryFixture(launched) {
  const gate = await availability({ MEMBERSHIP_FOUNDATIONS_LAUNCHED: String(launched) });
  const calls = [];
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

test("direct Foundations repository reads and writes cannot bypass the closed flag with operator or completion state", async () => {
  const { gate, repository, calls } = await repositoryFixture(false);
  const viewer = { authUserId: "operator", roles: ["ops_admin"], foundationsState: "completed" };
  for (const work of [() => repository.getMemberFoundationsState("operator"), () => repository.startMemberFoundations(viewer),
    () => repository.recordMemberFoundationProgress(viewer, "last-moment"), () => repository.completeMemberFoundations(viewer)]) {
    await assert.rejects(work, gate.FoundationsNotLaunchedError);
  }
  assert.deepEqual(calls, []);
});

test("opening Foundations retains repository member eligibility checks", async () => {
  const { repository, calls } = await repositoryFixture(true);
  await assert.rejects(() => repository.getMemberFoundationsState("unknown"), repository.FoundationAccessError);
  assert.deepEqual(calls, ["identity"]);
  calls.length = 0;
  for (const work of [() => repository.startMemberFoundations({ authUserId: "unknown" }),
    () => repository.recordMemberFoundationProgress({ authUserId: "unknown" }, "story"),
    () => repository.completeMemberFoundations({ authUserId: "unknown" })]) await assert.rejects(work, repository.FoundationAccessError);
  assert.deepEqual(calls, Array(3).fill(["database", "transaction", "query"]).flat());
});

test("future-letter completion is gated before shared repository database work while timeline remains independent", async () => {
  const gate = await availability({});
  let databaseCalls = 0;
  const databaseSentinel = new Error("Reached the existing membership check");
  const repository = await load("src/lib/membership/repository.ts", {
    "server-only": {}, "./badge-repository": {}, "libphonenumber-js/min": {},
    "@/lib/foundations/availability": gate,
    "@/lib/database/server": { getApplicationDatabase: () => { databaseCalls++; throw databaseSentinel; } },
    "@/lib/events/member-experiences": {}, "@/lib/events/community-event-repository": {}, "@/lib/google/communications": {},
    "@/lib/membership/access-policy": {}, "@/lib/membership/artifact-products": {}, "@/lib/membership/avatar-url": {},
    "@/lib/membership/phone": {}, "@/lib/membership/member-tag": {}, "@/lib/platform/ops-calendar-repository": {},
    "@/lib/platform/calendar-audience-invalidation": {}, "@/lib/platform/experience-member-access": {},
  });
  await assert.rejects(() => repository.completeMemberFoundationRequirement("operator", "future_letter"), gate.FoundationsNotLaunchedError);
  assert.equal(databaseCalls, 0);
  await assert.rejects(() => repository.completeMemberFoundationRequirement("member", "timeline"), error => error === databaseSentinel);
  assert.equal(databaseCalls, 1);
});
