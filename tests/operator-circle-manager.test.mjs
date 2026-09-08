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
const noNetwork = () => { throw new Error("No real network is allowed in Circle manager tests"); };
const link = { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
function load(path, dependencies = {}, request = noNetwork) {
  const output = ts.transpileModule(source(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", output)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "next/link") return link;
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected Circle manager dependency: ${name}`);
  }, cjsModule, cjsModule.exports, request);
  return cjsModule.exports;
}
const styles = load("src/components/platform/operatorStyles.ts");
const actions = load("src/components/platform/OpsActions.tsx", { "@/components/platform/operatorStyles": styles });
const dependencies = {
  "@/components/platform/operatorStyles": styles,
  "@/components/platform/OpsActions": { getCirclePlacementIssue: actions.getCirclePlacementIssue },
  "@/components/platform/StateLabel": { __esModule: true, default: ({ state }) => React.createElement("span", null, state) },
};
const firstCircle = {
  id: "11111111-1111-4111-8111-111111111111", name: "Circle 01", slug: "circle-01", status: "forming",
  activeMembers: 1, capacity: 10, blockId: "block-1", blockName: "Block 01", blockStatus: "forming",
  shaper: { name: "Shaper One", authUserId: "shaper-1", assignmentId: "staff-1", assignedAt: "2026-09-01T00:00:00Z" }, resources: [{ resourceId: "resource-1", label: "Circle resource" }],
};
const secondCircle = { ...firstCircle, id: "22222222-2222-4222-8222-222222222222", name: "Circle 02", slug: "circle-02", status: "active", shaper: null };
const candidate = {
  memberId: "33333333-3333-4333-8333-333333333333", name: "New Member", email: "new@example.test",
  accountState: "active", billingState: "active", programState: "onboarding", circleName: null, circleStatus: null,
  blockName: null, blockStatus: null, artifactState: "not_started", foundationsState: "in_progress", foundationsProgress: 30, nextAction: "Choose a Circle",
};
const firstAssignment = {
  assignmentId: "101", assignedAt: "2026-09-01T00:00:00Z", circleId: firstCircle.id,
  memberId: "44444444-4444-4444-8444-444444444444", name: "First Member", email: "first@example.test",
  accountState: null, billingState: null, programState: null,
};
const secondAssignment = { ...firstAssignment, assignmentId: "102", circleId: secondCircle.id, memberId: "55555555-5555-4555-8555-555555555555", name: "Other Member", email: "other@example.test", accountState: "suspended", billingState: "ended", programState: "paused" };
const defaults = {
  initialCircles: [firstCircle, secondCircle], initialAssignments: [firstAssignment, secondAssignment],
  candidates: [candidate], candidateTotal: 1, memberQuery: "", preview: false,
};
const Manager = load("src/components/platform/OperatorCirclesManager.tsx", dependencies).default;
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const byId = (node, id) => elements(node).find((item) => attr(item, "id") === id);
const visibleText = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(visibleText).join("");
const render = (props = {}) => parseFragment(renderToStaticMarkup(React.createElement(Manager, { ...defaults, ...props })));
function nodes(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}
function text(element) {
  if (element == null || typeof element === "boolean") return "";
  if (Array.isArray(element)) return element.map(text).join("");
  return typeof element === "object" ? text(element.props?.children) : String(element);
}
const ok = (payload) => ({ ok: true, json: async () => payload });
function harness(overrides = {}, request = async () => { throw new Error("Unexpected simulated request"); }) {
  const hooks = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  let props = { ...defaults, ...overrides };
  let refreshes = 0;
  const calls = [];
  const mockedReact = { ...React,
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (next) => {
        const value = typeof next === "function" ? next(hooks[index]) : next;
        if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous[i]))) {
        hooks[index] = deps;
        effects.push(effect);
      }
    },
  };
  const Component = load("src/components/platform/OperatorCirclesManager.tsx", {
    ...dependencies, react: mockedReact,
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
  }, async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return request(url, options);
  }).default;
  function draw() {
    let tree;
    for (let attempt = 0; attempt < 8; attempt++) {
      cursor = 0; dirty = false; effects = [];
      tree = Component(props);
      effects.forEach((effect) => effect());
      if (!dirty) return tree;
    }
    throw new Error("Circle manager did not settle after effects");
  }
  function button(label, tree = draw()) {
    const result = nodes(tree).find((node) => node.type === "button" && (node.props["aria-label"] === label || text(node).trim() === label));
    assert.ok(result, `button ${label} exists`);
    return result;
  }
  function click(label) { return button(label).props.onClick(); }
  function addForm(circle, tree = draw()) {
    const card = nodes(tree).find((node) => node.props?.id === `circle-${circle.id}`);
    const result = nodes(card).find((node) => node.type === "form" && node.props.onSubmit);
    assert.ok(result, `add form for ${circle.name} exists`);
    return result;
  }
  return {
    draw, button, click, addForm, calls, refreshes: () => refreshes,
    update(changes) { props = { ...props, ...changes }; return draw(); },
    open(circle) { return click(`Manage members — ${circle.name}`); },
    select(memberId, circle = firstCircle) { nodes(addForm(circle)).find((node) => node.type === "select").props.onChange({ target: { value: memberId } }); },
    submitAdd(circle = firstCircle) { return addForm(circle).props.onSubmit({ preventDefault() {} }); },
    create(name) {
      const form = nodes(draw()).find((node) => node.type === "form" && nodes(node).some((child) => child.type === "input" && child.props.name === "name"));
      nodes(form).find((node) => node.type === "input").props.onChange({ target: { value: name } });
      return nodes(draw()).find((node) => node.type === "form" && nodes(node).some((child) => child.type === "input" && child.props.name === "name")).props.onSubmit({ preventDefault() {} });
    },
  };
}

test("cards keep their own complete roster, explicit controls, and visible create form", () => {
  const page = render();
  const ids = elements(page).map((node) => attr(node, "id")).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  for (const [circle, included, excluded] of [[firstCircle, firstAssignment, secondAssignment], [secondCircle, secondAssignment, firstAssignment]]) {
    const card = byId(page, `circle-${circle.id}`);
    assert.match(visibleText(card), new RegExp(included.name));
    assert.doesNotMatch(visibleText(card), new RegExp(excluded.name));
    const toggle = elements(card).find((node) => attr(node, "aria-label") === `Manage members — ${circle.name}`);
    assert.equal(attr(toggle, "aria-expanded"), "false");
    assert.equal(attr(toggle, "aria-controls"), `roster-${circle.id}`);
    assert.equal(attr(byId(card, `roster-${circle.id}`), "hidden"), "");
    assert.ok(elements(card).some((node) => attr(node, "href") === `/ops/members/${included.memberId}`));
  }
  assert.equal(elements(page).some((node) => attr(node, "role") === "dialog"), false);
  for (let node = byId(page, "create-circle"); node; node = node.parentNode) assert.notEqual(node.tagName, "details");
  assert.match(visibleText(page), /Shaper One|Block 01/);
});

test("opening and switching Circles only changes the viewed roster and clears old removal confirmation", () => {
  const fixture = harness();
  fixture.open(firstCircle);
  fixture.click(`Remove ${firstAssignment.name} from ${firstCircle.name}`);
  assert.ok(nodes(fixture.draw()).some((node) => node.props?.["aria-label"] === "Confirm member removal"));
  fixture.open(secondCircle);
  const tree = fixture.draw();
  assert.equal(nodes(tree).find((node) => node.props?.id === `roster-${firstCircle.id}`).props.hidden, true);
  assert.equal(nodes(tree).find((node) => node.props?.id === `roster-${secondCircle.id}`).props.hidden, false);
  assert.equal(nodes(tree).some((node) => node.props?.["aria-label"] === "Confirm member removal"), false);
  assert.deepEqual(fixture.calls, []);
});

test("unknown URL targets never create candidate identities or trigger changes", () => {
  const fixture = harness({ initialCircleId: "not-authorized", initialMemberId: "<script>wrong</script>" });
  const tree = fixture.draw();
  assert.equal(nodes(tree).filter((node) => node.type === "select").every((node) => node.props.value === ""), true);
  assert.equal(nodes(tree).filter((node) => node.props?.id?.startsWith("roster-")).every((node) => node.props.hidden), true);
  assert.doesNotMatch(text(tree), /<script>|wrong/);
  assert.match(text(tree), /selected member is unavailable/);
  assert.deepEqual(fixture.calls, []);
});

test("search preserves the exact Circle and warns when candidates extend beyond the loaded page", () => {
  const page = render({ initialCircleId: secondCircle.id, candidateTotal: 101, memberQuery: "Find this member" });
  const roster = byId(page, `roster-${secondCircle.id}`);
  const search = elements(roster).find((node) => node.tagName === "form" && attr(node, "method") === "get");
  assert.equal(attr(search, "action"), "/ops/circles#assign-member");
  assert.equal(attr(elements(search).find((node) => attr(node, "name") === "circleId"), "value"), secondCircle.id);
  assert.equal(attr(elements(search).find((node) => attr(node, "name") === "memberQuery"), "value"), "Find this member");
  assert.match(visibleText(roster), /beyond these first results/);
});

test("only eligible unassigned members can be added and occupied or closed Circles have no add form", async () => {
  for (const changes of [{ accountState: "suspended" }, { billingState: "pending" }, { programState: "paused" }, { circleName: "Elsewhere" }]) {
    const fixture = harness({ initialCircleId: firstCircle.id, initialMemberId: candidate.memberId, candidates: [{ ...candidate, ...changes }] });
    assert.equal(fixture.button(`Add to ${firstCircle.name}`).props.disabled, true);
    await fixture.submitAdd();
    assert.deepEqual(fixture.calls, []);
  }
  const occupied = harness({ candidates: [{ ...candidate, memberId: firstAssignment.memberId }], initialMemberId: firstAssignment.memberId });
  assert.equal(occupied.button(`Add to ${firstCircle.name}`).props.disabled, true);
  await occupied.submitAdd();
  assert.deepEqual(occupied.calls, []);
  for (const circle of [{ ...firstCircle, activeMembers: 10 }, { ...firstCircle, status: "archived" }, { ...firstCircle, status: "completed" }]) {
    const page = render({ initialCircles: [circle], initialCircleId: circle.id });
    assert.equal(elements(byId(page, `roster-${circle.id}`)).some((node) => node.tagName === "select"), false);
  }
});

test("adding posts the exact member and Circle once, then uses the real assignment ID in its roster", async () => {
  let resolve;
  const fixture = harness({ initialCircleId: firstCircle.id }, () => new Promise((done) => { resolve = done; }));
  fixture.select(candidate.memberId);
  const oldForm = fixture.addForm(firstCircle);
  const first = oldForm.props.onSubmit({ preventDefault() {} });
  await oldForm.props.onSubmit({ preventDefault() {} });
  assert.equal(fixture.calls.length, 1, "request guard also covers duplicate clicks before React rerenders");
  assert.equal(fixture.button(`Manage members — ${secondCircle.name}`).props.disabled, true);
  resolve(ok({ assignment: { id: "103", assignedAt: "2026-09-08T00:00:00Z", circleId: firstCircle.id, memberId: candidate.memberId, created: true } }));
  await first;
  assert.deepEqual(fixture.calls, [{ url: "/api/ops/circle-assignments", method: "POST", body: { memberId: candidate.memberId, circleId: firstCircle.id } }]);
  const addedRow = nodes(fixture.draw()).find((node) => node.type === "li" && nodes(node).some((child) => child.props?.href === `/ops/members/${candidate.memberId}`));
  assert.equal(addedRow.key, "103");
  fixture.click(`Remove ${candidate.name} from ${firstCircle.name}`);
  assert.match(text(fixture.draw()), /New Member.*Circle 01/s);
  assert.equal(fixture.button("Confirm removal").props.disabled, false);
  assert.equal(fixture.refreshes(), 1);
});

test("removal is a separate confirmation bound to the displayed Circle and preserves the other roster", async () => {
  const fixture = harness({ initialCircleId: secondCircle.id }, async () => ok({ assignment: { circleId: secondCircle.id, circleStatus: "archived", blockId: "block-1", blockStatus: "archived" } }));
  fixture.click(`Remove ${secondAssignment.name} from ${secondCircle.name}`);
  assert.deepEqual(fixture.calls, []);
  assert.match(text(fixture.draw()), /last member.*Circle will be archived/s);
  await fixture.click("Confirm removal");
  assert.deepEqual(fixture.calls, [{ url: "/api/ops/circle-assignments", method: "PATCH", body: { memberId: secondAssignment.memberId, circleId: secondCircle.id } }]);
  const tree = fixture.draw();
  assert.ok(nodes(tree).some((node) => node.props?.href === `/ops/members/${firstAssignment.memberId}`));
  assert.equal(nodes(tree).some((node) => node.props?.href === `/ops/members/${secondAssignment.memberId}`), false);
  assert.match(text(tree), /account and history are unchanged/);
});

test("a changed assignment invalidates an open removal confirmation before sending", async () => {
  const fixture = harness({ initialCircleId: firstCircle.id });
  fixture.click(`Remove ${firstAssignment.name} from ${firstCircle.name}`);
  fixture.update({ initialAssignments: [{ ...firstAssignment, assignmentId: "new-assignment", circleId: secondCircle.id }, secondAssignment] });
  assert.equal(nodes(fixture.draw()).some((node) => node.type === "button" && text(node) === "Confirm removal"), false);
  assert.equal(nodes(fixture.draw()).some((node) => node.props?.["aria-label"] === "Confirm member removal"), false);
  assert.deepEqual(fixture.calls, []);
});

test("conflict or incomplete responses never report a successful removal or erase a roster entry", async () => {
  for (const response of [
    { ok: false, json: async () => ({ error: "This member's Circle changed. Refresh the roster." }) },
    ok({ assignment: { circleId: secondCircle.id } }),
    ok({ assignment: { circleId: firstCircle.id } }),
    ok({ assignment: { circleId: firstCircle.id, circleStatus: "unknown" } }),
    ok({}),
  ]) {
    const fixture = harness({ initialCircleId: firstCircle.id }, async () => response);
    fixture.click(`Remove ${firstAssignment.name} from ${firstCircle.name}`);
    await fixture.click("Confirm removal");
    const tree = fixture.draw();
    assert.ok(nodes(tree).some((node) => node.props?.href === `/ops/members/${firstAssignment.memberId}`));
    assert.ok(nodes(tree).some((node) => node.props?.role === "alert"));
    assert.equal(fixture.refreshes(), 0);
  }
});

test("incomplete or mismatched add responses leave the roster and selected member intact", async () => {
  const valid = { id: "103", assignedAt: "2026-09-08T00:00:00Z", circleId: firstCircle.id, memberId: candidate.memberId, created: true };
  for (const payload of [
    {}, { assignment: null }, { assignment: {} },
    ...[{ id: "" }, { created: undefined }, { assignedAt: "invalid" }, { memberId: firstAssignment.memberId }, { circleId: secondCircle.id }].map((change) => ({ assignment: { ...valid, ...change } })),
  ]) {
    const fixture = harness({ initialCircleId: firstCircle.id }, async () => ok(payload));
    fixture.select(candidate.memberId);
    await fixture.submitAdd();
    const tree = fixture.draw();
    assert.equal(nodes(tree).some((node) => node.props?.href === `/ops/members/${candidate.memberId}`), false);
    assert.ok(nodes(tree).some((node) => node.props?.role === "alert"));
    assert.match(text(tree), /Refresh.*before repeating/s);
    assert.equal(nodes(fixture.addForm(firstCircle)).find((node) => node.type === "select").props.value, candidate.memberId);
    assert.equal(fixture.refreshes(), 0);
  }
});

test("incomplete or mismatched activation responses preserve forming state and the specific confirmation", async () => {
  for (const payload of [
    {}, { circle: null }, { circle: {} },
    ...[{ id: secondCircle.id }, { status: "forming" }, { activeMembers: 0 }, { activeMembers: "1" }].map((change) => ({ circle: { id: firstCircle.id, status: "active", activeMembers: 1, ...change } })),
  ]) {
    const fixture = harness({ initialCircleId: firstCircle.id }, async () => ok(payload));
    fixture.click(`Activate ${firstCircle.name}`);
    await fixture.click("Confirm activation");
    const tree = fixture.draw();
    assert.ok(nodes(tree).some((node) => node.props?.["aria-label"] === "Confirm Circle activation"));
    assert.equal(fixture.button(`Activate ${firstCircle.name}`).props.disabled, false);
    assert.ok(nodes(tree).some((node) => node.props?.role === "alert"));
    assert.match(text(tree), /Shaper One/);
    assert.equal(fixture.refreshes(), 0);
  }
});

test("incomplete creation responses do not invent a new Circle or clear the entered name", async () => {
  const valid = { ...firstCircle, id: "66666666-6666-4666-8666-666666666666", name: "Circle 03", activeMembers: 0 };
  for (const payload of [
    {}, { circle: null }, { circle: {} },
    ...[{ id: "" }, { name: undefined }, { status: "active" }, { capacity: 0 }, { capacity: "10" }, { activeMembers: 1 }].map((change) => ({ circle: { ...valid, ...change } })),
  ]) {
    const fixture = harness({}, async () => ok(payload));
    await fixture.create("Circle 03");
    const tree = fixture.draw();
    assert.equal(nodes(tree).filter((node) => node.type === "article").length, 2);
    assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.name === "name").props.value, "Circle 03");
    assert.ok(nodes(tree).some((node) => node.props?.role === "alert"));
    assert.equal(fixture.refreshes(), 0);
  }
});

test("activation requires a populated forming Circle and explicit confirmation; response preserves Shaper metadata", async () => {
  const fixture = harness({ initialCircleId: firstCircle.id }, async () => ok({ circle: { id: firstCircle.id, status: "active", activeMembers: 1, activated: true } }));
  fixture.click(`Activate ${firstCircle.name}`);
  assert.deepEqual(fixture.calls, []);
  await fixture.click("Confirm activation");
  assert.deepEqual(fixture.calls, [{ url: "/api/ops/circles", method: "PATCH", body: { circleId: firstCircle.id } }]);
  assert.match(text(fixture.draw()), /Shaper One/);
  assert.match(text(fixture.draw()), /other requirements are met/);
  const empty = harness({ initialCircles: [{ ...firstCircle, activeMembers: 0 }], initialAssignments: [], initialCircleId: firstCircle.id });
  assert.equal(empty.button(`Activate ${firstCircle.name}`).props.disabled, true);
  empty.click(`Activate ${firstCircle.name}`);
  await empty.click("Confirm activation");
  assert.deepEqual(empty.calls, []);
});

test("creation posts only a name and opens the new forming Circle without assigning or activating", async () => {
  const newCircle = { ...firstCircle, id: "66666666-6666-4666-8666-666666666666", name: "Circle 03", slug: "circle-03", activeMembers: 0 };
  const fixture = harness({}, async () => ok({ circle: newCircle }));
  await fixture.create("  Circle 03  ");
  assert.deepEqual(fixture.calls, [{ url: "/api/ops/circles", method: "POST", body: { name: "Circle 03" } }]);
  const tree = fixture.draw();
  assert.equal(nodes(tree).find((node) => node.props?.id === `roster-${newCircle.id}`).props.hidden, false);
  assert.equal(fixture.button(`Activate ${newCircle.name}`).props.disabled, true);
});

test("preview interactions never fetch, refresh, or change rosters, Circle status, or Circle count", async () => {
  const fixture = harness({ initialCircleId: firstCircle.id, preview: true });
  fixture.select(candidate.memberId);
  await fixture.submitAdd();
  fixture.click(`Remove ${firstAssignment.name} from ${firstCircle.name}`);
  await fixture.click("Confirm removal");
  fixture.click(`Activate ${firstCircle.name}`);
  await fixture.click("Confirm activation");
  await fixture.create("Preview Circle");
  const tree = fixture.draw();
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.refreshes(), 0);
  assert.equal(nodes(tree).filter((node) => node.type === "article").length, 2);
  assert.ok(nodes(tree).some((node) => node.props?.href === `/ops/members/${firstAssignment.memberId}`));
  assert.equal(nodes(tree).some((node) => node.props?.href === `/ops/members/${candidate.memberId}`), false);
  assert.match(text(tree), /Preview only/);
});

test("all four Shaper and resource preview submissions return before form reads or network calls", async () => {
  let cursor = 0;
  let refreshes = 0;
  let requests = 0;
  const state = [];
  const previewReact = { ...React, useEffect() {}, useState(initial) {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
  } };
  const Component = load("src/components/platform/OpsCircleManagementActions.tsx", {
    "@/components/platform/operatorStyles": styles,
    react: previewReact,
    "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
  }, async () => { requests++; throw new Error("Preview must not request"); }).default;
  const props = { initialCircles: defaults.initialCircles, resources: [], shapers: [], preview: true };
  const draw = () => { cursor = 0; return Component(props); };
  const forms = nodes(draw()).filter((node) => node.type === "form");
  assert.equal(forms.length, 4);
  for (const form of forms) {
    await form.props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview must return before reading form data"); } });
    draw();
  }
  assert.equal(requests, 0);
  assert.equal(refreshes, 0);
  assert.strictEqual(state[0], props.initialCircles);
  assert.ok(nodes(draw()).filter((node) => node.props?.notice).every((node) => /Preview only/.test(node.props.notice.text)));
});
