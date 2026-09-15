import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const noNetwork = () => { throw new Error("Setup tests must never make a real request"); };
function load(path, { react = React, request = noNetwork, FormDataImpl = globalThis.FormData } = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "FormData", compiled)((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
    throw new Error(`Unexpected dependency ${name}`);
  }, cjsModule, cjsModule.exports, request, FormDataImpl);
  return cjsModule.exports;
}
const Component = load("src/components/platform/OpsCircleManagementActions.tsx").default;
const resourceOne = { resourceId: "resource-one", title: "First lesson", version: 1, versionId: "resource-one-v1" };
const resourceTwo = { resourceId: "resource-two", title: "Second lesson", version: 2, versionId: "resource-two-v2" };
const assignmentOne = { ...resourceOne, assignmentId: "resource-assignment-one", assignedAt: "2026-09-01", isPinned: false };
const assignmentTwo = { ...resourceTwo, assignmentId: "resource-assignment-two", assignedAt: "2026-09-01", isPinned: false };
const circles = [
  { id: "forming", name: "Circle 01", status: "forming", shaper: null, resources: [assignmentOne] },
  { id: "led", name: "Circle 02", status: "active", shaper: { assignmentId: "shaper-assignment", name: "Shaper", authUserId: "one", assignedAt: "2026-09-01" }, resources: [assignmentTwo] },
  { id: "closed", name: "Circle 03", status: "archived", shaper: null, resources: [] },
];
const nodes = (node) => [node, ...(node.childNodes ?? []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const visibleText = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(visibleText).join("");
function selectedCircleValues(initialCircleId) {
  const tree = parseFragment(renderToStaticMarkup(React.createElement(Component, { initialCircles: circles, initialCircleId, resources: [], shapers: [], preview: true })));
  const selects = nodes(tree).filter((node) => node.tagName === "select" && attr(node, "name") === "circleId");
  return { tree, values: selects.map((select) => attr(nodes(select).find((node) => node.tagName === "option" && attr(node, "selected") !== undefined), "value")) };
}
test("Circle setup preselects only the authorized open Circle, without selecting a Shaper or destructive action", () => {
  const { tree, values } = selectedCircleValues("forming");
  assert.deepEqual(values, ["forming", "forming"]);
  const otherSelects = nodes(tree).filter((node) => node.tagName === "select" && attr(node, "name") !== "circleId");
  for (const select of otherSelects) assert.equal(attr(nodes(select).find((node) => node.tagName === "option" && attr(node, "selected") !== undefined), "value"), "");
});

test("split Shaper section is saved-state first and does not repeat Circle or resource selectors", async () => {
  const f = fixture({ initialCircleId: "led", section: "shaper" });
  assert.match(elementText(f.draw()), /Shaper/);
  assert.equal(elements(f.draw()).some((node) => node.type === "form"), false);
  assert.equal(elements(f.draw()).some((node) => node.type === "select"), false);
  f.click("Edit Shaper");
  assert.equal(elements(f.draw()).some((node) => node.type === "form"), false, "Edit never silently removes the current Shaper");
  f.click("Remove Shaper");
  assert.equal(f.requests.length, 0);
  assert.equal(f.draw().props["data-operator-dirty"], "true");
  assert.ok(elements(f.form("endShaper")).some((node) => node.type === "input" && node.props.type === "hidden" && node.props.value === "shaper-assignment"));
  f.click("Cancel");
  assert.equal(f.form("endShaper"), undefined);
  assert.equal(f.requests.length, 0);
});

test("split Shaper assignment retains exact scope and the pending/dirty modal guards", async () => {
  let resolve;
  const f = fixture({ initialCircleId: "forming", section: "shaper" }, () => new Promise((done) => { resolve = done; }));
  f.click("Assign Shaper");
  assert.equal(f.select("assignShaper", "circleId"), undefined, "there is no second Circle choice inside its manager");
  f.change("assignShaper", "shaperAuthUserId", "one");
  assert.equal(f.draw().props["data-operator-dirty"], "true");
  await f.submit("assignShaper", { circleId: "led", shaperAuthUserId: "one" });
  assert.equal(f.requests.length, 0);
  const saving = f.submit("assignShaper", { circleId: "forming", shaperAuthUserId: "one" });
  assert.equal(f.draw().props["data-operator-pending"], "true");
  resolve(Response.json({ assignment: { assignmentId: "new-shaper", assignedAt: "2026-09-15" } }));
  await saving;
  assert.deepEqual(f.requests[0].body, { circleId: "forming", shaperAuthUserId: "one" });
  assert.equal(f.form("assignShaper"), undefined);
  assert.equal(f.draw().props["data-operator-pending"], undefined);
  assert.equal(f.draw().props["data-operator-dirty"], undefined);
  assert.match(elementText(f.draw()), /Shaper One/);
});

test("split resources show saved titles and only explicit Add/Remove reveals a scoped form", async () => {
  const f = fixture({ initialCircleId: "forming", section: "resources" });
  assert.match(elementText(f.draw()), /First lesson/);
  assert.doesNotMatch(elementText(f.draw()), /Second lesson|Circle 02/);
  assert.equal(elements(f.draw()).some((node) => node.type === "form"), false);
  f.click("Add resource");
  f.change("assignResource", "resourceId", "resource-two");
  assert.equal(f.select("assignResource", "circleId"), undefined);
  await f.submit("assignResource", { circleId: "led", resourceId: "resource-two" });
  assert.equal(f.requests.length, 0);
  f.click("Cancel");
  assert.equal(f.draw().props["data-operator-dirty"], undefined);
  f.click("Remove First lesson");
  assert.equal(f.requests.length, 0);
  assert.match(elementText(f.draw()), /version history is kept/);
  await f.submit("endResource", { assignmentId: "resource-assignment-two" });
  assert.equal(f.requests.length, 0);
  await f.submit("endResource", { assignmentId: "resource-assignment-one" });
  assert.deepEqual(f.requests[0].body, { assignmentId: "resource-assignment-one" });
  assert.match(elementText(f.draw()), /No resources shared yet/);
});
test("an existing Shaper cannot be overwritten by a Circle deep link", () => {
  assert.deepEqual(selectedCircleValues("led").values, ["", "led"]);
});
test("unknown or retired Circle context fails closed; only an absent context offers all current Circles", () => {
  for (const id of ["closed", "missing"]) {
    const { tree, values } = selectedCircleValues(id);
    assert.deepEqual(values, []);
    assert.equal(nodes(tree).some((node) => node.tagName === "form"), false);
    assert.match(visibleText(tree), /no longer available/);
    assert.ok(nodes(tree).some((node) => attr(node, "href") === "/ops/circles"));
  }
  assert.deepEqual(selectedCircleValues(undefined).values, ["", ""]);
});
test("empty setup options have concrete next steps, not permanently disabled controls without explanation", () => {
  const { tree } = selectedCircleValues("forming");
  const hrefs = nodes(tree).filter((node) => node.tagName === "a").map((node) => attr(node, "href"));
  assert.ok(hrefs.includes("/ops/operators?add=1"));
  assert.ok(hrefs.includes("/ops/academy"));
  assert.match(visibleText(tree), /assignment is created when they accept/);
  assert.match(visibleText(tree), /no need to assign them again/);
});

test("explicit Circle context restricts both creation and destructive assignment choices to that Circle", () => {
  const { tree } = selectedCircleValues("forming");
  assert.match(visibleText(tree), /Managing Circle 01 only/);
  assert.doesNotMatch(visibleText(tree), /Circle 02|Second lesson/);
  const values = nodes(tree).filter((node) => node.tagName === "option").map((node) => attr(node, "value"));
  assert.ok(values.includes("resource-assignment-one"));
  assert.equal(values.includes("resource-assignment-two"), false);
  assert.equal(values.includes("shaper-assignment"), false);
});

const elements = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const elementText = (node) => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(elementText).join("") : typeof node === "object" ? elementText(node.props?.children) : String(node);
function fixture(patch = {}, respond = () => Response.json({ assignment: { assignmentId: "saved", assignedAt: "2026-09-09", created: true } })) {
  let props = { initialCircles: circles, resources: [resourceOne, resourceTwo], shapers: [{ authUserId: "one", name: "Shaper One" }, { authUserId: "two", name: "Shaper Two" }], preview: false, ...patch };
  const slots = [];
  const effects = [];
  const requests = [];
  let cursor = 0;
  let dirty = false;
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; dirty = true; }
      }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((item, offset) => !Object.is(item, slots[index][offset]))) {
        slots[index] = deps;
        effects.push(fn);
      }
    },
  };
  const Subject = load("src/components/platform/OpsCircleManagementActions.tsx", {
    react: hooks,
    request: async (url, options) => { const request = { url, ...options, body: JSON.parse(options.body) }; requests.push(request); return respond(request); },
    FormDataImpl: function (form) { return { get: (key) => form.fields[key] ?? null }; },
  }).default;
  function draw(flush = true) {
    let tree;
    let turns = 0;
    do {
      if (++turns > 10) throw new Error("Circle setup effects did not settle");
      cursor = 0; dirty = false;
      tree = Subject(props);
      if (flush) while (effects.length) effects.shift()();
    } while (flush && dirty);
    return tree;
  }
  const form = (action, tree = draw()) => elements(tree).find((node) => node.type === "form" && node.props.onSubmit.name === action);
  const select = (action, name, tree) => elements(form(action, tree)).find((node) => node.type === "select" && node.props.name === name);
  return { draw, form, select, requests,
    click(label) {
      const button = elements(draw()).find((node) => node.type === "button" && (node.props["aria-label"] === label || elementText(node) === label));
      assert.ok(button, `${label} is visible`);
      return button.props.onClick();
    },
    change(action, name, value) { select(action, name).props.onChange({ target: { value } }); return draw(); },
    rerender(patch, flush = true) { props = { ...props, ...patch }; return draw(flush); },
    submit(action, fields) { return form(action).props.onSubmit({ preventDefault() {}, currentTarget: { fields, reset() {} } }); },
  };
}

test("all selects are controlled and an ineligible Circle clears immediately without selecting a replacement", () => {
  const f = fixture();
  for (const node of elements(f.draw()).filter((node) => node.type === "select")) {
    assert.equal(typeof node.props.value, "string");
    assert.equal(node.props.defaultValue, undefined);
    assert.equal(typeof node.props.onChange, "function");
  }
  f.change("assignShaper", "circleId", "forming");
  f.change("assignResource", "circleId", "forming");
  const immediate = f.rerender({ initialCircles: circles.map((circle) => circle.id === "forming" ? { ...circle, status: "archived" } : circle) }, false);
  assert.equal(f.select("assignShaper", "circleId", immediate).props.value, "");
  assert.equal(f.select("assignResource", "circleId", immediate).props.value, "");
  f.draw();
  f.rerender({ initialCircles: circles });
  assert.equal(f.select("assignShaper", "circleId").props.value, "");
  assert.equal(f.select("assignResource", "circleId").props.value, "", "a returning option must be deliberately selected again");
});

test("a refreshed Shaper assignment invalidates only the now-ineligible Circle selector, never choosing another Circle", () => {
  const f = fixture({ initialCircleId: "forming" });
  const refreshed = circles.map((circle) => circle.id === "forming" ? { ...circle, shaper: circles[1].shaper } : circle);
  const tree = f.rerender({ initialCircles: refreshed }, false);
  assert.equal(f.select("assignShaper", "circleId", tree).props.value, "");
  assert.equal(f.select("assignResource", "circleId", tree).props.value, "forming");
});

test("removed Shaper, publication, or exact resource version is cleared rather than replaced", () => {
  const f = fixture({ initialCircleId: "forming" });
  f.change("assignShaper", "shaperAuthUserId", "one");
  f.change("assignResource", "resourceId", "resource-one");
  let tree = f.rerender({ shapers: [{ authUserId: "two", name: "Shaper Two" }], resources: [resourceTwo] }, false);
  assert.equal(f.select("assignShaper", "shaperAuthUserId", tree).props.value, "");
  assert.equal(f.select("assignResource", "resourceId", tree).props.value, "");
  f.draw();
  f.rerender({ resources: [resourceOne, resourceTwo] });
  assert.equal(f.select("assignResource", "resourceId").props.value, "");
  f.change("assignResource", "resourceId", "resource-one");
  tree = f.rerender({ resources: [{ ...resourceOne, version: 2, versionId: "resource-one-v2" }, resourceTwo] }, false);
  assert.equal(f.select("assignResource", "resourceId", tree).props.value, "");
});

test("removed destructive assignment choices clear immediately and cannot target their replacement", async () => {
  const f = fixture({ initialCircleId: "led" });
  f.change("endShaper", "assignmentId", "shaper-assignment");
  f.change("endResource", "assignmentId", "resource-assignment-two");
  const refreshed = circles.map((circle) => circle.id === "led" ? {
    ...circle, shaper: { ...circle.shaper, assignmentId: "replacement-shaper" }, resources: [{ ...assignmentTwo, assignmentId: "replacement-resource" }],
  } : circle);
  const tree = f.rerender({ initialCircles: refreshed }, false);
  assert.equal(f.select("endShaper", "assignmentId", tree).props.value, "");
  assert.equal(f.select("endResource", "assignmentId", tree).props.value, "");
  await f.submit("endShaper", { assignmentId: "replacement-shaper" });
  await f.submit("endResource", { assignmentId: "replacement-resource" });
  assert.equal(f.requests.length, 0);
});

test("changing explicit context clears unrelated choices, and retired or removed context offers no mutation forms", () => {
  const f = fixture({ initialCircleId: "forming" });
  f.change("assignShaper", "shaperAuthUserId", "one");
  f.change("assignResource", "resourceId", "resource-one");
  f.change("endResource", "assignmentId", "resource-assignment-one");
  let tree = f.rerender({ initialCircleId: "led" }, false);
  assert.equal(f.select("assignResource", "circleId", tree).props.value, "led");
  for (const [action, name] of [["assignShaper", "shaperAuthUserId"], ["assignResource", "resourceId"], ["endResource", "assignmentId"]]) assert.equal(f.select(action, name, tree).props.value, "");
  f.draw();
  tree = f.rerender({ initialCircles: circles.filter((circle) => circle.id !== "led") }, false);
  assert.equal(elements(tree).some((node) => node.type === "form"), false);
  f.draw();
  tree = f.rerender({ initialCircles: circles.map((circle) => circle.id === "led" ? { ...circle, status: "completed" } : circle) });
  assert.equal(elements(tree).some((node) => node.type === "form"), false);
  assert.equal(f.requests.length, 0);
});

test("contextual handlers reject injected cross-Circle targets and unselected assignment IDs", async () => {
  const f = fixture({ initialCircleId: "forming" });
  f.change("assignShaper", "shaperAuthUserId", "one");
  f.change("assignResource", "resourceId", "resource-one");
  await f.submit("assignShaper", { circleId: "led", shaperAuthUserId: "one" });
  await f.submit("assignResource", { circleId: "led", resourceId: "resource-one" });
  assert.equal(f.form("endShaper"), undefined, "a Shaper from another Circle is not even offered for removal");
  await f.submit("endResource", { assignmentId: "resource-assignment-two" });
  assert.equal(f.requests.length, 0);
  const led = fixture({ initialCircleId: "led" });
  await led.submit("endShaper", { assignmentId: "shaper-assignment" });
  assert.equal(led.requests.length, 0, "even a current assignment requires explicit selection");
});

test("explicit valid selections preserve all four existing endpoint and payload contracts", async () => {
  const cases = [
    ["assignShaper", "forming", [["shaperAuthUserId", "one"]], { circleId: "forming", shaperAuthUserId: "one" }, "/api/ops/circle-shaper-assignments", "POST"],
    ["endShaper", "led", [["assignmentId", "shaper-assignment"]], { assignmentId: "shaper-assignment" }, "/api/ops/circle-shaper-assignments", "PATCH"],
    ["assignResource", "forming", [["resourceId", "resource-one"]], { circleId: "forming", resourceId: "resource-one", isPinned: false }, "/api/ops/circle-resources", "POST"],
    ["endResource", "led", [["assignmentId", "resource-assignment-two"]], { assignmentId: "resource-assignment-two" }, "/api/ops/circle-resources", "PATCH"],
  ];
  for (const [action, initialCircleId, selections, body, url, method] of cases) {
    const f = fixture({ initialCircleId });
    for (const [name, value] of selections) f.change(action, name, value);
    await f.submit(action, body);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0].body, body);
    assert.equal(f.requests[0].url, url);
    assert.equal(f.requests[0].method, method);
    assert.equal(f.requests[0].headers["Content-Type"], "application/json");
  }
});

test("preview handlers remain inert before even reading a form", async () => {
  const f = fixture({ initialCircleId: "led", preview: true });
  const forms = elements(f.draw()).filter((node) => node.type === "form");
  assert.equal(forms.length, 4);
  for (const form of forms) await form.props.onSubmit({ preventDefault() {}, get currentTarget() { throw new Error("Preview must not inspect a form"); } });
  assert.equal(f.requests.length, 0);
});

test("empty Circle shows concise status instead of disabled removal forms, with human action labels", () => {
  const f = fixture({ initialCircleId: "forming", initialCircles: [{ ...circles[0], resources: [] }, circles[1]] });
  assert.equal(f.form("endShaper"), undefined);
  assert.equal(f.form("endResource"), undefined);
  const tree = parseFragment(renderToStaticMarkup(f.draw()));
  assert.match(visibleText(tree), /No Shaper assigned yet/);
  assert.match(visibleText(tree), /No resources shared yet/);
  assert.match(visibleText(tree), /Add resource/);
  const filled = parseFragment(renderToStaticMarkup(fixture({ initialCircleId: "led" }).draw()));
  assert.match(visibleText(filled), /Remove Shaper/);
  assert.match(visibleText(filled), /Remove resource/);
  assert.match(visibleText(filled), /Second lesson · v2/);
});
