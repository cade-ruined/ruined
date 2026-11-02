import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(name => name in dependencies ? dependencies[name] : require(name),
    loadedModule, loadedModule.exports, ...Object.values(globals));
  return loadedModule.exports;
}
const pricing = load("src/lib/membership/pricing.ts");
const schedules = load("src/lib/membership/foundations-schedule.ts");
const model = load("src/lib/stripe/operator-membership-model.ts");
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
const flush = () => new Promise(resolve => setImmediate(resolve));
const initialStatus = changes => ({ eligible: true, state: "ready", memberName: "Geoff Elder", actorName: "Cade Mangelson", ...changes });
const quoted = changes => ({ id: "reservation-one", reviewToken: "a".repeat(64), expiresAt: "2099-10-23T22:00:00Z",
  firstChargeAt: null, billingSchedule: schedules.foundationsBillingScheduleForMonth("2099-11", "monthly"),
  offer: pricing.MEMBERSHIP_OFFERS.founding_individual_monthly,
  agreement: { title: "Ruined Membership Agreement", version: "ruined_membership-v3", bodyText: "Exact published terms." },
  memberName: "Geoff Elder", actorName: "Cade Mangelson", total: 37692, tax: 2792,
  paymentMethodLabel: "Saved Link payment method", authorityVersion: model.OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION, ...changes });
const evidence = "Member authorized me to accept these terms and charge their saved method for the first payment and recurring renewals.";

async function fixture({ preview = false, statusChanges = {} } = {}) {
  const slots = [], effects = [], calls = [];
  let cursor = 0, status = initialStatus(statusChanges), quote = quoted(), failure = null, transport = false;
  let responseResult = { state: "pending", message: "Stripe payment is being reconciled. Do not start another payment." }, refreshes = 0, requests = 0;
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(fn) { effects[cursor++] = fn; },
  };
  const component = load("src/components/platform/OperatorSavedMemberPayment.tsx", {
    react, "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
    "@/components/membership/AgreementText": { __esModule: true, default: ({ body }) => React.createElement("p", null, body) },
    "@/components/platform/operatorStyles": { OPERATOR_BUTTON_CLASS: "operator-button" },
    "@/lib/stripe/operator-membership-model": model,
  }, { crypto: { randomUUID: () => `request-${++requests}` }, fetch: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options.method ?? "GET", body });
    if (transport) throw new Error("Network interrupted; payment not confirmed.");
    return { ok: !failure, json: async () => failure ? { error: failure } : body?.action === "quote" ? { quote } : body?.action === "collect" ? responseResult : status };
  } });
  const render = () => { cursor = 0; return component.default({ memberId: "member-one", memberName: "Geoff Elder", preview }); };
  render();
  for (const effect of effects) effect?.();
  await flush();
  return { render, calls, get refreshes() { return refreshes; },
    button: label => nodes(render()).find(node => node.type === "button" && text(node) === label),
    authority: () => nodes(render()).find(node => node.type === "input" && node.props.type === "checkbox"),
    evidence: () => nodes(render()).find(node => node.type === "textarea"),
    form: () => nodes(render()).find(node => node.type === "form"),
    submit: () => nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }),
    setQuote: value => { quote = value; }, setStatus: value => { status = value; }, setResult: value => { responseResult = value; },
    fail: value => { failure = value; }, interrupt: value => { transport = value; },
  };
}
async function approve(f) {
  f.authority().props.onChange({ target: { checked: true } });
  f.evidence().props.onChange({ target: { value: evidence } });
}

test("saved-method UI requires reviewed exact price, unchecked authority and a recorded member instruction", async () => {
  const f = await fixture();
  assert.equal(f.form(), undefined);
  await f.button("Review saved payment").props.onClick();
  assert.deepEqual(f.calls.at(-1).body, { action: "quote", requestId: "request-1" });
  const content = text(f.render());
  assert.match(content, /\$376\.92charged today/);
  assert.match(content, /\$349\.00 membership \+ \$27\.92 tax/);
  assert.match(content, /Saved Link payment method/);
  assert.match(content, /12-month commitment.*\$4,188\.00/);
  assert.match(content, /11 monthly installments/);
  assert.match(content, /Recorded as Cade Mangelson for Geoff Elder/);
  assert.ok(content.includes(model.OPERATOR_SAVED_PAYMENT_AUTHORITY_TEXT));
  assert.equal(f.authority().props.checked, false);
  assert.equal(f.evidence().props.value, "");
  await f.submit(); assert.equal(f.calls.length, 2);
  f.authority().props.onChange({ target: { checked: true } });
  await f.submit(); assert.equal(f.calls.length, 2);
  f.evidence().props.onChange({ target: { value: "too short" } });
  await f.submit(); assert.equal(f.calls.length, 2);
  f.evidence().props.onChange({ target: { value: `  ${evidence}  ` } });
  await f.submit();
  assert.deepEqual(f.calls.at(-1).body, { action: "collect", reservationId: "reservation-one", reviewToken: "a".repeat(64),
    authorityAccepted: true, authorityVersion: model.OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION, authorizationEvidence: evidence });
  assert.equal(f.form(), undefined);
  assert.equal(f.calls.filter(call => call.body?.action === "collect").length, 1);
});

test("incomplete quote cannot expose collection; retries reuse the quote request identity", async () => {
  const f = await fixture(); f.fail("Temporary quote failure");
  await f.button("Review saved payment").props.onClick();
  assert.equal(f.form(), undefined);
  f.fail(null); f.setQuote(quoted({ total: null }));
  await f.button("Review saved payment").props.onClick();
  assert.equal(f.form(), undefined);
  assert.match(text(f.render()), /quote is incomplete/);
  f.setQuote(quoted()); await f.button("Review saved payment").props.onClick();
  assert.deepEqual(f.calls.filter(call => call.body?.action === "quote").map(call => call.body.requestId), ["request-1", "request-1", "request-1"]);
  assert.equal(f.authority().props.checked, false);
});

test("expired accepted quote does not collect and requires a fresh review", async () => {
  const f = await fixture(); f.setQuote(quoted({ expiresAt: "2000-01-01T00:00:00Z" }));
  await f.button("Review saved payment").props.onClick(); await approve(f); await f.submit();
  assert.equal(f.calls.filter(call => call.body?.action === "collect").length, 0);
  assert.equal(f.form(), undefined); assert.match(text(f.render()), /quote expired/);
  f.setQuote(quoted()); await f.button("Review saved payment").props.onClick();
  assert.equal(f.calls.at(-1).body.requestId, "request-2");
  assert.equal(f.authority().props.checked, false);
});

test("unknown collection response disables further submit and only checks the original payment", async () => {
  const f = await fixture(); await f.button("Review saved payment").props.onClick(); await approve(f);
  f.interrupt(true); await f.submit();
  assert.equal(f.form(), undefined); assert.equal(f.button("Review saved payment"), undefined);
  assert.match(text(f.render()), /payment not confirmed/);
  f.interrupt(false); f.setStatus(initialStatus({ eligible: false, state: "review", result: { state: "review", message: "Outcome still unknown. Do not retry collection." } }));
  await f.button("Check payment status").props.onClick();
  assert.match(text(f.render()), /Outcome still unknown/);
  await f.button("Check payment status").props.onClick();
  assert.equal(f.calls.filter(call => call.body?.action === "collect").length, 1);
  assert.ok(f.calls.slice(3).every(call => call.method === "GET"));
  assert.doesNotMatch(text(f.render()), /Payment confirmed/);
});

test("reloaded unresolved payment exposes its explanation and status check without another collection", async () => {
  for (const state of ["pending", "requires_action", "failed", "review"]) {
    const message = `Persisted ${state} explanation`;
    const f = await fixture({ statusChanges: { eligible: false, state, result: { state, message } } });
    assert.match(text(f.render()), new RegExp(message));
    assert.equal(f.form(), undefined); assert.equal(f.button("Review saved payment"), undefined);
    assert.ok(f.button("Check payment status"));
    if (state === "requires_action") assert.match(text(f.render()), /Member authentication required/);
    await f.button("Check payment status").props.onClick();
    assert.ok(f.calls.every(call => call.method === "GET"));
  }
  const noResult = await fixture({ statusChanges: { eligible: false, state: "review", reason: "Review the persisted payment." } });
  assert.match(text(noResult.render()), /Review the persisted payment/);
  assert.ok(noResult.button("Check payment status"));
});

test("verified status resolves an uncertain submission without issuing another charge", async () => {
  const f = await fixture(); await f.button("Review saved payment").props.onClick(); await approve(f); await f.submit();
  f.setStatus(initialStatus({ eligible: false, state: "paid", result: { state: "paid", message: "Verified paid." } }));
  await f.button("Check payment status").props.onClick();
  assert.match(text(f.render()), /Payment confirmed/);
  assert.equal(f.button("Check payment status"), undefined);
  assert.equal(f.form(), undefined);
  assert.equal(f.calls.filter(call => call.body?.action === "collect").length, 1);
  assert.equal(f.refreshes, 2);
});

test("preview never requests account data; unavailable and already-paid statuses offer no payment controls", async () => {
  const preview = await fixture({ preview: true });
  assert.equal(preview.render(), null); assert.deepEqual(preview.calls, []);
  for (const state of ["unavailable", "paid"]) {
    const f = await fixture({ statusChanges: { eligible: false, state } });
    assert.equal(f.render(), null);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, "GET");
  }
});
