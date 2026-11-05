import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const model = load("src/lib/membership/member-search-model.ts");

function fixture(behaviors, readError = null) {
  const pools = [], timers = new Set(), durations = [], logs = [], seen = [];
  let sharedReads = 0;
  const shared = () => { sharedReads++; return new Promise(() => {}); };
  shared.end = () => { throw new Error("The shared write pool must remain untouched"); };
  const globals = {
    process: { env: { DATABASE_URL: "postgres://isolated-test" } },
    globalThis: { ruinedApplicationDatabase: shared },
    console: { error: (message, details) => logs.push({ message, details }) },
    setTimeout: (callback, duration) => {
      durations.push(duration);
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, 5);
      timers.add(timer); return timer;
    },
    clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); },
  };
  const database = load("src/lib/database/server.ts", {
    "node:async_hooks": { AsyncLocalStorage },
    postgres: () => {
      const behavior = behaviors[pools.length] ?? {};
      const pending = new Set();
      const sql = () => behavior.hang ? new Promise((_, reject) => pending.add(reject)) : Promise.resolve([]);
      sql.closed = [];
      sql.end = async options => {
        sql.closed.push(options);
        for (const reject of pending) reject(new Error("Owned connection terminated"));
        pending.clear();
      };
      pools.push(sql); return sql;
    },
  }, globals);
  const route = load("app/api/my/members/route.ts", {
    "next/server": require("next/server"),
    "@/lib/auth/session": { resolveCurrentPlatformSession: async () => ({ status: "authenticated", viewer: { authUserId: "verified-actor" } }) },
    "@/lib/database/server": database,
    "@/lib/membership/member-search-model": model,
    "@/lib/membership/member-search-repository": { getMemberSearch: async (authUserId, query, page) => {
      assert.equal(authUserId, "verified-actor");
      const sql = database.getApplicationDatabase();
      seen.push(sql);
      if (readError) throw readError;
      const results = await sql`select only_public_member_fields`;
      return { query, page, results, hasMore: false };
    } },
  }, { console: globals.console });
  return { database, pools, timers, durations, logs, seen, shared, sharedReads: () => sharedReads,
    get: () => route.GET(new Request("https://members.example.test/api/my/members?q=%40cade&page=1")) };
}

test("member search API bypasses a stalled shared pool and recovers a stalled owned read", { timeout: 5_000 }, async () => {
  for (const behaviors of [[{}], [{ hang: true }, {}]]) {
    const f = fixture(behaviors);
    const response = await f.get();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { query: "cade", page: 1, results: [], hasMore: false });
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.equal(f.sharedReads(), 0, "the persistent shared pool is never used for this request");
    assert.equal(f.database.getApplicationDatabase(), f.shared, "outside work keeps its original database");
    assert.deepEqual(f.seen, f.pools, "each retry receives its own database scope");
    assert.equal(f.pools.length, behaviors.length);
    assert.ok(f.pools.every(pool => JSON.stringify(pool.closed) === JSON.stringify([{ timeout: 0 }])));
    assert.equal(f.timers.size, 0);
    assert.ok(f.logs.every(log => log.details.stage === "member-search"));
  }
});

test("two stalled API reads return a bounded generic 503 and close only their owned pools", { timeout: 5_000 }, async () => {
  const f = fixture([{ hang: true }, { hang: true }]);
  const response = await f.get();
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Member search is temporarily unavailable/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(f.sharedReads(), 0);
  assert.equal(f.pools.length, 2);
  assert.ok(f.pools.every(pool => pool.closed.length === 1));
  assert.deepEqual(f.durations, [8_000, 1_000, 8_000, 1_000]);
  assert.equal(f.timers.size, 0);
  assert.doesNotMatch(JSON.stringify(f.logs), /postgres:\/\/|only_public_member_fields|verified-actor/);
});

test("access denial and SQL errors retain status semantics without retrying the API read", { timeout: 5_000 }, async () => {
  for (const [error, status] of [
    [new model.MemberSearchError(403, "Active member access is required."), 403],
    [Object.assign(new Error("PRIVATE database details"), { code: "42501" }), 503],
  ]) {
    const f = fixture([{}], error);
    const response = await f.get();
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /PRIVATE|42501/);
    assert.equal(f.pools.length, 1);
    assert.equal(f.pools[0].closed.length, 1);
    assert.equal(f.sharedReads(), 0);
    assert.equal(f.timers.size, 0);
  }
});
