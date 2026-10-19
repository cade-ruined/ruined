import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const noDependency = name => { throw Error(`Unexpected dependency: ${name}`); };
function compile(path, dependency = noDependency, fetch = () => { throw Error("Unexpected network request"); }) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", output)(name => name === "react/jsx-runtime" ? require(name) : dependency(name), mod, mod.exports, fetch);
  return mod.exports;
}
const management = compile("src/lib/communications/member-email-cadence-management.ts");
const model = compile("src/lib/communications/member-email-cadence-model.ts");
const copy = compile("src/lib/communications/member-email-cadence-copy.ts", name => { assert.equal(name, "./member-email-cadence-model"); return model; });
const automationView = compile("src/lib/communications/email-automation-view.ts", name => { assert.equal(name, "./member-email-cadence-model"); return model; });
const navigation = compile("src/lib/communications/email-automation-navigation.ts", name => ({ "./member-email-cadence-model": model, "./email-automation-view": automationView })[name] ?? noDependency(name));
const styles = compile("src/components/platform/operatorStyles.ts");
const nodes = node => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : String(node);
const API = "/api/ops/emails/automations";
const event = { id: "event-1", title: "November Foundations 01", startsAt: "2026-11-05T22:00:00Z", endsAt: "2026-11-05T23:30:00Z", timeZone: "America/Denver" };
const template = {
  id: "template-1", version: "published-version", name: "Personal note", status: "published", hasUnpublishedVersions: false,
  html: '<html><head></head><body><h1>Saved heading</h1><p>Hi there,</p><p>Saved message</p><p>Your name</p><footer><a href="mailto:hello@example.test">hello@example.test</a></footer></body></html>', text: null, subject: "Saved subject", from: "Ruined <hello@example.test>", replyTo: [],
  variables: [{ key: "NAME", type: "string", fallbackValue: "Friend" }, { key: "URL", type: "string", fallbackValue: "" }, { key: "BODY", type: "string", fallbackValue: "Saved body" }],
  fields: [{ key: "heading", label: "Heading", value: "Saved heading" }, { key: "body", label: "Message", value: "Saved message" }, { key: "greeting", label: "Greeting", value: "Hi there," }, { key: "signature", label: "Signature", value: "Your name" }],
};
const counts = { sent: 0, pending: 0, failed: 0, manualReview: 0, cancelled: 0 };
const summary = { title: "Foundations 01 · Members", status: "upcoming", attention: "", ...management.cadenceManagementDescriptions("foundations_01", "members"), nextReminder: null, delivery: counts };
const plan = { ...summary, title: event.title, sequenceId: null, id: "plan-1", eventId: event.id, kind: "foundations_01", track: "members", active: true, revision: 7, templateName: template.name, updatedAt: "2026-10-12T15:00:00Z" };
const sequence = { ...summary, matchingCallCount: 1, id: "sequence-1", kind: "foundations_01", track: "members", active: true, revision: 2, templateName: template.name, updatedAt: "2026-10-12T15:00:00Z" };
const overview = { events: [event], templates: [template], plans: [], sequences: [], configuration: { enabled: false, ready: false, activatedAt: null }, setupRequired: false, warnings: [], managedElsewhere: [], inactive: [{ title: "Completion", reason: "Awaiting approved completion rules." }] };
const review = {
  reviewToken: "opaque-reviewed-token", expiresAt: "2099-01-01T00:00:00Z", scope: "event",
  preview: { html: "<html><head></head><body>Reviewed first email</body></html>", subject: "Reviewed subject", text: "Reviewed copy" },
  previews: [{ stage: "day_before", html: "<html><head></head><body>First stage</body></html>", subject: "Tomorrow", text: "First stage" }, { stage: "day_of", html: "<html><body>Second stage</body></html>", subject: "Today", text: "Second stage" }],
  occurrences: [{ stage: "day_before", dueAt: "2026-11-04T22:00:00Z", expiresAt: "2026-11-04T22:30:00Z" }],
  recipients: [{ memberId: "member-1", name: "Alex", email: "alex@example.test", eligible: true, reason: "" }, { memberId: "member-2", name: "Jordan", email: "jordan@example.test", eligible: false, reason: "Membership email updates are turned off." }],
  warnings: ["Only actual confirmed registrations are included."],
};
function savedDetail(data, scope, id, eventId) {
  const item = (scope === "sequence" ? data.sequences : data.plans).find(row => row.id === id);
  assert.ok(item, `Unknown saved automation: ${id}`);
  const call = { ...event, planId: plan.id, revision: plan.revision, active: item.active, status: item.status, attention: item.attention, nextReminder: null, delivery: counts };
  return { scope, id, revision: item.revision, active: item.active, title: item.title, status: item.status,
    draft: { scope, eventId: scope === "event" ? event.id : "", kind: item.kind, track: item.track, templateId: template.id, templateVersion: template.version, bodyTarget: "copy:body", headingTarget: "copy:heading", bindings: { NAME: { source: "member_name" }, URL: { source: "call_url" }, BODY: { source: "literal", value: "Saved body" } }, copy: { greeting: "", signature: "RU/NED" } },
    template, configuration: data.configuration, timingSummary: item.timingSummary, audienceSummary: item.audienceSummary, inheritanceSummary: item.inheritanceSummary, nextReminder: null,
    calls: [call], selectedEventId: eventId || event.id, previewIsExample: false, previews: review.previews, occurrences: review.occurrences,
    recipients: review.recipients, recipientsChecked: true, recentDeliveries: [], warnings: [],
  };
}
function fixture({ preview = false, data = overview, reviewed = review, selectedTemplate = template, respond } = {}) {
  const stores = new Map(), effects = [], calls = [];
  let currentStore, changed = false, visited;
  function slot() { assert.ok(currentStore, "Hooks must run inside a component render"); const store = currentStore; return [store, store.cursor++]; }
  const hooks = { ...React,
    useRef(initial) { const [store, i] = slot(); return store.slots[i] ??= { current: initial }; },
    useState(initial) { const [store, i] = slot(); if (!(i in store.slots)) store.slots[i] = typeof initial === "function" ? initial() : initial; return [store.slots[i], next => { const value = typeof next === "function" ? next(store.slots[i]) : next; changed ||= store.slots[i] !== value; store.slots[i] = value; }]; },
    useEffect(effect, dependencies) { const [store, i] = slot(); if (!store.slots[i] || dependencies.some((value, index) => value !== store.slots[i].dependencies[index])) effects.push(() => { store.slots[i]?.cleanup?.(); store.slots[i] = { dependencies, cleanup: effect() }; }); },
  };
  function resolve(node, path = "root") {
    if (node == null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((child, i) => resolve(child, `${path}/${child?.key ?? i}`));
    if (typeof node.type === "function") {
      const identity = `${path}/${node.type.name}:${node.key ?? ""}`;
      const store = stores.get(identity) ?? { slots: [], cursor: 0 };
      stores.set(identity, store); visited.add(identity); store.cursor = 0;
      const previous = currentStore; currentStore = store;
      let rendered;
      try { rendered = node.type(node.props); } finally { currentStore = previous; }
      return resolve(rendered, identity);
    }
    return { ...node, props: { ...node.props, children: resolve(node.props?.children, `${path}/children`) } };
  }
  const deps = {
    react: hooks, "next/link": { __esModule: true, default: "a" },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" },
    "@/components/platform/OperatorMessagesTabs": { __esModule: true, default: "message-tabs" },
    "@/components/platform/operatorStyles": styles,
    "./operatorStyles": styles,
    "@/lib/communications/member-email-cadence-model": model,
    "@/lib/communications/member-email-cadence-copy": copy,
    "@/lib/communications/member-email-cadence-management": management,
    "@/lib/communications/email-automation-view": automationView,
    "@/lib/communications/email-automation-navigation": navigation,
    "./OperatorEmailAutomationDetail.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
    "./OperatorEmailAutomationReview.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) },
  };
  deps["./OperatorEmailAutomationDetail"] = compile("src/components/platform/OperatorEmailAutomationDetail.tsx", name => deps[name] ?? noDependency(name));
  deps["@/components/platform/OperatorEmailAutomationEditor"] = compile("src/components/platform/OperatorEmailAutomationEditor.tsx", name => deps[name] ?? noDependency(name));
  deps["./OperatorEmailAutomationEditor"] = deps["@/components/platform/OperatorEmailAutomationEditor"];
  deps["./OperatorEmailAutomationReview"] = compile("src/components/platform/OperatorEmailAutomationReview.tsx", name => deps[name] ?? noDependency(name));
  deps["@/components/platform/OperatorEmailAutomationManager"] = compile("src/components/platform/OperatorEmailAutomationManager.tsx", name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; });
  async function fallback(call) {
    if (call.method === "GET") {
      if (call.url.startsWith(`${API}?`)) { const query = new URL(call.url, "https://example.test").searchParams; return Response.json(savedDetail(data, query.get("scope"), query.get("id"), query.get("eventId"))); }
      return Response.json(call.url === API ? data : { template: selectedTemplate });
    }
    return Response.json(JSON.parse(call.body).action === "preview" ? reviewed : { ok: true });
  }
  const Component = compile("src/components/platform/OperatorEmailAutomations.tsx", name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, async (url, options) => { const call = { url, ...options }; calls.push(call); return respond ? respond(call, fallback) : fallback(call); }).default;
  function draw() {
    for (let i = 0; i < 10; i++) {
      changed = false; visited = new Set();
      const tree = resolve(React.createElement(Component, { preview }));
      for (const [identity, store] of stores) if (!visited.has(identity)) { store.slots.forEach(value => value?.cleanup?.()); stores.delete(identity); }
      effects.splice(0).forEach(effect => effect());
      if (!changed) return tree;
    }
    throw Error("Unstable render");
  }
  const find = predicate => nodes(draw()).find(predicate);
  const button = label => { const result = find(node => node.type === "button" && text(node) === label); assert.ok(result, `Missing button: ${label}`); return result; };
  async function settle() { await new Promise(resolve => setImmediate(resolve)); return draw(); }
  function change(id, value) { const field = find(node => node.props?.id === id); assert.ok(field, `Missing field: ${id}`); field.props.onChange({ target: { value }, currentTarget: { value } }); }
  async function setup({ scope = "event", withEvent = true } = {}) { draw(); await settle(); button("New automation").props.onClick(); if (scope !== "sequence") change("cadence-scope", scope); if (withEvent) change("cadence-event", preview ? "preview-november" : event.id); change("cadence-template", preview ? "preview-template" : template.id); await settle(); change("cadence-body", "copy:body"); change("cadence-heading", "copy:heading"); }
  const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  async function openSaved(id) { draw(); await settle(); button("Email library").props.onClick(); const row = find(node => node.type === "li" && node.key === id); assert.ok(row, `Missing saved row: ${id}`); const open = nodes(row).find(node => node.type === "button" && node.props["aria-label"]?.startsWith("View ")); assert.ok(open); open.props.onClick(); await settle(); }
  function savedStage(stage) { const node = find(node => node.type === "button" && node.props["aria-label"] === `Preview ${automationView.AUTOMATION_STAGE_NAMES[stage]}`); assert.ok(node); node.props.onClick(); }
  function reviewStage(stage) { const region = find(node => node.props?.["aria-label"] === "Review reminder emails"); const node = nodes(region).find(node => node.type === "button" && node.key === stage); assert.ok(node); node.props.onClick(); }
  function detailView(view) { const region = find(node => node.props?.["aria-label"] === "Automation detail views"); const node = nodes(region).find(node => node.type === "button" && text(node).startsWith(view)); assert.ok(node); node.props.onClick(); }
  function editorStage(stage) { const region = find(node => node.props?.["aria-label"] === "Email reminder stages"); const node = nodes(region).find(node => node.type === "button" && node.key === stage); assert.ok(node); node.props.onClick(); }
  return { draw, find, button, calls, change, settle, setup, submit, openSaved, savedStage, reviewStage, detailView, editorStage };
}

test("sample workspace supports review with real cadence timing while remaining completely offline", async () => {
  const f = fixture({ preview: true });
  await f.setup(); await f.submit();
  assert.match(text(f.draw()), /Nothing is saved or sent/);
  assert.match(text(f.draw()), /1 eligible · 1 excluded/);
  assert.match(text(f.draw()), /Membership email updates are turned off/);
  assert.match(text(f.draw()), /Orientation/);
  const frame = f.find(node => node.type === "iframe");
  assert.equal(frame.props.sandbox, "");
  assert.equal(frame.props.referrerPolicy, "no-referrer");
  assert.match(frame.props.srcDoc, /Content-Security-Policy/);
  assert.match(frame.props.srcDoc, /script-src 'none'/);
  assert.equal(f.button("Activation off in preview").props.disabled, true);
  f.button("Activation off in preview").props.onClick();
  f.button("Back to automations").props.onClick(); f.button("Discard changes").props.onClick(); f.button("Refresh").props.onClick(); await f.settle();
  assert.equal(f.calls.length, 0);
});

test("future sequence is the default and can activate before any calls or recipients exist", async () => {
  const f = fixture({ data: { ...overview, events: [] }, reviewed: { ...review, scope: "sequence", recipients: [], occurrences: [], matchingEvents: [] } });
  await f.setup({ scope: "sequence", withEvent: false });
  assert.equal(f.find(node => node.props?.id === "cadence-scope").props.value, "sequence");
  assert.equal(f.find(node => node.props?.id === "cadence-event").props.value, "");
  assert.equal(Boolean(f.button("Preview and review").props.disabled), false);
  await f.submit();
  const posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.equal(posted.draft.scope, "sequence");
  assert.equal(posted.draft.eventId, "");
  assert.match(text(f.draw()), /No matching calls are scheduled yet/);
  assert.match(text(f.draw()), /No recipients are included in this example/);
  assert.match(text(f.draw()), /Members joining later receive only future stages/);
  const activate = f.button("Activate sequence");
  assert.equal(Boolean(activate.props.disabled), false);
  activate.props.onClick(); activate.props.onClick(); await f.settle();
  const calls = f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), { action: "activate", reviewToken: review.reviewToken });
  assert.match(text(f.draw()), /Sequence activated for matching published calls/);
});

test("changing scope invalidates review and individual calls still require a selected event", async () => {
  const f = fixture({ reviewed: { ...review, scope: "sequence", matchingEvents: [event] } });
  await f.setup({ scope: "sequence", withEvent: false }); await f.submit();
  const matching = f.find(node => node.type === "details" && text(node).startsWith("Matching published calls"));
  assert.ok(text(matching).includes(event.title));
  assert.equal(nodes(matching).find(node => node.type === "a").props.href, `/ops/experiences/${event.id}`);
  f.button("Back to editing").props.onClick();
  f.change("cadence-scope", "event");
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  assert.equal(f.find(node => node.type === "button" && text(node) === "Activate sequence"), undefined);
  assert.equal(f.find(node => node.props?.id === "cadence-event").props.value, "");
  assert.equal(f.button("Preview and review").props.disabled, true);
  await f.submit();
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("activation follows reviewed scope and sequence approvals still expire", async () => {
  for (const reviewed of [{ ...review, recipients: [], occurrences: [] }, { ...review, scope: "sequence", expiresAt: "2000-01-01T00:00:00Z", recipients: [], occurrences: [] }]) {
    const f = fixture({ reviewed }); await f.setup({ scope: "sequence", withEvent: false }); await f.submit();
    const activate = f.button(reviewed.scope === "sequence" ? "Activate sequence" : "Activate automation");
    assert.equal(activate.props.disabled, true);
    activate.props.onClick(); await f.settle();
    assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate").length, 0);
  }
});

test("local sequence preview uses the chosen call type without a current event or external request", async () => {
  const f = fixture({ preview: true }); await f.setup({ scope: "sequence", withEvent: false });
  f.change("cadence-kind", "circle"); await f.submit();
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Circle call — example call/);
  assert.match(text(f.draw()), /representative future call/);
  assert.match(text(f.draw()), /No recipients are included in this example/);
  assert.match(text(f.draw()), /Nothing is saved or sent/);
  assert.equal(f.button("Activation off in preview").props.disabled, true);
  assert.equal(f.calls.length, 0);
});

test("review binds the actual event, published template version and explicit per-member sources", async () => {
  const f = fixture(); await f.setup();
  f.change("cadence-track", "founder_test"); f.change("cadence-source-NAME", "member_name"); f.change("cadence-source-URL", "call_url");
  await f.submit();
  const posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.equal(posted.action, "preview");
  assert.equal(posted.draft.eventId, event.id);
  assert.equal(posted.draft.templateId, template.id);
  assert.equal(posted.draft.templateVersion, template.version);
  assert.equal(posted.draft.track, "founder_test");
  assert.equal(posted.draft.bodyTarget, "copy:body");
  assert.equal(posted.draft.headingTarget, "copy:heading");
  assert.deepEqual(posted.draft.bindings.NAME, { source: "member_name" });
  assert.deepEqual(posted.draft.bindings.URL, { source: "call_url" });
  assert.match(text(f.draw()), /1 eligible · 1 excluded/);
  assert.match(text(f.draw()), /Membership email updates are turned off/);
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /First stage/);
  f.reviewStage("day_of");
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Second stage/);
  f.button("Back to editing").props.onClick();
  f.change("cadence-kind", "circle");
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  assert.equal(f.find(node => node.type === "button" && text(node) === "Activate automation"), undefined);
});

test("a reviewed plan can be armed during delivery setup but activation submits only its token once", async () => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const f = fixture({ respond: (call, fallback) => call.body && JSON.parse(call.body).action === "activate" ? response : fallback(call) });
  await f.setup(); await f.submit();
  assert.match(text(f.draw()), /No automated emails will leave until automatic delivery is enabled/);
  const activate = f.button("Activate automation");
  assert.equal(Boolean(activate.props.disabled), false);
  activate.props.onClick(); activate.props.onClick();
  const calls = f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), { action: "activate", reviewToken: review.reviewToken });
  assert.ok(f.find(node => node.type === "iframe"), "review remains visible while activation is pending");
  assert.equal(f.find(node => node.type === "form"), undefined);
  assert.equal(f.button("Activating…").props.disabled, true);
  assert.equal(f.button("Back to editing").props.disabled, true);
  finish(Response.json({ ok: true })); await f.settle();
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  assert.match(text(f.draw()), /Automation activated for future reminders/);
  assert.equal(f.calls.filter(call => call.url === API && call.method === "GET").length, 2);
});

test("cadence message and heading variables do not also submit conflicting literal bindings", async () => {
  const f = fixture(); await f.setup(); f.change("cadence-body", "variable:BODY"); f.change("cadence-heading", "variable:NAME"); await f.submit();
  const posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.equal(posted.draft.bodyTarget, "variable:BODY");
  assert.equal(posted.draft.headingTarget, "variable:NAME");
  assert.deepEqual(posted.draft.bindings, { URL: { source: "literal", value: "" } });
});

test("remaining template text submits only changed copy and editing it invalidates the review", async () => {
  const f = fixture(); await f.setup();
  const fields = nodes(f.draw()).filter(node => node.type === "textarea" && node.props.id?.startsWith("cadence-copy-"));
  assert.deepEqual(fields.map(node => node.props.value), ["Hi there,", "Your name"]);
  assert.equal(f.find(node => node.props?.id === "cadence-copy-0"), undefined);
  assert.equal(f.find(node => node.props?.id === "cadence-copy-1"), undefined);
  assert.equal(fields.some(node => node.props.value === "hello@example.test"), false);
  f.change("cadence-copy-2", ""); f.change("cadence-copy-3", "RU/NED");
  await f.submit();
  const posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.deepEqual(posted.draft.copy, { greeting: "", signature: "RU/NED" });
  assert.ok(f.find(node => node.type === "iframe"));
  f.button("Back to editing").props.onClick();
  f.change("cadence-copy-3", "Your name");
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  assert.equal(f.find(node => node.type === "button" && text(node) === "Activate automation"), undefined);
  f.change("cadence-copy-2", "Hi there,"); await f.submit();
  assert.equal(Object.hasOwn(JSON.parse(f.calls.filter(call => call.method === "POST").at(-1).body).draft, "copy"), false);
});

test("copy overrides cannot compete with cadence targets and reset when choosing a template", async () => {
  const f = fixture(); await f.setup();
  f.change("cadence-copy-2", "An edited greeting"); f.change("cadence-copy-3", "An edited signature");
  f.change("cadence-body", "copy:greeting"); f.change("cadence-heading", "copy:signature");
  assert.equal(f.find(node => node.props?.id === "cadence-copy-2"), undefined);
  assert.equal(f.find(node => node.props?.id === "cadence-copy-3"), undefined);
  await f.submit();
  assert.equal(Object.hasOwn(JSON.parse(f.calls.find(call => call.method === "POST").body).draft, "copy"), false);
  f.button("Back to editing").props.onClick();
  f.change("cadence-template", template.id); await f.settle();
  f.change("cadence-body", "copy:body"); f.change("cadence-heading", "copy:heading");
  assert.equal(f.find(node => node.props?.id === "cadence-copy-2").props.value, "Hi there,");
  assert.equal(f.find(node => node.props?.id === "cadence-copy-3").props.value, "Your name");
  assert.equal(f.find(node => node.type === "iframe"), undefined);
});

test("local sample preview renders fixed copy edits as text without a provider request", async () => {
  const f = fixture({ preview: true }); await f.setup();
  f.change("cadence-copy-1", ""); f.change("cadence-copy-3", "RU/NED <team>");
  await f.submit();
  const html = f.find(node => node.type === "iframe").props.srcDoc;
  assert.match(html, /RU\/NED &lt;team&gt;/);
  assert.doesNotMatch(html, /Hi there,|Your name|<team>/);
  assert.match(html, /We’re about to begin/);
  assert.equal(f.calls.length, 0);
});

test("uncertain activation clears the review and never automatically repeats the request", async () => {
  const f = fixture({ respond: (call, fallback) => { if (call.body && JSON.parse(call.body).action === "activate") throw Error("Connection interrupted. Refresh to check the plan."); return fallback(call); } });
  await f.setup(); await f.submit(); f.button("Activate automation").props.onClick(); await f.settle();
  assert.match(text(f.draw()), /Connection interrupted/);
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate").length, 1);
});

test("empty eligibility, no future stages and expired reviews block activation inside the handler", async () => {
  for (const patch of [{ recipients: review.recipients.filter(recipient => !recipient.eligible) }, { occurrences: [] }, { expiresAt: "2000-01-01T00:00:00Z" }]) {
    const f = fixture({ reviewed: { ...review, ...patch } }); await f.setup(); await f.submit();
    assert.equal(f.button("Activate automation").props.disabled, true);
    f.button("Activate automation").props.onClick(); await f.settle();
    assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate").length, 0);
  }
});

test("pausing uses the displayed plan revision and reloads the current plan list", async () => {
  const f = fixture({ data: { ...overview, plans: [plan] } }); f.draw(); await f.settle();
  await f.openSaved(plan.id); f.button("Pause reminders").props.onClick(); await f.settle();
  assert.deepEqual(JSON.parse(f.calls.find(call => call.method === "POST").body), { action: "pause", id: plan.id, revision: plan.revision });
  assert.equal(f.calls.filter(call => call.url === API && call.method === "GET").length, 2);
  assert.match(text(f.draw()), /Automation paused/);
});

test("sequence pause targets its revision and leaves individual overrides unchanged", async () => {
  let paused = false;
  const inherited = { ...plan, sequenceId: sequence.id };
  const individual = { ...plan, id: "individual-plan" };
  const data = { ...overview, sequences: [sequence], plans: [inherited, individual] };
  const f = fixture({ data, respond: (call, fallback) => {
    if (call.body && JSON.parse(call.body).action === "pause_sequence") { paused = true; return Response.json({ ok: true }); }
    if (paused && call.method === "GET" && call.url === API) return Response.json({ ...data, sequences: [{ ...sequence, active: false, status: "paused" }], plans: [{ ...inherited, status: "paused", attention: "Sequence paused or awaiting its approved update. No reminders will send for this call." }, individual] });
    return fallback(call);
  } });
  f.draw(); await f.settle(); f.button("Email library").props.onClick();
  assert.equal(f.find(node => node.type === "li" && node.key === inherited.id), undefined, "inherited calls belong inside their sequence");
  assert.match(text(f.find(node => node.type === "li" && node.key === individual.id)), /Custom reminders for this call/);
  assert.match(text(f.find(node => node.type === "li" && node.key === sequence.id)), /1 call using this sequence/);
  await f.openSaved(sequence.id, "sequence");
  assert.match(text(f.draw()), /Revision 2/);
  const pause = f.button("Pause sequence"); pause.props.onClick(); pause.props.onClick(); await f.settle();
  const calls = f.calls.filter(call => call.method === "POST");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), { action: "pause_sequence", id: sequence.id, revision: sequence.revision });
  assert.match(text(f.draw()), /Sequence paused. Its inherited call reminders are paused too/);
  assert.match(text(f.find(node => node.type === "li" && node.key === sequence.id)), /Paused/);
  assert.match(text(f.find(node => node.type === "li" && node.key === individual.id)), /Enabled/);
  assert.equal(f.calls.filter(call => call.method === "GET" && call.url === API).length, 2);
});

test("changed calls expose the reason for attention and link actual delivery outcomes to email history", async () => {
  const attention = "Call changed. Review the updated time and audience before activating again.";
  const data = { ...overview, configuration: { enabled: true, ready: true }, plans: [{ ...plan, status: "changed", attention, delivery: { sent: 4, pending: 2, failed: 1, manualReview: 2, cancelled: 1 } }] };
  const f = fixture({ data });
  f.draw(); await f.settle(); f.button("Email library").props.onClick();
  const row = f.find(node => node.type === "li" && node.key === plan.id);
  assert.match(text(row), /Needs attention/);
  assert.ok(text(row).includes(attention));
  await f.openSaved(plan.id); f.detailView("Activity");
  const history = f.find(node => node.type === "a" && node.props.href === "/ops/messages?mode=emails");
  assert.ok(history);
  assert.match(text(f.draw()), /Accepted by provider means the send request succeeded/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("missing setup, campaign-only designs and template load failures cannot produce a review", async () => {
  const setup = fixture({ data: { ...overview, setupRequired: true } }); setup.draw(); await setup.settle(); setup.button("New automation").props.onClick();
  assert.equal(setup.button("Preview and review").props.disabled, true);
  await setup.submit();
  assert.equal(setup.calls.filter(call => call.method === "POST").length, 0);
  const campaign = fixture({ selectedTemplate: { ...template, campaignOnly: true } }); campaign.draw(); await campaign.settle(); campaign.button("New automation").props.onClick(); campaign.change("cadence-template", template.id); await campaign.settle();
  assert.match(text(campaign.draw()), /Choose an individual email template/);
  assert.equal(campaign.button("Preview and review").props.disabled, true);
  const unpublished = fixture({ selectedTemplate: { ...template, status: "draft" } }); unpublished.draw(); await unpublished.settle(); unpublished.button("New automation").props.onClick(); unpublished.change("cadence-template", template.id); await unpublished.settle();
  assert.match(text(unpublished.draw()), /Publish this design in Resend/);
  assert.equal(unpublished.button("Preview and review").props.disabled, true);
  let fail = false;
  const failed = fixture({ respond: (call, fallback) => fail && call.url !== API ? Response.json({ error: "Template unavailable" }, { status: 503 }) : fallback(call) });
  await failed.setup(); await failed.submit(); failed.button("Back to editing").props.onClick(); fail = true; failed.change("cadence-template", "different-template"); await failed.settle();
  assert.match(text(failed.draw()), /Template unavailable/);
  assert.equal(failed.find(node => node.type === "iframe"), undefined);
  assert.equal(failed.button("Preview and review").props.disabled, true);
});

test("admin page denies other operators and preview does not require provider access", async () => {
  async function page(context) {
    const deps = {
      "next/navigation": { redirect(path) { throw Error(`Redirect:${path}`); } },
      "@/components/platform/OperatorEmailAutomations": { __esModule: true, default: "automation-ui" },
      "@/components/platform/OperatorMessagesTabs": { __esModule: true, default: "message-tabs" },
      "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" },
      "@/components/platform/PlatformUnavailable": { __esModule: true, default: "unavailable" },
      "@/lib/platform/page-data": { getOperatorAccessContext: async () => context },
    };
    return compile("app/ops/email-automations/page.tsx", name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }).default();
  }
  await assert.rejects(page({ state: "signed_out" }), /Redirect:\/ops\/access/);
  assert.equal((await page({ state: "denied" })).type, "unavailable");
  assert.equal((await page({ state: "preview" })).props.preview, true);
  assert.match(text(await page({ state: "authenticated", role: "ops_coordinator", viewer: { id: "operator-1" } })), /Admin access required/);
  assert.equal((await page({ state: "authenticated", role: "ops_admin", viewer: { id: "admin-1" } })).type, "automation-ui");
});

test("automations has an explicit messages tab without changing existing message modes", async () => {
  const names = { "../announcements/page": "posts", "../notifications/page": "alerts", "../emails/page": "emails", "../email-automations/page": "automations" };
  const Page = compile("app/ops/messages/page.tsx", name => { assert.ok(names[name], name); return { __esModule: true, default: names[name] }; }).default;
  for (const mode of ["posts", "alerts", "emails", "automations", undefined]) assert.equal((await Page({ searchParams: Promise.resolve({ mode }) })).type, mode ?? "posts");
  const Tabs = compile("src/components/platform/OperatorMessagesTabs.tsx", name => { assert.equal(name, "next/link"); return { __esModule: true, default: "a" }; }).default;
  const links = nodes(Tabs({ active: "automations" })).filter(node => node.type === "a");
  assert.equal(links.length, 4);
  assert.equal(links.find(link => link.props["aria-current"] === "page").props.href, "/ops/messages?mode=automations");
});

test("management hub searches saved sequences and calls and filters actionable states", async () => {
  const paused = { ...sequence, id: "paused-sequence", title: "Circle call · Members", kind: "circle", active: false, status: "paused" };
  const changed = { ...plan, status: "changed", attention: "Call changed — review its time." };
  const f = fixture({ data: { ...overview, sequences: [sequence, paused], plans: [changed] } });
  f.draw(); await f.settle(); f.button("Email library").props.onClick();
  assert.equal(f.find(node => node.type === "form"), undefined);
  assert.match(text(f.draw()), /Automated emails/);
  assert.ok(f.find(node => node.key === sequence.id && node.type === "li"));
  f.change("automation-search", "circle");
  assert.equal(f.find(node => node.key === sequence.id && node.type === "li"), undefined);
  assert.ok(f.find(node => node.key === paused.id && node.type === "li"));
  f.change("automation-search", ""); f.change("automation-filter", "attention");
  assert.ok(f.find(node => node.key === plan.id && node.type === "li"));
  assert.equal(f.find(node => node.key === paused.id && node.type === "li"), undefined);
  f.change("automation-filter", "paused");
  assert.ok(f.find(node => node.key === paused.id && node.type === "li"));
  assert.equal(f.find(node => node.key === plan.id && node.type === "li"), undefined);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("opening a saved sequence renders its approved stages and automatically checked audience without a review token", async () => {
  const f = fixture({ data: { ...overview, sequences: [sequence] } });
  await f.openSaved(sequence.id, "sequence");
  assert.equal(f.calls.at(-1).url, `${API}?scope=sequence&id=${sequence.id}`);
  assert.match(text(f.draw()), /16 calendar days and 7 calendar days before/);
  assert.match(text(f.draw()), /8 a.m. Denver time/);
  assert.match(text(f.draw()), /No future email is scheduled/);
  assert.match(text(f.draw()), /Who receives it/);
  assert.match(text(f.draw()), /alex@example.test/);
  const frame = f.find(node => node.type === "iframe");
  assert.equal(frame.props.title, "Saved automation email design");
  assert.equal(frame.props.sandbox, "");
  assert.match(frame.props.srcDoc, /First stage/);
  f.savedStage("day_of");
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Second stage/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("selecting a scheduled call automatically checks its audience while preserving the selected reminder", async () => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const secondCall = { ...event, id: "event-2", title: "December Foundations 01" };
  const data = { ...overview, events: [event, secondCall], sequences: [sequence] };
  const detail = savedDetail(data, "sequence", sequence.id);
  detail.calls.push({ ...detail.calls[0], ...secondCall });
  const f = fixture({ data, respond: (call, fallback) => call.url.includes("eventId=") ? response : call.url.startsWith(`${API}?`) ? Response.json(detail) : fallback(call) });
  await f.openSaved(sequence.id, "sequence");
  assert.match(text(f.draw()), /alex@example.test/);
  f.savedStage("day_of");
  f.change("automation-recipient-call", secondCall.id);
  assert.equal(f.calls.filter(call => call.url.includes("eventId=")).length, 1);
  assert.equal(f.calls.at(-1).method, "GET");
  assert.equal(f.calls.at(-1).url, `${API}?scope=sequence&id=${sequence.id}&eventId=${secondCall.id}`);
  assert.equal(f.button("Checking…").props.disabled, true);
  assert.doesNotMatch(text(f.draw()), /alex@example.test/);
  finish(Response.json({ ...detail, selectedEventId: secondCall.id, recipients: [{ memberId:"second",name:"Casey",email:"casey@example.test",eligible:true,reason:"" }] })); await f.settle();
  assert.match(text(f.draw()), /1 eligible · 0 excluded/);
  assert.match(text(f.draw()), /casey@example.test/);
  assert.doesNotMatch(text(f.draw()), /alex@example.test/);
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Second stage/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("saved edits preserve the approved template version, field bindings and fixed copy before guarded reactivation", async () => {
  const f = fixture({ data: { ...overview, sequences: [sequence] }, reviewed: { ...review, scope: "sequence" } });
  await f.openSaved(sequence.id, "sequence"); f.button("Edit emails").props.onClick();
  assert.equal(f.find(node => node.props?.id === "cadence-template").props.value, template.id);
  assert.equal(f.find(node => node.props?.id === "cadence-body").props.value, "copy:body");
  assert.equal(f.find(node => node.props?.id === "cadence-source-NAME").props.value, "member_name");
  assert.equal(f.find(node => node.props?.id === "cadence-source-URL").props.value, "call_url");
  assert.equal(f.find(node => node.props?.id === "cadence-copy-2").props.value, "");
  assert.equal(f.find(node => node.props?.id === "cadence-copy-3").props.value, "RU/NED");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
  await f.submit();
  const posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.equal(posted.action, "preview");
  assert.equal(posted.draft.templateVersion, template.version);
  assert.equal(posted.draft.scope, "sequence");
  assert.deepEqual(posted.draft.copy, { greeting: "", signature: "RU/NED" });
  assert.deepEqual(posted.draft.bindings.NAME, { source: "member_name" });
  f.button("Back to editing").props.onClick();
  f.change("cadence-copy-3", "Team RU/NED");
  assert.equal(f.find(node => node.type === "button" && text(node) === "Activate sequence"), undefined);
  f.button("Back to sequence").props.onClick();
  assert.match(text(f.draw()), /Discard the changes/);
  f.button("Keep editing").props.onClick();
  assert.equal(f.find(node => node.props?.id === "cadence-copy-3").props.value, "Team RU/NED");
  f.button("Back to sequence").props.onClick(); f.button("Discard changes").props.onClick();
  assert.equal(f.find(node => node.type === "form"), undefined);
  assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate").length, 0);
});

test("paused automation resumes through prefilled review, never an immediate activation request", async () => {
  const f = fixture({ data: { ...overview, plans: [{ ...plan, active: false, status: "paused" }] } });
  await f.openSaved(plan.id);
  f.button("Review and resume").props.onClick();
  assert.equal(f.find(node => node.props?.id === "cadence-scope"), undefined);
  assert.match(text(f.draw()), /This call only/);
  assert.equal(f.find(node => node.props?.id === "cadence-event").props.value, event.id);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
  await f.submit();
  assert.equal(JSON.parse(f.calls.find(call => call.method === "POST").body).action, "preview");
  assert.ok(f.button("Activate automation"));
});

test("delivery activity exposes failures without a retry action and separates provider acceptance from delivery", async () => {
  const data = { ...overview, plans: [plan] };
  const f = fixture({ data, respond: (call, fallback) => call.url.startsWith(`${API}?`) ? Response.json({ ...savedDetail(data, "event", plan.id), recentDeliveries: [{ id: "delivery-1", eventId: event.id, eventTitle: event.title, stage: "day_before", status: "manual_review", dueAt: event.startsAt, updatedAt: event.startsAt, sentAt: null, reason: "Provider outcome uncertain. Verify Resend before taking action." }] }) : fallback(call) });
  await f.openSaved(plan.id); f.detailView("Activity");
  assert.match(text(f.draw()), /Needs delivery review/);
  assert.match(text(f.draw()), /Provider outcome uncertain/);
  assert.match(text(f.draw()), /Accepted by provider means the send request succeeded/);
  assert.equal(f.find(node => node.type === "button" && /retry/i.test(text(node))), undefined);
});

test("sample manager supports saved previews, inspection, editing and review without any network calls", async () => {
  const f = fixture({ preview: true });
  await f.openSaved("sample-sequence-members", "sequence");
  assert.match(text(f.draw()), /fictional/);
  assert.equal(f.button("Pause sequence").props.disabled, true);
  f.button("Pause sequence").props.onClick();
  f.button("Refresh audience").props.onClick(); await f.settle();
  assert.match(text(f.draw()), /alex@example.test/);
  f.button("Edit emails").props.onClick(); await f.submit();
  assert.equal(f.button("Activation off in preview").props.disabled, true);
  f.button("Activation off in preview").props.onClick();
  assert.equal(f.calls.length, 0);
});

test("a failed detail or audience request leaves saved state intact and surfaces the failure", async () => {
  let fail = false;
  const f = fixture({ data: { ...overview, sequences: [sequence] }, respond: (call, fallback) => fail && call.url.startsWith(`${API}?`) ? Response.json({ error: "Audience check unavailable. Try again later." }, { status: 503 }) : fallback(call) });
  await f.openSaved(sequence.id, "sequence"); fail = true;
  f.button("Refresh audience").props.onClick(); await f.settle();
  assert.match(text(f.draw()), /Audience check unavailable/);
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /First stage/);
  assert.doesNotMatch(text(f.draw()), /alex@example.test/);
  assert.equal(Boolean(f.button("Edit emails").props.disabled), false);
});

test("other automatic workflows remain distinct from unfinished protocols and do not imply delivery success", async () => {
  const f = fixture({ data: { ...overview, warnings: ["Live template catalog temporarily unavailable. Saved designs remain visible."], managedElsewhere: [{ id: "registration", title: "Welcome and profile-ready emails", state: "configured", statusLabel: "Configured", trigger: "Follows verified registration and profile access.", timing: "After the relevant account change.", recipients: "The corresponding member.", management: { href: "/ops/members", label: "View members" }, controlBoundary: "Managed by registration settings; not paused with recurring call reminders." }] } });
  f.draw(); await f.settle(); f.button("Email library").props.onClick();
  const existing = f.find(node => node.props?.["aria-labelledby"] === "existing-automated-emails-heading");
  assert.match(text(existing), /Welcome and profile-ready/);
  assert.match(text(existing), /Managed by registration settings/);
  assert.match(text(f.find(node => node.type === "details" && text(node).startsWith("Planned"))), /Completion/);
  assert.doesNotMatch(text(existing), /Awaiting approved completion rules/);
  assert.match(text(f.draw()), /Saved designs remain visible/);
});

test("focused details preserve the library search when returning and sample stages use actual approved copy", async () => {
  const f = fixture({ preview: true }); f.draw();
  f.change("automation-search", "Foundations 01");
  await f.openSaved("sample-sequence-members");
  assert.equal(f.find(node => node.props?.id === "automation-search"), undefined);
  const frame = f.find(node => node.type === "iframe");
  assert.match(frame.props.srcDoc, /What we mean by Foundations/);
  assert.doesNotMatch(frame.props.srcDoc, /Tomorrow:/);
  f.savedStage("day_before");
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Tomorrow:/);
  assert.doesNotMatch(f.find(node => node.type === "iframe").props.srcDoc, /What we mean by Foundations/);
  f.button("← Back to automated emails").props.onClick();
  assert.equal(f.find(node => node.props?.id === "automation-search").props.value, "Foundations 01");
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  assert.equal(f.calls.length, 0);
});

test("next reminder uses its explicit time zone and ready sequences do not look finished", async () => {
  const nextReminder = { stage: "day_before", dueAt: "2026-11-04T22:00:00Z", expiresAt: "2026-11-04T22:30:00Z", eventId: event.id, eventTitle: event.title, timeZone: "America/New_York" };
  const f = fixture({ data: { ...overview, configuration: { ...overview.configuration, enabled: true, ready: true }, sequences: [{ ...sequence, nextReminder }, { ...sequence, id: "ready-sequence", title: "Circle call · Members", status: "no_remaining", matchingCallCount: 0 }] } });
  f.draw(); await f.settle(); f.button("Email library").props.onClick();
  assert.match(text(f.find(node => node.type === "li" && node.key === sequence.id)), /5:00 PM EST/);
  const ready = text(f.find(node => node.type === "li" && node.key === "ready-sequence"));
  assert.match(ready, /Waiting for a call/);
  assert.doesNotMatch(ready, /finished/);
});

test("dirty editor guards client-side navigation and completed review receives focus without stage-change jumps", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  const windowListeners = new Map(), documentListeners = new Map(), focused = [], navigated = [];
  class ElementStub { constructor(href, target = "") { this.href = href; this.target = target; } closest() { return this; } hasAttribute() { return false; } }
  globalThis.Element = ElementStub;
  globalThis.window = { location: { href: "https://example.test/ops/messages?mode=automations", pathname: "/ops/messages", search: "?mode=automations", hash: "", assign: url => navigated.push(url) }, history: { state: null, replaceState() {} }, addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: name => windowListeners.delete(name) };
  globalThis.document = { addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name), getElementById: id => ({ focus: () => focused.push(id), scrollIntoView() {} }) };
  try {
    const f = fixture(); await f.setup(); await f.submit(); f.draw();
    assert.ok(focused.includes("automation-review-heading"));
    const count = focused.filter(id => id === "automation-review-heading").length;
    f.reviewStage("day_of"); f.draw();
    assert.equal(focused.filter(id => id === "automation-review-heading").length, count);
    let prevented = 0;
    const click = { target: new ElementStub("https://example.test/ops/messages?mode=emails"), preventDefault() { prevented++; }, stopPropagation() {} };
    documentListeners.get("click")(click); f.draw();
    assert.equal(prevented, 1); assert.equal(navigated.length, 0);
    assert.ok(focused.includes("automation-discard-confirmation"));
    f.button("Keep editing").props.onClick();
    assert.equal(f.find(node => node.type === "form"), undefined);
    assert.ok(f.find(node => node.type === "iframe"));
    documentListeners.get("click")(click); f.button("Discard changes").props.onClick();
    assert.deepEqual(navigated, ["https://example.test/ops/messages?mode=emails"]);
    let warned = false;
    windowListeners.get("beforeunload")({ preventDefault() { warned = true; } });
    assert.equal(warned, false);
  } finally { for (const key of Object.keys(previous)) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } }
});

test("effective filters exclude finished and cancelled calls while blocked prerequisites need attention", async () => {
  const past = { ...plan, id: "past", status: "past" };
  const cancelled = { ...plan, id: "cancelled", status: "cancelled" };
  const blocked = { ...plan, id: "blocked", status: "blocked", attention: "The call needs its access link before reminders can send." };
  const f = fixture({ data: { ...overview, plans: [plan, past, cancelled, blocked] } });
  f.draw(); await f.settle(); f.button("Email library").props.onClick(); f.change("automation-filter", "active");
  assert.ok(f.find(node => node.type === "li" && node.key === plan.id));
  for (const id of ["past", "cancelled", "blocked"]) assert.equal(f.find(node => node.type === "li" && node.key === id), undefined);
  f.change("automation-filter", "attention");
  assert.ok(f.find(node => node.type === "li" && node.key === "blocked"));
  assert.equal(f.find(node => node.type === "li" && node.key === plan.id), undefined);
});

test("member and founder test sequences are separated without losing their saved audience track", async () => {
  const members = { ...sequence, title: "Foundations 01" };
  const founders = { ...sequence, id: "founder-sequence", title: "Foundations 01", track: "founder_test" };
  const f = fixture({ data: { ...overview, sequences: [members, founders] } }); f.draw(); await f.settle(); f.button("Email library").props.onClick();
  assert.ok(f.find(node => node.type === "li" && node.key === members.id));
  assert.equal(f.find(node => node.type === "li" && node.key === founders.id), undefined);
  f.button("Tests").props.onClick();
  assert.ok(f.find(node => node.type === "li" && node.key === founders.id));
  assert.equal(f.find(node => node.type === "li" && node.key === members.id), undefined);
  await f.openSaved(founders.id);
  assert.match(text(f.draw()), /Email sequence · Founder test/);
  f.button("Edit emails").props.onClick();
  assert.equal(f.find(node => node.props?.id === "cadence-track").props.value, "founder_test");
  assert.ok(f.button("Back to sequence"));
});

test("recurring email filters combine across sequences and calls and reset without sending", async () => {
  const soon = { stage: "day_before", dueAt: new Date(Date.now() + 2 * 86400000).toISOString(), expiresAt: new Date(Date.now() + 2 * 86400000 + 1800000).toISOString(), eventId: event.id, eventTitle: event.title, timeZone: "America/Denver" };
  const circle = { ...sequence, id: "circle-sequence", title: "Circle WHY", kind: "circle", track: "members", nextReminder: soon };
  const founders = { ...sequence, id: "founders-sequence", title: "Circle test", kind: "circle", track: "founder_test", active: false, status: "paused" };
  const circleCall = { ...plan, id: "circle-call", title: "Circle WHY — November", kind: "circle", nextReminder: soon };
  const f = fixture({ data: { ...overview, sequences: [sequence, circle, founders], plans: [plan, circleCall] } });
  f.draw(); await f.settle(); f.button("Email library").props.onClick();
  f.change("automation-kind", "circle");
  f.button("Members").props.onClick();
  f.change("automation-schedule", "week");
  f.change("automation-filter", "active");
  f.change("automation-search", "  WHY  ");
  assert.match(text(f.draw()), /1 sequence · 1 custom call/);
  const displayed = () => nodes(f.find(node => node.props?.["aria-label"] === "Email library")).filter(node => node.type === "li" && node.key !== "Completion").map(node => node.key);
  assert.deepEqual(displayed(), [circle.id, circleCall.id]);
  f.button("Tests").props.onClick();
  assert.deepEqual(displayed(), []);
  assert.match(text(f.draw()), /No automated emails match this view/);
  f.button("Reset view").props.onClick();
  assert.equal(displayed().length, 4);
  for (const id of ["automation-kind", "automation-schedule", "automation-filter"]) assert.equal(f.find(node => node.props?.id === id).props.value, "all");
  assert.equal(f.find(node => node.props?.id === "automation-search").props.value, "");
  assert.equal(f.find(node => node.props?.id === "automation-sort").props.value, "next");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("recurring email sort changes the rendered order and survives details and refresh", async () => {
  const alpha = { ...sequence, id: "alpha", title: "Alpha", updatedAt: "2026-10-01T10:00:00Z" };
  const zulu = { ...sequence, id: "zulu", title: "Zulu", updatedAt: "2026-10-19T10:00:00Z" };
  const f = fixture({ data: { ...overview, sequences: [alpha, zulu] } });
  f.draw(); await f.settle(); f.button("Email library").props.onClick();
  f.change("automation-kind", "foundations");
  f.button("Members").props.onClick();
  f.change("automation-schedule", "none");
  f.change("automation-sort", "updated");
  const displayed = () => nodes(f.find(node => node.props?.["aria-label"] === "Email library")).filter(node => node.type === "li" && node.key !== "Completion").map(node => node.key);
  assert.deepEqual(displayed(), [zulu.id, alpha.id]);
  await f.openSaved(zulu.id);
  f.button("← Back to automated emails").props.onClick();
  f.button("Refresh").props.onClick(); await f.settle();
  assert.equal(f.find(node => node.props?.id === "automation-kind").props.value, "foundations");
  assert.equal(f.button("Members").props["aria-pressed"], true);
  assert.equal(f.find(node => node.props?.id === "automation-schedule").props.value, "none");
  assert.equal(f.find(node => node.props?.id === "automation-sort").props.value, "updated");
  assert.deepEqual(displayed(), [zulu.id, alpha.id]);
  f.change("automation-sort", "name");
  assert.deepEqual(displayed(), [alpha.id, zulu.id]);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("Upcoming is the default and opens the exact selected email without sending", async () => {
  const upcoming = { planId: plan.id, sequenceId: null, eventId: event.id, eventTitle: event.title, kind: plan.kind, track: "members", active: true, status: "upcoming", attention: "", stage: "day_of", timeZone: event.timeZone, dueAt: new Date(Date.now() + 86400000).toISOString(), expiresAt: new Date(Date.now() + 88200000).toISOString() };
  const f = fixture({ data: { ...overview, plans: [plan], upcoming: [upcoming], configuration: { enabled: true, ready: true } } });
  f.draw(); await f.settle();
  assert.equal(f.button("Upcoming").props["aria-current"], "page");
  assert.ok(f.find(node => node.props?.["aria-label"] === "Upcoming email reminders"));
  assert.equal(f.find(node => node.props?.["aria-label"] === "Email library"), undefined);
  const open = f.find(node => node.type === "button" && node.props["aria-label"] === `View Day-of reminder for ${event.title}`);
  assert.ok(open); open.props.onClick(); await f.settle();
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Second stage/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("successful pause stays visibly paused when the following overview refresh fails", async () => {
  let paused = false;
  const upcoming = { planId: plan.id, sequenceId: null, eventId: event.id, eventTitle: event.title, kind: plan.kind, track: "members", active: true, status: "upcoming", attention: "", stage: "day_before", timeZone: event.timeZone, dueAt: new Date(Date.now() + 86400000).toISOString(), expiresAt: new Date(Date.now() + 88200000).toISOString() };
  const data = { ...overview, plans: [plan], upcoming: [upcoming], configuration: { enabled: true, ready: true } };
  const f = fixture({ data, respond: (call, fallback) => {
    if (call.body && JSON.parse(call.body).action === "pause") { paused = true; return Response.json({ ok: true }); }
    if (paused && call.url === API && call.method === "GET") return Response.json({ error: "Refresh failed" }, { status: 503 });
    return fallback(call);
  } });
  await f.openSaved(plan.id); f.button("Pause reminders").props.onClick(); await f.settle();
  f.button("Upcoming").props.onClick();
  const row = f.find(node => node.type === "li" && node.key === `${plan.id}:day_before`);
  assert.match(text(row), /Paused/);
  assert.doesNotMatch(text(row), /Scheduled/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("leaving the library clears its unsupported filters without losing search", async () => {
  const f = fixture({ data: { ...overview, plans: [plan] } }); f.draw(); await f.settle(); f.button("Email library").props.onClick();
  f.change("automation-search", "Foundations"); f.change("automation-filter", "finished"); f.change("automation-schedule", "none");
  f.button("Upcoming").props.onClick();
  assert.equal(f.find(node => node.props?.id === "automation-filter").props.value, "all");
  assert.equal(f.find(node => node.props?.id === "automation-schedule").props.value, "all");
  assert.equal(f.find(node => node.props?.id === "automation-search").props.value, "Foundations");
  f.button("Activity").props.onClick();
  assert.equal(f.find(node => node.props?.id === "automation-schedule"), undefined);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
});

test("editing a stage carries only its overrides into review and any subsequent edit invalidates approval", async () => {
  const f = fixture(); await f.setup();
  f.change("cadence-message-subject", "Your call is tomorrow"); f.change("cadence-message-body", "Bring one honest question.");
  await f.submit();
  let posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.deepEqual(posted.draft.messages, { day_before: { subject: "Your call is tomorrow", message: "Bring one honest question." } });
  f.button("Back to editing").props.onClick();
  f.change("cadence-message-body", "Bring two honest questions.");
  assert.equal(f.find(node => node.type === "button" && text(node) === "Activate automation"), undefined);
  f.button("Restore default message").props.onClick();
  await f.submit();
  posted = JSON.parse(f.calls.filter(call => call.method === "POST").at(-1).body);
  assert.equal(Object.hasOwn(posted.draft, "messages"), false);
  assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate").length, 0);
});

test("invalid stage text is blocked inside the review handler, including keyboard form submission", async () => {
  const f = fixture(); await f.setup();
  f.change("cadence-message-body", "[INSERT LINK]");
  assert.equal(f.button("Preview and review").props.disabled, true);
  await f.submit();
  assert.equal(f.calls.filter(call => call.method === "POST").length, 0);
  assert.equal(f.find(node => node.type === "button" && text(node) === "Activate automation"), undefined);
});

test("review is a focused read-only step and returning to edit preserves the selected email and its changes", async () => {
  const f = fixture(); await f.setup();
  f.change("cadence-message-body", "A question for tomorrow.");
  f.editorStage("day_of");
  f.change("cadence-message-subject", "We begin today"); f.change("cadence-message-body", "Bring that question with you.");
  await f.submit();
  assert.equal(f.find(node => node.type === "form"), undefined);
  assert.equal(f.find(node => node.type === "textarea"), undefined);
  assert.equal(f.find(node => node.type === "input"), undefined);
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Second stage/);
  const request = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.deepEqual(request.draft.messages.day_of, { subject: "We begin today", message: "Bring that question with you." });
  f.button("Back to editing").props.onClick();
  assert.ok(f.find(node => node.type === "form"));
  assert.equal(f.find(node => node.props?.id === "cadence-message-subject").props.value, "We begin today");
  assert.equal(f.find(node => node.props?.id === "cadence-message-body").props.value, "Bring that question with you.");
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  assert.equal(f.find(node => node.type === "button" && text(node) === "Activate automation"), undefined);
  f.editorStage("day_before");
  assert.equal(f.find(node => node.props?.id === "cadence-message-body").props.value, "A question for tomorrow.");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate").length, 0);
});

test("switching the reviewed email carries that selection back to editing without another request", async () => {
  const f = fixture(); await f.setup(); await f.submit();
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /First stage/);
  f.reviewStage("day_of");
  f.button("Back to editing").props.onClick();
  const stages = f.find(node => node.props?.["aria-label"] === "Email reminder stages");
  assert.equal(nodes(stages).find(node => node.type === "button" && node.props["aria-pressed"]).key, "day_of");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("review does not attach another reminder's send time to a stage with no future occurrence", async () => {
  const f = fixture(); await f.setup(); await f.submit();
  let preview = f.find(node => node.props?.["aria-label"] === "Automation email preview");
  assert.match(text(preview), /Scheduled send:/);
  f.reviewStage("day_of");
  preview = f.find(node => node.props?.["aria-label"] === "Automation email preview");
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Second stage/);
  assert.doesNotMatch(text(preview), /Scheduled send:/);
  assert.match(text(preview), /No future send/i);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("saved call and sequence edits keep their approved scope and audience track visible and locked", async () => {
  for (const scope of ["event", "sequence"]) {
    const f = fixture({ data: { ...overview, plans: [plan], sequences: [sequence] }, reviewed: { ...review, scope } });
    await f.openSaved(scope === "event" ? plan.id : sequence.id); f.button("Edit emails").props.onClick();
    assert.equal(f.find(node => node.props?.id === "cadence-scope"), undefined, "saved scope cannot silently switch");
    assert.match(text(f.draw()), scope === "event" ? /This call only/ : /All matching calls/);
    assert.equal(f.find(node => node.props?.id === "cadence-kind").props.disabled, true);
    assert.equal(f.find(node => node.props?.id === "cadence-track").props.disabled, true);
    assert.equal(Boolean(f.find(node => node.props?.id === "cadence-event").props.disabled), scope === "event");
    f.change("cadence-kind", "circle"); f.change("cadence-track", "founder_test");
    if (scope === "event") f.change("cadence-event", "unrelated-call");
    assert.equal(f.find(node => node.props?.id === "cadence-kind").props.value, "foundations_01");
    assert.equal(f.find(node => node.props?.id === "cadence-track").props.value, "members");
    if (scope === "event") assert.equal(f.find(node => node.props?.id === "cadence-event").props.value, event.id);
    await f.submit();
    const posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
    assert.equal(posted.draft.scope, scope);
    assert.equal(posted.draft.kind, "foundations_01");
    assert.equal(posted.draft.track, "members");
    assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "activate").length, 0);
  }
});
