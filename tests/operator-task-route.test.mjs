import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture({ trusted = true, viewer = { authUserId: "signed-in-operator" }, failure = null } = {}) {
  const calls = [];
  const logs = [];
  class OpsOperatingRepositoryError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const repository = {
    OpsOperatingRepositoryError,
    transitionOpsTask: async (input) => {
      calls.push(input);
      if (failure) {
        if (failure.code) throw new OpsOperatingRepositoryError(failure.code, failure.message);
        throw new Error(failure.message);
      }
      return { id: input.taskId, state: "open", version: input.expectedVersion + 1 };
    },
  };
  const dependencies = {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/ops-operating-repository": repository,
  };
  function load(path) {
    const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", "console", output)((name) => {
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    }, loaded, loaded.exports, { error: (...args) => logs.push(args) });
    return loaded.exports;
  }
  dependencies["@/lib/platform/ops-api"] = load("../src/lib/platform/ops-api.ts");
  const route = load("../app/api/ops/tasks/[taskId]/route.ts");
  const run = (body, contentType = "application/json") => route.PATCH(new Request("https://members.theruinedproject.com/api/ops/tasks/task-one", {
    method: "PATCH",
    headers: { "content-type": contentType },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ taskId: "task-one" }) });
  return { run, calls, logs };
}

test("task route uses the authenticated operator and ignores client-supplied ownership", async () => {
  const f = fixture();
  const response = await f.run({
    action: "unclaim", expectedVersion: 7,
    actorAuthUserId: "someone-else", assignedToAuthUserId: "someone-else",
    claimedByCurrentOperator: true, claimedByName: "Forged Name",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(f.calls, [{ action: "unclaim", expectedVersion: 7, actorAuthUserId: "signed-in-operator", taskId: "task-one" }]);
  assert.deepEqual(await response.json(), { task: { id: "task-one", state: "open", version: 8 } });
});

test("task route rejects untrusted, signed-out, and non-JSON requests before changing ownership", async () => {
  for (const [options, contentType, status] of [
    [{ trusted: false }, "application/json", 403],
    [{ viewer: null }, "application/json", 401],
    [{}, "text/plain", 415],
  ]) {
    const f = fixture(options);
    const response = await f.run({ action: "complete", expectedVersion: 1 }, contentType);
    assert.equal(response.status, status);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(f.calls, []);
  }
});

test("task ownership and stale-version errors retain the repository's safe status and message", async () => {
  for (const [code, status, message] of [
    ["forbidden", 403, "Only the person who claimed this task can complete it."],
    ["conflict", 409, "This task has changed. Refresh and try again."],
    ["invalid", 400, "A task version is required."],
    ["not_found", 404, "The task could not be found."],
  ]) {
    const f = fixture({ failure: { code, message } });
    const response = await f.run({ action: "complete", expectedVersion: 2 });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: message });
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(f.logs, []);
  }
});

test("task route does not invent a version for old clients and conceals unexpected error details", async () => {
  for (const body of [null, [], { action: "complete" }, ...[null, "2", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(expectedVersion => ({ action: "complete", expectedVersion }))]) {
    const invalid = fixture();
    assert.equal((await invalid.run(body)).status, 400);
    assert.deepEqual(invalid.calls, []);
  }

  const failed = fixture({ failure: { message: "PRIVATE DATABASE DETAIL" } });
  const response = await failed.run({ action: "claim", expectedVersion: 1 });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE/);
  assert.doesNotMatch(JSON.stringify(failed.logs), /PRIVATE/);
});
