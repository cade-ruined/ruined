import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const elements = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const Dialog = ({ children }) => children;
const directory = {
  canCreate: true, canManageGlobal: true,
  circles: [{ id: "circle-one", name: "Founders Circle" }], blocks: [{ id: "block-one", name: "Block 01" }],
  experiences: [{ experienceId: "meeting-one", title: "Founders gathering", kind: "circle_meeting", scope: "Founders Circle", circleId: "circle-one", state: "draft", startsAt: "2026-10-02T00:00:00Z", endsAt: "2026-10-02T01:00:00Z", registeredCount: 2, waitlistedCount: 1, capacity: 10, meetingUrl: null }],
};
const values = { title: "Our next meeting", startsAt: "2026-10-01T18:00", endsAt: "2026-10-01T19:00", timezone: "America/Denver", visibility: "all_members", kind: "member_event", registrationMode: "internal", capacity: "10", waitlistEnabled: "on" };

function fixture(patch = {}, { hash = "", respond = async () => Response.json({ experience: { experienceId: "saved-id" } }) } = {}) {
  const props = { directory, ...patch };
  const states = [];
  const effects = [];
  const listeners = new Map();
  const calls = [];
  const navigations = [];
  let cursor = 0;
  let changed = false;
  let resets = 0;
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (next) => { const value = typeof next === "function" ? next(states[index]) : next; changed ||= !Object.is(states[index], value); states[index] = value; }];
    },
    useEffect(work, dependencies) {
      const index = cursor++;
      if (!states[index] || dependencies.some((value, offset) => !Object.is(value, states[index][offset]))) { states[index] = dependencies; effects.push(work); }
    },
  };
  const browserWindow = {
    location: { pathname: "/ops/experiences", search: props.requestedCircleId ? `?circleId=${props.requestedCircleId}` : "", hash },
    history: { state: { next: true }, replaceState(state, unused, url) { void unused; this.state = state; browserWindow.location.hash = new URL(url, "https://example.test").hash; } },
    addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); },
  };
  const dependencies = {
    react: hooks,
    "next/navigation": { useRouter: () => ({ push: (path) => navigations.push(path), refresh() {} }) },
    "next/link": { __esModule: true, default: "a" },
    "@/components/platform/OperatorDialog": { __esModule: true, default: Dialog },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" },
    "@/components/platform/StateLabel": { __esModule: true, default: "span" },
  };
  function load(path) {
    const loadedModule = { exports: {} };
    const output = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", "window", "fetch", "FormData", output)((name) => {
      if (dependencies[name]) return dependencies[name];
      if (name === "react/jsx-runtime") return require(name);
      if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
      if (name === "@/lib/datetime/zoned-date-time") return load("src/lib/datetime/zoned-date-time.ts");
      throw new Error(`Unexpected directory dependency ${name}`);
    }, loadedModule, loadedModule.exports, browserWindow, async (url, options) => { const call = { url, method: options.method, body: JSON.parse(options.body) }; calls.push(call); return respond(call); }, class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } });
    return loadedModule.exports;
  }
  const Subject = load("src/components/platform/OperatorExperienceDirectory.tsx").default;
  function draw() {
    let tree;
    do { cursor = 0; changed = false; tree = Subject(props); while (effects.length) effects.shift()(); } while (changed);
    return tree;
  }
  const find = (predicate) => elements(draw()).find(predicate);
  return {
    draw, calls, navigations, browserWindow, listeners, resets: () => resets,
    modal: () => find((node) => node.type === Dialog),
    form: () => find((node) => node.type === "form"),
    field: (name) => find((node) => node.props?.name === name),
    open() { find((node) => node.props?.id === "new-experience-trigger").props.onClick(); },
    submit(fields = values) { return this.form().props.onSubmit({ preventDefault() {}, currentTarget: { values: fields, reset() { resets++; } } }); },
  };
}

test("the directory uses one destination per event and one guarded creation task", () => {
  const f = fixture();
  assert.equal(f.modal().props.open, false);
  assert.equal(f.modal().props.returnFocusId, "new-experience-trigger");
  const row = elements(f.draw()).find((node) => node.type === "article");
  assert.equal(elements(row).filter((node) => node.props?.href).length, 1);
  assert.equal(elements(row).find((node) => node.props?.href).props.href, "/ops/experiences/meeting-one");
  assert.doesNotMatch(text(row), /Meeting link not set|Set meeting link/);
  assert.equal(elements(f.draw()).some((node) => node.type === "dl"), false);
  f.open();
  assert.equal(f.modal().props.open, true);
  assert.equal(f.browserWindow.location.hash, "#new-experience");
  assert.deepEqual(elements(f.form()).filter((node) => node.type === "legend").map(text), ["When", "Who"]);
  assert.equal(elements(f.form()).find((node) => node.type === "details").props.open, undefined);
  assert.match(text(f.form()), /Nothing is published or sent yet/);
  assert.deepEqual(f.calls, []);
});

test("Circle deep links open creation, pin scope, preserve every time and never send invitations", async () => {
  const f = fixture({ requestedCircleId: "circle-one" }, { hash: "#new-experience" });
  assert.equal(f.modal().props.open, true);
  assert.equal(f.field("title").props.defaultValue, "Founders Circle meeting");
  assert.equal(f.field("circleId").props.value, "circle-one");
  assert.equal(f.field("registrationMode").props.value, "none");
  assert.equal(f.field("capacity"), undefined);
  await f.submit({ ...values, visibility: "public", circleId: "other-circle", blockId: "other-block" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/ops/experiences");
  assert.equal(f.calls[0].body.circleId, "circle-one");
  assert.equal(f.calls[0].body.visibility, "circle");
  assert.equal(f.calls[0].body.kind, "circle_meeting");
  assert.equal(f.calls[0].body.registrationMode, "none");
  assert.equal(f.calls[0].body.capacity, null);
  assert.equal(f.calls[0].body.startsAt, "2026-10-02T00:00:00.000Z");
  assert.equal(f.calls[0].body.endsAt, "2026-10-02T01:00:00.000Z");
  assert.deepEqual(f.navigations, ["/ops/experiences/saved-id#meeting-setup"]);
});

test("closing after the dialog's discard confirmation resets only its own draft and hash", () => {
  const f = fixture({ requestedCircleId: "circle-one" });
  f.open();
  f.form().props.onChange();
  assert.equal(f.form().props["data-operator-dirty"], "true");
  const before = f.form().key;
  f.modal().props.onClose();
  assert.equal(f.modal().props.open, false);
  assert.equal(f.form().props["data-operator-dirty"], undefined);
  assert.notEqual(f.form().key, before);
  assert.equal(f.browserWindow.location.search, "?circleId=circle-one");
  assert.equal(f.browserWindow.location.hash, "");
  assert.deepEqual(f.calls, []);
});

test("pending requests prevent duplicate creates and closing; failures preserve unsaved input", async () => {
  let resolve;
  const f = fixture({}, { respond: () => new Promise((done) => { resolve = done; }) });
  f.open(); f.form().props.onChange();
  const version = f.form().key;
  const request = f.submit();
  assert.equal(f.modal().props.pending, true);
  assert.equal(f.form().props["data-operator-pending"], "true");
  await f.submit();
  f.modal().props.onClose();
  assert.equal(f.modal().props.open, true);
  assert.equal(f.calls.length, 1);
  resolve(Response.json({ error: "Please check the date." }, { status: 400 }));
  await request;
  assert.equal(f.form().key, version);
  assert.equal(f.form().props["data-operator-dirty"], "true");
  assert.equal(f.resets(), 0);
  assert.match(text(f.form()), /Please check the date/);
});

test("advanced registration values still reach the unchanged draft API", async () => {
  const f = fixture();
  await f.submit({ ...values, visibility: "block", blockId: "block-one", summary: "A short introduction", details: "The full plan", locationLabel: "The studio", registrationOpensAt: "2026-09-20T09:00", registrationClosesAt: "2026-10-01T12:00" });
  const saved = f.calls[0].body;
  assert.equal(saved.blockId, "block-one"); assert.equal(saved.circleId, null);
  assert.equal(saved.capacity, 10); assert.equal(saved.waitlistEnabled, true);
  assert.equal(saved.registrationOpensAt, "2026-09-20T15:00:00.000Z");
  assert.equal(saved.registrationClosesAt, "2026-10-01T18:00:00.000Z");
  assert.equal(saved.summary, "A short introduction"); assert.equal(saved.details, "The full plan"); assert.equal(saved.locationLabel, "The studio");
  const external = fixture();
  await external.submit({ ...values, registrationMode: "external", externalRegistrationUrl: "https://example.test/event" });
  assert.equal(external.calls[0].body.externalRegistrationUrl, "https://example.test/event");
  assert.equal(external.calls[0].body.capacity, null); assert.equal(external.calls[0].body.registrationOpensAt, null);
});

test("preview, invalid context, missing permission, and invalid local time cannot create an event", async () => {
  const preview = fixture({ preview: true });
  await preview.form().props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview must not read the form"); } });
  assert.match(text(preview.draw()), /Preview only/);
  assert.deepEqual(preview.calls, []);
  for (const patch of [{ directory: { ...directory, canCreate: false } }, { requestedCircleId: "missing-circle" }]) {
    const f = fixture(patch, { hash: "#new-experience" });
    assert.equal(f.modal(), undefined);
    assert.equal(f.form(), undefined);
    assert.deepEqual(f.calls, []);
  }
  const invalidTime = fixture();
  await invalidTime.submit({ ...values, startsAt: "2027-03-14T02:30" });
  assert.deepEqual(invalidTime.calls, []);
  assert.match(text(invalidTime.form()), /does not exist/);
});

test("late hash navigation opens the same creation dialog without scrolling the page", () => {
  const f = fixture();
  assert.equal(f.modal().props.open, false);
  f.browserWindow.location.hash = "#new-experience";
  f.listeners.get("hashchange")();
  assert.equal(f.modal().props.open, true);
  assert.deepEqual(f.calls, []);
});
