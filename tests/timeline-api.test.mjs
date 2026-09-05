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
  const response = await f.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { timeline: f.timeline });
  assert.deepEqual(f.calls, [["read", "verified-account"]]);
});

test("Timeline reload cannot bypass sign-in, disconnected mode, or repository access denial", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ mode: "preview" }, 503], [{ denied: true }, 403]]) {
    const f = fixture(options);
    assert.equal((await f.GET()).status, status);
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
