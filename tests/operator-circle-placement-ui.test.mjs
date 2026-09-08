import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const noNetwork = () => { throw new Error("Real network calls are forbidden in Circle UI tests"); };
const link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
function load(path, dependencies = {}, request = noNetwork) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "FormData", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "next/link") return link;
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected Circle UI dependency: ${name}`);
  }, cjsModule, cjsModule.exports, request, class {
    constructor(values) { this.values = values; }
    get(key) { return this.values[key]; }
  });
  return cjsModule.exports;
}
const styles = { "@/components/platform/operatorStyles": load("src/components/platform/operatorStyles.ts") };
const { OpsCircleActions, getCirclePlacementIssue } = load("src/components/platform/OpsActions.tsx", styles);
const member = {
  memberId: "11111111-1111-4111-8111-111111111111", name: "Example Member", email: "member@example.test",
  accountState: "active", billingState: "active", programState: "onboarding",
  circleName: null, circleStatus: null, blockName: null, blockStatus: null,
  artifactState: "not_started", foundationsState: "in_progress", foundationsProgress: 25, nextAction: "Choose a Circle",
};
const circle = {
  id: "22222222-2222-4222-8222-222222222222", name: "Circle 01", slug: "circle-01",
  status: "forming", capacity: 10, activeMembers: 0, blockId: null, blockName: null, blockStatus: null,
};
const props = { initialCircles: [circle], members: [member], initialMemberId: member.memberId };
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
function elements(node) { return [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName); }
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const find = (tree, tag, predicate = () => true) => elements(tree).find((node) => node.tagName === tag && predicate(node));
const byId = (tree, id) => elements(tree).find((node) => attr(node, "id") === id);
const render = (overrides = {}) => parseFragment(renderToStaticMarkup(React.createElement(OpsCircleActions, { ...props, ...overrides })));
function assertNotCollapsed(node) {
  for (let parent = node; parent; parent = parent.parentNode) assert.notEqual(parent.tagName, "details", "placement and activation must not require opening a disclosure");
}

test("authorized member preselection exposes the numbered placement flow and accepts an empty forming Circle", () => {
  const tree = render();
  assertNotCollapsed(byId(tree, "assign-member"));
  assert.match(text(tree), /1\. Choose member.*2\. Choose Circle.*3\. Assign member/s);
  assert.match(text(tree), /Assign members first/);
  const memberSelect = find(tree, "select", (node) => attr(node, "name") === "memberId");
  assert.equal(attr(find(memberSelect, "option", (node) => attr(node, "value") === member.memberId), "selected"), "");
  const circleSelect = find(tree, "select", (node) => attr(node, "name") === "circleId");
  assert.match(text(circleSelect), /Circle 01 · forming · 10 spaces/);
  assert.equal(attr(find(byId(tree, "assign-member"), "button"), "disabled"), "", "explicit Circle choice is required");
  assertNotCollapsed(byId(tree, "activate-circle"));
  assert.match(text(byId(tree, "activate-circle")), /Place its first member above/);
  assert.equal(attr(find(byId(tree, "activate-circle"), "button"), "disabled"), "");
});

test("arbitrary memberId never creates an option, echoes an ID, or enables submission", () => {
  const tree = render({ initialMemberId: "<img src=x onerror=alert(1)>" });
  assert.match(text(tree), /not in the member list available to you/);
  assert.doesNotMatch(text(tree), /onerror|img src/);
  assert.equal(elements(tree).filter((node) => node.tagName === "img").length, 0);
  assert.equal(attr(find(byId(tree, "assign-member"), "button"), "disabled"), "");
});

test("blocked preselected members receive specific prerequisites and a membership review link", () => {
  for (const [changes, expected] of [
    [{ accountState: "suspended" }, /active account \(currently suspended\)/],
    [{ billingState: "pending" }, /active billing \(currently pending\)/],
    [{ programState: "paused" }, /onboarding or active program \(currently paused\)/],
    [{ circleName: "Circle 02" }, /Already assigned to Circle 02/],
  ]) {
    const tree = render({ members: [{ ...member, ...changes }] });
    assert.match(text(byId(tree, "circle-member-help")), expected);
    assert.equal(attr(find(byId(tree, "circle-member-help"), "a"), "href"), `/ops/members/${member.memberId}#membership`);
    assert.equal(attr(find(byId(tree, "assign-member"), "button"), "disabled"), "");
    const option = find(tree, "option", (node) => attr(node, "value") === member.memberId);
    assert.equal(attr(option, "disabled"), "");
  }
  assert.equal(getCirclePlacementIssue(member), null);
  assert.equal(getCirclePlacementIssue({ ...member, programState: "active" }), null);
});

test("full, archived and completed Circles cannot be selected, while active spaces remain available", () => {
  const tree = render({ initialCircles: [
    circle,
    { ...circle, id: "active", name: "Active Circle", status: "active", activeMembers: 9 },
    { ...circle, id: "full", name: "Full Circle", activeMembers: 10 },
    { ...circle, id: "archived", name: "Archived Circle", status: "archived" },
    { ...circle, id: "completed", name: "Completed Circle", status: "completed" },
  ] });
  const select = find(byId(tree, "assign-member"), "select", (node) => attr(node, "name") === "circleId");
  assert.match(text(select), /Active Circle · active · 1 space/);
  assert.doesNotMatch(text(select), /Full Circle|Archived Circle|Completed Circle/);
});

test("empty and full rosters have visible explanations and a Create Circle destination", () => {
  for (const initialCircles of [[], [{ ...circle, activeMembers: 10 }]]) {
    const tree = render({ initialCircles });
    assert.ok(byId(tree, "assign-member"));
    assert.match(text(byId(tree, "circle-space-help")), /No Circles have an open space/);
    assert.equal(attr(find(byId(tree, "circle-space-help"), "a"), "href"), "#create-circle");
  }
  assert.equal(attr(byId(render({ initialCircles: [] }), "create-circle"), "open"), "");
  assert.match(text(render({ members: [], initialMemberId: undefined })), /No members are ready for placement/);
});

test("an assigned member's forming Circle is preselected for explicit activation, but ambiguous names are not", () => {
  const assigned = { ...member, circleName: circle.name, circleStatus: "forming" };
  const readyCircle = { ...circle, activeMembers: 1 };
  const tree = render({ members: [assigned], initialCircles: [readyCircle] });
  const activation = byId(tree, "activate-circle");
  assertNotCollapsed(activation);
  assert.equal(attr(find(activation, "option", (node) => attr(node, "value") === circle.id), "selected"), "");
  assert.equal(attr(find(activation, "button"), "disabled"), undefined);
  const ambiguous = render({ members: [assigned], initialCircles: [readyCircle, { ...readyCircle, id: "duplicate-name" }] });
  assert.equal(attr(find(byId(ambiguous, "activate-circle"), "button"), "disabled"), "");
});

function interactiveHarness(response) {
  const state = [];
  const refs = [];
  const calls = [];
  let cursor = 0;
  let refCursor = 0;
  const mockedReact = { ...React,
    useEffect() {},
    useRef() { const index = refCursor++; return refs[index] ??= { current: null }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
  };
  const loadedModule = load("src/components/platform/OpsActions.tsx", { ...styles, react: mockedReact }, async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return response ?? { ok: true, json: async () => ({ assignment: { created: true } }) };
  });
  const draw = () => { cursor = 0; refCursor = 0; return loadedModule.OpsCircleActions(props); };
  return { calls, draw };
}
function reactNodes(element) {
  if (!React.isValidElement(element)) return [];
  const descendants = [];
  // Children.toArray rewrites keys; inspect the original route remount key.
  React.Children.forEach(element.props.children, (child) => descendants.push(...reactNodes(child)));
  return [element, ...descendants];
}

test("mocked placement posts only the selected IDs, then offers activation without performing it", async () => {
  const harness = interactiveHarness();
  let tree = harness.draw();
  reactNodes(tree).find((node) => node.type === "select" && node.props.name === "circleId").props.onChange({ target: { value: circle.id } });
  tree = harness.draw();
  const form = reactNodes(tree).find((node) => node.type === "form");
  assert.equal(reactNodes(form).find((node) => node.type === "button").props.disabled, false);
  await form.props.onSubmit({ preventDefault() {}, currentTarget: { memberId: member.memberId, circleId: circle.id } });
  assert.deepEqual(harness.calls.map(({ url, method, body }) => ({ url, method, body })), [{
    url: "/api/ops/circle-assignments", method: "POST", body: { memberId: member.memberId, circleId: circle.id },
  }]);
  const rendered = parseFragment(renderToStaticMarkup(harness.draw()));
  assert.match(text(rendered), /Example Member assigned to Circle 01\. Next: activate/);
  const activation = byId(rendered, "activate-circle");
  assert.equal(attr(find(activation, "option", (node) => attr(node, "value") === circle.id), "selected"), "");
  assert.equal(attr(find(activation, "button"), "disabled"), undefined);
  assert.equal(harness.calls.length, 1, "activation requires a separate deliberate submission");
});

test("mocked stale failure preserves selections; forged submission never sends a request", async () => {
  const harness = interactiveHarness({ ok: false, json: async () => ({ error: "That Circle has reached its capacity." }) });
  let tree = harness.draw();
  reactNodes(tree).find((node) => node.type === "select" && node.props.name === "circleId").props.onChange({ target: { value: circle.id } });
  tree = harness.draw();
  await reactNodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { memberId: member.memberId, circleId: circle.id } });
  let rendered = parseFragment(renderToStaticMarkup(harness.draw()));
  assert.match(text(rendered), /That Circle has reached its capacity/);
  assert.equal(attr(find(rendered, "option", (node) => attr(node, "value") === member.memberId), "selected"), "");
  assert.equal(attr(find(rendered, "option", (node) => attr(node, "value") === circle.id), "selected"), "");
  const forged = interactiveHarness();
  await reactNodes(forged.draw()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { memberId: "not-authorized", circleId: circle.id } });
  assert.equal(forged.calls.length, 0);
  rendered = parseFragment(renderToStaticMarkup(forged.draw()));
  assert.match(text(rendered), /Choose an eligible member/);
});

const stub = { __esModule: true, default: ({ children }) => React.createElement("div", null, children) };
const sectionDependencies = Object.fromEntries([
  "OperatorGoogleCommunicationField", "OperatorMemberDirectory", "OperatorPageFrame", "OperatorProgress", "StateLabel",
].map((name) => [`@/components/platform/${name}`, stub]));
sectionDependencies["@/components/platform/OperatorEmptyState"] = { __esModule: true, default: ({ actionHref, actionLabel }) => React.createElement("a", { href: actionHref }, actionLabel) };
const OpsSection = load("src/components/platform/OpsSection.tsx", sectionDependencies).default;
const dashboard = { members: [member], unassignedMembers: 1, totalMembers: 1, activeMembers: 1, attentionRequired: 0 };

test("Circle and Foundations placement links reach the exposed form, not the member directory", () => {
  const tree = parseFragment(renderToStaticMarkup(React.createElement(OpsSection, {
    actions: React.createElement(OpsCircleActions, props), circles: [circle], configuration: {}, dashboard, section: "circles",
  })));
  assertNotCollapsed(byId(tree, "assign-member"));
  assertNotCollapsed(byId(tree, "activate-circle"));
  assert.equal(attr(find(tree, "a", (node) => text(node) === "Place members"), "href"), "#assign-member");
  assert.ok(byId(tree, `circle-${circle.id}`));
  const foundations = parseFragment(renderToStaticMarkup(React.createElement(OpsSection, { canPlaceMembers: true, configuration: {}, dashboard, section: "foundations" })));
  assert.equal(attr(find(foundations, "a", (node) => text(node).includes("Place members")), "href"), "/ops/circles#assign-member");
  assert.ok(find(foundations, "a", (node) => attr(node, "href") === `/ops/circles?memberId=${member.memberId}#assign-member`));
});

test("non-admin Circle snapshot explains placement authority without offering a dead placement link", () => {
  const tree = parseFragment(renderToStaticMarkup(React.createElement(OpsSection, { circles: [circle], configuration: {}, dashboard, section: "circles" })));
  assert.match(text(tree), /An Administrator can place members/);
  assert.equal(find(tree, "a", (node) => text(node) === "Place members"), undefined);
});

test("Foundations placement links are available only to Administrators, including the route permission prop", async () => {
  let role = "ops_admin";
  const Page = load("app/ops/foundations/page.tsx", {
    "@/components/platform/OpsSection": { __esModule: true, default: OpsSection },
    "@/components/platform/PlatformUnavailable": stub,
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({
      state: "authenticated", role, dashboard, configuration: {},
    }) },
  }).default;
  for (const nextRole of ["ops_admin", "circle_leader", "guide"]) {
    role = nextRole;
    const tree = parseFragment(renderToStaticMarkup(await Page()));
    const links = elements(tree).filter((node) => node.tagName === "a" && attr(node, "href")?.startsWith("/ops/circles"));
    if (role === "ops_admin") assert.equal(links.length, 2);
    else {
      assert.equal(links.length, 0);
      assert.match(text(tree), /An Administrator can place this member/);
    }
  }
  const defaultAccess = parseFragment(renderToStaticMarkup(React.createElement(OpsSection, { configuration: {}, dashboard, section: "foundations" })));
  assert.equal(find(defaultAccess, "a", (node) => attr(node, "href")?.startsWith("/ops/circles")), undefined);
});

const rosterAssignment = {
  accountState: "active", assignedAt: "2026-09-08T12:00:00.000Z", assignmentId: "12345",
  billingState: "active", circleId: circle.id, email: "roster@example.test",
  memberId: "33333333-3333-4333-8333-333333333333", name: "Roster Member", programState: "active",
};

function circlePageFixture(overrides = {}) {
  const state = {
    role: "ops_admin", dashboard, candidates: [member], totalResults: 1,
    selectedMembers: [member], assignments: [rosterAssignment], failAt: null, ...overrides,
  };
  const reads = [];
  const Manager = ({ children }) => React.createElement("section", { "data-manager": "true" }, children);
  const Unavailable = () => React.createElement("div", { "data-unavailable": "true" }, "Unavailable");
  const read = (name, actor, input) => {
    assert.equal(actor, "verified-admin-fixture");
    reads.push({ name, actor, ...(input ? { input } : {}) });
    if (state.failAt === name) throw new Error(`Fixture ${name} unavailable`);
  };
  const Page = load("app/ops/circles/page.tsx", {
    "@/components/platform/OperatorCirclesManager": { __esModule: true, default: Manager },
    "@/components/platform/OperatorPageFrame": stub,
    "@/components/platform/OperatorGoogleCommunicationField": stub,
    "@/components/platform/OpsCircleManagementActions": stub,
    "@/components/platform/OpsSection": { __esModule: true, default: OpsSection },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: Unavailable },
    "@/lib/platform/ops-operating-repository": { getOpsCircleCommunicationDirectory: async (actor) => {
      read("communications", actor);
      return [{ ...circle, googleCommunicationsConfigured: false, chatUrl: null }];
    } },
    "@/lib/platform/ops-preview": {},
    "@/lib/platform/ops-repository": {
      getOpsCircleSummaries: async (actor) => { read("circles", actor); return [circle]; },
      getOpsCircleManagementOptions: async (actor) => { read("options", actor); return { resources: [], shapers: [] }; },
      getOpsCircleMemberAssignments: async (actor) => { read("roster", actor); return state.assignments; },
    },
    "@/lib/platform/repository": { getOperatorMemberDirectoryPage: async (actor, input) => {
      if (input.memberId !== undefined) {
        read("selected-member", actor, input);
        return { members: state.selectedMembers, totalResults: state.selectedMembers.length };
      }
      read("directory", actor, input);
      return state.failAt === "directory-null" ? null : { members: state.candidates, totalResults: state.totalResults };
    } },
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({
      state: "authenticated", role: state.role, viewer: { authUserId: "verified-admin-fixture" }, dashboard: state.dashboard, configuration: {},
    }) },
  }).default;
  return { state, reads, draw: async (parameters = {}) => {
    const element = await Page({ searchParams: Promise.resolve(parameters) });
    return {
      manager: reactNodes(element).find((node) => node.type === Manager),
      tree: parseFragment(renderToStaticMarkup(element)),
    };
  } };
}

test("Circle route passes exact roster IDs and searches all member states so unavailable matches remain explainable", async () => {
  const fixture = circlePageFixture({ totalResults: 33 });
  const { manager } = await fixture.draw({ memberId: member.memberId, circleId: circle.id, memberQuery: "  Example  " });
  assert.ok(manager);
  assert.deepEqual(manager.props.initialAssignments, [rosterAssignment]);
  assert.equal(manager.props.initialAssignments[0].memberId, rosterAssignment.memberId, "roster members need not be in the dashboard or candidate page");
  assert.equal(manager.props.initialAssignments[0].circleId, circle.id);
  assert.deepEqual(manager.props.candidates, [member]);
  assert.equal(manager.props.candidateTotal, 33);
  assert.equal(manager.props.initialMemberId, member.memberId);
  assert.equal(manager.props.initialCircleId, circle.id);
  assert.equal(manager.props.memberQuery, "Example");
  assert.equal(manager.props.preview, false);
  assert.equal(manager.key, `${member.memberId}:${circle.id}:Example`);
  assert.deepEqual(fixture.reads.find(({ name }) => name === "directory").input, { filter: "all", query: "Example", page: 1 });
  assert.equal(fixture.reads.some(({ name }) => name === "selected-member"), false, "an already-loaded exact member is not fetched twice");
});

test("Circle search remount key retains member and Circle context while rejecting array parameters", async () => {
  const fixture = circlePageFixture();
  const first = (await fixture.draw({ memberId: member.memberId, circleId: circle.id, memberQuery: "First" })).manager;
  const second = (await fixture.draw({ memberId: member.memberId, circleId: circle.id, memberQuery: "Second" })).manager;
  assert.notEqual(first.key, second.key);
  assert.equal(second.props.initialMemberId, first.props.initialMemberId);
  assert.equal(second.props.initialCircleId, first.props.initialCircleId);
  const malformed = (await fixture.draw({ memberId: [member.memberId, "another"], circleId: [circle.id], memberQuery: ["search"] })).manager;
  assert.equal(malformed.props.initialMemberId, undefined);
  assert.equal(malformed.props.initialCircleId, undefined);
  assert.equal(malformed.props.memberQuery, "");
  assert.equal(malformed.key, "::");
  const bounded = (await fixture.draw({ memberQuery: "x".repeat(200) })).manager;
  assert.equal(bounded.props.memberQuery.length, 120);
});

test("Circle route resolves a selected member outside the candidate page without widening or mutating it", async () => {
  const absentDashboard = { ...dashboard, members: Array.from({ length: 100 }, (_, index) => ({ ...member, memberId: `dashboard-${index}` })) };
  const candidates = absentDashboard.members.slice(0, 25);
  const fixture = circlePageFixture({ dashboard: absentDashboard, candidates, totalResults: 75 });
  let { manager } = await fixture.draw({ memberId: member.memberId });
  assert.deepEqual(fixture.reads.filter(({ name }) => name === "directory" || name === "selected-member").map(({ input }) => input), [
    { filter: "unassigned", query: "", page: 1 }, { memberId: member.memberId },
  ]);
  assert.equal(manager.props.candidates.length, 26);
  assert.deepEqual(manager.props.candidates.at(-1), member);
  assert.equal(manager.props.candidateTotal, 75, "targeted merge does not alter the server's candidate total");
  assert.equal(manager.props.pinnedMemberId, member.memberId, "the extra selected person is labeled separately from search matches");
  assert.equal(candidates.length, 25);
  assert.equal(absentDashboard.members.length, 100);
  fixture.state.selectedMembers = [{ ...member, accountState: "suspended", programState: "paused" }];
  ({ manager } = await fixture.draw({ memberId: member.memberId }));
  assert.match(getCirclePlacementIssue(manager.props.candidates.at(-1)), /currently suspended.*currently paused/);
  fixture.state.selectedMembers = [{ ...member, memberId: "wrong-record" }];
  ({ manager } = await fixture.draw({ memberId: member.memberId }));
  assert.equal(manager.props.candidates.length, 25);
  assert.equal(manager.props.candidates.some((candidate) => candidate.memberId === "wrong-record"), false);
  fixture.state.selectedMembers = [];
  ({ manager } = await fixture.draw({ memberId: member.memberId }));
  assert.equal(manager.props.candidates.length, 25);
});

test("Circle administration fails closed when required roster, options, directory or selected-member loads fail", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const failAt of ["circles", "options", "roster", "directory", "directory-null", "selected-member"]) {
    const fixture = circlePageFixture({ failAt, candidates: [] });
    const { manager, tree } = await fixture.draw({ memberId: member.memberId });
    assert.equal(manager, undefined, `no management controls on ${failAt} failure`);
    assert.ok(find(tree, "div", (node) => attr(node, "data-unavailable") === "true"), failAt);
  }
});

test("Shapers and Guides get a scoped Circle snapshot without manager, full roster or candidate directory reads", async () => {
  for (const role of ["circle_leader", "guide"]) {
    const fixture = circlePageFixture({ role });
    const { manager, tree } = await fixture.draw({ memberId: member.memberId, circleId: circle.id, memberQuery: "Example" });
    assert.equal(manager, undefined);
    assert.deepEqual(fixture.reads.map(({ name }) => name), ["communications"]);
    assert.match(text(tree), /An Administrator can place members/);
    assert.equal(find(tree, "a", (node) => text(node) === "Place members"), undefined);
  }
});

function directoryHarness(role = "ops_admin", rows = []) {
  const queries = [];
  const sql = async (parts, ...parameters) => {
    const statement = parts.join("?");
    queries.push({ statement, parameters });
    assert.doesNotMatch(statement, /\b(insert|update|delete|alter|grant)\b/i, "exact member lookup stays read-only");
    if (statement.includes("from platform_role_grants")) {
      assert.match(statement, /platform_user\.status = 'active'/);
      assert.match(statement, /grant_row\.revoked_at is null/);
      return role ? [{ role_slug: role }] : [];
    }
    assert.match(statement, /and \(\?::uuid is null or member\.id = \?::uuid\)/);
    assert.ok(parameters.includes(member.memberId), "exact UUID is bound as a parameter");
    assert.equal(statement.includes(member.memberId), false);
    assert.match(statement, /\? = 'ops_admin'[\s\S]*or exists[\s\S]*circle_staff_assignments[\s\S]*member_assignment\.member_id = member\.id/);
    assert.ok(parameters.includes(role), "normal role scope is preserved alongside the exact-ID restriction");
    if (statement.includes("select count(*)")) return [{ total_results: rows.length }];
    assert.match(statement, /limit \?[\s\S]*offset \?/);
    assert.deepEqual(parameters.slice(-2), [25, 0]);
    return rows;
  };
  sql.begin = async (mode, callback) => {
    assert.equal(mode, "isolation level repeatable read read only");
    return callback(sql);
  };
  const repository = load("src/lib/platform/repository.ts", {
    "server-only": {},
    "@/lib/identity/repository": {},
    "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/stripe/database": { getBillingDatabase: () => sql },
    "@/lib/stripe/membership-state": {},
    "@/lib/platform/model": load("src/lib/platform/model.ts"),
  });
  return { lookup: repository.getOperatorMemberDirectoryPage, queries };
}

test("exact member directory lookup preserves permission predicates, pagination and lifecycle fields", async () => {
  const row = {
    member_id: member.memberId, display_name: member.name, email: member.email,
    account_state: "suspended", billing_state: "active", program_state: "paused",
    foundations_state: "in_progress", foundations_progress: 25, artifact_state: "not_started",
    circle_name: null, circle_status: null, block_name: null, block_status: null,
  };
  const admin = directoryHarness("ops_admin", [row]);
  const result = await admin.lookup("admin-fixture", { memberId: member.memberId });
  assert.equal(result.members.length, 1);
  assert.equal(result.members[0].memberId, member.memberId);
  assert.equal(result.members[0].accountState, "suspended");
  assert.equal(result.members[0].programState, "paused");
  assert.match(getCirclePlacementIssue(result.members[0]), /currently suspended.*currently paused/);
  assert.equal(admin.queries.length, 3);
  const scoped = directoryHarness("circle_leader", []);
  assert.deepEqual((await scoped.lookup("shaper-fixture", { memberId: member.memberId })).members, []);
  const denied = directoryHarness(null);
  assert.equal(await denied.lookup("no-role-fixture", { memberId: member.memberId }), null);
  assert.equal(denied.queries.length, 1, "no member queries execute without an active operator role");
});

test("malformed exact member IDs fail closed rather than falling back to a full member query", async () => {
  for (const memberId of ["", "not-a-uuid", "' or true --"]) {
    const harness = directoryHarness();
    assert.equal(await harness.lookup("admin-fixture", { memberId }), null);
    assert.equal(harness.queries.length, 0);
  }
});
