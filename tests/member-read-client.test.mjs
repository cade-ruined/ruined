import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function fixture(replies) {
  const source = readFileSync(new URL("../src/lib/membership/member-read-client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [], timers = new Map();
  let timerId = 0;
  const mod = { exports: {} };
  new Function("module", "exports", "fetch", "setTimeout", "clearTimeout", compiled)(mod, mod.exports,
    async (url, options) => {
      const reply = replies[calls.length];
      calls.push({ url, options });
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply() : reply;
    }, (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; }, id => timers.delete(id));
  const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { ...mod.exports, calls, timers, tick, fire: async ms => {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `Expected a ${ms}ms timer`);
    timers.delete(entry[0]); entry[1].callback(); await tick();
  } };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
const begin = f => { const controller = new AbortController(); return { controller,
  result: f.fetchMemberRead("/api/my/members?q=alex&page=1", { signal: controller.signal }) }; };

test("healthy member reads include JSON and stay private without an extra request", async () => {
  const f = fixture([json({ results: [] })]);
  assert.deepEqual(await begin(f).result, { status: 200, ok: true, data: { results: [] } });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.cache, "no-store");
  assert.equal(f.timers.size, 0);
});

test("transient server and network failures recover once without manual interaction", async () => {
  for (const first of [json({}, 503), new Response("unavailable", { status: 504 }), new TypeError("network failed")]) {
    const f = fixture([first, json({ recovered: true })]);
    const pending = begin(f).result;
    await f.tick();
    assert.equal(f.calls.length, 1, "recovery waits briefly instead of flooding the API");
    await f.fire(300);
    assert.deepEqual(await pending, { status: 200, ok: true, data: { recovered: true } });
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 0);
  }
});

test("access, validation, and other permanent status responses never retry or wait for an error body", async () => {
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const f = fixture([{ ok: false, status, json: () => new Promise(() => {}) }]);
    assert.deepEqual(await begin(f).result, { status, ok: false, data: null });
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  }
});

test("recovery stops after one retry and keeps a later access denial authoritative", async () => {
  for (const last of [503, 401, 403]) {
    const f = fixture([json({}, 503), new Response("not JSON", { status: last })]);
    const pending = begin(f).result;
    await f.tick(); await f.fire(300);
    assert.deepEqual(await pending, { status: last, ok: false, data: null });
    assert.equal(f.calls.length, 2);
    assert.equal(f.timers.size, 0);
  }
});

test("the deadline covers headers and body; a hung read can recover but two hangs terminate", async () => {
  for (const hang of [() => new Promise(() => {}), () => ({ ok: true, status: 200, json: () => new Promise(() => {}) })]) {
    const f = fixture([hang, json({ recovered: true })]);
    const pending = begin(f).result;
    await f.tick(); await f.fire(20_000);
    assert.equal(f.calls[0].options.signal.aborted, true);
    await f.fire(300);
    assert.equal((await pending).data.recovered, true);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture([() => new Promise(() => {}), () => new Promise(() => {})]);
  const pending = begin(f).result;
  const rejection = assert.rejects(pending, { name: "MemberReadTimeoutError" });
  await f.fire(20_000); await f.fire(300); await f.fire(20_000);
  await rejection;
  assert.equal(f.calls.length, 2);
  assert.equal(f.timers.size, 0);
});

test("closing or changing search cancels both active work and scheduled recovery", async () => {
  for (const whileWaiting of [false, true]) {
    const f = fixture([whileWaiting ? json({}, 503) : () => new Promise(() => {}), json({ stale: true })]);
    const { controller, result } = begin(f);
    const rejection = assert.rejects(result, { name: "AbortError" });
    await f.tick(); controller.abort(); await rejection;
    assert.equal(f.calls.length, 1);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture([]), controller = new AbortController(); controller.abort();
  await assert.rejects(f.fetchMemberRead("/api/my/members", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(f.calls.length, 0);
});

test("successful malformed JSON is not retried as a transient network error", async () => {
  const f = fixture([new Response("invalid JSON", { status: 200 })]);
  await assert.rejects(begin(f).result, /Invalid member read response/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});
