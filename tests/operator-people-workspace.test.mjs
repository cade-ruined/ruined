import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/components/platform/OperatorPeopleWorkspace.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const nodes = node => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const visibleText = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(visibleText).join("") : typeof node === "object" ? node.props?.hidden ? "" : visibleText(node.props?.children) : String(node);
function fixture({ admin = true, hash = "", preview = false, direct = false } = {}) {
  const state = [], effects = [], listeners = new Map();
  let cursor = 0, refreshes = 0;
  const win = { location: { hash, pathname: "/ops/members", search: "?q=Ty" }, history: { replaceState(_a, _b, path) { win.location.hash = ""; assert.equal(path, "/ops/members?q=Ty"); } }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "window", output)(name => {
    if (name === "react") return { ...React, useEffect(fn) { effects.push(fn); }, useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; }, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => state[i] = next]; } };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/navigation") return { useRouter: () => ({ refresh() { refreshes++; } }) };
    if (name === "next/link") return { __esModule: true, default: "a" };
    if (name.endsWith("OperatorDialog")) return { default: "dialog-stub", __esModule: true };
    if (name.endsWith("OpsActions")) return { OpsInvitationActions: "invitation-stub" };
    if (name.endsWith("operatorStyles")) return { OPERATOR_PRIMARY_ACTION_CLASS: "primary" };
    throw Error(name);
  }, mod, mod.exports, win);
  const draw = () => { cursor = 0; return mod.exports.default({ children: "Member list", pendingJoining: admin ? "Pending list" : undefined, directInvitations: admin && direct ? "Direct history" : undefined, preview, showHistory: admin }); };
  const button = label => { const match = nodes(draw()).find(node => node.type === "button" && text(node) === label); assert.ok(match, label); return match; };
  return { draw, button, effects, win, listeners, refreshes: () => refreshes, pending(value) { nodes(draw()).find(node => node.props?.id === "pending-joining-panel").props.ref.current = { querySelector(selector) { assert.equal(selector, '[data-operator-pending="true"]'); return value ? {} : null; } }; } };
}

test("People defaults to browsing with one Add action and no inline access forms", () => {
  const f = fixture();
  assert.match(visibleText(f.draw()), /Member list/);
  assert.doesNotMatch(visibleText(f.draw()), /Pending list/);
  assert.equal(nodes(f.draw()).some(node => node.type === "dialog-stub"), false);
  f.button("Pending joining").props.onClick();
  assert.match(visibleText(f.draw()), /Pending list/);
  assert.doesNotMatch(visibleText(f.draw()), /Member list/);
  assert.equal(nodes(f.draw()).find(node => node.props?.id === "member-directory-panel").props.children, "Member list", "switching views retains directory state");
  assert.equal(f.refreshes(), 0);
});

test("pending joining requests block a view switch, and settled reviews remain mounted afterward", () => {
  const f = fixture();
  f.button("Pending joining").props.onClick();
  f.pending(true);
  f.button("Members").props.onClick();
  assert.equal(f.button("Pending joining").props["aria-pressed"], true);
  assert.match(visibleText(f.draw()), /Wait for the current change to finish/);
  assert.match(visibleText(f.draw()), /Pending list/);
  f.pending(false);
  f.button("Members").props.onClick();
  assert.equal(f.button("Members").props["aria-pressed"], true);
  assert.doesNotMatch(visibleText(f.draw()), /Wait for the current change/);
  const pending = nodes(f.draw()).find(node => node.props?.id === "pending-joining-panel");
  assert.equal(pending.props.hidden, true);
  assert.equal(pending.props.children, "Pending list", "saved results and local confirmations are not unmounted");
  f.button("Add member").props.onClick();
  assert.equal(nodes(pending).some(node => node.type === "dialog-stub"), false, "the active dialog never lives in a hidden tab panel");
  assert.equal(nodes(f.draw()).find(node => node.type === "dialog-stub").props.returnFocusId, "add-member-trigger");
});

test("only administrators see historical navigation and pending joining writes block leaving", () => {
  const f = fixture();
  const historyLink = () => nodes(f.draw()).find(node => node.type === "a" && node.props.href === "/ops/members/history");
  assert.ok(historyLink());
  let prevented = 0;
  f.pending(true);
  historyLink().props.onClick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.match(text(f.draw()), /Wait for the current change to finish/);
  f.pending(false);
  historyLink().props.onClick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(nodes(fixture({ admin: false }).draw()).some(node => node.props?.href === "/ops/members/history"), false);
});

test("Add opens the guarded dialog and keeps preview safety and refresh behavior", () => {
  const f = fixture({ preview: true });
  f.button("Add member").props.onClick();
  const dialog = nodes(f.draw()).find(node => node.type === "dialog-stub");
  assert.equal(dialog.props.open, true);
  assert.equal(dialog.props.returnFocusId, "add-member-trigger");
  const form = nodes(f.draw()).find(node => node.type === "invitation-stub");
  assert.equal(form.props.preview, true);
  form.props.onSaved();
  assert.equal(f.refreshes(), 1);
  dialog.props.onClose();
  assert.equal(nodes(f.draw()).some(node => node.type === "invitation-stub"), false);
});

test("legacy add/pending deep links stay useful without opening admin controls for scoped operators", () => {
  for (const hash of ["#allow-member-email", "#pending-member-joining"]) {
    const f = fixture({ hash });
    f.draw();
    const cleanup = f.effects[0]();
    if (hash.includes("allow")) {
      const dialog = nodes(f.draw()).find(node => node.type === "dialog-stub");
      assert.ok(dialog);
      dialog.props.onClose();
      assert.equal(f.win.location.hash, "");
    } else assert.match(text(f.draw()), /Pending list/);
    cleanup();
    assert.equal(f.listeners.size, 0);
    const scoped = fixture({ admin: false, hash });
    scoped.draw(); scoped.effects[0]();
    assert.equal(nodes(scoped.draw()).some(node => node.type === "button" || node.type === "dialog-stub"), false);
    assert.match(text(scoped.draw()), /Member list/);
  }
});

test("the existing member allowance form advertises dirty and pending work to the dialog", () => {
  const actions = readFileSync(new URL("../src/components/platform/OpsActions.tsx", import.meta.url), "utf8");
  assert.match(actions, /aria-label="Add member steps" data-operator-pending=\{pending \|\| copying/);
  assert.match(actions, /data-operator-dirty=\{email\.trim\(\) !== \(preview \? sampleEmail : ""\) && !allowance \|\| revokeEmail/);
  const invitations = readFileSync(new URL("../src/components/platform/OperatorMemberInvitations.tsx", import.meta.url), "utf8");
  assert.match(invitations, /data-operator-pending=\{busy \? "true" : undefined\}/);
});


test("direct invitation history has its own admin view and stable search deep link", () => {
  const f = fixture({ direct: true, hash: "#direct-invitations" });
  f.draw(); f.effects[0]();
  assert.match(visibleText(f.draw()), /Direct history/);
  assert.doesNotMatch(visibleText(f.draw()), /Pending list|Member list/);
  assert.equal(f.button("Ruined Direct").props["aria-pressed"], true);
  f.button("Members").props.onClick();
  assert.match(visibleText(f.draw()), /Member list/);
  f.pending(true); f.button("Ruined Direct").props.onClick();
  assert.equal(f.button("Members").props["aria-pressed"], true, "pending access changes keep their existing navigation guard");
  const scoped = fixture({ admin: false, direct: true, hash: "#direct-invitations" });
  scoped.draw(); scoped.effects[0]();
  assert.doesNotMatch(text(scoped.draw()), /Direct history|Ruined Direct/);
});
