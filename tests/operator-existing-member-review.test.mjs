import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function load(path, overrides, environment = {}) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "window", "document", output)((name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected test dependency: ${name}`);
  }, cjsModule, cjsModule.exports, environment.window, environment.document);
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
function routeFixture({ role = "ops_admin", state = "connected", selectedRecord = record, memberRows } = {}) {
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
      state, role, dashboard: { members: [{ memberId, name: member.displayName, email: member.email }] }, viewer: { authUserId: "verified-admin" },
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
    "@/lib/platform/repository": { getOperatorMemberDirectoryPage: async (...args) => {
      calls.push(["memberSearch", ...args]);
      if (memberRows === null) return null;
      return { members: memberRows ?? [{ memberId, name: member.displayName, email: member.email, PRIVATE_FIELD: "DO_NOT_FORWARD" }],
        page: 1, pageCount: 1, query: args[1].query, totalResults: 1 };
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
  const effects = [];
  const focusCalls = [];
  const listeners = new Map();
  const focusTraps = [];
  const clearedTimers = [];
  const effectDependencies = [];
  const hooks = {
    ...React,
    useEffect(effect, dependencies) { effects.push(effect); effectDependencies.push(dependencies); },
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
    "@/components/platform/OperatorAccessEditor": { __esModule: true, default: () => null },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "next/link": Link,
    "@/components/platform/operatorStyles": { OPERATOR_BUTTON_CLASS: "button", OPERATOR_FIELD_CLASS: "field", OPERATOR_LABEL_CLASS: "label", OPERATOR_LABEL_TEXT_CLASS: "labelText" },
    "@/lib/accessibility/focus": { keepFocusInside: (...args) => focusTraps.push(args) },
  }, { window: { setTimeout: (fn) => { fn(); return 1; }, clearTimeout: (id) => clearedTimers.push(id) }, document: {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
    getElementById: (id) => ({ scrollIntoView: () => focusCalls.push(["scroll", id]), focus: () => focusCalls.push(["focus", id]) }),
  } }).default;
  const draw = () => { cursor = 0; effects.length = 0; effectDependencies.length = 0; return Manager({ circles: [circle], initialOperators: [], currentViewerAuthUserId: "admin", preview: false, selectedMember: member, ...props }); };
  const click = (label) => {
    const target = nodes(draw()).find((node) => node.type === "button" && text(node) === label);
    assert.ok(target, `button ${label} exists`);
    target.props.onClick({ currentTarget: { focus() {} } });
  };
  return { draw, click, effects, effectDependencies, focusCalls, listeners, focusTraps, clearedTimers };
}

test("an authorized existing-member shortcut opens only a locked identity review, never sends automatically", (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("No automatic request"); });
  const fixture = managerFixture();
  const tree = fixture.draw();
  assert.equal(nodes(tree).filter((node) => node.props?.role === "dialog").length, 1);
  assert.equal(nodes(tree).filter((node) => node.type === "form").length, 1);
  assert.match(renderToStaticMarkup(tree), /Back to member/);
  assert.ok(nodes(tree).some((node) => node.props?.href === `/ops/members/${memberId}`));
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
  assert.match(text(tree), /open member sign-in to accept and, if asked, verify the newest email code/);
  assert.equal(requests, 0);
});

test("Administrator has no Circle prerequisite but always requires explicit full-access confirmation", () => {
  const fixture = managerFixture({ circles: [] });
  let tree = fixture.draw();
  assert.match(text(tree), /A Shaper or Guide needs a forming or active Circle/);
  assert.ok(nodes(tree).some((node) => node.props?.href === "/ops/circles"));
  nodes(tree).find((node) => node.type === "input" && node.props.value === "ops_admin").props.onChange();
  tree = fixture.draw();
  let send = nodes(tree).find((node) => node.type === "button" && node.props.type === "submit");
  assert.equal(send.props.disabled, true);
  assert.doesNotMatch(text(tree), /Circles they help manage/);
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

test("member search reuses the authorized server directory with bounded input and sends minimal identity props", async () => {
  const fixture = routeFixture();
  const result = await fixture.route({ searchParams: Promise.resolve({ chooseMember: "1", memberQuery: "  Example   Member  ", memberPage: "2" }) });
  assert.deepEqual(fixture.calls.find(([kind]) => kind === "memberSearch"), ["memberSearch", "verified-admin", { filter: "all", query: "Example Member", page: 2 }]);
  const props = result.props.children.props;
  assert.deepEqual(props.memberSearch.members, [member]);
  assert.equal(props.initialMemberPickerOpen, true);
  assert.equal(props.initialAddOpen, false);
  assert.doesNotMatch(JSON.stringify(props), /DO_NOT_FORWARD|PRIVATE_FIELD/);
  const bounded = routeFixture();
  await bounded.route({ searchParams: Promise.resolve({ memberQuery: "x".repeat(160), memberPage: "-3" }) });
  assert.deepEqual(bounded.calls.find(([kind]) => kind === "memberSearch")[2], { filter: "all", query: "x".repeat(120), page: 1 });
  const missing = routeFixture({ memberRows: null });
  assert.equal((await missing.route({})).type, missing.unavailable);
});

test("add query opens only an explicit review, while preview member search never reads live records", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("No automatic request"); });
  const fixture = routeFixture();
  const result = await fixture.route({ searchParams: Promise.resolve({ add: "1" }) });
  assert.equal(result.props.children.props.initialAddOpen, true);
  const form = managerFixture({ selectedMember: null, initialAddOpen: true });
  assert.equal(nodes(form.draw()).filter((node) => node.props?.role === "dialog").length, 1);
  assert.equal(nodes(form.draw()).find((node) => node.props?.name === "email").props.defaultValue, "");
  assert.equal(requests, 0);
  const preview = routeFixture({ state: "preview" });
  const search = await preview.route({ searchParams: Promise.resolve({ chooseMember: "1", memberQuery: "member", memberPage: "9000" }) });
  assert.deepEqual(preview.calls, []);
  assert.deepEqual(search.props.children.props.memberSearch.members, [member]);
  assert.equal(search.props.children.props.memberSearch.page, 1);
});

const memberSearch = { members: [member], page: 1, pageCount: 1, query: "", totalResults: 1 };

test("in-place member selection is one click to review and never navigates through the Members directory", (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("No automatic request"); });
  const fixture = managerFixture({ selectedMember: null, memberSearch });
  let tree = fixture.draw();
  assert.ok(!nodes(tree).some((node) => node.props?.href === "/ops/members"));
  assert.ok(!nodes(tree).some((node) => node.type === "h2" && text(node) === "Operators"), "shared page heading is not duplicated");
  fixture.click("Choose existing member");
  tree = fixture.draw();
  const searchForm = nodes(tree).find((node) => node.type === "form");
  assert.equal(searchForm.props.method, "get");
  assert.equal(searchForm.props.action, "/ops/operators#choose-operator-member");
  fixture.click("Review access");
  tree = fixture.draw();
  assert.equal(nodes(tree).filter((node) => node.props?.role === "dialog").length, 1);
  assert.equal(nodes(tree).find((node) => node.props?.name === "email").props.defaultValue, member.email);
  assert.equal(nodes(tree).find((node) => node.props?.name === "email").props.readOnly, true);
  assert.equal(requests, 0);
  fixture.click("Cancel");
  assert.ok(!nodes(fixture.draw()).some((node) => node.props?.role === "dialog"));
  assert.equal(requests, 0);
});

test("existing active, pending, expired, and suspended matches focus their operator record instead of offering another invitation", (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("No automatic request"); });
  for (const status of ["active", "invited", "expired", "suspended"]) {
    const entry = { id: `operator:${status}`, authUserId: ["active", "suspended"].includes(status) ? "operator-user" : null,
      email: " member@example.test ", displayName: member.displayName, circles: [], role: "ops_admin", status,
      invitedAt: null, lastSignedInAt: null };
    const fixture = managerFixture({ selectedMember: null, memberSearch, initialMemberPickerOpen: true, initialOperators: [entry] });
    assert.ok(!nodes(fixture.draw()).some((node) => node.type === "button" && text(node) === "Review access"));
    fixture.click("View operator record");
    assert.deepEqual(fixture.focusCalls, [["scroll", `operator-row-${entry.id}`], ["focus", `operator-row-${entry.id}`]]);
    assert.ok(!nodes(fixture.draw()).some((node) => node.props?.role === "dialog"));
  }
  assert.equal(requests, 0);
});

test("member picker handles pagination, no matches, and missing email without losing the operator task", () => {
  const paged = managerFixture({ selectedMember: null, initialMemberPickerOpen: true,
    memberSearch: { ...memberSearch, page: 2, pageCount: 3, query: "A & B", totalResults: 60 } });
  const links = nodes(paged.draw()).filter((node) => node.props?.href?.includes("memberPage="));
  assert.equal(links.length, 2);
  for (const link of links) {
    const url = new URL(link.props.href, "https://members.example.test");
    assert.equal(url.pathname, "/ops/operators");
    assert.equal(url.searchParams.get("chooseMember"), "1");
    assert.equal(url.searchParams.get("memberQuery"), "A & B");
    assert.equal(url.hash, "#choose-operator-member");
  }
  const empty = managerFixture({ selectedMember: null, initialMemberPickerOpen: true,
    memberSearch: { ...memberSearch, members: [], totalResults: 0 } });
  assert.match(text(empty.draw()), /No members match.*Add operator/);
  const missing = managerFixture({ selectedMember: null, initialMemberPickerOpen: true,
    memberSearch: { ...memberSearch, members: [{ ...member, email: null }] } });
  assert.ok(nodes(missing.draw()).some((node) => node.props?.href === `/ops/members/${memberId}#membership`));
  assert.ok(!nodes(missing.draw()).some((node) => node.type === "button" && text(node) === "Review access"));
});

test("picker focus, role-review focus, dialog tab trap, Escape, and cleanup remain keyboard safe", () => {
  const picker = managerFixture({ selectedMember: null, initialMemberPickerOpen: true, memberSearch });
  const tree = picker.draw();
  let searched = 0;
  nodes(tree).find((node) => node.props?.id === "operator-member-search").props.ref.current = { focus: () => searched++ };
  const cleanups = picker.effects.map((effect) => effect()).filter(Boolean);
  assert.equal(searched, 1);
  cleanups.forEach((cleanup) => cleanup());
  assert.ok(picker.clearedTimers.length > 0);

  const review = managerFixture();
  let roleFocused = 0;
  let triggerFocused = 0;
  const dialogTree = review.draw();
  nodes(dialogTree).find((node) => node.type === "input" && node.props?.value === "guide").props.ref.current = { focus: () => roleFocused++ };
  nodes(dialogTree).find((node) => node.type === "button" && text(node) === "Add operator").props.ref.current = { focus: () => triggerFocused++ };
  const reviewCleanups = review.effects.map((effect) => effect()).filter(Boolean);
  assert.equal(roleFocused, 1, "a selected identity starts at responsibility, not a read-only name field");
  review.listeners.get("keydown")({ key: "Tab" });
  assert.equal(review.focusTraps.length, 1);
  review.listeners.get("keydown")({ key: "Escape" });
  assert.equal(triggerFocused, 1);
  assert.ok(!nodes(review.draw()).some((node) => node.props?.role === "dialog"));
  reviewCleanups.forEach((cleanup) => cleanup());
  assert.equal(review.listeners.has("keydown"), false);
});

test("closing a picker result review restores its trigger without retriggering search focus", () => {
  const fixture = managerFixture({ selectedMember: null, initialMemberPickerOpen: true, memberSearch });
  let focused = 0;
  let tree = fixture.draw();
  const pickerDependencies = [...fixture.effectDependencies[1]];
  nodes(tree).find((node) => node.type === "button" && text(node) === "Review access").props.onClick({ currentTarget: { focus: () => focused++ } });
  fixture.draw();
  assert.deepEqual(fixture.effectDependencies[1], pickerDependencies);
  fixture.click("Cancel");
  tree = fixture.draw();
  assert.equal(focused, 1);
  assert.deepEqual(fixture.effectDependencies[1], pickerDependencies, "React will not rerun the search-focus effect on dialog close");
  assert.ok(!nodes(tree).some((node) => node.props?.role === "dialog"));
});

test("explicit preview invitation stays local and the live form reports an undelivered saved invitation as pending", async (t) => {
  const sentBodies = [];
  t.mock.method(globalThis, "FormData", function() { return { get: (key) => key === "email" ? member.email : member.displayName }; });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sentBodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ delivery: "not_sent", invitation: {
      entry: { id: "invitation:new", email: member.email, displayName: member.displayName, authUserId: null,
        role: "ops_admin", status: "invited", circles: [], invitedAt: null, lastSignedInAt: null },
      expiresAt: "2026-09-16T00:00:00Z", reissued: false,
    } }) };
  });
  for (const preview of [true, false]) {
    const fixture = managerFixture({ preview });
    nodes(fixture.draw()).find((node) => node.type === "input" && node.props?.value === "ops_admin").props.onChange();
    nodes(fixture.draw()).find((node) => node.props?.type === "checkbox").props.onChange({ target: { checked: true } });
    const submit = nodes(fixture.draw()).find((node) => node.type === "form").props.onSubmit;
    const first = submit({ preventDefault() {}, currentTarget: {} });
    const second = submit({ preventDefault() {}, currentTarget: {} });
    await Promise.all([first, second]);
    if (preview) {
      assert.match(text(fixture.draw()), /Preview invitation created.*No email was sent/);
      assert.equal(sentBodies.length, 0);
    } else {
      assert.match(text(fixture.draw()), /email was not delivered.*Access is still pending/);
      assert.deepEqual(sentBodies, [{ circleIds: [], displayName: member.displayName, email: member.email, role: "ops_admin" }]);
    }
  }
});
