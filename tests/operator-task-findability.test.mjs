import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const noNetwork = () => { throw new Error("Real requests are forbidden in operator UI tests"); };
function loader({ react = React, request = noNetwork, extra = {}, router = {} } = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const output = ts.transpileModule(read(path), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    new Function("require", "module", "exports", "fetch", "FormData", output)((name) => {
      if (Object.hasOwn(extra, name)) return extra[name];
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {}, ...router }), redirect() { throw new Error("Unexpected redirect"); } };
      if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
      if (name === "@/components/platform/OperatorPageFrame") return { __esModule: true, default: ({ children }) => React.createElement("main", null, children) };
      if (name === "@/components/platform/OperatorGoogleCommunicationField") return { __esModule: true, default: () => React.createElement("div", null, "Google link") };
      if (/^@\/(components\/platform|lib\/(platform|datetime))\//.test(name)) {
        const local = `src/${name.slice(2)}`;
        const target = [".ts", ".tsx"].map((extension) => local + extension).find((candidate) => existsSync(new URL(candidate, root)));
        assert.ok(target, `dependency ${name} exists`);
        assert.doesNotMatch(target, /repository|database|identity/, "UI test must never load a live data module");
        return load(target);
      }
      throw new Error(`Unexpected dependency ${name}`);
    }, { exports }, exports, request, class {
      constructor(values) { this.values = values; }
      get(key) { return this.values[key] ?? null; }
      getAll(key) { return Array.isArray(this.values[key]) ? this.values[key] : []; }
    });
    return exports;
  }
  return load;
}
const load = loader();
const preview = load("src/lib/platform/ops-preview.ts");
const academy = load("src/lib/platform/ops-academy-preview.ts");
const experiences = load("src/lib/platform/ops-experience-preview.ts");
const experience = Object.values(experiences.PREVIEW_OPS_EXPERIENCE_RECORDS)[0];
const component = (name) => load(`src/components/platform/${name}.tsx`).default;
const render = (name, props) => parseFragment(renderToStaticMarkup(React.createElement(component(name), props)));
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const byId = (node, id) => elements(node).find((item) => attr(item, "id") === id);
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
function exposed(node) {
  assert.ok(node, "target exists");
  for (let current = node; current; current = current.parentNode) {
    assert.notEqual(current.tagName, "details", "routine actions are not inside a disclosure");
    assert.equal(attr(current, "hidden"), undefined);
  }
}
function anchorsResolve(tree) {
  const ids = elements(tree).map((node) => attr(node, "id")).filter(Boolean);
  assert.equal(ids.length, new Set(ids).size, "IDs are unique");
  for (const link of elements(tree).filter((node) => node.tagName === "a" && attr(node, "href")?.startsWith("#"))) assert.ok(byId(tree, attr(link, "href").slice(1)), `target ${attr(link, "href")} exists`);
}
function nodes(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  return [element, ...nodes(element.props?.children)];
}
function reactText(element) {
  if (element == null || typeof element === "boolean") return "";
  if (Array.isArray(element)) return element.map(reactText).join("");
  return typeof element === "object" ? reactText(element.props?.children) : String(element);
}
function harness(path, name, props, request = async () => ({ ok: true, json: async () => ({}) })) {
  let cursor = 0;
  const state = [];
  const calls = [];
  let refreshes = 0;
  const mockedReact = { ...React,
    useEffect() {}, useContext() { return Boolean(props.preview); }, useMemo(work) { return work(); },
    useRef(initial) { const index = cursor++; return state[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
  };
  const loaded = loader({ react: mockedReact, router: { refresh() { refreshes++; } }, request: async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) }); return request(url, options);
  } })(path);
  const Component = loaded[name];
  const draw = () => { cursor = 0; return Component(props); };
  return { draw, calls, state, refreshes: () => refreshes, invoke: (fn, input) => { cursor = 0; state.length = 0; return fn(input); } };
}
const previewEvent = { preventDefault() {}, get currentTarget() { throw new Error("Preview must return before reading or resetting form data"); } };

test("Experiences puts the searchable directory before its exposed draft form and task links resolve", () => {
  const tree = render("OperatorExperienceDirectory", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, preview: true });
  exposed(byId(tree, "new-experience"));
  anchorsResolve(tree);
  const all = elements(tree);
  assert.ok(all.indexOf(all.find((node) => attr(node, "aria-label") === "Experience directory")) < all.indexOf(byId(tree, "new-experience")));
  assert.ok(all.some((node) => node.tagName === "input" && attr(node, "type") === "search"));
  assert.match(text(tree), /Publishing is a separate action/);
  const restricted = render("OperatorExperienceDirectory", { directory: { ...experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, canCreate: false } });
  assert.equal(byId(restricted, "new-experience"), undefined);
  assert.equal(elements(restricted).some((node) => attr(node, "href") === "#new-experience"), false);
});

test("Experience search and state filters change only the displayed authorized records", () => {
  const records = experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY.experiences;
  const fixture = harness("src/components/platform/OperatorExperienceDirectory.tsx", "default", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, preview: true });
  nodes(fixture.draw()).find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: records[0].title } });
  assert.equal(nodes(fixture.draw()).filter((node) => node.type === "article").length, records.filter((item) => item.title.includes(records[0].title)).length);
  nodes(fixture.draw()).find((node) => node.type === "select" && node.props.value === "all").props.onChange({ target: { value: "nonexistent" } });
  assert.equal(nodes(fixture.draw()).filter((node) => node.type === "article").length, 0);
  assert.match(reactText(fixture.draw()), /No matches/);
  assert.deepEqual(fixture.calls, []);
});

test("Experience record exposes details and roster tasks without removing optional Meet fallback", () => {
  const editable = { ...experience, canEdit: true, state: "draft" };
  const tree = render("OperatorExperienceRecord", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, experience: editable, preview: true });
  anchorsResolve(tree);
  exposed(byId(tree, "edit-experience"));
  exposed(byId(tree, "experience-roster"));
  assert.ok(elements(tree).some((node) => node.tagName === "summary" && text(node).includes("Manual Meet fallback")));
  assert.ok(elements(tree).some((node) => node.tagName === "button" && /Publish/.test(text(node))));
  const restricted = render("OperatorExperienceRecord", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, experience: { ...editable, canEdit: false, canManageRoster: false, canManageAttendance: false } });
  assert.equal(byId(restricted, "edit-experience"), undefined);
  assert.equal(byId(restricted, "experience-actions"), undefined);
  assert.equal(elements(restricted).some((node) => node.tagName === "button" && /Confirm place|Save|Cancel place/.test(text(node))), false);
});

test("Academy keeps lessons first with exposed creation and permission-gated tasks", () => {
  const tree = render("OperatorAcademy", { academy: academy.PREVIEW_OPS_ACADEMY, options: academy.PREVIEW_OPS_ACADEMY_EDITOR.options, preview: true });
  anchorsResolve(tree);
  exposed(byId(tree, "new-lesson")); exposed(byId(tree, "new-collection"));
  const all = elements(tree);
  assert.ok(all.indexOf(all.find((node) => attr(node, "aria-label") === "Academy lessons")) < all.indexOf(byId(tree, "new-lesson")));
  const restricted = render("OperatorAcademy", { academy: { ...academy.PREVIEW_OPS_ACADEMY, canManage: false }, options: academy.PREVIEW_OPS_ACADEMY_EDITOR.options });
  assert.equal(elements(restricted).some((node) => node.tagName === "form"), false);
  assert.equal(byId(restricted, "new-lesson"), undefined);
  anchorsResolve(restricted);
});

test("Academy search and status filters do not change the source library or save content", () => {
  const fixture = harness("src/components/platform/OperatorAcademy.tsx", "default", { academy: academy.PREVIEW_OPS_ACADEMY, options: academy.PREVIEW_OPS_ACADEMY_EDITOR.options, preview: true });
  nodes(fixture.draw()).find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "no-matching-lesson" } });
  assert.match(reactText(fixture.draw()), /0 of 3 lessons/);
  assert.match(reactText(fixture.draw()), /No matches/);
  assert.equal(academy.PREVIEW_OPS_ACADEMY.resources.length, 3);
  assert.deepEqual(fixture.calls, []);
});

test("Artifacts keeps production first and exposes award, binding, new-template and shipping tasks", () => {
  const Admin = component("OperatorArtifactAdmin");
  const tree = render("OperatorArtifactQueue", { artifacts: preview.PREVIEW_OPS_ARTIFACTS, preview: true, controls: React.createElement(Admin, { artifacts: preview.PREVIEW_OPS_ARTIFACTS, data: preview.PREVIEW_OPS_ARTIFACT_CONTROLS, preview: true }) });
  anchorsResolve(tree);
  for (const id of ["award-artifact", "artifact-templates", "new-artifact-template", "artifact-fulfillment"]) exposed(byId(tree, id));
  const all = elements(tree);
  assert.ok(all.indexOf(byId(tree, "artifact-production")) < all.indexOf(byId(tree, "award-artifact")));
  const readonly = render("OperatorArtifactQueue", { artifacts: [], preview: true });
  assert.equal(elements(readonly).some((node) => attr(node, "aria-label") === "Artifact tasks"), false);
  anchorsResolve(readonly);
});

test("Block setup is exposed in sequence while ending an assignment remains secondary", () => {
  const block = { id: "block-1", name: "Block 01", status: "forming", circles: [], currentCircles: 0 };
  const BlockActions = load("src/components/platform/OpsActions.tsx").OpsBlockActions;
  const tree = render("OpsBlocks", { blocks: [block], dashboard: { members: [] }, actions: React.createElement(BlockActions, { circles: preview.PREVIEW_OPS_CIRCLES, initialBlocks: [block], preview: true }) });
  anchorsResolve(tree); exposed(byId(tree, "create-block")); exposed(byId(tree, "assign-block-circle"));
  assert.match(text(tree), /1\. Create a Block.*2\. Assign a Circle.*3\. Activate a Block/s);
  assert.ok(elements(tree).some((node) => node.tagName === "summary" && text(node).includes("End a Block assignment")));
  const restricted = render("OpsBlocks", { blocks: [block], dashboard: { members: [] } });
  assert.equal(byId(restricted, "create-block"), undefined);
  assert.equal(elements(restricted).some((node) => attr(node, "href") === "#create-block"), false);
});

test("Work category filters never mutate records and keep empty categories recoverable", () => {
  const fixture = harness("src/components/platform/OperatorWorkQueue.tsx", "default", { queue: preview.PREVIEW_OPS_WORK_QUEUE, preview: true });
  const buttons = nodes(fixture.draw()).filter((node) => node.type === "button");
  assert.equal(buttons.length, 4);
  buttons.find((node) => reactText(node) === "Tasks").props.onClick();
  assert.equal(nodes(fixture.draw()).filter((node) => node.type === "article").length, preview.PREVIEW_OPS_WORK_QUEUE.items.filter((item) => item.kind === "task").length);
  assert.deepEqual(fixture.calls, []);
});

test("System puts failed services first while preserving modes, evidence and retry permissions", () => {
  const services = [...preview.PREVIEW_OPS_SYSTEM.services].reverse();
  services[0] = { ...services[0], label: "Healthy service", state: "verified" };
  services[1] = { ...services[1], label: "Failed service", state: "failed", mode: "test" };
  const tree = render("OperatorSystemHealth", { health: { ...preview.PREVIEW_OPS_SYSTEM, services }, canRetry: false, preview: true });
  anchorsResolve(tree);
  const rows = elements(byId(tree, "service-checks")).filter((node) => node.tagName === "article");
  assert.match(text(rows[0]), /Failed service/);
  assert.match(text(tree), /Test mode/);
  assert.equal(elements(tree).some((node) => node.tagName === "button" && text(node).includes("Queue retry")), false);
  assert.equal(services[0].label, "Healthy service", "sorting must not mutate the incoming snapshot");
});

test("every Academy preview mutation returns before form reads, fetch, navigation or refresh", async () => {
  const editor = academy.PREVIEW_OPS_ACADEMY_EDITOR;
  for (const [name, props] of [
    ["OperatorAcademyCreateResource", { options: editor.options }],
    ["OperatorAcademyEditorForm", { options: editor.options, resource: editor.resource }],
    ["OperatorAcademyResourceStateActions", { resourceId: "lesson-1", revision: 2, status: "published" }],
    ["OperatorAcademyCollectionCreate", {}],
    ["OperatorAcademyCollectionActions", { collection: academy.PREVIEW_OPS_ACADEMY.collections[0] }],
  ]) {
    const fixture = harness("src/components/platform/OperatorAcademyActions.tsx", name, { ...props, preview: true });
    for (const node of nodes(fixture.draw())) {
      if (node.type === "form") await node.props.onSubmit(previewEvent);
      if (node.type === "button" && node.props.onClick) await node.props.onClick();
    }
    assert.deepEqual(fixture.calls, [], name);
    assert.equal(fixture.refreshes(), 0, name);
    assert.ok(fixture.state.some((value) => typeof value === "string" && value.includes("Preview only")), name);
  }
});

test("all five Artifact preview forms return before form reads or requests", async () => {
  const fixture = harness("src/components/platform/OperatorArtifactAdmin.tsx", "default", { artifacts: preview.PREVIEW_OPS_ARTIFACTS, data: preview.PREVIEW_OPS_ARTIFACT_CONTROLS, preview: true });
  const forms = nodes(fixture.draw()).filter((node) => typeof node.type === "function" && node.type.name.endsWith("Form"));
  assert.equal(forms.length, 5);
  for (const node of forms) {
    const form = fixture.invoke(node.type, node.props);
    await nodes(form).find((child) => child.type === "form").props.onSubmit(previewEvent);
    assert.deepEqual(fixture.calls, [], node.type.name);
    assert.ok(fixture.state.some((value) => typeof value === "string" && value.includes("Preview only")), node.type.name);
  }
  assert.equal(fixture.refreshes(), 0);
});

test("task, retry, production and all four Block actions are no-request previews", async () => {
  for (const [name, props] of [
    ["OperatorTaskAction", { state: "open", taskId: "task-1" }],
    ["OperatorWorkflowRetryAction", { workflowActionId: "retry-1" }],
    ["OperatorArtifactAction", { artifactJobId: "job-1", state: "in_production" }],
  ]) {
    const fixture = harness("src/components/platform/OperatorWorkActions.tsx", name, { ...props, preview: true });
    for (const node of nodes(fixture.draw())) {
      if (node.type === "form") await node.props.onSubmit(previewEvent);
      if (node.type === "button" && node.props.onClick) await node.props.onClick();
    }
    assert.deepEqual(fixture.calls, [], name); assert.equal(fixture.refreshes(), 0, name);
  }
  const fixture = harness("src/components/platform/OpsActions.tsx", "OpsBlockActions", { circles: preview.PREVIEW_OPS_CIRCLES, initialBlocks: [{ id: "block-1", name: "Block 01", status: "forming", currentCircles: 2, circles: [] }], preview: true });
  const forms = nodes(fixture.draw()).filter((node) => node.type === "form");
  assert.equal(forms.length, 4);
  for (const form of forms) await form.props.onSubmit(previewEvent);
  assert.deepEqual(fixture.calls, []); assert.equal(fixture.refreshes(), 0);
});

test("connected task and retry actions retain their original requests", async () => {
  const task = harness("src/components/platform/OperatorWorkActions.tsx", "OperatorTaskAction", { state: "open", taskId: "task-1", preview: false });
  await nodes(task.draw()).find((node) => node.type === "button" && reactText(node) === "Claim").props.onClick();
  assert.deepEqual(task.calls, [{ url: "/api/ops/tasks/task-1", method: "PATCH", body: { action: "claim" } }]);
  const retry = harness("src/components/platform/OperatorWorkActions.tsx", "OperatorWorkflowRetryAction", { workflowActionId: "retry-1" });
  await nodes(retry.draw()).find((node) => node.type === "button").props.onClick();
  assert.deepEqual(retry.calls, [{ url: "/api/ops/workflow-actions/retry-1/retry", method: "POST", body: {} }]);
});

test("preview routes pass guards through every exposed action surface without loading live data", async () => {
  const guardedNames = ["OperatorAcademy", "OperatorAcademyEditor", "OperatorArtifactQueue", "OperatorArtifactAdmin", "OperatorWorkQueue", "OperatorSystemHealth", "OpsBlockActions"];
  const reads = [];
  const failRead = (...args) => { reads.push(args); throw new Error("Preview must not read live data"); };
  const pageLoader = loader({ extra: {
    "@/lib/platform/page-data": { getOperatorPageContext: async () => ({ state: "preview", role: "ops_admin", viewer: null, dashboard: { members: [] } }) },
    "@/lib/platform/ops-academy-repository": { getOpsAcademyEditor: failRead, getOpsAcademyReferenceOptions: failRead, getOpsAcademySnapshot: failRead },
    "@/lib/platform/ops-artifact-repository": { getOpsArtifactControlData: failRead },
    "@/lib/platform/ops-operating-repository": { getOpsArtifactQueue: failRead, getOpsSystemHealth: failRead, getOpsWorkQueue: failRead },
    "@/lib/platform/ops-repository": { getOpsBlockSummaries: failRead, getOpsCircleSummaries: failRead },
    "@/components/platform/PlatformUnavailable": { __esModule: true, default: () => { throw new Error("Preview should render its task surface"); } },
  } });
  for (const path of ["academy/page.tsx", "academy/[resourceId]/page.tsx", "artifacts/page.tsx", "work/page.tsx", "system/page.tsx", "blocks/page.tsx"]) {
    const Page = pageLoader(`app/ops/${path}`).default;
    const tree = await Page({ params: Promise.resolve({ resourceId: "preview-welcome" }) });
    const candidates = [...nodes(tree), ...nodes(tree.props?.controls), ...nodes(tree.props?.actions)].filter((node) => typeof node.type === "function" && guardedNames.includes(node.type.name));
    assert.ok(candidates.length, `${path} renders guarded controls`);
    assert.ok(candidates.every((node) => node.props.preview === true), `${path} preserves preview all the way to its actions`);
    if (path === "blocks/page.tsx") {
      const html = parseFragment(renderToStaticMarkup(tree));
      exposed(byId(html, "create-block")); exposed(byId(html, "assign-block-circle"));
      assert.equal(elements(html).filter((node) => node.tagName === "form").length, 4);
      const snapshots = tree.props.blocks;
      assert.ok(snapshots.every((block) => block.currentCircles === block.circles.length && (block.status !== "active" || block.currentCircles >= 2)));
    }
  }
  assert.deepEqual(reads, []);
});
