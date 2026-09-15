import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import ts from "typescript";

const require = createRequire(import.meta.url);
const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
const elements = (node) => [node, ...(node.childNodes ?? []).flatMap(elements)].filter((item) => item.tagName);
const text = (node) => node.nodeName === "#text" ? node.value : (node.childNodes ?? []).map(text).join("");
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const noNetwork = () => { throw new Error("Real network is forbidden in Experience UI tests"); };
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const Frame = ({ children, title }) => React.createElement("main", null, React.createElement("h1", { className: "sr-only" }, title), children);
const Dialog = ({ children, title, ...props }) => props.open ? React.createElement("dialog", { open: true, "aria-label": title, "data-pending": props.pending }, children) : null;
const State = ({ state }) => React.createElement("span", null, state);
function load(path, dependencies = {}, fetch = noNetwork, window = undefined) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "window", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "next/link") return { __esModule: true, default: Link };
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    if (name === "@/components/platform/OperatorDialog") return { __esModule: true, default: Dialog };
    if (name === "@/components/platform/OperatorDateTimeField") return load("src/components/platform/OperatorDateTimeField.tsx");
    if (name === "@/components/platform/operatorStyles") return load("src/components/platform/operatorStyles.ts");
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, loadedModule, loadedModule.exports, fetch, window);
  return loadedModule.exports;
}
const styles = load("src/components/platform/operatorStyles.ts");
const calendarModule = load("src/components/platform/OperatorExperienceCalendar.tsx");
const calendar = {
  attendeeCount: 2, configured: true, googleEventId: null, googleEventUrl: null,
  lastError: null, lastSyncedAt: null, meetingUrl: null, organizerEmail: "operator@example.test", status: "not_created",
};
const experience = {
  experienceId: "event-1", title: "Founders Circle meeting", kind: "circle_meeting", scope: "Founders Circle",
  state: "draft", startsAt: "2099-09-15T18:00:00.000Z", endsAt: "2099-09-15T19:00:00.000Z", timezone: "America/Denver",
  canEdit: true, canManageCommunication: true, canManageGlobal: true, canManageRoster: true, canManageAttendance: true,
  googleCommunicationsConfigured: true, circleId: "circle-1", blockId: null, visibility: "circle", registrationMode: "internal",
  memberOptions: [], roster: [], history: [], registeredCount: 0, waitlistedCount: 0, meetingUrl: null, calendar,
};
const dependencies = {
  "@/components/platform/operatorStyles": styles,
  "@/components/platform/OperatorExperienceCalendar": calendarModule,
  "@/components/platform/OperatorDialog": { __esModule: true, default: Dialog },
  "@/components/platform/OperatorGoogleCommunicationField": { __esModule: true, default: () => React.createElement("span", null, "Manual link editor") },
  "@/components/platform/OperatorPageFrame": { __esModule: true, default: Frame },
  "@/components/platform/StateLabel": { __esModule: true, default: State },
  "@/lib/datetime/zoned-date-time": { zonedDateTimeLocalValue: (value) => value ?? "", zonedDateTimeLocalToIso: (value) => value || null },
};
const render = (element) => parseFragment(renderToStaticMarkup(element));
const panel = (changes = {}, extra = {}) => {
  let slot = 0;
  const OpenCalendar = load("src/components/platform/OperatorExperienceCalendar.tsx", {
    react: { ...React, useState: (initial) => [slot++ === 3 ? true : initial, () => {}] },
  }).default;
  return render(React.createElement(OpenCalendar, {
    calendar: { ...calendar, ...changes }, canManage: true, canBind: true, experienceId: experience.experienceId,
    experienceState: "draft", scope: experience.scope, audienceReviewHref: "/ops/circles?circleId=circle-1", audienceReviewLabel: "Review Circle", ...extra,
  }));
};

function interactive(changes = {}, preview = false, response = { ok: true, json: async () => ({}) }) {
  const slots = []; const effects = []; const calls = [];
  const window = { location: { pathname: "/ops/experiences/event-1", search: "", hash: "" }, history: { replaceState(_a, _b, value) { window.location.hash = value.includes("#") ? value.slice(value.indexOf("#")) : ""; } }, addEventListener() {}, removeEventListener() {} };
  let cursor = 0;
  const hooks = { ...React, useEffect(callback) { effects.push(callback); }, useMemo: (callback) => callback(),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  };
  const Record = load("src/components/platform/OperatorExperienceRecord.tsx", { ...dependencies, react: hooks }, async (url, options) => { calls.push({ url, options }); return response; }, window).default;
  return { calls, effects, window, draw() { cursor = 0; return Record({ directory: { circles: [{ id: "circle-1", name: "Founders Circle" }], blocks: [] }, experience: { ...experience, ...changes }, preview }); } };
}

test("Experience starts with one title, compact views and no open edit form or publish action", () => {
  const f = interactive(); const tree = render(f.draw());
  assert.equal(elements(tree).filter((node) => node.tagName === "h1").length, 1);
  assert.equal(attr(elements(tree).find((node) => node.tagName === "h1"), "class"), "sr-only");
  assert.ok(elements(tree).some((node) => node.tagName === "h2" && text(node) === experience.title));
  assert.equal(elements(tree).filter((node) => node.tagName === "dialog").length, 0);
  assert.equal(elements(tree).filter((node) => node.tagName === "button" && attr(node, "aria-pressed")).length, 3);
  assert.equal(attr(elements(tree).find((node) => attr(node, "id") === "experience-view-people"), "hidden"), "");
  assert.ok(elements(tree).some((node) => node.tagName === "button" && text(node) === "Review & publish"));
  assert.equal(elements(tree).some((node) => node.tagName === "button" && text(node) === "Publish + queue invitations"), false);
  assert.deepEqual(f.calls, []);
  assert.ok(elements(tree).some((node) => node.tagName === "button" && text(node) === "Manage meeting"));
  assert.doesNotMatch(text(tree), /Manual link editor/);
  assert.ok(elements(tree).some((node) => attr(node, "aria-label") === "Event snapshot"));
  assert.ok(elements(tree).some((node) => node.tagName === "h2" && attr(node, "class") === "operator-record-title"));
});

test("editing mounts all fields inside the dirty and pending guarded dialog", () => {
  const f = interactive(); nodes(f.draw()).find((node) => node.props?.id === "edit-experience-trigger").props.onClick();
  let output = f.draw(); const dialog = nodes(output).find((node) => node.type === Dialog && node.props.open);
  assert.equal(dialog.props.pending, false); assert.equal(dialog.props.returnFocusId, "edit-experience-trigger");
  const form = nodes(output).find((node) => node.type === "form" && node.props.id === "edit-experience");
  assert.equal(form.props["data-operator-dirty"], "false"); form.props.onChange();
  output = f.draw(); assert.equal(nodes(output).find((node) => node.props?.id === "edit-experience").props["data-operator-dirty"], "true");
  const tree = render(output);
  for (const name of ["title", "startsAt", "endsAt", "timezone", "kind", "visibility", "circleId", "registrationMode", "capacity", "registrationOpensAt", "registrationClosesAt", "summary", "details", "locationLabel", "waitlistEnabled"]) {
    assert.ok(elements(tree).some((node) => attr(node, "name") === name), name);
  }
  assert.deepEqual(f.calls, []);
});

test("publish requires review, warns about zero recipients and existing link replacement, preview never sends", async () => {
  const f = interactive({ calendar: { ...calendar, attendeeCount: 0 }, meetingUrl: "https://meet.google.com/abc-defg-hij" }, true);
  nodes(f.draw()).find((node) => node.props?.id === "publish-experience-trigger").props.onClick();
  const tree = render(f.draw()); const dialog = elements(tree).find((node) => node.tagName === "dialog");
  assert.match(text(dialog), /queued does not mean sent/); assert.match(text(dialog), /No one is currently eligible/);
  assert.match(text(dialog), /replace your saved meeting link/);
  const action = nodes(f.draw()).find((node) => node.type === "button" && node.props.children === "Publish + queue invitations");
  assert.equal(action.props.disabled, false, "zero invitees must not prevent publishing a valid event");
  await action.props.onClick(); assert.deepEqual(f.calls, []);
  assert.match(text(render(f.draw())), /Preview only/);
});

test("past drafts never promise automatic delivery in publish review", () => {
  const f = interactive({ startsAt: "2001-01-01T00:00:00Z", endsAt: "2001-01-01T01:00:00Z" });
  nodes(f.draw()).find((node) => node.props?.id === "publish-experience-trigger").props.onClick();
  const dialog = elements(render(f.draw())).find((node) => node.tagName === "dialog");
  assert.match(text(dialog), /will not automatically send Google invitations/);
  assert.equal(elements(dialog).some((node) => node.tagName === "button" && text(node) === "Publish Experience"), true);
});

test("publishing only happens after confirmation and failures stay in the review dialog", async () => {
  const f = interactive({}, false, { ok: false, json: async () => ({ error: "Publication could not be saved." }) });
  nodes(f.draw()).find((node) => node.props?.id === "publish-experience-trigger").props.onClick();
  assert.deepEqual(f.calls, []);
  const action = nodes(f.draw()).find((node) => node.type === "button" && node.props.children === "Publish + queue invitations");
  await action.props.onClick();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, "/api/ops/experiences/event-1/lifecycle");
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { intent: "publish", reason: "" });
  const dialog = elements(render(f.draw())).find((node) => node.tagName === "dialog");
  assert.ok(dialog); assert.match(text(dialog), /Publication could not be saved/);
  assert.equal(elements(dialog).some((node) => node.tagName === "button" && attr(node, "disabled") !== undefined), false);
});

test("existing deep links select the correct view or guarded dialog without a request", (t) => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.document = { getElementById: () => ({ scrollIntoView() {} }) };
  globalThis.requestAnimationFrame = (work) => work();
  t.after(() => { globalThis.document = previousDocument; globalThis.requestAnimationFrame = previousAnimationFrame; });
  for (const [hash, target] of [["#experience-roster", "people"], ["#meeting-setup", "overview"], ["#experience-calendar", "overview"], ["#experience-activity", "activity"]]) {
    const f = interactive(); f.window.location.hash = hash; f.draw(); f.effects[0]();
    const tree = render(f.draw());
    assert.equal(attr(elements(tree).find((node) => attr(node, "id") === `experience-view-${target}`), "hidden"), undefined, hash);
    assert.deepEqual(f.calls, []);
  }
  for (const [hash, title] of [["#edit-experience", "Edit Experience"], ["#experience-actions", "Publish Experience"]]) {
    const f = interactive(); f.window.location.hash = hash; f.draw(); f.effects[0]();
    assert.ok(nodes(f.draw()).some((node) => node.type === Dialog && node.props.title === title), hash);
    assert.deepEqual(f.calls, []);
  }
  const f = interactive();
  nodes(f.draw()).find((node) => node.type === "button" && node.props["aria-controls"] === "experience-view-people").props.onClick();
  assert.equal(f.window.location.hash, "#experience-roster");
  nodes(f.draw()).find((node) => node.type === "button" && node.props["aria-controls"] === "experience-view-overview").props.onClick();
  assert.equal(f.window.location.hash, "#meeting-setup", "revisiting a same-page People link can trigger a new hash change");
});

test("Calendar states keep queue, retry, binding, failure and archived cancellation truthful", () => {
  const queued = panel({ status: "pending_create" }, { experienceState: "published" });
  assert.match(text(queued), /Invitation queued/); assert.match(text(queued), /Refresh status/);
  assert.equal(elements(queued).some((node) => node.tagName === "button" && text(node) === "Send invitations"), false);
  const options = elements(queued).find((node) => node.tagName === "dialog");
  assert.match(text(options), /Retry invitations/);
  const paused = panel({ status: "pending_create", automaticDeliveryPaused: true }, { experienceState: "published" });
  assert.match(text(paused), /Review past event/); assert.match(text(paused), /Send invitations/);
  const failed = panel({ status: "failed", lastError: "Google could not be reached." }, { experienceState: "published" });
  assert.match(text(failed), /Needs attention/); assert.match(text(failed), /Google could not be reached/);
  const bound = panel({ configured: false, bindingRequired: true, bindingMode: "live", status: "pending_update", googleEventId: "remote" }, { experienceState: "published", canBind: false });
  assert.match(text(bound), /Verify delivery mode/);
  assert.equal(elements(bound).some((node) => node.tagName === "button" && text(node) === "Verify & bind to live"), false);
  const archived = panel({ canSendCancellation: true, googleEventId: "remote", status: "pending_cancel" }, { experienceState: "archived" });
  assert.match(text(archived), /Send cancellation/); assert.doesNotMatch(text(archived), /Open Google Meet/);
});

test("saved meeting has one join action and permission failures keep send disabled", () => {
  const saved = panel({ status: "synced", googleEventId: "remote", meetingUrl: "https://meet.google.com/abc-defg-hij" }, { experienceState: "published", meetingUrl: "https://meet.google.com/old-link-xyz" });
  const links = elements(saved).filter((node) => node.tagName === "a" && text(node).includes("Open Google Meet"));
  assert.equal(links.length, 1); assert.equal(attr(links[0], "href"), "https://meet.google.com/abc-defg-hij");
  const unconfiguredLinks = panel({ meetingUrl: "https://meet.google.com/abc-defg-hij" }, { linksEnabled: false });
  assert.equal(elements(unconfiguredLinks).some((node) => node.tagName === "a" && text(node).includes("Open Google Meet")), false);
  for (const props of [{ canManage: false }, { calendar: { ...calendar, configured: false } }]) {
    const blocked = panel({}, { experienceState: "published", ...props });
    const send = elements(blocked).find((node) => node.tagName === "button" && text(node) === "Send invitations");
    assert.equal(attr(send, "disabled"), "");
  }
});

test("meeting snapshot keeps send controls in a focused editor, and opening it never sends", async () => {
  const slots = []; let cursor = 0; const calls = [];
  const Component = load("src/components/platform/OperatorExperienceCalendar.tsx", {
    react: { ...React, useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; } },
  }, async (...args) => { calls.push(args); throw new Error("Preview must not send"); }).default;
  const draw = () => { cursor = 0; return Component({ calendar: { ...calendar, status: "synced", googleEventId: "remote", meetingUrl: "https://meet.google.com/abc-defg-hij" }, canManage: true, experienceId: "event-1", experienceState: "published", scope: "All members", preview: true, children: React.createElement("span", null, "Manual link editor") }); };
  let html = render(draw());
  assert.equal(elements(html).filter((node) => node.tagName === "dialog").length, 0);
  assert.equal(elements(html).some((node) => node.tagName === "button" && text(node) === "Update invitations"), false);
  nodes(draw()).find((node) => node.props?.id === "meeting-options-trigger").props.onClick();
  let dialog = nodes(draw()).find((node) => node.type === Dialog);
  assert.equal(dialog.props.open, true);
  assert.equal(dialog.props.returnFocusId, "meeting-options-trigger");
  assert.equal(dialog.props.pending, false);
  assert.deepEqual(calls, []);
  await nodes(dialog).find((node) => node.type === "button" && node.props.children === "Update invitations").props.onClick();
  html = render(draw());
  assert.match(text(html), /Preview only — no invitations were sent/);
  assert.deepEqual(calls, []);
  dialog = nodes(draw()).find((node) => node.type === Dialog);
  dialog.props.onClose();
  assert.equal(elements(render(draw())).some((node) => node.tagName === "dialog"), false);
});

test("event actions open separately and cancellation drafts participate in the dialog guard", () => {
  const f = interactive({ state: "published" });
  assert.equal(elements(render(f.draw())).some((node) => node.tagName === "button" && text(node) === "Cancel Experience"), false);
  nodes(f.draw()).find((node) => node.props?.id === "event-options-trigger").props.onClick();
  let dialog = nodes(f.draw()).find((node) => node.type === Dialog && node.props.title === "Event actions");
  assert.equal(dialog.props.open, true);
  assert.equal(dialog.props.returnFocusId, "event-options-trigger");
  nodes(dialog).find((node) => node.type === "button" && node.props.children === "Cancel Experience").props.onClick();
  dialog = nodes(f.draw()).find((node) => node.type === Dialog && node.props.title === "Event actions");
  const form = nodes(dialog).find((node) => node.type === "form");
  assert.equal(form.props["data-operator-dirty"], "false");
  form.props.onChange();
  assert.equal(nodes(f.draw()).find((node) => node.type === "form" && node.props["data-operator-dirty"] === "true").props["data-operator-dirty"], "true");
  assert.deepEqual(f.calls, []);
});

test("event action failures stay inside the dialog and successful saves dismiss it", async () => {
  for (const [ok, preview] of [[false, false], [true, false], [true, true]]) {
    const f = interactive({ state: "published" }, preview, { ok, json: async () => ({ error: "The event could not be completed." }) });
    nodes(f.draw()).find((node) => node.props?.id === "event-options-trigger").props.onClick();
    const dialog = nodes(f.draw()).find((node) => node.type === Dialog && node.props.title === "Event actions");
    await nodes(dialog).find((node) => node.type === "button" && node.props.children === "Complete").props.onClick();
    const visible = elements(render(f.draw())).find((node) => node.tagName === "dialog");
    if (ok && !preview) assert.equal(visible, undefined);
    else assert.match(text(visible), preview ? /Preview only/ : /The event could not be completed/);
    assert.equal(f.calls.length, preview ? 0 : 1);
    if (!preview) assert.deepEqual(JSON.parse(f.calls[0].options.body), { intent: "complete", reason: "" });
  }
});
