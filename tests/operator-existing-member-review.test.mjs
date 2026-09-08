import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, overrides) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected test dependency: ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}
const memberId = "10000000-0000-4000-8000-000000000010";
const member = { memberId, displayName: "Example Member", email: "Member@Example.test" };
const circle = { id: "10000000-0000-4000-8000-000000000020", name: "Circle 02" };
const record = {
  header: { memberId, preferredName: "Example", primaryEmail: member.email },
  membership: { contact: { legalName: member.displayName, phone: "PRIVATE_NOT_FOR_THIS_PAGE" } },
};
const Wrapper = ({ children }) => React.createElement("section", null, children);
const Link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
function routeFixture({ role = "ops_admin", state = "connected", selectedRecord = record } = {}) {
  const calls = [];
  const unavailable = () => null;
  const manager = () => null;
  const route = load("app/ops/operators/page.tsx", {
    "next/navigation": {
      notFound: () => { throw new Error("NOT_FOUND"); },
      redirect: (path) => { throw new Error(`REDIRECT:${path}`); },
    },
    "@/components/platform/OperatorAccessManager": { __esModule: true, default: manager },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: Wrapper },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: unavailable },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({
      state, role, dashboard: {}, viewer: { authUserId: "verified-admin" },
    }) },
    "@/lib/platform/ops-access-repository": { getOperatorAccessDirectory: async (actor) => {
      calls.push(["directory", actor]); return [];
    } },
    "@/lib/platform/ops-repository": { getOpsCircleSummaries: async (actor) => {
      calls.push(["circles", actor]); return [{ ...circle, status: "active" }];
    } },
    "@/lib/platform/ops-operating-repository": { getOpsMemberOperatingRecord: async (...args) => {
      calls.push(["member", ...args]); return selectedRecord;
    } },
    "@/lib/platform/ops-preview": { PREVIEW_OPS_CIRCLES: [], getPreviewOpsMemberRecord: () => selectedRecord },
  }).default;
  return { route, calls, unavailable, manager };
}

test("existing-member review resolves name and email from an authorized member ID, not URL identity fields", async () => {
  const { route, calls, manager } = routeFixture();
  const tree = await route({ searchParams: Promise.resolve({ memberId, email: "attacker@example.test", displayName: "Wrong person" }) });
  assert.deepEqual(calls.find(([kind]) => kind === "member"), ["member", "verified-admin", memberId]);
  assert.equal(tree.props.children.type, manager);
  assert.deepEqual(tree.props.children.props.selectedMember, member);
  assert.equal(tree.props.children.key, memberId, "a new selection resets any previous review dialog");
  assert.doesNotMatch(JSON.stringify(tree.props.children.props), /PRIVATE_NOT_FOR_THIS_PAGE|attacker|Wrong person/);
});

test("operator member shortcut fails closed before private lookup for non-admins or malformed IDs", async () => {
  for (const role of ["guide", "circle_leader"]) {
    const fixture = routeFixture({ role });
    const result = await fixture.route({ searchParams: Promise.resolve({ memberId }) });
    assert.equal(result.type, fixture.unavailable);
    assert.deepEqual(fixture.calls, []);
  }
  for (const invalid of ["not-a-member", [memberId, memberId], "", "../../members"]) {
    const fixture = routeFixture();
    await assert.rejects(fixture.route({ searchParams: Promise.resolve({ memberId: invalid }) }), /NOT_FOUND/);
    assert.deepEqual(fixture.calls, []);
  }
  const missing = routeFixture({ selectedRecord: null });
  await assert.rejects(missing.route({ searchParams: Promise.resolve({ memberId }) }), /NOT_FOUND/);
});

test("the ordinary operator directory does not load a member or prefill an invitation", async () => {
  const fixture = routeFixture();
  const result = await fixture.route({});
  assert.equal(result.props.children.props.selectedMember, null);
  assert.equal(fixture.calls.some(([kind]) => kind === "member"), false);
});

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
function managerFixture(props = {}) {
  // Exercise actual component handlers with isolated hook state, without a browser,
  // database, invitation provider, or timers running on mount.
  let cursor = 0;
  const slots = [];
  const hooks = {
    ...React,
    useEffect() {},
    useMemo: (fn) => fn(),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
  };
  const Manager = load("src/components/platform/OperatorAccessManager.tsx", {
    react: hooks,
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "next/link": Link,
    "@/components/platform/operatorStyles": { OPERATOR_BUTTON_CLASS: "button", OPERATOR_FIELD_CLASS: "field", OPERATOR_LABEL_CLASS: "label", OPERATOR_LABEL_TEXT_CLASS: "labelText" },
    "@/lib/accessibility/focus": { keepFocusInside() {} },
  }).default;
  const draw = () => { cursor = 0; return Manager({ circles: [circle], initialOperators: [], currentViewerAuthUserId: "admin", preview: false, selectedMember: member, ...props }); };
  const click = (label) => {
    const target = nodes(draw()).find((node) => node.type === "button" && text(node) === label);
    assert.ok(target, `button ${label} exists`);
    target.props.onClick({ currentTarget: { focus() {} } });
  };
  return { draw, click };
}

test("opening an existing-member shortcut is read-only and requires a click before locked identity review", () => {
  const fixture = managerFixture();
  let tree = fixture.draw();
  assert.equal(nodes(tree).some((node) => node.props?.role === "dialog"), false);
  assert.equal(nodes(tree).filter((node) => node.type === "form").length, 0);
  assert.match(renderToStaticMarkup(tree), /Back to member/);
  assert.ok(nodes(tree).some((node) => node.props?.href === `/ops/members/${memberId}`));
  fixture.click("Review operator access");
  tree = fixture.draw();
  const inputs = nodes(tree).filter((node) => node.type === "input");
  for (const [name, value] of [["displayName", member.displayName], ["email", member.email]]) {
    const input = inputs.find((node) => node.props.name === name);
    assert.equal(input.props.defaultValue, value);
    assert.equal(input.props.readOnly, true);
  }
  assert.equal(inputs.find((node) => node.props.value === "guide").props.checked, true);
  assert.ok(inputs.filter((node) => node.props.type === "checkbox").every((node) => node.props.checked === false));
  const send = nodes(tree).find((node) => node.type === "button" && node.props.type === "submit");
  assert.equal(send.props.disabled, true, "member Circle is never silently copied into operator scope");
  assert.match(text(tree), /This does not place them in a Circle as a member/);
  assert.match(text(tree), /already signed in with that email/);
});

test("Administrator has no Circle prerequisite but always requires explicit full-access confirmation", () => {
  const fixture = managerFixture({ circles: [] });
  fixture.click("Review operator access");
  let tree = fixture.draw();
  assert.match(text(tree), /A Shaper or Guide needs a forming or active Circle/);
  assert.ok(nodes(tree).some((node) => node.props?.href === "/ops/circles"));
  nodes(tree).find((node) => node.type === "input" && node.props.value === "ops_admin").props.onChange();
  tree = fixture.draw();
  let send = nodes(tree).find((node) => node.type === "button" && node.props.type === "submit");
  assert.equal(send.props.disabled, true);
  assert.doesNotMatch(text(tree), /Assigned Circles/);
  assert.match(text(tree), /No Circle assignment is required/);
  nodes(tree).find((node) => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
  send = nodes(fixture.draw()).find((node) => node.type === "button" && node.props.type === "submit");
  assert.equal(send.props.disabled, false);
});

test("matching existing operator entries show their record, never a duplicate member invitation shortcut", () => {
  for (const status of ["active", "invited", "expired", "suspended"]) {
    const fixture = managerFixture({ initialOperators: [{
      id: `operator:${status}`, authUserId: ["active", "suspended"].includes(status) ? "existing-operator" : null,
      circles: [circle], displayName: member.displayName, email: " member@example.test ",
      role: "guide", status, invitedAt: null, lastSignedInAt: null,
    }] });
    const tree = fixture.draw();
    const html = renderToStaticMarkup(tree);
    assert.match(html, /Find operator record/);
    assert.doesNotMatch(html, /Review operator access/);
    assert.equal(nodes(tree).some((node) => node.props?.role === "dialog"), false);
    assert.ok(nodes(tree).some((node) => node.props?.id === `operator-row-operator:${status}`));
  }
});

test("missing member email cannot open a review and reissued Administrator invitations do not pre-confirm access", () => {
  const missing = managerFixture({ selectedMember: { ...member, email: null } });
  assert.doesNotMatch(text(missing.draw()), /Review operator access/);
  assert.match(text(missing.draw()), /Add an email on this member/);
  const fixture = managerFixture({ initialOperators: [{
    id: "invitation:admin", authUserId: null, circles: [], displayName: member.displayName,
    email: member.email, role: "ops_admin", status: "invited", invitedAt: null, lastSignedInAt: null,
  }] });
  fixture.click("Send again");
  const tree = fixture.draw();
  const consent = nodes(tree).find((node) => node.type === "input" && node.props.type === "checkbox");
  assert.equal(consent.props.checked, false);
  assert.equal(nodes(tree).find((node) => node.type === "button" && node.props.type === "submit").props.disabled, true);
});

test("the generic Add operator form cannot accidentally replace an existing email invitation", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Must not request"); });
  t.mock.method(globalThis, "FormData", function() { return { get: (key) => key === "email" ? " MEMBER@example.test " : "Example Member" }; });
  for (const status of ["active", "invited", "expired", "suspended"]) {
    const fixture = managerFixture({ selectedMember: null, initialOperators: [{
      id: `operator:${status}`, authUserId: status === "active" || status === "suspended" ? "existing-operator" : null,
      circles: [circle], displayName: member.displayName, email: "member@example.test", role: "guide",
      status, invitedAt: null, lastSignedInAt: null,
    }] });
    fixture.click("Add operator");
    await nodes(fixture.draw()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: {} });
    assert.match(text(fixture.draw()), /already has an operator record/);
  }
  assert.equal(requests, 0);
});
