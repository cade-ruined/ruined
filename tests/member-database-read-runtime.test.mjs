import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(behaviors = [], { seedShared = true } = {}) {
  const source = readFileSync(new URL("../src/lib/database/server.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const pools = [];
  const logs = [];
  const timers = new Set();
  const timerDurations = [];
  const singleton = { end() { throw new Error("The shared write pool must remain untouched"); } };
  const globalState = seedShared ? { ruinedApplicationDatabase: singleton } : {};
  const mod = { exports: {} };
  const postgres = (_url, options) => {
    const behavior = behaviors[pools.length] ?? {};
    const pending = new Set();
    const sql = () => {
      if (behavior.error) return Promise.reject(behavior.error);
      if (!behavior.hang) return Promise.resolve(behavior.value ?? "loaded");
      const query = deferred();
      pending.add(query);
      return query.promise;
    };
    sql.options = options;
    sql.ends = [];
    sql.end = async (endOptions) => {
      sql.ends.push(endOptions);
      for (const query of pending) query.reject(Object.assign(new Error("terminated"), { code: "CONNECTION_DESTROYED" }));
      if (behavior.cleanupHangs) return new Promise(() => {});
      if (behavior.cleanupError) throw behavior.cleanupError;
    };
    pools.push(sql);
    return sql;
  };
  new Function("require", "module", "exports", "process", "globalThis", "console", "setTimeout", "clearTimeout", compiled)(
    (name) => {
      if (name === "server-only") return {};
      if (name === "node:async_hooks") return { AsyncLocalStorage };
      if (name === "postgres") return postgres;
      throw new Error(`Unexpected dependency: ${name}`);
    }, mod, mod.exports,
    { env: { DATABASE_URL: "postgres://fixture" } }, globalState,
    { error: (message, details) => logs.push({ message, details }) },
    (callback, milliseconds) => {
      timerDurations.push(milliseconds);
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, 5);
      timers.add(timer);
      return timer;
    },
    (timer) => { clearTimeout(timer); timers.delete(timer); },
  );
  return { ...mod.exports, globalState, logs, pools, singleton, timerDurations, timers };
}

test("profile reads allow four connections without queuing pipelined queries on one connection", async () => {
  const f = fixture([], { seedShared: false });
  const shared = f.getApplicationDatabase();
  assert.equal(shared.options.max_pipeline, undefined, "shared write connection behavior is preserved");
  const result = await f.withFreshApplicationDatabaseRead("member-home", () => f.getApplicationDatabase()`select profile`);
  assert.equal(result, "loaded");
  assert.equal(f.pools[1].options.max_pipeline, 0, "one would still allow a second query behind the active query");
  assert.equal(f.pools[1].options.max, 4);
  assert.equal(f.pools[1].options.prepare, false);
  assert.equal(f.getApplicationDatabase(), shared);
  assert.equal(shared.ends.length, 0);
});

test("a poisoned member read retries once in a fresh pool and preserves the shared write pool", async () => {
  const f = fixture([{ hang: true }, { value: "member profile" }]);
  const seen = [];
  const result = await f.withFreshApplicationDatabaseRead("member-home", async () => {
    const sql = f.getApplicationDatabase();
    seen.push(sql);
    return sql`select profile`;
  });
  assert.equal(result, "member profile");
  assert.equal(f.pools.length, 2);
  assert.deepEqual(seen, f.pools);
  assert.notEqual(seen[0], seen[1]);
  assert.deepEqual(f.pools.map((pool) => pool.ends), [[{ timeout: 0 }], [{ timeout: 0 }]]);
  assert.equal(f.getApplicationDatabase(), f.singleton);
  assert.equal(f.globalState.ruinedApplicationDatabase, f.singleton);
  assert.deepEqual(f.logs.map((log) => log.details), [{ stage: "member-home", kind: "read_timeout" }]);
  assert.deepEqual(f.timerDurations, [8_000, 1_000, 8_000, 1_000]);
  assert.equal(f.timers.size, 0);
});

test("two stalled reads reject with a bounded timeout and close both owned pools", async () => {
  const f = fixture([{ hang: true }, { hang: true }]);
  await assert.rejects(
    f.withFreshApplicationDatabaseRead("member-home", () => f.getApplicationDatabase()`select profile`),
    (error) => error instanceof f.ApplicationDatabaseReadTimeoutError && error.code === "DATABASE_READ_TIMEOUT",
  );
  assert.equal(f.pools.length, 2);
  assert.ok(f.pools.every((pool) => pool.ends.length === 1));
  assert.equal(f.getApplicationDatabase(), f.singleton);
  assert.equal(f.timers.size, 0);
});

test("SQL, access, and synchronous callback errors propagate without replay", async () => {
  for (const error of [Object.assign(new Error("private SQL details"), { code: "42501" }), new Error("access denied")]) {
    const f = fixture([{ error }]);
    await assert.rejects(
      f.withFreshApplicationDatabaseRead("member-home", () => f.getApplicationDatabase()`select profile`),
      (received) => received === error,
    );
    assert.equal(f.pools.length, 1);
    assert.deepEqual(f.pools[0].ends, [{ timeout: 0 }]);
    assert.equal(f.logs.length, 0, "private error details are not logged by the recovery helper");
    assert.equal(f.timers.size, 0);
  }
  const f = fixture();
  const error = new Error("synchronous read error");
  await assert.rejects(f.withFreshApplicationDatabaseRead("member-home", () => { throw error; }), (received) => received === error);
  assert.equal(f.pools.length, 1);
  assert.deepEqual(f.pools[0].ends, [{ timeout: 0 }]);
});

test("concurrent member reads retain separate database scopes across awaits", async () => {
  const f = fixture();
  const firstReady = deferred();
  const secondReady = deferred();
  const first = f.withFreshApplicationDatabaseRead("member-home", async () => {
    const pool = f.getApplicationDatabase();
    firstReady.resolve();
    await secondReady.promise;
    assert.equal(f.getApplicationDatabase(), pool);
    return pool;
  });
  const second = f.withFreshApplicationDatabaseRead("member-timeline", async () => {
    const pool = f.getApplicationDatabase();
    await firstReady.promise;
    secondReady.resolve();
    await Promise.resolve();
    assert.equal(f.getApplicationDatabase(), pool);
    return pool;
  });
  assert.equal(f.getApplicationDatabase(), f.singleton, "outside callers keep their existing write pool");
  const [firstPool, secondPool] = await Promise.all([first, second]);
  assert.notEqual(firstPool, secondPool);
  assert.deepEqual([firstPool, secondPool], f.pools);
  assert.equal(f.getApplicationDatabase(), f.singleton);
  assert.equal(f.timers.size, 0);
});

test("cleanup cannot indefinitely hold a completed profile or cause a read replay", async () => {
  for (const behavior of [{ cleanupHangs: true }, { cleanupError: new Error("private connection details") }]) {
    const f = fixture([behavior]);
    const result = await f.withFreshApplicationDatabaseRead("member-home", () => f.getApplicationDatabase()`select profile`);
    assert.equal(result, "loaded");
    assert.equal(f.pools.length, 1);
    assert.equal(f.logs.length, 1);
    assert.ok(["cleanup_timeout", "cleanup_error"].includes(f.logs[0].details.kind));
    assert.doesNotMatch(JSON.stringify(f.logs), /private connection details|postgres:\/\//);
    assert.equal(f.timers.size, 0);
  }
});

test("late work from a timed-out attempt retains its own ended pool", async () => {
  const f = fixture();
  const continueFirst = deferred();
  let calls = 0;
  let latePool;
  const result = await f.withFreshApplicationDatabaseRead("member-home", async () => {
    calls += 1;
    if (calls === 1) {
      await continueFirst.promise;
      latePool = f.getApplicationDatabase();
      return "late";
    }
    return "recovered";
  });
  continueFirst.resolve();
  await Promise.resolve();
  assert.equal(result, "recovered");
  assert.equal(latePool, f.pools[0]);
  assert.deepEqual(latePool.ends, [{ timeout: 0 }]);
  assert.equal(f.getApplicationDatabase(), f.singleton);
  assert.equal(f.timers.size, 0);
});
