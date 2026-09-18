import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), member = id(2), cleanup = id(3);
const endpoint = `https://members.example.test/api/ops/members/${member}/deletion`;
const context = value => ({ params: Promise.resolve({ memberId: value ?? member }) });
const payload = { confirmationEmail: "test@example.test", expectedLifecycleVersion: 7, reason: "test_account" };
const eligibility = { allowed: true, blockers: [], confirmationEmail: payload.confirmationEmail, memberName: "Test member", lifecycleVersion: 7 };

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => {
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

async function fixture() {
  const state = { viewer: { authUserId: actor }, queries: [], cleanupCalls: [], logs: [], configured: true, database: null, cleanupError: null };
  const session = { getCurrentPlatformViewer: async () => state.viewer };
  const requestPolicy = await load("src/lib/auth/request.ts", {}, { process: { env: { NODE_ENV: "production" } } });
  const api = await load("src/lib/platform/ops-api.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/request": requestPolicy, "@/lib/auth/session": session,
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: class extends Error {} },
  });
  const sql = async (strings, ...values) => {
    const query = strings.join("?"); state.queries.push({ query, values });
    if (state.database) return state.database(query, values);
    return [{ deletion: query.includes("ruined_delete_member(") ? { deleted: true, cleanupId: cleanup } : eligibility }];
  };
  const repository = await load("src/lib/platform/member-deletion-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/platform/member-deletion-cleanup": { memberDeletionCleanupConfigured: () => state.configured },
  });
  const route = await load("app/api/ops/members/[memberId]/deletion/route.ts", {
    "@/lib/auth/session": session, "@/lib/platform/ops-api": api,
    "@/lib/platform/member-deletion-repository": repository,
    "@/lib/platform/member-deletion-cleanup": { processMemberDeletionCleanupBatch: async (...args) => {
      state.cleanupCalls.push(args); if (state.cleanupError) throw state.cleanupError;
      return { claimed: 1, completed: 0, deferred: 1, failed: 0 };
    } },
  }, { console: { error: (...args) => state.logs.push(args) } });
  return { state, route, repository };
}

function request(body = payload, headers = {}) {
  return new Request(endpoint, { method: "DELETE", headers: { origin: new URL(endpoint).origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function responseStatus(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

test("deletion eligibility requires authentication and database administrator authorization and is never cached", async () => {
  const { state, route } = await fixture();
  state.viewer = null;
  await responseStatus(await route.GET(new Request(endpoint), context()), 401);
  assert.equal(state.queries.length, 0);
  state.viewer = { authUserId: actor };
  state.database = () => { throw Object.assign(new Error("Administrator access is required."), { code: "PT403" }); };
  await responseStatus(await route.GET(new Request(endpoint), context()), 403);
  assert.deepEqual(state.queries[0].values, [actor, member]);
  state.database = null;
  assert.deepEqual(await responseStatus(await route.GET(new Request(endpoint), context()), 200), { deletion: eligibility });
  assert.equal(route.dynamic, "force-dynamic"); assert.equal(route.runtime, "nodejs");
  assert.equal(state.cleanupCalls.length, 0);
});

test("deletion uses the real mutation origin, authentication and JSON guards before reading or changing records", async () => {
  const { state, route } = await fixture();
  await responseStatus(await route.DELETE(request(payload, { origin: "https://attacker.example.test" }), context()), 403);
  state.viewer = null;
  await responseStatus(await route.DELETE(request(), context()), 401);
  state.viewer = { authUserId: actor };
  await responseStatus(await route.DELETE(request(payload, { "content-type": "text/plain" }), context()), 415);
  const noOrigin = request(); noOrigin.headers.delete("origin");
  await responseStatus(await route.DELETE(noOrigin, context()), 403);
  assert.equal(state.queries.length, 0); assert.equal(state.cleanupCalls.length, 0);
  state.database = () => { throw Object.assign(new Error("Administrator access is required."), { code: "PT403" }); };
  await responseStatus(await route.DELETE(request(), context()), 403);
  assert.equal(state.cleanupCalls.length, 0, "an authenticated non-administrator cannot trigger provider deletion");
});

test("malformed payloads, identity injection, invalid versions and reasons fail before SQL or providers", async () => {
  const { state, route } = await fixture();
  for (const body of [null, [], "delete", {}, { ...payload, actorId: actor }, { ...payload, memberId: member },
    { ...payload, reason: "remove_everything" }, { ...payload, confirmationEmail: " " }, { ...payload, confirmationEmail: "x".repeat(255) },
    ...[0, -1, 1.5, "7", Number.MAX_SAFE_INTEGER + 1].map(expectedLifecycleVersion => ({ ...payload, expectedLifecycleVersion }))]) {
    await responseStatus(await route.DELETE(request(body), context()), 400);
  }
  await responseStatus(await route.DELETE(new Request(endpoint, { method: "DELETE", headers: { origin: new URL(endpoint).origin, "content-type": "application/json" }, body: "{" }), context()), 400);
  await responseStatus(await route.DELETE(request(), context("not-a-member")), 400);
  assert.equal(state.queries.length, 0); assert.equal(state.cleanupCalls.length, 0);
});

test("confirmation/version conflicts and missing records map safely without provider deletion", async () => {
  const { state, route } = await fixture();
  for (const [code, status, message] of [["PT400",400,"Invalid request."],["PT404",404,"Member not found."],["PT409",409,"The email does not match."],["PT409",409,"The member record changed."]]) {
    state.database = () => { throw Object.assign(new Error(message), { code }); };
    assert.deepEqual(await responseStatus(await route.DELETE(request(), context()), status), { error: message });
  }
  state.database = () => { throw new Error("PRIVATE DATABASE CONNECTION DETAILS"); };
  const failure = await responseStatus(await route.DELETE(request(), context()), 503);
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE/);
  assert.doesNotMatch(JSON.stringify(state.logs), /PRIVATE/);
  assert.equal(state.cleanupCalls.length, 0);
});

test("provider cleanup starts only after a successful committed SQL result and uses its exact job id", async () => {
  const { state, route } = await fixture();
  let commit, entered;
  const committed = new Promise(resolve => { commit = resolve; });
  const sqlEntered = new Promise(resolve => { entered = resolve; });
  state.database = async (_query, values) => { assert.deepEqual(values, [actor, member, 7, "test@example.test", "duplicate_account"]); entered(); return committed; };
  const response = route.DELETE(request({ ...payload, confirmationEmail: "  TEST@example.test  ", reason: "duplicate_account" }), context());
  await sqlEntered;
  assert.equal(state.cleanupCalls.length, 0);
  commit([{ deletion: { deleted: true, cleanupId: cleanup } }]);
  assert.deepEqual(await responseStatus(await response, 200), { deleted: true, cleanupPending: true });
  assert.deepEqual(state.cleanupCalls, [[1, cleanup]]);
});

test("provider outage after deletion reports successful removal with durable cleanup pending", async () => {
  const { state, route } = await fixture();
  state.cleanupError = new Error("PRIVATE PROVIDER SECRET");
  assert.deepEqual(await responseStatus(await route.DELETE(request(), context()), 200), { deleted: true, cleanupPending: true });
  assert.equal(state.queries.length, 1); assert.equal(state.cleanupCalls.length, 1);
  assert.doesNotMatch(JSON.stringify(state.logs), /PRIVATE/);
});

test("unconfigured cleanup disables eligibility and rejects deletion without a database write", async () => {
  const { state, route } = await fixture(); state.configured = false;
  const body = await responseStatus(await route.GET(new Request(endpoint), context()), 200);
  assert.equal(body.deletion.allowed, false); assert.ok(body.deletion.blockers.length);
  state.queries.length = 0;
  await responseStatus(await route.DELETE(request(), context()), 503);
  assert.equal(state.queries.length, 0); assert.equal(state.cleanupCalls.length, 0);
});
