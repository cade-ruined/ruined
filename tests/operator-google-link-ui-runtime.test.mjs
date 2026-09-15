import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/platform/OperatorGoogleCommunicationField.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const chat = "https://chat.google.com/room/example";
const meet = "https://meet.google.com/abc-defg-hij";
const event = { preventDefault() {}, get currentTarget() { throw Error("The controlled link form should not read unrelated form data"); } };

function fixture(overrides = {}, respond, copy = async () => {}) {
  let props = { configured: true, editable: true, entityId: "circle-one", entityType: "circle", initialUrl: null, kind: "chat", ...overrides };
  const slots = [];
  const effects = [];
  const cleanups = [];
  const calls = [];
  const copied = [];
  let cursor = 0, key, refreshes = 0;
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++; if (!(i in slots)) { slots[i] = deps; effects.push(effect); } },
  };
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "navigator", compiled)((name) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/navigation") return { useRouter: () => ({ refresh() { refreshes++; } }) };
    if (name === "@/components/platform/operatorStyles") return { OPERATOR_BUTTON_CLASS: "button", OPERATOR_FIELD_CLASS: "field", OPERATOR_LABEL_TEXT_CLASS: "label" };
    throw Error(`Unexpected Google link dependency: ${name}`);
  }, cjsModule, cjsModule.exports, async (url, init) => {
    const request = { url, method: init.method, body: JSON.parse(init.body) };
    calls.push(request);
    if (respond) return respond(request);
    return Response.json({ communication: { ...request.body, kind: request.body.entityType === "circle" ? "chat" : "meet", connected: init.method === "PUT", url: init.method === "PUT" ? request.body.url : null } });
  }, { clipboard: { writeText: async (value) => { copied.push(value); return copy(value); } } });
  function draw() {
    const element = cjsModule.exports.default(props);
    if (element.key !== key) {
      cleanups.splice(0).forEach((cleanup) => cleanup?.());
      slots.length = 0; key = element.key;
    }
    cursor = 0;
    const tree = element.type(element.props);
    effects.splice(0).forEach((effect) => cleanups.push(effect()));
    return tree;
  }
  const button = (label) => { const found = nodes(draw()).find((node) => node.type === "button" && text(node) === label); assert.ok(found, label); return found; };
  return { draw, calls, copied, button, refreshes: () => refreshes,
    change(value) { nodes(draw()).find((node) => node.type === "input").props.onChange({ target: { value } }); },
    submit() { return nodes(draw()).find((node) => node.type === "form").props.onSubmit(event); },
    update(patch) { props = { ...props, ...patch }; return draw(); },
  };
}

test("empty Chat and Meet forms expose their exact action without a collapsed disclosure", () => {
  for (const [kind, label] of [["chat", "Set chat link"], ["meet", "Save meeting link"]]) {
    const f = fixture({ kind, entityType: kind === "chat" ? "circle" : "experience" });
    assert.equal(nodes(f.draw()).some((node) => node.type === "details" || node.type === "summary"), false);
    assert.equal(f.button(label).props.type, "submit");
    assert.match(text(f.draw()), /does not.*Google access/);
    assert.match(text(f.draw()), kind === "chat" ? /add its members there/ : /does not send invitations/);
    assert.equal(nodes(f.draw()).some((node) => node.type === "a"), false);
    assert.deepEqual(f.calls, []);
  }
});

test("saved links show one compact value and an Edit action instead of a redundant form", () => {
  for (const [kind, url] of [["chat", chat], ["meet", meet]]) {
    const f = fixture({ kind, initialUrl: url });
    const tree = f.draw();
    assert.equal(nodes(tree).some((node) => node.type === "form" || node.type === "input"), false);
    assert.equal(nodes(tree).filter((node) => node.type === "a" && text(node) === url).length, 1);
    assert.equal(f.button("Edit").props["aria-label"], `Edit ${kind === "chat" ? "chat" : "meeting"} link`);
    assert.doesNotMatch(text(tree), /Saved (?:chat|meeting) link|Chat space link|Meet room link|[Pp]aste|Link saved/);
    assert.equal(tree.props["data-operator-dirty"], undefined);
    assert.deepEqual(f.calls, []);
  }
});

test("open and copy always use the saved link, not an unsaved draft, with a copy-failure fallback", async () => {
  for (const [kind, url, label] of [["chat", chat, "Open chat ↗"], ["meet", meet, "Open meeting ↗"]]) {
    const f = fixture({ kind, initialUrl: url });
    f.button("Edit").props.onClick();
    f.change(`${url}?unsaved=1`);
    const open = nodes(f.draw()).find((node) => node.type === "a" && text(node) === label);
    assert.equal(open.props.href, url);
    assert.equal(open.props.target, "_blank");
    await f.button("Copy link").props.onClick();
    assert.deepEqual(f.copied, [url]);
    assert.match(text(f.draw()), /link copied/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.refreshes(), 0);
  }
  const failed = fixture({ initialUrl: chat }, undefined, async () => { throw Error("Clipboard unavailable"); });
  await failed.button("Copy link").props.onClick();
  assert.match(text(failed.draw()), /Select and copy the saved URL/);
  assert.ok(nodes(failed.draw()).some((node) => node.props?.role === "alert"));
});

test("read-only links do not instruct operators to paste into a missing form", () => {
  for (const kind of ["chat", "meet"]) {
    const f = fixture({ kind, editable: false, initialUrl: kind === "chat" ? chat : meet });
    assert.match(text(f.draw()), kind === "chat" ? /Open chat/ : /Open meeting/);
    assert.doesNotMatch(text(f.draw()), /[Pp]aste/);
    assert.equal(nodes(f.draw()).some((node) => node.type === "form" || node.type === "input"), false);
    assert.equal(nodes(f.draw()).some((node) => node.type === "button" && text(node) === "Edit"), false);
    assert.deepEqual(f.calls, []);
  }
});

test("saving preserves the existing endpoint and identity, blocks double submit, and reports only link storage", async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const f = fixture({}, () => response);
  f.change(` ${chat} `);
  const first = f.submit();
  assert.equal(f.draw().props["data-operator-pending"], "true");
  await f.submit();
  assert.deepEqual(f.calls, [{ url: "/api/ops/google-communications", method: "PUT", body: { entityId: "circle-one", entityType: "circle", url: chat } }]);
  resolve(Response.json({ communication: { entityId: "circle-one", entityType: "circle", kind: "chat", connected: true, url: chat } }));
  await first;
  assert.match(text(f.draw()), /Chat link saved in Ruined. No invitation was sent/);
  assert.doesNotMatch(text(f.draw()), /Google Chat is ready/);
  assert.ok(f.button("Edit"));
  assert.equal(nodes(f.draw()).some((node) => node.type === "input"), false);
  assert.equal(f.draw().props["data-operator-pending"], undefined);
  assert.equal(f.draw().props["data-operator-dirty"], undefined);
  assert.equal(f.refreshes(), 1);
});

test("removing a saved link requires a separate confirmation and does not claim to remove people or cancel meetings", async () => {
  for (const kind of ["chat", "meet"]) {
    const f = fixture({ kind, entityType: kind === "chat" ? "circle" : "experience", initialUrl: kind === "chat" ? chat : meet });
    f.button("Edit").props.onClick();
    f.button("Remove link").props.onClick();
    assert.equal(f.draw().props["data-operator-dirty"], "true");
    assert.deepEqual(f.calls, []);
    assert.match(text(f.draw()), kind === "chat" ? /members stay unchanged.*Manage membership in Google Chat/ : /does not cancel it or send cancellation notices/);
    f.button("Keep link").props.onClick();
    assert.equal(nodes(f.draw()).some((node) => node.props?.role === "group"), false);
    f.button("Remove link").props.onClick();
    await f.button("Confirm remove link").props.onClick();
    assert.deepEqual(f.calls, [{ url: "/api/ops/google-communications", method: "DELETE", body: { entityId: "circle-one", entityType: kind === "chat" ? "circle" : "experience" } }]);
    assert.match(text(f.draw()), /Nothing was changed in Google/);
    assert.equal(nodes(f.draw()).some((node) => node.type === "a"), false);
    assert.equal(nodes(f.draw()).find((node) => node.type === "input").props.value, "");
    assert.equal(f.draw().props["data-operator-dirty"], undefined);
  }
});

test("preview and revoked UI capability prevent writes; read-only viewers can use a configured saved link", async () => {
  const preview = fixture({ initialUrl: chat, preview: true });
  preview.button("Edit").props.onClick();
  preview.change(chat);
  await preview.submit();
  preview.button("Remove link").props.onClick();
  await preview.button("Confirm remove link").props.onClick();
  assert.deepEqual(preview.calls, []);
  assert.equal(preview.refreshes(), 0);
  assert.match(text(preview.draw()), /Preview only/);
  for (const patch of [{ configured: false }, { editable: false }]) {
    const f = fixture({ initialUrl: chat });
    f.button("Edit").props.onClick();
    const oldSubmit = nodes(f.draw()).find((node) => node.type === "form").props.onSubmit;
    const tree = f.update(patch);
    assert.equal(nodes(tree).some((node) => node.type === "form"), false);
    await oldSubmit(event);
    assert.deepEqual(f.calls, []);
    assert.equal(nodes(tree).some((node) => node.type === "a"), patch.configured !== false);
  }
});

test("failed and mismatched saves retain the saved URL and editable draft", async () => {
  for (const response of [Response.json({ error: "Access changed" }, { status: 403 }), Response.json({}), Response.json({ communication: { entityId: "other-circle", entityType: "circle", kind: "chat", connected: true, url: chat } })]) {
    const f = fixture({ initialUrl: chat }, () => response);
    f.button("Edit").props.onClick();
    f.change(`${chat}-new`);
    await f.submit();
    assert.equal(nodes(f.draw()).find((node) => node.type === "input").props.value, `${chat}-new`);
    assert.equal(nodes(f.draw()).find((node) => node.type === "a").props.href, chat);
    assert.ok(nodes(f.draw()).some((node) => node.props?.role === "alert"));
    assert.equal(f.refreshes(), 0);
    assert.equal(f.draw().props["data-operator-dirty"], "true");
  }
});

test("entity and authoritative-link changes reset draft and confirmation; old responses cannot overwrite the new target", async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const f = fixture({ initialUrl: chat }, () => response);
  f.button("Edit").props.onClick();
  f.button("Remove link").props.onClick();
  f.change(`${chat}-new`);
  const pending = f.submit();
  const nextUrl = "https://chat.google.com/room/second";
  const next = f.update({ entityId: "circle-two", initialUrl: nextUrl });
  assert.equal(nodes(next).some((node) => node.type === "input"), false);
  assert.ok(f.button("Edit"));
  assert.equal(nodes(next).some((node) => node.props?.role === "group"), false);
  resolve(Response.json({ communication: { entityId: "circle-one", entityType: "circle", kind: "chat", connected: true, url: `${chat}-new` } }));
  await pending;
  assert.equal(nodes(f.draw()).find((node) => node.type === "a").props.href, nextUrl);
  assert.equal(f.refreshes(), 0);
  f.button("Edit").props.onClick();
  assert.equal(nodes(f.draw()).find((node) => node.type === "input").props.value, nextUrl);
  f.change(`${nextUrl}-unsaved`);
  const refreshed = f.update({ initialUrl: `${nextUrl}-server` });
  assert.equal(nodes(refreshed).some((node) => node.type === "input"), false);
  f.button("Edit").props.onClick();
  assert.equal(nodes(f.draw()).find((node) => node.type === "input").props.value, `${nextUrl}-server`);
});

test("Cancel discards only the local draft and removal confirmation without a request", () => {
  const f = fixture({ initialUrl: chat });
  f.button("Edit").props.onClick();
  f.change(`${chat}-unsaved`);
  f.button("Remove link").props.onClick();
  assert.equal(f.draw().props["data-operator-dirty"], "true");
  f.button("Cancel").props.onClick();
  assert.equal(nodes(f.draw()).some((node) => node.type === "input" || node.props?.role === "group"), false);
  assert.equal(f.draw().props["data-operator-dirty"], undefined);
  assert.deepEqual(f.calls, []);
  f.button("Edit").props.onClick();
  assert.equal(nodes(f.draw()).find((node) => node.type === "input").props.value, chat);
});

test("Cancel is disabled and stale cancel handlers cannot hide a pending save", async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const f = fixture({ initialUrl: chat }, () => response);
  f.button("Edit").props.onClick();
  const oldCancel = f.button("Cancel").props.onClick;
  f.change(`${chat}-new`);
  const pending = f.submit();
  assert.equal(f.button("Cancel").props.disabled, true);
  oldCancel();
  assert.equal(nodes(f.draw()).find((node) => node.type === "input").props.value, `${chat}-new`);
  resolve(Response.json({ error: "Please try again" }, { status: 503 }));
  await pending;
  assert.equal(f.button("Cancel").props.disabled, false);
  assert.equal(f.draw().props["data-operator-pending"], undefined);
  assert.equal(f.draw().props["data-operator-dirty"], "true");
});
