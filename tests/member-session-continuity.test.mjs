import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (status, value) => ({ status, json: async () => ({ status: value }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function monitorFixture(fetcher = async () => reply(200, "authenticated"), options = {}) {
  let now = 0, timerId = 0;
  const calls = [], statuses = [], timers = new Map();
  const win = new EventTarget(), doc = new EventTarget(), nav = { onLine: true };
  doc.visibilityState = "visible";
  class Clock extends Date { static now() { return now; } }
  const library = await load("src/lib/auth/member-session-monitor.ts", {}, {
    Date: Clock, window: win, document: doc, navigator: nav,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, init) { calls.push({ url, init }); return fetcher(url, init); },
  });
  const controller = library.startMemberSessionMonitor({ ownerId: "owner-one", initialStatus: "connected", onStatus: state => statuses.push(state), ...options });
  return { controller, calls, statuses, timers, nav, doc,
    fire(target, name) { (target === "document" ? doc : win).dispatchEvent(new Event(name)); },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); } await tick(); },
  };
}

test("foreground events share one refresh, transmit no token, and throttle healthy checks", async () => {
  const waiting = deferred();
  const f = await monitorFixture(() => waiting.promise);
  for (const [target, event] of [["window", "focus"], ["window", "pageshow"], ["window", "online"], ["document", "visibilitychange"]]) f.fire(target, event);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/auth/session");
  assert.equal(f.calls[0].init.cache, "no-store");
  assert.equal(f.calls[0].init.credentials, "same-origin");
  assert.deepEqual(f.calls[0].init.headers, { "X-Ruined-Session-Owner": "owner-one" });
  waiting.resolve(reply(200, "authenticated")); await tick();
  f.fire("window", "focus"); assert.equal(f.calls.length, 1);
  await f.advance(300_000); assert.equal(f.calls.length, 2);
  f.controller.stop();
});

test("hidden and offline pages wait for a real return, including short background visits", async () => {
  const f = await monitorFixture(); await tick();
  f.doc.visibilityState = "hidden"; f.fire("document", "visibilitychange");
  assert.equal(f.timers.size, 0);
  await f.advance(5000); f.fire("window", "focus"); assert.equal(f.calls.length, 1);
  f.doc.visibilityState = "visible"; f.fire("document", "visibilitychange");
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 1, "brief backgrounding must restore the active refresh timer");
  f.nav.onLine = false; f.fire("window", "offline");
  assert.equal(f.statuses.at(-1), "offline"); assert.equal(f.timers.size, 0);
  await f.advance(600_000); assert.equal(f.calls.length, 1);
  f.nav.onLine = true; f.fire("window", "online"); await tick();
  assert.equal(f.calls.length, 2); assert.equal(f.statuses.at(-1), "connected");
  f.controller.stop();
});

test("temporary errors retry with backoff and never manufacture a logout", async () => {
  let attempt = 0;
  const f = await monitorFixture(async () => ++attempt < 3 ? reply(503, "unavailable") : reply(200, "authenticated"));
  await tick(); assert.deepEqual(f.statuses, ["reconnecting"]);
  await f.advance(4999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2);
  await f.advance(9999); assert.equal(f.calls.length, 2);
  await f.advance(1); assert.equal(f.statuses.at(-1), "connected");
  assert.ok(!f.statuses.includes("signed_out")); f.controller.stop();
});

test("bounded requests recover after timeout and cleanup cancels every listener and request", async () => {
  const f = await monitorFixture((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  await f.advance(10_000); assert.equal(f.statuses.at(-1), "reconnecting");
  await f.advance(5000); assert.equal(f.calls.length, 2);
  const signal = f.calls[1].init.signal;
  f.controller.stop(); await tick();
  assert.equal(signal.aborted, true); assert.equal(f.timers.size, 0);
  f.fire("window", "focus"); f.fire("window", "online"); f.fire("document", "visibilitychange");
  await f.advance(600_000); assert.equal(f.calls.length, 2);
});

test("manual recovery supersedes stale logout responses and account changes stop old-page work", async () => {
  const old = deferred(); let attempt = 0;
  const f = await monitorFixture(() => ++attempt === 1 ? old.promise : Promise.resolve(reply(200, "authenticated")));
  await f.controller.check();
  old.resolve(reply(401, "signed_out")); await tick();
  assert.deepEqual(f.statuses, ["connected"]); f.controller.stop();
  const changed = await monitorFixture(async () => reply(409, "account_changed")); await tick();
  assert.deepEqual(changed.statuses, ["account_changed"]);
  await changed.controller.check(); changed.fire("window", "focus"); await changed.advance(600_000);
  assert.equal(changed.calls.length, 1); changed.controller.stop();
});

test("only a confirmed invalid session asks for sign-in; recovery can restore the same page", async () => {
  let attempt = 0;
  const f = await monitorFixture(async () => ++attempt === 1 ? reply(401, "signed_out") : attempt === 2 ? reply(503, "unavailable") : reply(200, "authenticated"));
  await tick(); assert.equal(f.statuses.at(-1), "signed_out"); assert.equal(f.timers.size, 0);
  await f.controller.check(); assert.equal(f.statuses.at(-1), "signed_out");
  await f.controller.check(); assert.equal(f.statuses.at(-1), "connected"); f.controller.stop();
  const wrong = await monitorFixture(async () => reply(401, "unavailable")); await tick();
  assert.equal(wrong.statuses.at(-1), "reconnecting"); wrong.controller.stop();
});

const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
function hookHarness() {
  const slots = []; let cursor = 0; const effects = [];
  return { hooks: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++, prior = slots[i]; if (!prior || deps.some((value, index) => value !== prior.deps[index])) effects.push(() => { prior?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  }, render(fn) { cursor = 0; const tree = fn(); effects.splice(0).forEach(effect => effect()); return tree; } };
}

test("continuity retains the same child subtree during outages, expiry and recovery without refreshing drafts", async () => {
  const h = hookHarness(); let notify; let refreshes = 0;
  const router = { refresh() { refreshes++; } };
  const passwordless = () => null;
  const Component = (await load("src/components/membership/MemberSessionContinuity.tsx", {
    react: h.hooks, "next/navigation": { useRouter: () => router, usePathname: () => "/my/journal" },
    "@/components/platform/PasswordlessAccessForm": { __esModule: true, default: passwordless },
    "@/lib/auth/member-session-monitor": { startMemberSessionMonitor(args) { notify = args.onStatus; return { stop() {}, async check() {} }; } },
  })).default;
  const draft = React.createElement("textarea", { defaultValue: "An unfinished journal entry" });
  const render = () => h.render(() => Component({ children: draft, enabled: true, ownerId: "owner-one" }));
  const initial = render(); const wrapper = initial.props.children[0];
  let childModalCloses = 0;
  wrapper.props.ref.current = { querySelectorAll(selector) { assert.equal(selector, "dialog[open]"); return [{ close() { childModalCloses++; } }]; } };
  const recoveryDialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  nodes(initial).find(node => node.type === "dialog").props.ref.current = recoveryDialog;
  for (const status of ["offline", "reconnecting", "signed_out", "connected", "account_changed"]) {
    notify(status); const tree = render(); const same = tree.props.children[0];
    assert.equal(same.type, wrapper.type); assert.equal(same.key, wrapper.key);
    assert.equal(same.props.children, draft); assert.equal(same.props.hidden, status === "account_changed");
    assert.equal(refreshes, 0);
    assert.equal(recoveryDialog.open, status === "signed_out", "recovery must remain reachable above an existing modal");
    assert.equal(childModalCloses, status === "account_changed" ? 1 : 0, "only a changed account releases child modals so Open profile remains reachable");
    assert.equal(nodes(tree).filter(node => node.type === passwordless).length, 1);
  }
  notify("signed_out");
  await nodes(render()).find(node => node.type === passwordless).props.onAuthenticated();
  const accepted = render();
  assert.equal(nodes(accepted).filter(node => node.type === passwordless).length, 0, "a consumed code is not shown for resubmission during recovery");
  assert.ok(nodes(accepted).some(node => node.props.role === "status" && String(node.props.children).includes("Your code was accepted")));
  notify("signed_out");
  assert.equal(nodes(render()).filter(node => node.type === passwordless).length, 1, "definitive rejection allows a fresh code request");
});

test("passwordless recovery uses its callback while ordinary sign-in still navigates", async () => {
  for (const recovery of [true, false]) {
    const h = hookHarness(); const redirects = []; let completed = 0;
    const Component = (await load("src/components/platform/PasswordlessAccessForm.tsx", {
      react: h.hooks, "next/link": { __esModule: true, default: () => null },
    }, {
      window: { location: { assign: value => redirects.push(value) }, setTimeout() { return 1; }, clearTimeout() {} },
      FormData: class { get() { return "123456"; } },
      fetch: async () => ({ ok: true, json: async () => ({ redirectTo: "/my" }) }),
    })).default;
    const props = { enabled: true, onAuthenticated: recovery ? async () => { completed++; } : undefined };
    const render = () => h.render(() => Component(props));
    await render().props.onSubmit({ preventDefault() {} });
    await render().props.onSubmit({ preventDefault() {}, currentTarget: {} });
    assert.equal(completed, recovery ? 1 : 0); assert.deepEqual(redirects, recovery ? [] : ["/my"]);
  }
});
