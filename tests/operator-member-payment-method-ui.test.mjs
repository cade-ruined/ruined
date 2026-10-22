import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, deps = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), js)(name => name in deps ? deps[name] : require(name), result, result.exports, ...Object.values(globals));
  return result.exports;
}
const model = load("src/lib/stripe/payment-method-model.ts");
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : "";
const flush = () => new Promise(resolve => setImmediate(resolve));
const snapshot = (state = "not_saved", extra = {}) => ({ enabled: true, eligible: true, reason: null, state, canRemove: false, removalPending: false, paymentMethod: state === "saved" ? { type: "card", label: "Visa ending in 4242" } : null, ...extra });
async function fixture({ state = "not_saved", extra = {}, preview = false, returned = "" } = {}) {
  const slots = [], calls = [], redirects = [], timers = [];
  let cursor = 0, effect, response = snapshot(state, extra), failure = null, destination = "https://checkout.stripe.com/c/pay/setup-fixture", uuid = 0, refreshes = 0;
  const router = { refresh() { refreshes++; } };
  const hooks = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn) { cursor++; effect = fn; },
  };
  const View = load("src/components/platform/OperatorMemberPaymentMethod.tsx", { react: hooks,
    "next/navigation": { useRouter: () => router },
    "@/components/platform/operatorStyles": { OPERATOR_BUTTON_CLASS: "operator-button" },
    "@/lib/stripe/payment-method-model": model,
  }, { window: { location: { href: `https://members.example.test/ops/members/member-one?paymentSetup=${returned}`, assign: value => redirects.push(value) } },
    crypto: { randomUUID: () => `attempt-${++uuid}` },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    fetch: async (url, options = {}) => { calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null }); return { ok: !failure, json: async () => failure ? { error: failure } : options.method === "POST" ? { url: destination } : response }; },
  }).default;
  const render = () => { cursor = 0; return View({ memberId: "member-one", memberName: "Aaron Lee", preview }); };
  render(); effect(); await flush();
  return { render, calls, redirects, timers, get refreshes() { return refreshes; },
    consent: () => nodes(render()).find(node => node.props.name === "operator-save-card-consent"),
    button: name => nodes(render()).find(node => node.type === "button" && text(node) === name),
    submit: () => nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }),
    setResponse: value => { response = value; }, fail: value => { failure = value; }, destination: value => { destination = value; },
    reload: async () => { render(); effect(); await flush(); },
  };
}

test("operator card setup names the target member and requires fresh sponsor consent", async () => {
  const f = await fixture();
  assert.match(text(f.render()), /Aaron Lee/);
  assert.match(text(f.render()), /No charge is made here/);
  assert.match(text(f.render()), /To accept the agreement and pay now, use Complete membership above/);
  assert.match(text(f.render()), /Save a card for later \(optional\)/);
  assert.ok(text(f.render()).includes(model.OPERATOR_PAYMENT_SETUP_CONSENT_TEXT));
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.button("Add card securely").props.disabled, true);
  await f.submit(); assert.equal(f.calls.length, 1);
  f.consent().props.onChange({ target: { checked: true } }); await f.submit();
  assert.deepEqual(f.calls[1], { url: "/api/ops/members/member-one/payment-method", method: "POST", body: { attemptId: "attempt-1", consentAccepted: true, consentVersion: model.OPERATOR_PAYMENT_SETUP_CONSENT_VERSION } });
  assert.deepEqual(f.redirects, ["https://checkout.stripe.com/c/pay/setup-fixture"]);
});

test("Stripe return never claims saved before authoritative confirmation and polling is bounded", async () => {
  const f = await fixture({ state: "pending", returned: "returned" });
  assert.match(text(f.render()), /Waiting for Stripe confirmation/);
  assert.doesNotMatch(text(f.render()), /Visa ending/);
  assert.equal(f.refreshes, 0);
  for (let i = 0; i < 9; i++) { f.timers[i](); await flush(); }
  assert.equal(f.calls.length, 10);
  assert.equal(f.timers.length, 9);
  f.setResponse(snapshot("saved")); await f.reload();
  assert.match(text(f.render()), /Visa ending in 4242/);
  assert.equal(f.consent(), undefined);
  assert.equal(f.refreshes, 1);
  await f.reload(); assert.equal(f.refreshes, 1);
  assert.equal(f.calls.some(call => call.method !== "GET"), false);
});

test("provider failures retain the attempt and non-Stripe redirects are rejected", async () => {
  const f = await fixture(); f.consent().props.onChange({ target: { checked: true } });
  f.fail("Stripe unavailable."); await f.submit();
  assert.match(text(f.render()), /Stripe unavailable/);
  f.fail(null); f.destination("https://example.invalid/card"); await f.submit();
  assert.equal(f.calls[1].body.attemptId, f.calls[2].body.attemptId);
  assert.deepEqual(f.redirects, []);
  assert.match(text(f.render()), /Secure card setup could not be opened/);
});

test("cancelled setup remains resumable instead of claiming confirmation is pending", async () => {
  const f = await fixture({ state: "pending", returned: "cancelled" });
  assert.match(text(f.render()), /Card setup was not completed\. No charge was made/);
  assert.doesNotMatch(text(f.render()), /Waiting for Stripe confirmation/);
  assert.equal(f.timers.length, 0);
  assert.equal(f.button("Continue secure card setup").props.disabled, true);
  assert.equal(f.consent().props.checked, false);
  f.consent().props.onChange({ target: { checked: true } }); await f.submit();
  assert.equal(f.calls.at(-1).method, "POST");
  assert.deepEqual(f.redirects, ["https://checkout.stripe.com/c/pay/setup-fixture"]);
  const saved = await fixture({ state: "saved", returned: "cancelled" });
  assert.match(text(saved.render()), /Visa ending in 4242/);
  assert.doesNotMatch(text(saved.render()), /not completed|Waiting for Stripe confirmation/);
});

test("ineligible members have no save controls and preview performs no reads or writes", async () => {
  const blocked = await fixture({ extra: { eligible: false, reason: "Manage the existing subscription through billing." } });
  assert.equal(blocked.consent(), undefined);
  assert.match(text(blocked.render()), /existing subscription/);
  const preview = await fixture({ preview: true });
  assert.match(text(preview.render()), /Preview only/);
  preview.consent().props.onChange({ target: { checked: true } }); await preview.submit();
  assert.equal(preview.button("Add card securely").props.disabled, true);
  assert.deepEqual(preview.calls, []); assert.deepEqual(preview.redirects, []);
});

test("member record exposes card setup only to administrators and carries target identity and preview scope", () => {
  const blank = () => null;
  const Payment = () => null;
  const Checkout = () => null;
  const deps = {
    "next/link": { __esModule: true, default: "a" },
    "@/lib/membership/operator-registration-progress": load("src/lib/membership/operator-registration-progress.ts"),
    "@/lib/platform/operator-return-location": load("src/lib/platform/operator-return-location.ts"),
    "@/lib/platform/operator-member-guidance": load("src/lib/platform/operator-member-guidance.ts"),
    "@/components/platform/OperatorMemberActions": { OperatorNoteAction: blank, OperatorTaskCreateAction: blank, OperatorOverrideAction: blank },
    "@/components/platform/OperatorMemberPaymentMethod": { __esModule: true, default: Payment },
    "@/components/platform/OperatorMemberCheckout": { __esModule: true, default: Checkout },
  };
  for (const name of ["OperatorMemberDeleteAction", "OperatorMemberCheckpoints", "CirclePlacementRecommendations", "OperatorPageFrame", "OperatorMemberSetup", "OperatorProfileSupport", "OperatorProgress", "OperatorMemberAvatar", "OperatorMemberReferrals", "OperatorMemberWorkspace", "StateLabel"]) deps[`@/components/platform/${name}`] = { __esModule: true, default: blank };
  const Record = load("src/components/platform/OperatorMemberRecord.tsx", deps).default;
  const record = load("src/lib/platform/ops-preview.ts").getPreviewOpsMemberRecord("preview-01");
  for (const role of ["ops_admin", "ops_support", "circle_leader", "guide"]) {
    const panels = nodes(Record({ record: { ...record, access: { ...record.access, roles: [role] } }, preview: true })).filter(node => node.type === Payment);
    assert.equal(panels.length, role === "ops_admin" ? 1 : 0);
    if (panels[0]) assert.deepEqual(panels[0].props, { memberId: record.header.memberId, memberName: record.header.preferredName, preview: true });
    const checkouts = nodes(Record({ record: { ...record, access: { ...record.access, roles: [role] } }, preview: true })).filter(node => node.type === Checkout);
    assert.equal(checkouts.length, role === "ops_admin" ? 1 : 0);
    if (checkouts[0]) assert.deepEqual(checkouts[0].props, { memberId: record.header.memberId, memberName: record.header.preferredName, preview: true });
  }
  record.membership.agreement = { ...record.membership.agreement, authorizationId: "authority-one", signerName: "Cade Mang", signerEmail: "cade@example.test", delegatedForName: "Aaron Lee" };
  const agreementSection = nodes(Record({ record })).find(node => node.type === "h3" && text(node) === "Agreement");
  assert.ok(agreementSection);
  const recordText = text(Record({ record }));
  assert.match(recordText, /Accepted byCade Mangcade@example.test/);
  assert.match(recordText, /On behalf ofAaron Lee/);
});
