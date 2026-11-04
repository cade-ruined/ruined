import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";
import { loader } from "./helpers/member-sms-fixture.mjs";

const require = createRequire(import.meta.url), model = loader()("src/lib/communications/member-sms-template-model.ts");
const nodes = node => node == null || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.props?.children) : String(node);
const API = "/api/ops/messages/texts/templates";
function fixture({ preview = false, templateId = "call_reminder", respond, strictEffects = false } = {}) {
  const slots = [], effects = [], calls = [], saved = [], closed = [], busy = [];
  const configs = model.defaultMemberSmsTemplates();
  let cursor = 0, changed = false;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = { ...React,
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === "function" ? initial() : initial }; return [slots[i].value, value => { const next = typeof value === "function" ? value(slots[i].value) : value; changed ||= !Object.is(next, slots[i].value); slots[i].value = next; }]; },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const first = !(i in slots); effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; if (strictEffects && first) { slots[i].cleanup?.(); slots[i].cleanup = effect(); } }); } },
  };
  async function fallback(call) {
    assert.equal(call.url, API);
    if (call.method === "GET") return Response.json({ templates: configs.map(config => model.memberSmsTemplateView(config)) });
    const { action, reviewDigest, ...input } = JSON.parse(call.body);
    const edit = model.validateMemberSmsTemplateEdit(input), config = configs.find(item => item.id === edit.id);
    if (action === "preview") return Response.json({ template: model.memberSmsTemplateView({ ...config, ...edit }), preview: `Reviewed by server: ${model.memberSmsTemplatePreview({ ...config, ...edit })}`, reviewDigest: `digest:${edit.body}:${edit.revision}` });
    assert.equal(action, "save"); assert.equal(reviewDigest, `digest:${edit.body}:${edit.revision}`);
    Object.assign(config, edit, { revision: config.revision + 1, effectiveAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z" });
    return Response.json({ template: model.memberSmsTemplateView(config), preview: model.memberSmsTemplatePreview(config) });
  }
  const code = ts.transpileModule(readFileSync(new URL("../src/components/platform/OperatorSmsTemplateEditor.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "fetch", code)(name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/communications/member-sms-template-model") return model;
    if (name === "./operatorStyles") return { OPERATOR_BUTTON_CLASS: "button" };
    if (name === "./OperatorSmsTemplateEditor.module.css") return new Proxy({}, { get: (_, key) => key });
    assert.fail(`Unexpected dependency ${name}`);
  }, mod, mod.exports, async (url, options) => { assert.equal(preview, false, "Sample editor must stay offline"); const call = { url, ...options }; calls.push(call); return respond ? respond(call, fallback, configs) : fallback(call); });
  const props = { templateId, preview, onClose: () => closed.push(true), onSaved: () => saved.push(true), onBusyChange: value => busy.push(value) };
  function draw() { for (let i = 0; i < 20; i++) { cursor = 0; changed = false; const tree = mod.exports.default(props); effects.splice(0).forEach(effect => effect()); if (!changed) return tree; } assert.fail("Unstable render"); }
  const find = predicate => nodes(draw()).find(predicate);
  const button = label => { const result = find(node => node.type === "button" && text(node) === label); assert.ok(result, `Missing button ${label}`); return result; };
  const fill = (id, value) => { const node = find(node => node.props?.id === id); assert.ok(node, id); node.props.onChange({ currentTarget: { value }, target: { value } }); };
  const toggle = value => find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ currentTarget: { checked: value } });
  const review = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return draw(); };
  return { draw, find, button, fill, toggle, review, settle, props, calls, saved, closed, busy, configs, cleanup() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test("automatic wording and timing remain drafts until server review and a separate final save", async () => {
  let finish;
  const f = fixture({ respond: (call, fallback) => call.method === "POST" && JSON.parse(call.body).action === "save" ? new Promise(resolve => { finish = () => resolve(fallback(call)); }) : fallback(call) });
  f.draw(); await f.settle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, "GET"); assert.equal(f.calls[0].cache, "no-store");
  f.fill("sms-template-body", "Ruined: {{call_title}} starts at {{call_time}}. Join: {{call_link}}.");
  f.fill("sms-template-minutes", "90"); f.toggle(false); f.draw();
  assert.equal(f.calls.length, 1, "typing and settings have no autosave"); assert.ok(f.busy.includes(true));
  assert.match(text(f.draw()), /12:00 PM/); assert.match(text(f.draw()), /Reply STOP/); assert.match(text(f.draw()), /January 15, 2030/);
  assert.equal(f.find(node => node.type === "button" && text(node) === "Save changes"), undefined);
  await f.review(); await f.settle();
  assert.match(text(f.draw()), /Reviewed by server/); assert.match(text(f.draw()), /90 minutes before/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  const save = f.button("Save changes"); save.props.onClick(); save.props.onClick(); f.draw();
  assert.equal(f.calls.filter(call => call.method === "POST").length, 2);
  const payload = JSON.parse(f.calls.at(-1).body); assert.equal(payload.action, "save"); assert.equal(payload.noticeMinutes, 90); assert.equal(payload.enabled, false); assert.match(payload.reviewDigest, /^digest:/);
  assert.equal(f.button("Saving…").props.disabled, true); finish(); await f.settle();
  assert.match(text(f.draw()), /Changes saved/); assert.match(text(f.draw()), /Matches the saved version/); assert.equal(f.saved.length, 1);
  save.props.onClick(); await f.settle(); assert.equal(f.saved.length, 1, "stale save handler cannot save again");
  f.cleanup();
});

test("editing wording, timing or enabled state invalidates a reviewed digest immediately", async () => {
  const f = fixture(); f.draw(); await f.settle();
  f.fill("sms-template-body", "Ruined: Your call is at {{call_time}}. {{call_link}}"); await f.review(); await f.settle();
  const staleSave = f.button("Save changes"); f.fill("sms-template-minutes", "120"); staleSave.props.onClick(); await f.settle();
  assert.equal(f.calls.some(call => call.body && JSON.parse(call.body).action === "save"), false); assert.ok(f.button("Review changes"));
  await f.review(); await f.settle(); f.toggle(false); assert.ok(f.button("Review changes"));
  await f.review(); await f.settle(); f.fill("sms-template-body", "Ruined: Updated wording. {{call_link}}"); assert.ok(f.button("Review changes"));
  f.cleanup();
});

test("stale saves preserve the full draft and refresh only the saved revision before another review", async () => {
  let conflict = true;
  const f = fixture({ respond: (call, fallback, configs) => {
    if (call.method === "POST" && JSON.parse(call.body).action === "save" && conflict) {
      conflict = false; Object.assign(configs[1], { revision: 3, body: "Ruined: A different saved text. {{call_link}}", noticeMinutes: 45 });
      return Response.json({ error: "Saved revision changed." }, { status: 409 });
    }
    return fallback(call);
  } });
  f.draw(); await f.settle(); f.fill("sms-template-body", "Ruined: My draft stays here. {{call_link}}"); f.fill("sms-template-minutes", "80"); f.toggle(false);
  await f.review(); await f.settle(); f.button("Save changes").props.onClick(); await f.settle();
  assert.match(text(f.draw()), /changed while you were editing/); assert.equal(f.button("Review changes").props.disabled, true);
  f.button("Refresh saved version").props.onClick(); await f.settle();
  assert.equal(f.find(node => node.props?.id === "sms-template-body").props.value, "Ruined: My draft stays here. {{call_link}}");
  assert.equal(f.find(node => node.props?.id === "sms-template-minutes").props.value, "80"); assert.equal(f.find(node => node.props?.type === "checkbox").props.checked, false);
  assert.match(text(f.draw()), /draft is unchanged/); await f.review(); await f.settle();
  assert.equal(JSON.parse(f.calls.at(-1).body).revision, 3); assert.equal(JSON.parse(f.calls.at(-1).body).action, "preview");
  f.cleanup();
});

test("an uncertain save requires refresh and keeps the draft without silently retrying", async () => {
  const f = fixture({ respond: (call, fallback) => { if (call.body && JSON.parse(call.body).action === "save") throw Error("Connection lost"); return fallback(call); } });
  f.draw(); await f.settle(); f.fill("sms-template-body", "Ruined: Your updated call. {{call_link}}"); await f.review(); await f.settle();
  const save = f.button("Save changes"); save.props.onClick(); await f.settle(); save.props.onClick(); await f.settle();
  assert.match(text(f.draw()), /save result could not be confirmed/); assert.ok(f.button("Refresh saved version"));
  assert.equal(f.calls.filter(call => call.body && JSON.parse(call.body).action === "save").length, 1); assert.equal(f.saved.length, 0);
  f.cleanup();
});

test("confirmation and day-before settings stay fixed while short-reminder timing is validated", async () => {
  const confirm = fixture({ templateId: "opt_in_confirmation" }); confirm.draw(); await confirm.settle();
  assert.equal(confirm.find(node => node.props?.type === "checkbox"), undefined); assert.equal(confirm.find(node => node.props?.id === "sms-template-minutes"), undefined);
  assert.match(text(confirm.draw()), /Confirmation stays enabled/); assert.match(text(confirm.draw()), /Message and data rates/);
  assert.equal(confirm.find(node => node.props?.["aria-label"] === "Insert call details"), undefined); confirm.cleanup();
  const day = fixture({ templateId: "day_before" }); day.draw(); await day.settle();
  assert.equal(day.find(node => node.props?.type === "checkbox").props.checked, false); assert.equal(day.find(node => node.props?.id === "sms-template-minutes"), undefined);
  day.toggle(true); await day.review(); await day.settle(); assert.equal(JSON.parse(day.calls.at(-1).body).noticeMinutes, 1440); assert.match(text(day.draw()), /24 hours before the call/); day.cleanup();
  const short = fixture(); short.draw(); await short.settle(); short.fill("sms-template-minutes", "14");
  assert.equal(short.button("Review changes").props.disabled, true); await short.review(); assert.equal(short.calls.length, 1);
  short.fill("sms-template-minutes", "90.5"); assert.equal(short.button("Review changes").props.disabled, true); short.cleanup();
});

test("allowed field insertion, restoring default wording and cancelling only affect the draft", async () => {
  const f = fixture(); f.draw(); await f.settle();
  f.fill("sms-template-body", "Ruined: Call starts "); f.button("Call time only").props.onClick();
  assert.equal(f.find(node => node.props?.id === "sms-template-body").props.value, "Ruined: Call starts {{call_time}}");
  f.fill("sms-template-minutes", "75"); f.toggle(false); f.button("Restore default wording").props.onClick();
  assert.equal(f.find(node => node.props?.id === "sms-template-body").props.value, model.MEMBER_SMS_TEMPLATE_DEFINITIONS.call_reminder.body);
  assert.equal(f.find(node => node.props?.id === "sms-template-minutes").props.value, "75"); assert.equal(f.find(node => node.props?.type === "checkbox").props.checked, false);
  f.button("Cancel edit").props.onClick(); assert.match(text(f.draw()), /Discard unsaved changes/); f.button("Keep editing").props.onClick(); assert.equal(f.closed.length, 0);
  f.button("Cancel edit").props.onClick(); f.button("Discard changes").props.onClick(); assert.equal(f.closed.length, 1); assert.equal(f.calls.length, 1); f.cleanup();
});

test("sample editor remains offline, permits review and never enables saving", async () => {
  const f = fixture({ preview: true, templateId: "foundations_01" }); f.draw(); await f.settle();
  assert.match(text(f.draw()), /Sample editor/); f.fill("sms-template-body", "RU/NED Foundations starts at {{call_time}}. Join: {{meeting_link}}."); await f.review(); await f.settle();
  assert.match(text(f.draw()), /meet.google.com/); assert.equal(f.button("Saving off in sample").props.disabled, true); f.button("Saving off in sample").props.onClick(); await f.settle();
  assert.equal(f.calls.length, 0); assert.equal(f.saved.length, 0); f.cleanup();
});

test("template loading failure is explicit and can be retried", async () => {
  let fail = true;
  const f = fixture({ respond: (call, fallback) => fail ? Response.json({ error: "Template service unavailable." }, { status: 503 }) : fallback(call) });
  f.draw(); await f.settle(); assert.match(text(f.draw()), /Template service unavailable/); fail = false; f.button("Try again").props.onClick(); await f.settle();
  assert.ok(f.find(node => node.props?.id === "sms-template-body")); assert.equal(f.calls.length, 2); f.cleanup();
});

test("development effect replay aborts the first load without leaving the editor stuck", async () => {
  let first = true;
  const f = fixture({ strictEffects: true, respond: (call, fallback) => {
    if (first) { first = false; return new Promise((_resolve, reject) => call.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))); }
    return fallback(call);
  } });
  f.draw(); await f.settle(); assert.equal(f.calls.length, 2); assert.ok(f.find(node => node.props?.id === "sms-template-body"));
  assert.doesNotMatch(text(f.draw()), /Loading text template/); f.cleanup();
});

test("dirty navigation requires a discard decision and protects reloads", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  const windowListeners = new Map(), documentListeners = new Map(), navigated = [];
  class LinkElement { closest() { return this; } hasAttribute() { return false; } href = "https://example.test/ops/people"; target = ""; }
  globalThis.Element = LinkElement;
  globalThis.window = { location: { href: "https://example.test/ops/messages?channel=texts", assign: href => navigated.push(href) }, history: { state: null, pushState(_state, _unused, href) { globalThis.window.location.href = href; } }, addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: name => windowListeners.delete(name) };
  globalThis.document = { getElementById: () => null, addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) };
  try {
    const f = fixture(); f.draw(); await f.settle(); f.fill("sms-template-body", "Ruined: Unsaved wording."); f.draw();
    let warned = false; windowListeners.get("beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, true);
    let prevented = false; documentListeners.get("click")({ target: new LinkElement(), button: 0, preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.equal(prevented, true); f.button("Keep editing").props.onClick(); assert.deepEqual(navigated, []);
    globalThis.window.location.href = "https://example.test/ops/messages?channel=emails"; windowListeners.get("popstate")(); f.draw();
    assert.equal(globalThis.window.location.href, "https://example.test/ops/messages?channel=texts");
    f.button("Discard changes").props.onClick(); assert.deepEqual(navigated, ["https://example.test/ops/messages?channel=emails"]);
    warned = false; windowListeners.get("beforeunload")({ preventDefault() { warned = true; } }); assert.equal(warned, false, "Confirmed discard must not prompt a second time"); f.cleanup();
  } finally { for (const key of Object.keys(previous)) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } }
});
