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
const model = compile("src/lib/communications/member-email-cadence-model.ts");
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
const plan = { id: "plan-1", eventId: event.id, kind: "foundations_01", track: "members", active: true, revision: 7, templateName: template.name, updatedAt: "2026-10-12T15:00:00Z" };
const overview = { events: [event], templates: [template], plans: [], configuration: { enabled: false, ready: false }, inactive: [{ title: "Completion", reason: "Awaiting approved completion rules." }] };
const review = {
  reviewToken: "opaque-reviewed-token", expiresAt: "2099-01-01T00:00:00Z",
  preview: { html: "<html><head></head><body>Reviewed first email</body></html>", subject: "Reviewed subject", text: "Reviewed copy" },
  previews: [{ stage: "day_before", html: "<html><head></head><body>First stage</body></html>", subject: "Tomorrow", text: "First stage" }, { stage: "day_of", html: "<html><body>Second stage</body></html>", subject: "Today", text: "Second stage" }],
  occurrences: [{ stage: "day_before", dueAt: "2026-11-04T22:00:00Z", expiresAt: "2026-11-04T22:30:00Z" }],
  recipients: [{ memberId: "member-1", name: "Alex", email: "alex@example.test", eligible: true, reason: "" }, { memberId: "member-2", name: "Jordan", email: "jordan@example.test", eligible: false, reason: "Membership email updates are turned off." }],
  warnings: ["Only actual confirmed registrations are included."],
};
function fixture({ preview = false, data = overview, reviewed = review, selectedTemplate = template, respond } = {}) {
  const slots = [], effects = [], calls = [];
  let cursor = 0, changed = false;
  const hooks = { ...React,
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { const value = typeof next === "function" ? next(slots[i]) : next; changed ||= slots[i] !== value; slots[i] = value; }]; },
    useEffect(effect, dependencies) { const i = cursor++; if (!slots[i] || dependencies.some((value, index) => value !== slots[i].dependencies[index])) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { dependencies, cleanup: effect() }; }); },
  };
  const deps = {
    react: hooks, "next/link": { __esModule: true, default: "a" },
    "@/components/platform/OperatorPageFrame": { __esModule: true, default: "main" },
    "@/components/platform/OperatorMessagesTabs": { __esModule: true, default: "message-tabs" },
    "@/components/platform/operatorStyles": styles,
    "@/lib/communications/member-email-cadence-model": model,
  };
  async function fallback(call) {
    if (call.method === "GET") return Response.json(call.url === API ? data : { template: selectedTemplate });
    return Response.json(JSON.parse(call.body).action === "preview" ? reviewed : { ok: true });
  }
  const Component = compile("src/components/platform/OperatorEmailAutomations.tsx", name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, async (url, options) => { const call = { url, ...options }; calls.push(call); return respond ? respond(call, fallback) : fallback(call); }).default;
  function draw() { for (let i = 0; i < 10; i++) { cursor = 0; changed = false; const tree = Component({ preview }); effects.splice(0).forEach(effect => effect()); if (!changed) return tree; } throw Error("Unstable render"); }
  const find = predicate => nodes(draw()).find(predicate);
  const button = label => { const result = find(node => node.type === "button" && text(node) === label); assert.ok(result, `Missing button: ${label}`); return result; };
  async function settle() { await new Promise(resolve => setImmediate(resolve)); return draw(); }
  function change(id, value) { const field = find(node => node.props?.id === id); assert.ok(field, `Missing field: ${id}`); field.props.onChange({ target: { value }, currentTarget: { value } }); }
  async function setup() { draw(); await settle(); change("cadence-event", preview ? "preview-november" : event.id); change("cadence-template", preview ? "preview-template" : template.id); await settle(); change("cadence-body", "copy:body"); change("cadence-heading", "copy:heading"); }
  const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  return { draw, find, button, calls, change, settle, setup, submit };
}

test("sample workspace supports review with real cadence timing while remaining completely offline", async () => {
  const f = fixture({ preview: true });
  await f.setup(); await f.submit();
  assert.match(text(f.draw()), /Nothing is saved or sent/);
  assert.match(text(f.draw()), /1 eligible · 1 excluded/);
  assert.match(text(f.draw()), /Membership email updates are turned off/);
  assert.match(text(f.draw()), /Foundations orientation/);
  const frame = f.find(node => node.type === "iframe");
  assert.equal(frame.props.sandbox, "");
  assert.equal(frame.props.referrerPolicy, "no-referrer");
  assert.match(frame.props.srcDoc, /Content-Security-Policy/);
  assert.match(frame.props.srcDoc, /script-src 'none'/);
  assert.equal(f.button("Activation off in preview").props.disabled, true);
  f.button("Activation off in preview").props.onClick();
  f.button("Refresh").props.onClick(); await f.settle();
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
  assert.match(text(f.draw()), /Excluded: Membership email updates are turned off/);
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /First stage/);
  f.change("cadence-preview-stage", "1");
  assert.match(f.find(node => node.type === "iframe").props.srcDoc, /Second stage/);
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
  assert.equal(f.find(node => node.type === "iframe"), undefined);
  finish(Response.json({ ok: true })); await f.settle();
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
  const fields = nodes(f.draw()).filter(node => node.type === "textarea");
  assert.deepEqual(fields.map(node => node.props.value), ["Hi there,", "Your name"]);
  assert.equal(f.find(node => node.props?.id === "cadence-copy-0"), undefined);
  assert.equal(f.find(node => node.props?.id === "cadence-copy-1"), undefined);
  assert.equal(fields.some(node => node.props.value === "hello@example.test"), false);
  f.change("cadence-copy-2", ""); f.change("cadence-copy-3", "RU/NED");
  await f.submit();
  const posted = JSON.parse(f.calls.find(call => call.method === "POST").body);
  assert.deepEqual(posted.draft.copy, { greeting: "", signature: "RU/NED" });
  assert.ok(f.find(node => node.type === "iframe"));
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
  assert.match(html, /Alex, we’re back together tomorrow/);
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
  f.button("Pause automation").props.onClick(); await f.settle();
  assert.deepEqual(JSON.parse(f.calls.find(call => call.method === "POST").body), { action: "pause", id: plan.id, revision: plan.revision });
  assert.equal(f.calls.filter(call => call.url === API && call.method === "GET").length, 2);
  assert.match(text(f.draw()), /Automation paused/);
});

test("changed calls need review and delivery exceptions point to existing Resend history", async () => {
  const attention = "Call changed. Review the updated time and audience before activating again.";
  const f = fixture({ data: { ...overview, configuration: { enabled: true, ready: true }, plans: [{ ...plan, attention, delivery: { sent: 4, pending: 2, failed: 1, manualReview: 2, cancelled: 1 } }] } });
  f.draw(); await f.settle();
  const row = f.find(node => node.type === "li" && node.key === plan.id);
  assert.match(text(row), /Needs review/);
  assert.doesNotMatch(text(row), /Active/);
  assert.match(text(row), /4 sent · 2 waiting · 3 need review/);
  assert.ok(text(row).includes(attention));
  const history = nodes(row).find(node => node.type === "a");
  assert.equal(history.props.href, "/ops/messages?mode=emails");
  assert.match(text(history), /Check Resend delivery history/);
  assert.deepEqual(nodes(row).filter(node => node.type === "button").map(text), ["Pause automation"]);
});

test("missing setup, campaign-only designs and template load failures cannot produce a review", async () => {
  const setup = fixture({ data: { ...overview, setupRequired: true } }); setup.draw(); await setup.settle();
  assert.equal(setup.button("Review automation").props.disabled, true);
  await setup.submit();
  assert.equal(setup.calls.filter(call => call.method === "POST").length, 0);
  const campaign = fixture({ selectedTemplate: { ...template, campaignOnly: true } }); campaign.draw(); await campaign.settle(); campaign.change("cadence-template", template.id); await campaign.settle();
  assert.match(text(campaign.draw()), /Choose an individual email template/);
  assert.equal(campaign.button("Review automation").props.disabled, true);
  const unpublished = fixture({ selectedTemplate: { ...template, status: "draft" } }); unpublished.draw(); await unpublished.settle(); unpublished.change("cadence-template", template.id); await unpublished.settle();
  assert.match(text(unpublished.draw()), /Publish this design in Resend/);
  assert.equal(unpublished.button("Review automation").props.disabled, true);
  let fail = false;
  const failed = fixture({ respond: (call, fallback) => fail && call.url !== API ? Response.json({ error: "Template unavailable" }, { status: 503 }) : fallback(call) });
  await failed.setup(); await failed.submit(); fail = true; failed.change("cadence-template", "different-template"); await failed.settle();
  assert.match(text(failed.draw()), /Template unavailable/);
  assert.equal(failed.find(node => node.type === "iframe"), undefined);
  assert.equal(failed.button("Review automation").props.disabled, true);
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
