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
function loader({ react = React, request = noNetwork, extra = {}, router = {}, realCommunicationFields = false } = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const output = ts.transpileModule(read(path), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    new Function("require", "module", "exports", "fetch", "FormData", "window", output)((name) => {
      if (Object.hasOwn(extra, name)) return extra[name];
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "next/navigation") return { useRouter: () => ({ push() {}, refresh() {}, ...router }), redirect() { throw new Error("Unexpected redirect"); } };
      if (name === "next/link") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
      if (name === "next/image") return { __esModule: true, default: ({ alt, src, width, height }) => React.createElement("img", { alt, src, width, height }) };
      if (name === "@/components/platform/OperatorPageFrame") return { __esModule: true, default: ({ children }) => React.createElement("main", null, children) };
      if (name === "@/components/platform/OperatorGoogleCommunicationField" && !realCommunicationFields) return { __esModule: true, default: () => React.createElement("div", null, "Google link") };
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
    }, { history: { state: null, replaceState() {} }, location: { hash: "", pathname: "/ops/experiences/fixture", search: "" } });
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
  return { draw, calls, state, refreshes: () => refreshes, invoke: (fn, input, reset = true) => { cursor = 0; if (reset) state.length = 0; return fn(input); } };
}
const previewEvent = { preventDefault() {}, get currentTarget() { throw new Error("Preview must return before reading or resetting form data"); } };

test("Experiences keeps creation one click away in a closed modal without an always-open form", () => {
  const tree = render("OperatorExperienceDirectory", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, preview: true });
  exposed(byId(tree, "new-experience-trigger"));
  anchorsResolve(tree);
  const all = elements(tree);
  const dialog = all.find((node) => node.tagName === "dialog");
  assert.ok(dialog);
  assert.equal(attr(dialog, "open"), undefined);
  assert.ok(elements(dialog).includes(byId(tree, "new-experience")));
  assert.equal(all.filter((node) => node.tagName === "form").length, 1);
  assert.ok(all.some((node) => node.tagName === "input" && attr(node, "type") === "search"));
  assert.match(text(tree), /Nothing is published or sent yet/);
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

test("Experience record exposes edit and view controls without repeating forms across the overview", () => {
  const editable = { ...experience, canEdit: true, state: "draft" };
  const tree = render("OperatorExperienceRecord", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, experience: editable, preview: true });
  anchorsResolve(tree);
  exposed(byId(tree, "edit-experience-trigger"));
  assert.equal(byId(tree, "edit-experience"), undefined, "details edit form opens only in its dialog");
  assert.equal(attr(byId(tree, "experience-view-people"), "hidden"), "");
  assert.ok(byId(tree, "experience-roster"));
  exposed(byId(tree, "meeting-setup"));
  assert.equal(elements(tree).filter((node) => node.tagName === "button" && attr(node, "aria-pressed")).length, 3);
  assert.equal(elements(tree).some((node) => node.tagName === "summary" && text(node).includes("Manual Meet fallback")), false);
  assert.equal(elements(tree).some((node) => node.tagName === "aside"), false);
  assert.ok(elements(tree).some((node) => node.tagName === "button" && text(node) === "Review & publish"));
  const restricted = render("OperatorExperienceRecord", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, experience: { ...editable, canEdit: false, canManageRoster: false, canManageAttendance: false } });
  assert.equal(byId(restricted, "edit-experience"), undefined);
  assert.equal(byId(restricted, "experience-actions"), undefined);
  assert.equal(elements(restricted).some((node) => node.tagName === "button" && /Confirm place|Save|Cancel place/.test(text(node))), false);
});

test("Experience edits and cancellation open only on request, preserve failure state, and never mutate on Cancel", async () => {
  const fixture = harness("src/components/platform/OperatorExperienceRecord.tsx", "default", {
    directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY,
    experience: { ...experience, canEdit: true, state: "published" },
  }, async () => ({ ok: false, json: async () => ({ error: "Save failed. Retry your changes." }) }));
  const button = (label) => nodes(fixture.draw()).find((node) => node.type === "button" && reactText(node) === label);
  assert.equal(nodes(fixture.draw()).some((node) => node.type === "form" && node.props.onSubmit.name === "save"), false);
  button("Edit").props.onClick();
  const form = nodes(fixture.draw()).find((node) => node.type === "form" && node.props.onSubmit.name === "save");
  assert.ok(form);
  await form.props.onSubmit({ preventDefault() {}, currentTarget: { title: "Updated gathering", startsAt: "2026-09-20T10:00", timezone: "America/Denver", circleId: experience.circleId } });
  assert.equal(fixture.calls.length, 1);
  assert.ok(nodes(fixture.draw()).some((node) => node.type === "form" && node.props.onSubmit.name === "save"));
  assert.match(reactText(fixture.draw()), /Save failed/);
  // OperatorDialog calls onClose only after its pending/dirty guards have passed.
  nodes(fixture.draw()).find((node) => node.props?.title === "Edit Experience").props.onClose();
  assert.equal(nodes(fixture.draw()).some((node) => node.type === "form" && node.props.onSubmit.name === "save"), false);
  button("Cancel Experience").props.onClick();
  assert.ok(button("Confirm cancellation"));
  assert.ok(nodes(fixture.draw()).some((node) => node.type === "input" && node.props.name === "reason" && node.props.required));
  assert.equal(fixture.calls.length, 1, "showing the review does not cancel an Experience or send invitations");
  button("Keep Experience").props.onClick();
  assert.equal(button("Confirm cancellation"), undefined);
  assert.equal(fixture.calls.length, 1);
});

test("meeting links stay visible and editable only when neither Calendar ownership nor operator permissions block them", () => {
  const fullLoad = loader({ realCommunicationFields: true });
  const Record = fullLoad("src/components/platform/OperatorExperienceRecord.tsx").default;
  const base = { ...experience, circleId: "11111111-1111-4111-8111-111111111111", state: "draft", canEdit: true,
    canManageCommunication: true, googleCommunicationsConfigured: true, meetingUrl: "https://meet.google.com/abc-defg-hij",
    calendar: { ...experience.calendar, configured: true, status: "not_created", googleEventId: null, googleEventUrl: null, meetingUrl: null, lastSyncedAt: null, bindingRequired: false },
  };
  const draw = (record) => parseFragment(renderToStaticMarkup(React.createElement(Record, { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, experience: record, preview: true })));
  const manual = draw(base);
  const setup = byId(manual, "meeting-setup");
  exposed(setup);
  anchorsResolve(manual);
  assert.equal(elements(setup).some((node) => node.tagName === "form"), false, "saved meeting links do not repeat as edit fields");
  assert.ok(elements(setup).some((node) => node.tagName === "a" && attr(node, "href") === base.meetingUrl));
  assert.ok(elements(setup).some((node) => node.tagName === "button" && attr(node, "aria-label") === "Edit meeting link"));
  assert.ok(elements(manual).some((node) => node.tagName === "a" && attr(node, "href") === `/ops/circles?circleId=${base.circleId}`));
  for (const calendar of [
    { ...base.calendar, status: "synced", googleEventId: "owned-calendar-event" },
    { ...base.calendar, status: "failed", googleEventId: "owned-calendar-event" },
    { ...base.calendar, status: "pending_create" },
    { ...base.calendar, status: "pending_update" },
  ]) {
    const managed = draw({ ...base, calendar });
    exposed(byId(managed, "meeting-setup"));
    assert.match(text(byId(managed, "meeting-setup")), /Google Calendar manages this meeting link/);
    assert.equal(elements(byId(managed, "meeting-setup")).some((node) => node.tagName === "form"), false);
    assert.ok(elements(byId(managed, "meeting-setup")).some((node) => node.tagName === "a" && attr(node, "href") === base.meetingUrl));
  }
  const readOnly = draw({ ...base, canManageCommunication: false });
  exposed(byId(readOnly, "meeting-setup"));
  assert.equal(elements(byId(readOnly, "meeting-setup")).some((node) => node.tagName === "form"), false);
});

test("draft publishing and Calendar status describe queueing honestly and preview publish cannot send", async () => {
  const draft = { ...experience, state: "draft", startsAt: "2099-09-15T18:00:00Z", endsAt: "2099-09-15T19:00:00Z", canEdit: true, calendar: { ...experience.calendar, configured: true, status: "not_created", googleEventId: null, googleEventUrl: null, lastSyncedAt: null, bindingRequired: false } };
  const tree = render("OperatorExperienceRecord", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, experience: draft, preview: true });
  assert.ok(elements(tree).some((node) => node.tagName === "button" && text(node) === "Review & publish"));
  assert.match(text(byId(tree, "experience-calendar")), /Review & publish.*publishing alone does not confirm delivery/);
  assert.equal(elements(byId(tree, "experience-calendar")).some((node) => node.tagName === "button" && /Send invitations|Update invitations/.test(text(node))), false);
  assert.doesNotMatch(text(tree), /Publish \+ send invite|Calendar invitations sent\./);
  const fixture = harness("src/components/platform/OperatorExperienceRecord.tsx", "default", { directory: experiences.PREVIEW_OPS_EXPERIENCE_DIRECTORY, experience: draft, preview: true });
  nodes(fixture.draw()).find((node) => node.type === "button" && reactText(node) === "Review & publish").props.onClick();
  assert.match(reactText(fixture.draw()), /queued does not mean sent/);
  assert.deepEqual(fixture.calls, [], "reviewing a publication does not queue or send anything");
  await nodes(fixture.draw()).find((node) => node.type === "button" && reactText(node) === "Publish + queue invitations").props.onClick();
  assert.match(reactText(fixture.draw()), /Preview only/);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.refreshes(), 0);
});

test("Academy keeps lessons first with one creation action and permission-gated dialog tasks", () => {
  const tree = render("OperatorAcademy", { academy: academy.PREVIEW_OPS_ACADEMY, options: academy.PREVIEW_OPS_ACADEMY_EDITOR.options, preview: true });
  anchorsResolve(tree);
  exposed(byId(tree, "open-new-lesson"));
  assert.equal(byId(tree, "new-lesson"), undefined);
  assert.equal(byId(tree, "new-collection"), undefined);
  assert.equal(elements(tree).some((node) => node.tagName === "form"), false);
  assert.ok(elements(tree).some((node) => attr(node, "aria-label") === "Academy lessons"));
  const restricted = render("OperatorAcademy", { academy: { ...academy.PREVIEW_OPS_ACADEMY, canManage: false }, options: academy.PREVIEW_OPS_ACADEMY_EDITOR.options });
  assert.equal(elements(restricted).some((node) => node.tagName === "form"), false);
  assert.equal(byId(restricted, "new-lesson"), undefined);
  assert.equal(byId(restricted, "open-new-lesson"), undefined);
  anchorsResolve(restricted);
});

test("Academy view selection exposes only that workspace and creates content in a shared dialog", () => {
  const fixture = harness("src/components/platform/OperatorAcademy.tsx", "default", { academy: academy.PREVIEW_OPS_ACADEMY, options: academy.PREVIEW_OPS_ACADEMY_EDITOR.options, preview: true });
  const click = (label) => nodes(fixture.draw()).find((node) => node.type === "button" && reactText(node) === label).props.onClick();
  click("+ New lesson");
  let dialog = nodes(fixture.draw()).find((node) => node.type?.name === "OperatorDialog");
  assert.ok(dialog);
  assert.equal(dialog.props.returnFocusId, "open-new-lesson");
  assert.equal(nodes(dialog).find((node) => node.type?.name === "OperatorAcademyCreateResource").props.preview, true);
  dialog.props.onClose();
  click("Collections");
  assert.equal(nodes(fixture.draw()).some((node) => node.props?.["aria-label"] === "Academy lessons"), false);
  click("+ New collection");
  dialog = nodes(fixture.draw()).find((node) => node.type?.name === "OperatorDialog");
  assert.equal(dialog.props.returnFocusId, "open-new-collection");
  assert.ok(nodes(dialog).some((node) => node.type?.name === "OperatorAcademyCollectionCreate"));
  assert.deepEqual(fixture.calls, []);
});

test("Academy search and status filters do not change the source library or save content", () => {
  const fixture = harness("src/components/platform/OperatorAcademy.tsx", "default", { academy: academy.PREVIEW_OPS_ACADEMY, options: academy.PREVIEW_OPS_ACADEMY_EDITOR.options, preview: true });
  nodes(fixture.draw()).find((node) => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "no-matching-lesson" } });
  assert.match(reactText(fixture.draw()), /0 of 3 lessons/);
  assert.match(reactText(fixture.draw()), /No matches/);
  assert.equal(academy.PREVIEW_OPS_ACADEMY.resources.length, 3);
  assert.deepEqual(fixture.calls, []);
});

test("Artifacts opens on production with one view selector and focused creation actions", () => {
  const Admin = component("OperatorArtifactAdmin");
  const tree = render("OperatorArtifactQueue", { artifacts: preview.PREVIEW_OPS_ARTIFACTS, preview: true, controls: React.createElement(Admin, { artifacts: preview.PREVIEW_OPS_ARTIFACTS, data: preview.PREVIEW_OPS_ARTIFACT_CONTROLS, preview: true }) });
  anchorsResolve(tree);
  exposed(byId(tree, "open-award-artifact"));
  exposed(byId(tree, "artifact-production"));
  assert.equal(byId(tree, "award-artifact"), undefined, "award form opens only on request");
  assert.equal(byId(tree, "new-artifact-template"), undefined, "template form opens only on request");
  assert.equal(attr(byId(tree, "artifact-templates"), "hidden"), "");
  assert.equal(attr(byId(tree, "artifact-fulfillment"), "hidden"), "");
  const all = elements(tree);
  assert.equal(all.filter((node) => node.tagName === "nav" && attr(node, "aria-label") === "Artifact views").length, 1);
  assert.equal(all.filter((node) => node.tagName === "form").length, preview.PREVIEW_OPS_ARTIFACTS.filter((artifact) => artifact.artifactJobId).length, "only the existing production actions appear initially");
  const readonly = render("OperatorArtifactQueue", { artifacts: [], preview: true });
  assert.equal(elements(readonly).some((node) => attr(node, "aria-label") === "Artifact tasks"), false);
  anchorsResolve(readonly);
});

test("Blocks is browse-first with clear creation and per-Block management links instead of stacked forms", () => {
  const block = { id: "block-1", name: "Block 01", status: "forming", circles: [], currentCircles: 0 };
  const BlockActions = load("src/components/platform/OpsActions.tsx").OpsBlockActions;
  const tree = render("OpsBlocks", { blocks: [block], dashboard: { members: [] }, actions: React.createElement(BlockActions, { circles: preview.PREVIEW_OPS_CIRCLES, initialBlocks: [block], preview: true }) });
  exposed(byId(tree, "new-block-trigger")); exposed(byId(tree, "manage-block-trigger-block-1"));
  assert.equal(attr(byId(tree, "new-block-trigger"), "href"), "#create-block");
  assert.equal(attr(byId(tree, "manage-block-trigger-block-1"), "href"), "#manage-block-block-1");
  assert.equal(elements(tree).filter((node) => node.tagName === "form").length, 0);
  assert.doesNotMatch(text(tree), /1\. Create a Block|2\. Assign a Circle|3\. Activate a Block/);
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
  const rows = elements(byId(tree, "service-checks")).filter((node) => node.tagName === "details");
  assert.match(text(rows[0]), /Failed service/);
  assert.ok(rows[0].attrs.some((attribute) => attribute.name === "open"), "failures remain expanded");
  const healthy = rows.find((row) => /Healthy service/.test(text(row)));
  assert.equal(healthy.attrs.some((attribute) => attribute.name === "open"), false, "healthy service evidence is optional");
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
  for (const buttonId of ["open-award-artifact", "open-new-artifact-template", "open-new-artifact-shipment"]) {
    nodes(fixture.draw()).find((node) => node.props?.id === buttonId).props.onClick();
    for (const node of nodes(fixture.draw()).filter((node) => typeof node.type === "function" && node.type.name.endsWith("Form"))) {
      if (!forms.some((known) => known.type === node.type)) forms.push(node);
    }
  }
  assert.equal(forms.length, 5);
  for (const node of forms) {
    let form = fixture.invoke(node.type, node.props);
    if (!nodes(form).some((child) => child.type === "form")) {
      const edit = nodes(form).find((child) => child.type === "button" && /Edit|Connect/.test(reactText(child)));
      assert.ok(edit, `${node.type.name} has an explicit edit action`);
      edit.props.onClick();
      form = fixture.invoke(node.type, node.props, false);
    }
    await nodes(form).find((child) => child.type === "form").props.onSubmit(previewEvent);
    assert.deepEqual(fixture.calls, [], node.type.name);
    assert.ok(fixture.state.some((value) => typeof value === "string" && value.includes("Preview only")), node.type.name);
  }
  assert.equal(fixture.refreshes(), 0);
});

test("task, retry and production actions are no-request previews; Block tasks stay closed until requested", async () => {
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
  assert.equal(forms.length, 0, "the four explicit Block task preview submissions are covered by operator-block-workspace-runtime");
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
    "@/lib/platform/page-data": {
      getOperatorPageContext: async () => ({ state: "preview", role: "ops_admin", viewer: null, dashboard: { members: [] } }),
      getOperatorAccessContext: async () => ({ state: "preview", role: "ops_admin", viewer: null }),
    },
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
      exposed(byId(html, "new-block-trigger"));
      assert.ok(elements(html).some((node) => attr(node, "href")?.startsWith("#manage-block-")));
      assert.equal(elements(html).filter((node) => node.tagName === "form").length, 0);
      const snapshots = tree.props.blocks;
      assert.ok(snapshots.every((block) => block.currentCircles === block.circles.length && (block.status !== "active" || block.currentCircles >= 2)));
    }
  }
  assert.deepEqual(reads, []);
});
