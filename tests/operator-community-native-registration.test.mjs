import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

const compiled = new Map();
function load(path, dependencies, environment = {}) {
  if (!compiled.has(path)) {
    compiled.set(path, ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText);
  }
  const output = { exports: {} };
  new Function("require", "module", "exports", "FormData", "fetch", compiled.get(path))((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected community editor dependency: ${name}`);
    return dependencies[name];
  }, output, output.exports, environment.FormData, environment.fetch);
  return output.exports;
}

function nodes(node) {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(nodes)];
}

function text(node) {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : "";
}

const registrationModel = load("src/lib/events/byob-registration-model.ts", {});
const dateTime = load("src/lib/datetime/zoned-date-time.ts", {});
const baseEvent = {
  eventKey: "studio-night", title: "Studio night", eyebrow: "Community gathering",
  startsAt: "2026-10-15T00:00:00.000Z", timezone: "America/Denver",
  location: "Utah", admission: "Free", summary: "An evening at the studio.",
  imagePath: null, videoPath: null, videoPosterPath: null,
  publicationState: "published", eventState: "Upcoming",
  registrationMode: "none", registrationUrl: null, registrationOpen: false,
  version: 4, registeredCount: 0, attendanceCount: 0,
};
const fields = {
  eventKey: "new-gathering", title: "Updated gathering", eyebrow: "Community gathering",
  startsAt: "2026-10-14T18:00", location: "Utah", admission: "Free",
  summary: "Updated details.", publicationState: "published", eventState: "Upcoming",
};

function fixture(event) {
  const state = [];
  let cursor = 0;
  let refreshes = 0;
  const requests = [];
  const routes = [];
  const hooks = {
    ...React,
    useRef(initial) { const [ref] = hooks.useState(() => ({ current: initial })); return ref; },
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
  };
  const { CommunityEventEditor } = load("src/components/platform/OperatorCommunityEvents.tsx", {
    react: hooks,
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { useRouter: () => ({ push: (path) => routes.push(path), refresh: () => { refreshes++; } }) },
    "@/components/platform/OperatorPageFrame": { default: ({ children }) => React.createElement("main", null, children) },
    "@/components/platform/OperatorDialog": { default: ({ children }) => children },
    "@/components/platform/operatorStyles": {
      OPERATOR_FIELD_CLASS: "field", OPERATOR_LABEL_CLASS: "label", OPERATOR_LABEL_TEXT_CLASS: "label-text", OPERATOR_PRIMARY_ACTION_CLASS: "action",
    },
    "@/lib/datetime/zoned-date-time": dateTime,
    "@/lib/events/byob-registration-model": registrationModel,
  }, {
    FormData: class {
      constructor(form) { this.values = form.values; }
      get(name) { return this.values[name] ?? null; }
    },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, method: options.method, body });
      return { ok: true, json: async () => ({ event: { eventKey: body.event.eventKey } }) };
    },
  });
  const draw = () => { cursor = 0; return CommunityEventEditor({ event }); };
  const find = (predicate) => nodes(draw()).find(predicate);
  const registration = () => {
    const field = find((node) => node.props.label === "Registration");
    assert.ok(field, "The registration field is available in edit mode");
    return nodes(field).find((node) => node.type === "select");
  };
  return {
    draw, find, registration, requests, routes,
    surface: () => find((node) => node.type === "form") ?? find((node) => node.type === "section" && node.props["aria-label"] === "Event details"),
    refreshes: () => refreshes,
    edit() {
      const button = find((node) => node.type === "button" && text(node) === "Edit event");
      assert.ok(button, "Saved details retain their explicit Edit event action");
      button.props.onClick();
    },
    cancel() {
      assert.equal(find((node) => node.type === "button" && text(node) === "Cancel"), undefined, "No internal Cancel can bypass the shared dirty/pending guard");
      const dialog = find((node) => node.props.title === "Edit public event");
      assert.ok(dialog, "Existing-event editing uses the shared guarded dialog");
      assert.equal(dialog.props.returnFocusId, "edit-public-event");
      // Simulate onClose only after the shared dialog has approved dismissal.
      dialog.props.onClose();
    },
    chooseMode(value) {
      const select = registration();
      assert.equal(select.props.disabled, false, "Only an enabled registration selector may be changed");
      select.props.onChange({ target: { value } });
    },
    submit(values = fields) { return find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { values } }); },
  };
}

for (const eventKey of ["byob-02", "byob-03"]) {
  test(`${eventKey} preserves saved details and locks native registration when editing`, () => {
    for (const registrationMode of ["none", "external", "byob"]) {
      const view = fixture({ ...baseEvent, eventKey, registrationMode, registrationUrl: "https://tickets.example.test/stale", registrationOpen: true });
      assert.equal(view.surface().type, "section");
      assert.equal(view.surface().props["aria-label"], "Event details");
      assert.equal(view.find((node) => node.type === "form"), undefined);
      view.edit();
      assert.equal(view.surface().type, "form");
      assert.equal(view.surface().props["aria-label"], "Edit event details");
      assert.equal(view.find((node) => node.type === "fieldset").props.disabled, false);
      assert.equal(view.find((node) => node.type === "input" && node.props.name === "title").props.defaultValue, baseEvent.title);
      assert.equal(view.find((node) => node.type === "input" && node.props.name === "eventKey").props.readOnly, true);
      assert.equal(view.registration().props.value, "byob");
      assert.equal(view.registration().props.disabled, true);
      assert.deepEqual(nodes(view.registration()).filter((node) => node.type === "option").map((node) => node.props.value), ["byob"]);
      assert.equal(view.find((node) => node.props.name === "registrationUrl"), undefined);
      assert.equal(view.find((node) => node.props.name === "registrationOpen").props.defaultChecked, true);
      assert.equal(text(view.find((node) => node.type === "button" && node.props.type === "submit")), "Save event");
      assert.equal(nodes(view.surface()).some((node) => node.type === "button" && /^Edit/.test(text(node))), false);
    }
  });

  test(`${eventKey} saves native registration despite stale external record and form values`, async () => {
    const view = fixture({ ...baseEvent, eventKey, registrationMode: "external", registrationUrl: "https://tickets.example.test/stale" });
    view.edit();
    await view.submit({ ...fields, eventKey: "different-event", registrationMode: "external", registrationOpen: "on" });
    assert.equal(view.requests.length, 1);
    const request = view.requests[0];
    assert.equal(request.url, "/api/ops/community-events");
    assert.equal(request.method, "POST");
    assert.equal(request.body.expectedVersion, baseEvent.version);
    assert.equal(request.body.event.eventKey, eventKey, "Existing event identity must not come from submitted form values");
    assert.equal(request.body.event.registrationMode, "byob");
    assert.equal(request.body.event.registrationUrl, "", "An unrendered stale provider URL must not be submitted");
    assert.equal(request.body.event.registrationOpen, true);
    assert.equal(request.body.event.title, fields.title);
    assert.equal(request.body.event.startsAt, baseEvent.startsAt);
    assert.equal(view.refreshes(), 1);
    assert.deepEqual(view.routes, []);
    assert.equal(text(view.find((node) => node.props.role === "status")), "Event saved.");
    assert.equal(view.surface().type, "section", "Saving retains the live return to saved details");
    view.edit();
    assert.equal(view.registration().props.value, "byob", "Reopening editing must not restore stale external mode");
    assert.equal(view.registration().props.disabled, true);
  });
}

test("custom events retain both existing registration modes and an editable selector", async () => {
  for (const registrationMode of ["none", "external"]) {
    const view = fixture({ ...baseEvent, registrationMode, registrationUrl: registrationMode === "external" ? "https://tickets.example.test/studio" : null });
    assert.equal(view.surface().type, "section");
    view.edit();
    assert.equal(view.registration().props.disabled, false);
    assert.equal(view.registration().props.value, registrationMode);
    assert.deepEqual(nodes(view.registration()).filter((node) => node.type === "option").map((node) => node.props.value), ["none", "external"]);
    assert.equal(Boolean(view.find((node) => node.props.name === "registrationUrl")), registrationMode === "external");
    await view.submit({ ...fields, ...(registrationMode === "external" ? { registrationUrl: "https://tickets.example.test/studio", registrationOpen: "on" } : {}) });
    assert.equal(view.requests[0].body.event.registrationMode, registrationMode);
    assert.equal(view.requests[0].body.event.eventKey, "studio-night");
  }
});

test("custom event operators can change none to external and back through the enabled selector", async () => {
  const view = fixture(baseEvent);
  view.edit();
  view.chooseMode("external");
  assert.equal(view.find((node) => node.props.name === "registrationUrl").props.required, true);
  assert.ok(view.find((node) => node.props.name === "registrationOpen"));
  await view.submit({ ...fields, registrationUrl: "https://tickets.example.test/studio", registrationOpen: "on" });
  assert.equal(view.requests[0].body.event.registrationMode, "external");
  assert.equal(view.requests[0].body.event.registrationUrl, "https://tickets.example.test/studio");
  assert.equal(view.requests[0].body.event.registrationOpen, true);
  assert.equal(view.surface().type, "section");
  view.edit();
  view.chooseMode("none");
  assert.equal(view.find((node) => node.props.name === "registrationUrl"), undefined);
  assert.equal(view.find((node) => node.props.name === "registrationOpen"), undefined);
  await view.submit(fields);
  assert.equal(view.requests[1].body.event.registrationMode, "none");
  assert.equal(view.requests[1].body.event.registrationUrl, "");
  assert.equal(view.requests[1].body.event.registrationOpen, false);
});

test("cancel preserves saved details without a request and reopening restores the correct mode", () => {
  for (const eventKey of ["byob-02", "byob-03", "studio-night"]) {
    const view = fixture({ ...baseEvent, eventKey });
    view.edit();
    if (eventKey === "studio-night") view.chooseMode("external");
    view.cancel();
    assert.equal(view.surface().type, "section");
    assert.equal(view.requests.length, 0);
    assert.equal(view.refreshes(), 0);
    view.edit();
    assert.equal(view.registration().props.value, eventKey === "studio-night" ? "none" : "byob");
    assert.equal(view.registration().props.disabled, eventKey !== "studio-night");
  }
});

test("new custom events retain direct creation with none or external registration", async () => {
  for (const registrationMode of ["none", "external"]) {
    const view = fixture();
    assert.equal(view.registration().props.value, "none");
    assert.equal(text(view.find((node) => node.type === "button" && node.props.type === "submit")), "Create event");
    if (registrationMode === "external") view.chooseMode("external");
    await view.submit({ ...fields, ...(registrationMode === "external" ? { registrationUrl: "https://tickets.example.test/new", registrationOpen: "on" } : {}) });
    assert.equal(view.requests[0].body.expectedVersion, null);
    assert.equal(view.requests[0].body.event.eventKey, fields.eventKey);
    assert.equal(view.requests[0].body.event.registrationMode, registrationMode);
    assert.deepEqual(view.routes, ["/ops/community/new-gathering"]);
    assert.equal(view.refreshes(), 1);
  }
});
