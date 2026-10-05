import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import test from "node:test";
import ts from "typescript";

function fixture({ env = {}, platform = "connected", reconcileError = false, digest = { enabled: true, ready: true } } = {}) {
  const calls = [];
  const environment = { CRON_SECRET: "test-worker-secret", NODE_ENV: "production", VERCEL_ENV: "production", OPERATOR_REGISTRATION_WORK_ENABLED: "true", ...env };
  const dependencies = {
    "node:crypto": { timingSafeEqual },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: platform }) },
    "@/lib/platform/registration-work-repository": { reconcileRegistrationOperatorWork: async () => {
      calls.push("reconcile"); if (reconcileError) throw new Error("PRIVATE FAILURE DETAIL");
      return { created: 1, updated: 0, resolved: 0 };
    } },
    "@/lib/platform/work-queue-digest-delivery": { processWorkQueueDigestBatch: async () => { calls.push("digest"); return digest; } },
  };
  const output = ts.transpileModule(readFileSync(new URL("../app/api/internal/ops/work-summary/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "console", output)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, loaded, loaded.exports, { env: environment }, { error: () => {} });
  const request = (token = "test-worker-secret") => new Request("https://members.theruinedproject.com/api/internal/ops/work-summary", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { route: loaded.exports, request, calls };
}

test("summary cron rejects missing/wrong authorization before any private work", async () => {
  for (const token of [null, "wrong", "test-worker-secreT"]) {
    const f = fixture();
    const response = await f.route.GET(f.request(token));
    assert.equal(response.status, 401); assert.deepEqual(f.calls, []);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  const unconfigured = fixture({ env: { CRON_SECRET: "" } });
  assert.equal((await unconfigured.route.GET(unconfigured.request())).status, 401);
});

test("preview/development and disconnected servers cannot reconcile tasks or send summaries", async () => {
  for (const configuration of [{ env: { NODE_ENV: "development" } }, { env: { PLATFORM_MODE: "preview" } }, { env: { VERCEL_ENV: "preview" } }, { env: { VERCEL_ENV: undefined } }, { platform: "preview" }, { platform: "unavailable" }]) {
    const f = fixture(configuration);
    assert.equal((await (await f.route.GET(f.request())).json()).enabled, false);
    assert.deepEqual(f.calls, []);
  }
});

test("authorized scheduled summary reconciles registrations before reading/sending the queue", async () => {
  const f = fixture();
  assert.equal((await f.route.POST(f.request())).status, 200);
  assert.deepEqual(f.calls, ["reconcile", "digest"]);
  const disabled = fixture({ env: { OPERATOR_REGISTRATION_WORK_ENABLED: "false" }, digest: { enabled: false, ready: false } });
  assert.equal((await disabled.route.GET(disabled.request())).status, 200);
  assert.deepEqual(disabled.calls, ["digest"]);
});

test("reconciliation failure never sends a stale all-clear summary or leaks private failure details", async () => {
  const f = fixture({ reconcileError: true });
  const response = await f.route.GET(f.request());
  assert.equal(response.status, 503); assert.deepEqual(f.calls, ["reconcile"]);
  assert.doesNotMatch(await response.text(), /PRIVATE/);
  const unavailable = fixture({ digest: { enabled: true, ready: false } });
  assert.equal((await unavailable.route.GET(unavailable.request())).status, 503);
});
