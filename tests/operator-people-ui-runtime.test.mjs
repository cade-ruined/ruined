import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`); return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
function nodes(node) { if (!node || typeof node !== "object") return []; if (Array.isArray(node)) return node.flatMap(nodes); if (typeof node.type === "function") return nodes(node.type(node.props)); return [node, ...nodes(node.props?.children)]; }
function text(node) { if (node == null || typeof node === "boolean") return ""; if (Array.isArray(node)) return node.map(text).join(""); if (typeof node !== "object") return String(node); return text(node.props?.children); }
function fixture(path, props) {
  const state = []; let cursor = 0; let refreshes = 0;
  const hooks = { ...React, useEffect() {}, useRef(initial) { const id = cursor++; if (!(id in state)) state[id] = { current: initial }; return state[id]; }, useState(initial) { const id = cursor++; if (!(id in state)) state[id] = typeof initial === "function" ? initial() : initial; return [state[id], (value) => { state[id] = typeof value === "function" ? value(state[id]) : value; }]; } };
  const Component = load(path, {
    react: hooks, "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "next/link": { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) },
    "@/components/platform/OpsActions": { OpsInvitationActions: () => null },
    "@/components/platform/operatorStyles": { OPERATOR_BUTTON_CLASS: "button", OPERATOR_FIELD_CLASS: "field", OPERATOR_LABEL_TEXT_CLASS: "label" },
  }).default;
  const draw = () => { cursor = 0; return Component(props); };
  const find = (predicate) => nodes(draw()).find(predicate);
  const button = (label) => { const value = find((node) => node.type === "button" && text(node) === label); assert.ok(value, `Missing ${label}`); return value; };
  return { draw, find, button, refreshes: () => refreshes };
}
const circle = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Circle A" };
const operator = { id: "operator:test", authUserId: "22222222-2222-4222-8222-222222222222", email: "operator@example.com", displayName: "Operator", role: "guide", status: "active", circles: [circle] };
const invitation = { id: "12", email: "member@example.com", memberId: null, status: "pending", invitedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
const pendingProps = (entry = invitation) => ({ data: { entries: [entry], query: "", page: 1, pageCount: 1, totalResults: 1 }, preview: false });

test("preview operator scopes match the Circle options and open checked in the same editor without live reads", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Preview must not fetch live data"); });
  const preview = load("src/lib/platform/ops-preview.ts", {});
  const noLiveRead = () => { throw new Error("Preview must not read live records"); };
  const Page = load("app/ops/operators/page.tsx", {
    "next/navigation": { notFound: noLiveRead, redirect: noLiveRead },
    "@/components/platform/OperatorAccessManager": { __esModule: true, default: "operator-access-manager" },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: "operator-page-frame" },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: "platform-unavailable" },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({ state: "preview", role: "ops_admin", dashboard: { members: [] } }) },
    "@/lib/platform/ops-preview": preview,
    "@/lib/platform/ops-access-repository": { getOperatorAccessDirectory: noLiveRead },
    "@/lib/platform/ops-repository": { getOpsCircleSummaries: noLiveRead },
    "@/lib/platform/ops-operating-repository": { getOpsMemberOperatingRecord: noLiveRead },
    "@/lib/platform/repository": { getOperatorMemberDirectoryPage: noLiveRead },
  }).default;
  const page = await Page({});
  const props = page.props.children.props;
  assert.equal(props.preview, true);
  for (const entry of props.initialOperators.filter((entry) => entry.role !== "ops_admin")) {
    const expectedSlug = entry.role === "circle_leader" ? "circle-01" : "circle-02";
    const expected = preview.PREVIEW_OPS_CIRCLES.find((circle) => circle.slug === expectedSlug);
    assert.deepEqual(entry.circles, [{ id: expected.id, name: expected.name }]);
    assert.ok(props.circles.some((circle) => circle.id === expected.id));
    if (!entry.authUserId) continue;
    const editor = fixture("src/components/platform/OperatorAccessEditor.tsx", {
      entry, circles: props.circles, preview: true, onClose() {}, onSaved: noLiveRead,
    });
    assert.doesNotMatch(text(editor.draw()), /previous Circle is closed/);
    const selected = nodes(editor.draw()).filter((node) => node.type === "input" && node.props.type === "checkbox" && node.props.checked);
    assert.equal(selected.length, entry.circles.length);
    assert.equal(editor.button("Save access").props.disabled, false);
    await editor.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.match(text(editor.draw()), /Preview only/);
  }
});

test("operator edits require explicit save and send the displayed scope/status plus reason, never an invitation", async (t) => {
  const requests = []; let saved; t.mock.method(globalThis, "fetch", async (url, options) => { requests.push({ url, ...options }); return Response.json({ access: { authUserId: operator.authUserId, role: "guide", circles: [circle], status: "active" } }); });
  const f = fixture("src/components/platform/OperatorAccessEditor.tsx", { entry: operator, circles: [circle], preview: false, onClose() {}, onSaved(entry) { saved = entry; } });
  f.draw(); assert.equal(requests.length, 0);
  f.find((node) => node.type === "textarea").props.onChange({ target: { value: "Updated Circle responsibilities" } });
  await f.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/ops/operators"); assert.equal(requests[0].method, "PATCH");
  const body = JSON.parse(requests[0].body); assert.deepEqual(body.expectedCircleIds, [circle.id]); assert.equal(body.expectedRole, "guide"); assert.equal(body.expectedStatus, "active"); assert.equal(body.restoreAccount, false); assert.equal(body.reason, "Updated Circle responsibilities"); assert.equal(saved.authUserId, operator.authUserId);
});
test("administrator and suspended-account edits visibly require separate confirmations; preview never writes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected mutation"); });
  const f = fixture("src/components/platform/OperatorAccessEditor.tsx", { entry: { ...operator, role: "ops_admin", status: "suspended", circles: [] }, circles: [circle], preview: true, onClose() {}, onSaved() { throw new Error("Preview save"); } });
  assert.equal(f.button("Restore and save access").props.disabled, true);
  const confirmations = nodes(f.draw()).filter((node) => node.type === "input" && node.props.type === "checkbox"); assert.equal(confirmations.length, 2);
  for (const checkbox of confirmations) checkbox.props.onChange({ target: { checked: true } });
  assert.equal(f.button("Restore and save access").props.disabled, false);
  await f.find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.match(text(f.draw()), /Preview only/);
});
test("review and copy recheck a saved allowance without renewing it, and stale review clears instructions", async (t) => {
  const requests = []; let stale = false;
  t.mock.method(globalThis, "fetch", async (url, options) => { requests.push({ url, ...options }); return stale ? Response.json({ error: "Allowance was replaced" }, { status: 409 }) : Response.json({ invitation }); });
  const f = fixture("src/components/platform/OperatorMemberInvitations.tsx", pendingProps()); f.draw(); assert.equal(requests.length, 0);
  await f.button("Review").props.onClick(); assert.equal(requests.length, 1); assert.match(f.find((node) => node.type === "textarea").props.value, /member@example.com/);
  stale = true; await f.button("Copy instructions").props.onClick(); assert.match(text(f.draw()), /Allowance was replaced/); assert.equal(f.find((node) => node.type === "textarea"), undefined);
  assert.equal(requests.every((request) => request.url.endsWith("invitationId=12") && !request.method), true);
});
test("expired joining has no sharing action; renewal waits for confirmation and sends the exact invitation ID", async (t) => {
  const expired = { ...invitation, status: "expired", expiresAt: new Date(Date.now() - 1).toISOString() };
  const requests = []; t.mock.method(globalThis, "fetch", async (url, options) => { requests.push({ url, ...options }); return options?.method === "POST" ? Response.json({ invitation: { ...invitation, id: "13", reissued: true } }) : Response.json({ invitation: expired }); });
  const f = fixture("src/components/platform/OperatorMemberInvitations.tsx", pendingProps(expired));
  await f.button("Review").props.onClick(); assert.match(text(f.draw()), /has expired/); assert.equal(f.find((node) => node.type === "textarea"), undefined);
  f.button("Renew").props.onClick(); assert.equal(requests.length, 1);
  await f.button("Confirm renewal").props.onClick(); assert.deepEqual(JSON.parse(requests[1].body), { email: invitation.email, invitationId: "12" }); assert.equal(requests[1].method, "POST"); assert.equal(f.refreshes(), 1);
});
test("pending removal requires an explicit confirmation and never acts on a replacement row", async (t) => {
  const requests = []; t.mock.method(globalThis, "fetch", async (url, options) => { requests.push({ url, ...options }); return Response.json({ error: "This joining allowance has changed." }, { status: 409 }); });
  const f = fixture("src/components/platform/OperatorMemberInvitations.tsx", pendingProps());
  f.button("Remove").props.onClick(); assert.equal(requests.length, 0);
  await f.button("Confirm removal").props.onClick(); assert.equal(requests[0].method, "DELETE"); assert.deepEqual(JSON.parse(requests[0].body), { email: invitation.email, invitationId: "12" }); assert.match(text(f.draw()), /has changed/); assert.equal(f.refreshes(), 0);
});

test("operator PATCH validates origin, session, JSON, and exact input before invoking access edits; no email is sent", async () => {
  let trusted = true; let viewer = { authUserId: "admin" }; const edits = []; const deliveries = [];
  class RepositoryError extends Error {}
  const route = load("app/api/ops/operators/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => Response.json(body, options) } },
    "@/lib/auth/request": { isTrustedPlatformOrigin: () => trusted }, "@/lib/auth/session": { getCurrentPlatformViewer: async () => viewer },
    "@/lib/platform/ops-access-repository": { OpsAccessRepositoryError: RepositoryError, updateOperatorAccess: async (input) => { edits.push(input); return { authUserId: input.targetAuthUserId }; } },
    "@/lib/supabase/passwordless-delivery": { sendInvitedOperatorAccessCode: (...args) => deliveries.push(args) },
  });
  const input = { authUserId: operator.authUserId, role: "guide", circleIds: [circle.id], expectedRole: "guide", expectedCircleIds: [circle.id], expectedStatus: "active", reason: "Change scope" };
  const request = (body = input, contentType = "application/json") => new Request("http://localhost/api/ops/operators", { method: "PATCH", headers: { "Content-Type": contentType }, body: JSON.stringify(body) });
  trusted = false; assert.equal((await route.PATCH(request())).status, 403); trusted = true;
  viewer = null; assert.equal((await route.PATCH(request())).status, 401); viewer = { authUserId: "admin" };
  assert.equal((await route.PATCH(request(input, "text/plain"))).status, 415); assert.equal((await route.PATCH(request({ ...input, circleIds: [null] }))).status, 400); assert.equal(edits.length, 0);
  assert.equal((await route.PATCH(request())).status, 200); assert.equal(edits[0].actorAuthUserId, "admin"); assert.equal(edits[0].restoreAccount, false); assert.equal(deliveries.length, 0);
});
