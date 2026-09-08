import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const Link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
const Frame = { __esModule: true, default: ({ children }) => React.createElement("main", null, children) };
const styles = new Proxy({}, { get: () => "control" });
function load(path, dependencies = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return React;
    if (name === "next/link") return Link;
    if (name === "@/components/platform/OperatorPageFrame") return Frame;
    if (name === "@/components/platform/operatorStyles") return styles;
    throw new Error(`Unexpected task-first UI dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  return typeof node === "object" ? text(node.props?.children) : String(node);
}
function hookFixture(path, props, dependencies = {}, exportName = "default") {
  const slots = [];
  let cursor = 0;
  let refreshes = 0;
  const hooks = {
    ...React, useEffect() {}, useMemo: (fn) => fn(),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
  const Component = load(path, { ...dependencies, react: hooks, "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) } })[exportName];
  const draw = () => { cursor = 0; return Component(props); };
  const button = (label) => {
    const result = nodes(draw()).find((node) => node.type === "button" && text(node) === label);
    assert.ok(result, `button ${label} exists`);
    return result;
  };
  return { draw, button, refreshes: () => refreshes };
}
function captureRequests(t, handler = () => Response.json({ dispatch: { recipientCount: 1 } })) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    return handler(requests.at(-1), requests.length);
  });
  t.mock.method(globalThis, "FormData", function(form) { return { get: (key) => form.fields[key] ?? null }; });
  return requests;
}
const event = (fields) => ({ preventDefault() {}, currentTarget: { fields, reset() {} } });
const data = { blocks: [], circles: [{ id: "circle-one", label: "Circle One" }], members: [{ id: "member-one", label: "Example Member" }], history: [] };
const notificationDeps = { "@/lib/platform/ops-notification-model": load("src/lib/platform/ops-notification-model.ts") };
function notificationFixture(props = {}) {
  return hookFixture("src/components/platform/OperatorNotificationCenter.tsx", { data, ...props }, notificationDeps);
}
const draft = { audience: "member:member-one", notificationType: "reminder", title: "A private reminder", body: "Bring your journal.", actionLabel: "Open Circle", actionUrl: "/my/circle" };
function reviewNotification(fixture, fields = draft) {
  nodes(fixture.draw()).find((node) => node.type === "form").props.onSubmit(event(fields));
}

test("notifications show history before the visible composer, require an audience, and cannot send during review", async (t) => {
  const requests = captureRequests(t);
  const f = notificationFixture();
  const initial = nodes(f.draw());
  assert.equal(initial.some((node) => node.type === "details"), false);
  assert.ok(initial.findIndex((node) => node.props?.id === "notification-history") < initial.findIndex((node) => node.props?.id === "write-notification"));
  const audience = initial.find((node) => node.type === "select" && node.props.name === "audience");
  assert.equal(audience.props.defaultValue, "");
  assert.equal(audience.props.required, true);
  reviewNotification(f, { ...draft, audience: "" });
  assert.match(text(f.draw()), /Choose the intended audience/);
  assert.equal(nodes(f.draw()).some((node) => node.props?.onClick?.name === "sendNotification"), false);
  reviewNotification(f);
  assert.match(text(f.draw()), /Example Member/);
  assert.equal(requests.length, 0);
  await f.button("Send notification").props.onClick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/ops/notifications");
  assert.deepEqual(JSON.parse(requests[0].body), {
    actionLabel: "Open Circle", actionUrl: "/my/circle", body: draft.body,
    notificationType: "reminder", targetId: "member-one", targetType: "member", title: draft.title,
  });
  assert.match(text(f.draw()), /No email or text message was sent/);
  assert.equal(nodes(f.draw()).some((node) => node.props?.["aria-label"] === "Review notification before sending"), false);
});

test("editing invalidates notification review; failed delivery can retry unchanged payload with the same key", async (t) => {
  const requests = captureRequests(t, () => { throw new Error("Network unavailable"); });
  const f = notificationFixture();
  reviewNotification(f);
  nodes(f.draw()).find((node) => node.type === "form").props.onChange();
  assert.equal(nodes(f.draw()).some((node) => node.props?.["aria-label"] === "Review notification before sending"), false);
  reviewNotification(f);
  await f.button("Send notification").props.onClick();
  assert.equal(f.button("Send notification").props.disabled, false, "transport failure never leaves the form busy forever");
  assert.match(text(f.draw()), /Network unavailable/);
  await f.button("Send notification").props.onClick();
  assert.equal(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
  f.button("Back to editing").props.onClick();
  reviewNotification(f, { ...draft, body: "Updated reminder." });
  await f.button("Send notification").props.onClick();
  assert.notEqual(requests[1].headers["Idempotency-Key"], requests[2].headers["Idempotency-Key"]);
});

test("notification preview supports review but its handler cannot send even if invoked directly", async (t) => {
  const requests = captureRequests(t);
  const f = notificationFixture({ preview: true });
  reviewNotification(f);
  assert.equal(f.button("Send notification").props.disabled, true);
  await f.button("Send notification").props.onClick();
  assert.equal(requests.length, 0);
  assert.match(text(f.draw()), /Preview — notifications are not sent/);
});

test("announcements expose their draft form and require an explicit audience review before the existing publish control", () => {
  const Create = () => null;
  const Publish = () => null;
  const f = hookFixture("src/components/platform/OperatorAnnouncements.tsx", {
    announcements: [{ announcementId: "draft-one", title: "For this Circle", body: "Details", state: "draft", publishedAt: null, targetLabel: "Circle One" }],
    audienceOptions: data, canManage: true, preview: true,
  }, {
    "@/components/platform/OperatorEmptyState": { __esModule: true, default: () => null },
    "@/components/platform/StateLabel": { __esModule: true, default: () => null },
    "@/components/platform/OperatorWorkActions": { OperatorAnnouncementCreateAction: Create, OperatorAnnouncementPublishAction: Publish },
  });
  assert.equal(nodes(f.draw()).some((node) => node.type === "details"), false);
  assert.equal(nodes(f.draw()).some((node) => node.type === Publish), false);
  assert.equal(nodes(f.draw()).find((node) => node.type === Create).props.preview, true);
  f.button("Review & publish").props.onClick();
  assert.match(text(f.draw()), /Publish to Circle One/);
  assert.match(text(f.draw()), /cannot be edited or retracted/);
  assert.equal(nodes(f.draw()).find((node) => node.type === Publish).props.preview, true);
  f.button("Cancel review").props.onClick();
  assert.equal(nodes(f.draw()).some((node) => node.type === Publish), false);
});

test("all preview member corrections, notes, tasks, and announcement handlers stop before FormData or fetch", async (t) => {
  const requests = captureRequests(t);
  const paths = [
    ["OperatorMemberActions", "OperatorNoteAction"], ["OperatorMemberActions", "OperatorTaskCreateAction"],
    ["OperatorMemberActions", "OperatorOverrideAction"], ["OperatorWorkActions", "OperatorAnnouncementCreateAction"],
    ["OperatorWorkActions", "OperatorAnnouncementPublishAction"],
  ];
  for (const [file, exportName] of paths) {
    const f = hookFixture(`src/components/platform/${file}.tsx`, { preview: true, memberId: "member-one", lifecycleVersion: 1, announcementId: "one", audienceOptions: data }, {}, exportName);
    const form = nodes(f.draw()).find((node) => node.type === "form");
    if (form) await form.props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview must not collect mutation data"); } });
    else await f.button("Publish").props.onClick();
    assert.match(text(f.draw()), /Preview/);
  }
  assert.deepEqual(requests, []);
});

test("profile correction is visible, stops preview writes, and recovers from a failed transport", async (t) => {
  const requests = captureRequests(t, () => { throw new Error("Network unavailable"); });
  const profile = { preferredName: "Example", displayName: "Example Member", version: 3 };
  const deps = { "@/lib/membership/phone": { SHIPPING_COUNTRY_OPTIONS: [{ code: "US", name: "United States" }] } };
  const preview = hookFixture("src/components/platform/OperatorProfileSupport.tsx", { memberId: "member-one", profile, preview: true }, deps);
  assert.equal(nodes(preview.draw()).some((node) => node.type === "details"), false);
  await nodes(preview.draw()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview read"); } });
  assert.equal(requests.length, 0);
  const f = hookFixture("src/components/platform/OperatorProfileSupport.tsx", { memberId: "member-one", profile }, deps);
  await nodes(f.draw()).find((node) => node.type === "form").props.onSubmit(event({ value: "Updated", reason: "Confirmed with member" }));
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].body), { preferredName: "Updated", expectedVersion: 3, reason: "Confirmed with member" });
  assert.equal(f.button("Correct Preferred name").props.disabled, false);
  assert.match(text(f.draw()), /Reload saved profile before retrying/);
});

test("member record action anchors have visible authorized destinations and never add global permissions", () => {
  const preview = load("src/lib/platform/ops-preview.ts");
  const record = preview.getPreviewOpsMemberRecord("preview-01");
  const component = () => null;
  const Record = load("src/components/platform/OperatorMemberRecord.tsx", {
    "@/components/platform/OperatorMemberActions": { OperatorNoteAction: component, OperatorTaskCreateAction: component, OperatorOverrideAction: component },
    "@/components/platform/OperatorMemberSetup": { __esModule: true, default: component },
    "@/components/platform/OperatorProfileSupport": { __esModule: true, default: component },
    "@/components/platform/OperatorProgress": { __esModule: true, default: component },
    "@/components/platform/StateLabel": { __esModule: true, default: component },
  }).default;
  const tree = Record({ record, preview: true });
  const list = nodes(tree);
  for (const id of ["new-member-task", "new-member-note"]) {
    assert.ok(list.some((node) => node.type === "a" && node.props.href === `#${id}`));
    assert.ok(list.some((node) => node.props?.id === id));
  }
  assert.equal(list.some((node) => node.type === "details"), false);
  assert.equal(list.filter((node) => node.type === component && Object.hasOwn(node.props, "memberId")).every((node) => node.props.preview), true);
  const restricted = Record({ record: { ...record, access: { ...record.access, roles: ["guide"], capabilities: [] } } });
  assert.equal(nodes(restricted).some((node) => node.props?.id === "new-member-task"), false);
  assert.equal(nodes(restricted).some((node) => node.props?.id === "new-member-note"), false);
  assert.doesNotMatch(renderToStaticMarkup(restricted), /Record a state correction/);
});

test("operator guide distinguishes email allowance, acceptance, member placement, and explicit communication review", () => {
  const guide = source("docs/operator-admin-sop.md");
  assert.match(guide, /Where to click first/);
  assert.match(guide, /does not send an invitation email or create their sign-in account/);
  assert.match(guide, /Review notification → Send notification/);
  assert.match(guide, /Circle placement.*Operator access/s);
  const memberPage = source("app/ops/members/page.tsx");
  assert.match(memberPage, /context\.role === "ops_admin" && \(context\.state === "preview" \|\| context\.viewer\)/);
  assert.match(memberPage, /href="#allow-member-email"/);
  assert.doesNotMatch(memberPage, /<details/);
});

test("admin-preview member allowance is visible but both removal and admission are inert", async (t) => {
  const requests = captureRequests(t);
  const fixture = hookFixture("src/components/platform/OpsActions.tsx", { preview: true }, {}, "OpsInvitationActions");
  const tree = fixture.draw();
  assert.match(text(tree), /email allowances are not changed/);
  assert.equal(fixture.button("Allow email").props.disabled, true);
  assert.equal(fixture.button("Remove allowance").props.disabled, true);
  await nodes(tree).find((node) => node.type === "form").props.onSubmit({
    preventDefault() {},
    get currentTarget() { throw new Error("Preview must return before reading submitted identity"); },
  });
  assert.equal(requests.length, 0);
});
