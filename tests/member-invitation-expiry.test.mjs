import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(path, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}

const expiry = await load("src/lib/membership/invitation-expiry.ts");

test("invitation expiry closes exactly at the issued deadline and fails closed without one", () => {
  const expiresAt = "2026-09-21T02:45:00.000Z", deadline = Date.parse(expiresAt);
  assert.equal(expiry.memberInvitationExpired(expiresAt, deadline - 1), false);
  assert.equal(expiry.memberInvitationExpired(expiresAt, deadline), true);
  assert.equal(expiry.memberInvitationExpired(expiresAt, deadline + 1), true);
  for (const value of [null, undefined, "", "not-a-date"]) {
    assert.equal(expiry.memberInvitationExpired(value, deadline - 1), true);
    assert.equal(expiry.memberInvitationDeadline(value), null);
  }
});

test("the printed deadline represents the service timestamp in Denver, including its daylight-saving zone", () => {
  for (const [instant, label] of [
    ["2026-09-21T02:45:00.000Z", "SEP. 20 8:45PM MDT"],
    ["2026-09-20T20:45:00-06:00", "SEP. 20 8:45PM MDT"],
    ["2026-01-21T03:45:00.000Z", "JAN. 20 8:45PM MST"],
    ["2026-03-08T08:59:00.000Z", "MAR. 8 1:59AM MST"],
    ["2026-03-08T09:00:00.000Z", "MAR. 8 3:00AM MDT"],
    ["2026-11-01T07:59:00.000Z", "NOV. 1 1:59AM MDT"],
    ["2026-11-01T08:00:00.000Z", "NOV. 1 1:00AM MST"],
  ]) assert.equal(expiry.memberInvitationDeadline(instant), label);
});

async function hookFixture(initialNow) {
  let now = initialNow, timerId = 0, state, currentDeps, cleanup, pendingEffect;
  const timers = new Map(), listeners = { window: new Map(), document: new Map() };
  const eventTarget = name => ({
    addEventListener(type, listener) {
      if (!listeners[name].has(type)) listeners[name].set(type, new Set());
      listeners[name].get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners[name].get(type)?.delete(listener); },
  });
  class Clock extends Date { static now() { return now; } }
  const hook = await load("src/components/membership/use-invitation-expiry.ts", {
    "react": {
      useState(initial) {
        if (state === undefined) state = typeof initial === "function" ? initial() : initial;
        return [state, value => { state = typeof value === "function" ? value(state) : value; }];
      },
      useEffect(effect, dependencies) {
        if (!currentDeps || dependencies.some((value, index) => value !== currentDeps[index])) {
          cleanup?.(); currentDeps = dependencies; pendingEffect = effect;
        }
      },
    },
    "@/lib/membership/invitation-expiry": expiry,
  }, {
    Date: Clock, window: eventTarget("window"), document: eventTarget("document"),
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    timers, listeners,
    render(expiresAt) {
      const result = hook.useInvitationExpired(expiresAt);
      if (pendingEffect) { const effect = pendingEffect; pendingEffect = undefined; cleanup = effect(); }
      return result;
    },
    setNow(value) { now = value; },
    fireTimers() {
      for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
    },
    dispatch(target, type) { for (const callback of [...(listeners[target].get(type) ?? [])]) callback(); },
    unmount() { cleanup?.(); },
  };
}

test("an open invitation expires at its original deadline without extending it on rerender", async () => {
  const issued = Date.parse("2026-09-19T02:45:00Z"), deadline = issued + 48 * 60 * 60 * 1000;
  const expiresAt = new Date(deadline).toISOString(), f = await hookFixture(issued);
  assert.equal(f.render(expiresAt), false);
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].due, deadline);
  f.setNow(deadline - 1); f.fireTimers();
  assert.equal(f.render(expiresAt), false);
  assert.equal([...f.timers.values()][0].due, deadline, "A rerender cannot restart the 48-hour window.");
  f.setNow(deadline); f.fireTimers();
  assert.equal(f.render(expiresAt), true); assert.equal(f.timers.size, 0);
  f.unmount();
});

test("focus and visibility events catch expiration when a sleeping tab missed its timer", async () => {
  for (const [target, type] of [["window", "focus"], ["document", "visibilitychange"]]) {
    const start = Date.parse("2026-09-19T02:45:00Z"), expiresAt = new Date(start + 1000).toISOString();
    const f = await hookFixture(start); assert.equal(f.render(expiresAt), false);
    f.setNow(start + 1001); f.dispatch(target, type);
    assert.equal(f.render(expiresAt), true); assert.equal(f.timers.size, 0);
    f.unmount();
  }
});

test("a replacement deadline cancels the prior timer and unmount removes all work", async () => {
  const start = Date.parse("2026-09-19T02:45:00Z"), f = await hookFixture(start);
  f.render(new Date(start + 1000).toISOString());
  const firstTimer = [...f.timers.keys()][0], replacement = new Date(start + 2000).toISOString();
  assert.equal(f.render(replacement), false); assert.equal(f.timers.has(firstTimer), false);
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].due, start + 2000);
  assert.equal(f.listeners.window.get("focus").size, 1);
  assert.equal(f.listeners.document.get("visibilitychange").size, 1);
  f.unmount();
  assert.equal(f.timers.size, 0);
  assert.equal(f.listeners.window.get("focus").size, 0);
  assert.equal(f.listeners.document.get("visibilitychange").size, 0);
});

test("unissued or malformed deadlines never schedule a sharing window", async () => {
  for (const value of [null, "invalid"]) {
    const f = await hookFixture(Date.parse("2026-09-19T02:45:00Z"));
    assert.equal(f.render(value), true); assert.equal(f.timers.size, 0); f.unmount();
  }
});
