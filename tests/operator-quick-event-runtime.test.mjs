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
const DateTimeField = () => null;
const directory = {
  canCreate: true, canManageGlobal: true,
  circles: [{ id: "circle-one", name: "Founders Circle" }, { id: "circle-two", name: "Studio Circle" }],
  blocks: [{ id: "block-one", name: "Block 01" }], experiences: [],
};
const values = { title: "Our next gathering", meetingUrl: " https://meet.google.com/abc-defg-hij ", audience: "all_members", startsAt: "2026-10-15T18:00", duration: "60", timezone: "America/Denver", summary: "Bring your latest work." };

function fixture(patch = {}, { respond = async () => Response.json({ experience: { experienceId: "saved-id" } }), confirm = false } = {}) {
  const calls = [];
  const created = [];
  const pendingChanges = [];
  const confirmations = [];
  let advanced = 0;
  let requestSequence = 0;
  const states = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    },
  };
  const dependencies = {
    react: hooks,
    "@/components/platform/OperatorDateTimeField": { __esModule: true, default: DateTimeField },
  };
  function load(path) {
    const loadedModule = { exports: {} };
    const output = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", "window", "fetch", "FormData", "crypto", output)((name) => {
      if (dependencies[name]) return dependencies[name];
      if (name === "react/jsx-runtime") return require(name);
      if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
      if (name === "@/lib/datetime/zoned-date-time") return load("src/lib/datetime/zoned-date-time.ts");
      throw new Error(`Unexpected quick event dependency ${name}`);
    }, loadedModule, loadedModule.exports, { confirm(message) { confirmations.push(message); return confirm; } }, async (url, options) => { const call = { url, method: options.method, body: JSON.parse(options.body) }; calls.push(call); return respond(call); }, class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } }, { randomUUID() { return `00000000-0000-4000-8000-${String(++requestSequence).padStart(12, "0")}`; } });
    return loadedModule.exports;
  }
  const Subject = load("src/components/platform/OperatorQuickEventForm.tsx").default;
  const props = { directory, onAdvanced() { advanced++; }, onCreated(id) { created.push(id); }, onPendingChange(pending) { pendingChanges.push(pending); }, ...patch };
  const draw = () => { cursor = 0; return Subject(props); };
  const find = (predicate) => elements(draw()).find(predicate);
  return {
    draw, calls, created, pendingChanges, confirmations, advanced: () => advanced,
    field: (name) => find((node) => node.props?.name === name),
    button: (label) => find((node) => node.type === "button" && text(node) === label),
    submit(fields = values) { return draw().props.onSubmit({ preventDefault() {}, currentTarget: { values: fields, reset() { throw new Error("Do not discard the form before navigation"); } } }); },
    change() { draw().props.onChange(); },
  };
}

test("quick creation sends one complete publish request with the supplied Meet link and no registration", async () => {
  const f = fixture();
  assert.deepEqual(elements(f.draw()).filter((node) => node.type === "label").slice(0, 3).map((node) => text(node.props.children[0])), ["Title", "Google Meet link", "Audience"]);
  assert.equal(f.field("meetingUrl").props.required, true);
  assert.equal(f.field("meetingUrl").props.type, "url");
  assert.equal(f.field("startsAt").props.required, true);
  assert.equal(f.field("duration").props.defaultValue, "60");
  assert.equal(elements(f.draw()).find((node) => node.type === "details").props.open, undefined);
  assert.equal(f.field("capacity"), undefined);
  assert.match(text(f.draw()), /sends calendar invitations to this audience/);
  f.change();
  await f.submit();
  assert.deepEqual(f.calls, [{ url: "/api/ops/experiences", method: "POST", body: {
    intent: "create_and_publish", requestId: "00000000-0000-4000-8000-000000000002", title: values.title, meetingUrl: values.meetingUrl.trim(), visibility: "all_members", circleId: null, blockId: null,
    startsAt: "2026-10-16T00:00:00.000Z", endsAt: "2026-10-16T01:00:00.000Z", timezone: "America/Denver", kind: "member_event", summary: values.summary,
    details: "", locationLabel: "Google Meet", registrationMode: "none", capacity: null, waitlistEnabled: false,
    externalRegistrationUrl: null, registrationOpensAt: null, registrationClosesAt: null,
  } }]);
  assert.deepEqual(f.created, ["saved-id"]);
  assert.deepEqual(f.pendingChanges, [true, false]);
  assert.equal(f.draw().props["data-operator-dirty"], undefined);
});

test("Circle routes pin their audience even if a different audience is submitted", async () => {
  const f = fixture({ selectedCircle: directory.circles[0] });
  assert.equal(f.field("title").props.defaultValue, "Founders Circle meeting");
  assert.equal(f.field("audience").props.type, "hidden");
  assert.equal(f.field("audience").props.value, "circle:circle-one");
  await f.submit({ ...values, audience: "block:block-one" });
  assert.equal(f.calls[0].body.visibility, "circle");
  assert.equal(f.calls[0].body.circleId, "circle-one");
  assert.equal(f.calls[0].body.blockId, null);
  assert.equal(f.calls[0].body.kind, "circle_meeting");
});

test("the audience selector exposes only permitted choices and separates Circle and Block payloads", async () => {
  const scoped = fixture({ directory: { ...directory, canManageGlobal: false } });
  assert.equal(scoped.field("audience").props.defaultValue, "circle:circle-one");
  assert.deepEqual(elements(scoped.field("audience")).filter((node) => node.type === "option" && !node.props.disabled).map((node) => node.props.value), ["circle:circle-one", "circle:circle-two"]);
  const empty = fixture({ directory: { ...directory, canManageGlobal: false, circles: [] } });
  assert.equal(empty.field("audience").props.defaultValue, "");
  assert.deepEqual(elements(empty.field("audience")).filter((node) => node.type === "option" && !node.props.disabled), []);
  for (const [audience, expected] of [["circle:circle-two", { visibility: "circle", circleId: "circle-two", blockId: null, kind: "circle_meeting" }], ["block:block-one", { visibility: "block", circleId: null, blockId: "block-one", kind: "member_event" }]]) {
    const f = fixture();
    await f.submit({ ...values, audience });
    for (const [key, value] of Object.entries(expected)) assert.equal(f.calls[0].body[key], value);
  }
});

test("duration is elapsed time in the selected timezone, including across a daylight-saving change", async () => {
  for (const [timezone, startsAt, duration, start, end] of [
    ["America/New_York", "2026-10-15T18:00", "90", "2026-10-15T22:00:00.000Z", "2026-10-15T23:30:00.000Z"],
    ["America/Denver", "2027-03-14T01:30", "120", "2027-03-14T08:30:00.000Z", "2027-03-14T10:30:00.000Z"],
  ]) {
    const f = fixture();
    f.field("timezone").props.onChange({ target: { value: timezone } });
    assert.match(text(f.draw()), new RegExp(`Times in ${timezone}`));
    await f.submit({ ...values, timezone, startsAt, duration });
    assert.equal(f.calls[0].body.startsAt, start);
    assert.equal(f.calls[0].body.endsAt, end);
  }
});

test("invalid times, duration, and audience fail before issuing any request", async () => {
  for (const [fields, expected] of [
    [{ startsAt: "2027-03-14T02:30" }, /does not exist/],
    [{ timezone: "Mars/Olympus" }, /valid IANA timezone/],
    [{ startsAt: "" }, /Choose the event date and time/],
    [{ duration: "5" }, /Choose an event duration/],
    [{ audience: "public" }, /Choose an audience/],
    [{ audience: "circle:" }, /Choose an audience/],
  ]) {
    const f = fixture();
    f.change();
    await f.submit({ ...values, ...fields });
    assert.deepEqual(f.calls, []);
    assert.equal(f.draw().props["data-operator-dirty"], "true");
    assert.equal(f.draw().props["data-operator-pending"], undefined);
    assert.match(text(f.draw()), expected);
    assert.deepEqual(f.created, []);
  }
});

test("preview and missing create permission never read or submit event details", async () => {
  for (const patch of [{ preview: true }, { directory: { ...directory, canCreate: false } }]) {
    const f = fixture(patch);
    await f.draw().props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("This path must not read event details"); } });
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.pendingChanges, []);
    assert.deepEqual(f.created, []);
    if (patch.preview) assert.match(text(f.draw()), /Preview only — no event was created or invitations sent/);
  }
});

test("a pending create disables actions and rejects a duplicate submission; a failure preserves details", async () => {
  let resolve;
  const f = fixture({}, { respond: () => new Promise((done) => { resolve = done; }) });
  f.change();
  const fields = { ...values, title: "A carefully prepared title" };
  const request = f.submit(fields);
  assert.equal(f.draw().props["data-operator-pending"], "true");
  assert.equal(f.button("Creating event…").props.disabled, true);
  assert.equal(f.button("Advanced event setup").props.disabled, true);
  await f.submit();
  assert.equal(f.calls.length, 1);
  resolve(Response.json({ error: "The calendar could not be reached." }, { status: 503 }));
  await request;
  assert.equal(f.draw().props["data-operator-dirty"], "true");
  assert.equal(f.draw().props["data-operator-pending"], undefined);
  assert.match(text(f.draw()), /The calendar could not be reached/);
  assert.equal(f.calls[0].body.title, fields.title);
  assert.deepEqual(f.created, []);
  assert.deepEqual(f.pendingChanges, [true, false]);
});

test("advanced setup requires discard confirmation only after editing", () => {
  const clean = fixture();
  clean.button("Advanced event setup").props.onClick();
  assert.equal(clean.advanced(), 1);
  assert.deepEqual(clean.confirmations, []);
  const declined = fixture();
  declined.change();
  declined.button("Advanced event setup").props.onClick();
  assert.equal(declined.advanced(), 0);
  assert.deepEqual(declined.confirmations, ["Switch to advanced setup and discard these details?"]);
  assert.equal(declined.draw().props["data-operator-dirty"], "true");
  const accepted = fixture({}, { confirm: true });
  accepted.change();
  accepted.button("Advanced event setup").props.onClick();
  assert.equal(accepted.advanced(), 1);
  assert.deepEqual(accepted.calls, []);
});


test("retrying unchanged details keeps the same request ID while editing starts a new request", async () => {
  const f = fixture({}, { respond: async () => { throw new Error("Response was lost"); } });
  f.change();
  await f.submit();
  await f.submit();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.requestId, f.calls[1].body.requestId);
  f.change();
  await f.submit({ ...values, title: "Updated event title" });
  assert.notEqual(f.calls[2].body.requestId, f.calls[0].body.requestId);
  assert.equal(f.calls[2].body.title, "Updated event title");
  assert.deepEqual(f.created, []);
});
