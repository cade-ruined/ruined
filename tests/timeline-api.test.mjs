import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/api/my/timeline/route.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
class MembershipAccessDeniedError extends Error {}
class MembershipConflictError extends Error {}
class MembershipInputError extends Error {}
function fixture({ authenticated = true, mode = "connected", denied = false } = {}) {
  const calls = [];
  const timeline = { entries: [], revision: "5", completedAt: null, access: {} };
  const dependencies = {
    "next/server": { NextResponse: { json: (data, options) => Response.json(data, options) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: (request) => request.headers.get("origin") === "https://members.example.test" },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => authenticated ? { authUserId: "verified-account" } : null },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode }) },
    "@/lib/membership/repository": {
      MembershipAccessDeniedError, MembershipConflictError, MembershipInputError,
      completeMemberFoundationRequirement: async (auth, requirement) => {
        calls.push(["complete", auth, requirement]);
        return { timeline: { completed: true } };
      },
      getMemberTimeline: async (auth) => {
        calls.push(["read", auth]);
        if (denied) throw new MembershipAccessDeniedError("Access denied");
        return timeline;
      },
      saveMemberTimeline: async (auth, entries, revision) => {
        calls.push(["save", auth, entries, revision]);
        if (revision !== "5") throw new MembershipConflictError("Load latest saved events");
        return timeline;
      },
      upsertMemberTimelineEntry: async (auth, entry, revision) => {
        calls.push(["upsert", auth, entry, revision]);
        if (denied) throw new MembershipAccessDeniedError("Access denied");
        if (revision !== "5") throw new MembershipConflictError("Load latest saved events");
        return timeline;
      },
      deleteMemberTimelineEntry: async (auth, id, revision) => {
        calls.push(["delete", auth, id, revision]);
        if (denied) throw new MembershipAccessDeniedError("Access denied");
        if (revision !== "5") throw new MembershipConflictError("Load latest saved events");
        return timeline;
      },
    },
  };
  const cjs = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, cjs, cjs.exports);
  return { ...cjs.exports, calls, timeline };
}
function request(body, origin = "https://members.example.test") {
  return new Request("https://members.example.test/api/my/timeline", {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });
}

test("Timeline reload uses only verified account identity and disables shared caching", async () => {
  const f = fixture();
  const response = await f.GET(new Request("https://members.example.test/api/my/timeline"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { timeline: f.timeline });
  assert.deepEqual(f.calls, [["read", "verified-account"]]);
});

test("Timeline reload cannot bypass sign-in, disconnected mode, or repository access denial", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ mode: "preview" }, 503], [{ denied: true }, 403]]) {
    const f = fixture(options);
    assert.equal((await f.GET(new Request("https://members.example.test/api/my/timeline"))).status, status);
    if (!options.denied) assert.equal(f.calls.length, 0);
  }
});

test("Timeline save forwards the expected revision and treats missing/stale clients as conflicts", async () => {
  const f = fixture();
  assert.equal((await f.POST(request({ action: "save", entries: [], expectedRevision: "5" }))).status, 200);
  assert.deepEqual(f.calls[0], ["save", "verified-account", [], "5"]);
  for (const payload of [{ action: "save", entries: [] }, { action: "save", entries: [], expectedRevision: "4" }]) {
    assert.equal((await f.POST(request(payload))).status, 409);
  }
});

test("Timeline save rejects foreign origins, unsigned users, invalid revisions and injected member IDs", async () => {
  const payload = { action: "save", entries: [], expectedRevision: "5" };
  const f = fixture();
  assert.equal((await f.POST(request(payload, "https://outside.example.test"))).status, 403);
  assert.equal((await f.POST(request({ ...payload, memberId: "another-member" }))).status, 400);
  assert.equal((await f.POST(request({ ...payload, expectedRevision: 5 }))).status, 400);
  const unsigned = fixture({ authenticated: false });
  assert.equal((await unsigned.POST(request(payload))).status, 401);
  assert.equal(f.calls.length + unsigned.calls.length, 0);
});

test("Timeline accepts optional months without collapsing omission into explicit clearing", async () => {
  for (const month of [undefined, null, 1, 9, 12]) {
    const f = fixture();
    const entry = { id: null, title: "A beginning", year: 2020, details: null, ...(month === undefined ? {} : { month }) };
    const response = await f.POST(request({ action: "save", entries: [entry], expectedRevision: "5" }));
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls, [["save", "verified-account", [entry], "5"]]);
    assert.equal(Object.hasOwn(f.calls[0][2][0], "month"), month !== undefined);
  }
});

test("Timeline rejects noninteger, out-of-range and nonnumeric months before invoking persistence", async () => {
  for (const month of [0, -1, 13, 1.5, "1", "", true, [], {}]) {
    const f = fixture();
    const response = await f.POST(request({ action: "save", entries: [{ id: null, title: "A beginning", year: 2020, details: null, month }], expectedRevision: "5" }));
    assert.equal(response.status, 400);
    assert.deepEqual(f.calls, []);
  }
});

test("single moment upsert and deletion use verified ownership, revision and private snapshots", async () => {
  const entry = { id: null, year: 2020, month: 9, title: "A moment", details: null };
  for (const payload of [{ action: "upsert", entry }, { action: "delete", id: "entry-id" }]) {
    const f = fixture();
    const response = await f.POST(request({ ...payload, expectedRevision: "5" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { timeline: f.timeline });
    assert.deepEqual(f.calls, [[payload.action, "verified-account", payload.entry ?? payload.id, "5"]]);
    for (const expectedRevision of [undefined, "4"]) {
      assert.equal((await fixture().POST(request({ ...payload, expectedRevision }))).status, 409);
    }
    assert.equal((await fixture({ authenticated: false }).POST(request(payload))).status, 401);
    assert.equal((await fixture({ denied: true }).POST(request({ ...payload, expectedRevision: "5" }))).status, 403);
    const foreign = fixture();
    assert.equal((await foreign.POST(request(payload, "https://outside.example.test"))).status, 403);
    assert.deepEqual(foreign.calls, []);
    assert.equal((await fixture().POST(request({ ...payload, memberId: "someone-else", expectedRevision: "5" }))).status, 400);
  }
});

test("Timeline compatibility save accepts more than50 entries; single-moment actions reject injected fields", async () => {
  const f = fixture();
  const entry = { id: null, year: 2020, title: "A moment", details: null };
  assert.equal((await f.POST(request({ action: "save", entries: Array.from({ length: 120 }, () => entry), expectedRevision: "5" }))).status, 200);
  assert.equal(f.calls[0][2].length, 120);
  for (const payload of [
    { action: "upsert", entry: { ...entry, month: 13 } }, { action: "upsert", entry: { ...entry, memberId: "other" } },
    { action: "upsert", entry: null }, { action: "delete", id: null }, { action: "delete", id: "id", entries: [] },
  ]) assert.equal((await fixture().POST(request({ ...payload, expectedRevision: "5" }))).status, 400);
});

test("Timeline bounds actual request bytes, including chunked/lying lengths, before parsing or persistence", async () => {
  for (const declared of [undefined, "1"]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(250_001)); },
      cancel() { cancelled = true; },
    });
    const f = fixture();
    const response = await f.POST(new Request("https://members.example.test/api/my/timeline", {
      method: "POST", body: stream, duplex: "half",
      headers: { origin: "https://members.example.test", "content-type": "application/json", ...(declared ? { "content-length": declared } : {}) },
    }));
    assert.equal(response.status, 413);
    assert.equal(cancelled, true);
    assert.deepEqual(f.calls, []);
  }
  for (const declared of ["250001", "-1", "NaN", "Infinity"]) {
    const f = fixture();
    const req = request({ action: "complete" });
    req.headers.set("content-length", declared);
    assert.equal((await f.POST(req)).status, 413);
    assert.deepEqual(f.calls, []);
  }
});


test("Timeline owner headers block stale-account reads, saves, deletion and Foundations completion", async () => {
  const f = fixture();
  const changedGet = await f.GET(new Request("https://members.example.test/api/my/timeline", { headers: { "x-ruined-session-owner": "old-account" } }));
  assert.equal(changedGet.status, 409);
  assert.equal(changedGet.headers.get("cache-control"), "private, no-store");
  assert.equal(changedGet.headers.get("vary"), "Cookie");
  const entry = { id: null, title: "Private old account moment", year: 2020, details: null };
  for (const body of [
    { action: "complete" }, { action: "save", entries: [], expectedRevision: "5" },
    { action: "upsert", entry, expectedRevision: "5" }, { action: "delete", id: "existing-entry", expectedRevision: "5" },
  ]) {
    const req = request(body); req.headers.set("x-ruined-session-owner", "old-account");
    const response = await f.POST(req);
    assert.equal(response.status, 409); assert.equal(response.headers.get("vary"), "Cookie");
  }
  assert.equal(f.calls.length, 0);
  for (const owner of [null, "verified-account"]) {
    const req = request({ action: "complete" }); if (owner) req.headers.set("x-ruined-session-owner", owner);
    assert.equal((await f.POST(req)).status, 200);
    const get = new Request("https://members.example.test/api/my/timeline"); if (owner) get.headers.set("x-ruined-session-owner", owner);
    assert.equal((await f.GET(get)).status, 200);
  }
  assert.deepEqual(f.calls, [["complete", "verified-account", "timeline"], ["read", "verified-account"], ["complete", "verified-account", "timeline"], ["read", "verified-account"]]);
});
