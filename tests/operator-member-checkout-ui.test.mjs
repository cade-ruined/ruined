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
const pricing = load("src/lib/membership/pricing.ts");
const schedule = load("src/lib/membership/foundations-schedule.ts");
const model = load("src/lib/stripe/operator-membership-model.ts");
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : "";
const flush = () => new Promise(resolve => setImmediate(resolve));
const status = (changes = {}) => ({ eligible: true, reason: null, paid: false, memberName: "Aaron Lee", actorName: "Cade Mang", publishableKey: "pk_test_fixture", ...changes });
const quoted = (plan = "monthly") => ({ id: "reservation-one", reviewToken: "review-exact-terms", expiresAt: "2099-10-23T22:00:00Z", firstChargeAt: null, billingSchedule: schedule.foundationsBillingScheduleForMonth("2099-11", plan), offer: pricing.MEMBERSHIP_OFFERS[`founding_individual_${plan}`], agreement: { title: "Ruined Membership Agreement", version: "ruined_membership-v3", bodyText: "Exact published membership agreement." }, memberName: "Aaron Lee", actorName: "Cade Mang", publishableKey: "pk_test_fixture", buyoutCap: 150000 });
async function fixture({ preview = false, statusChanges = {}, returned = false } = {}) {
  const slots = [], effects = [], calls = [], timers = [];
  let cursor = 0, state = status(statusChanges), failure = null, responseQuote = quoted(), requestCount = 0, refreshes = 0;
  const router = { refresh() { refreshes++; } };
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(fn) { const i = cursor++; effects[i] = fn; },
    useCallback(fn) { cursor++; return fn; },
  };
  const checkoutModule = load("src/components/platform/OperatorMemberCheckout.tsx", { react,
    "next/navigation": { useRouter: () => router },
    "@stripe/stripe-js": { loadStripe: () => assert.fail("Preview and parent render must not initialize Stripe") },
    "@/components/membership/AgreementText": { __esModule: true, default: ({ body }) => React.createElement("p", null, body) },
    "@/components/platform/operatorStyles": { OPERATOR_BUTTON_CLASS: "operator-button" },
    "@/lib/membership/foundations-schedule": schedule,
    "@/lib/membership/pricing": pricing,
    "@/lib/stripe/operator-membership-model": model,
  }, { window: { location: { href: `https://members.example.test/ops/members/member-one${returned ? "?membershipCheckout=returned" : ""}` } },
    crypto: { randomUUID: () => `request-${++requestCount}` },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
    fetch: async (url, options = {}) => { const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, method: options.method || "GET", body }); return { ok: !failure, json: async () => failure ? typeof failure === "string" ? { error: failure } : failure : body?.action === "quote" ? { quote: responseQuote } : body?.action === "checkout" ? { clientSecret: "secret-fixture", plan: responseQuote.offer.plan, commercialReservationId: responseQuote.id } : state }; },
  });
  const render = () => { cursor = 0; return checkoutModule.default({ memberId: "member-one", memberName: "Aaron Lee", preview }); };
  const runEffects = async () => { render(); for (const fn of effects) fn?.(); await flush(); };
  await runEffects();
  return { render, runEffects, calls, timers, get refreshes() { return refreshes; },
    button: label => nodes(render()).find(node => node.type === "button" && text(node) === label),
    authority: () => nodes(render()).find(node => node.props.name === "operator-membership-authority"),
    submit: () => nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }),
    embedded: () => nodes(render()).find(node => node.type === checkoutModule.OperatorEmbeddedCheckout),
    fail: value => { failure = value; }, setStatus: value => { state = value; }, setQuote: value => { responseQuote = value; },
  };
}

test("admin reviews exact member offer and authority before opening Stripe directly", async () => {
  const f = await fixture();
  await f.button("Review membership").props.onClick();
  assert.deepEqual(f.calls.at(-1), { url: "/api/ops/members/member-one/checkout", method: "POST", body: { action: "quote", requestId: "request-1", plan: "monthly" } });
  assert.match(text(f.render()), /\$349.*due today/);
  assert.match(text(f.render()), /12-month commitment/);
  assert.match(text(f.render()), /\$4,188 total before tax/);
  assert.match(text(f.render()), /Renews monthly at \$349/);
  assert.match(text(f.render()), /lower of \$1,500/);
  assert.match(text(f.render()), /You’ll accept as Cade Mang on behalf of Aaron Lee/);
  assert.ok(text(f.render()).includes(model.OPERATOR_MEMBERSHIP_AUTHORITY_TEXT));
  assert.equal(f.authority().props.checked, false);
  await f.submit(); assert.equal(f.calls.length, 2);
  f.authority().props.onChange({ target: { checked: true } }); await f.submit();
  assert.deepEqual(f.calls.at(-1).body, { action: "checkout", reservationId: "reservation-one", reviewToken: "review-exact-terms", authorityAccepted: true, authorityVersion: model.OPERATOR_MEMBERSHIP_AUTHORITY_VERSION });
  assert.ok(f.embedded());
  assert.equal(f.embedded().props.clientSecret, "secret-fixture");
  assert.equal(f.authority(), undefined);
  assert.ok(f.calls.every(call => call.url === "/api/ops/members/member-one/checkout"));
  assert.match(text(f.render()), /Accepted as Cade Mang on behalf of Aaron Lee/);
});

test("quote transport failures keep the same request and lock the selected plan", async () => {
  const f = await fixture(); f.fail("Temporary provider timeout.");
  await f.button("Review membership").props.onClick();
  assert.equal(nodes(f.render()).find(node => node.type === "fieldset").props.disabled, true);
  assert.equal(f.authority(), undefined);
  f.fail(null); await f.button("Review membership").props.onClick();
  assert.equal(f.calls[1].body.requestId, f.calls[2].body.requestId);
  assert.equal(f.calls[1].body.plan, f.calls[2].body.plan);
});

test("annual quote shows annual amount and renewal, not monthly exit penalties", async () => {
  const f = await fixture();
  const annual = nodes(f.render()).filter(node => node.type === "input" && node.props.type === "radio")[1];
  annual.props.onChange(); f.setQuote(quoted("annual"));
  await f.button("Review membership").props.onClick();
  assert.match(text(f.render()), /\$3,490.*due today/);
  assert.match(text(f.render()), /Renews annually at \$3,490/);
  assert.match(text(f.render()), /does not automatically refund the prepaid year/);
  assert.doesNotMatch(text(f.render()), /lower of \$1,500/);
});

test("changed terms require fresh unchecked review of the existing offer", async () => {
  const f = await fixture(); await f.button("Review membership").props.onClick();
  f.authority().props.onChange({ target: { checked: true } });
  f.fail({ code: "review_changed", error: "The published agreement changed." }); await f.submit();
  assert.equal(f.authority(), undefined);
  assert.equal(f.embedded(), undefined);
  assert.match(text(f.render()), /membership terms have changed/);
  f.fail(null); f.setQuote({ ...quoted(), reviewToken: "review-updated-terms" });
  await f.button("Review current offer").props.onClick();
  assert.equal(f.calls.at(-1).body.requestId, "request-1");
  assert.equal(f.authority().props.checked, false);
  f.authority().props.onChange({ target: { checked: true } }); await f.submit();
  assert.equal(f.calls.at(-1).body.reviewToken, "review-updated-terms");
});

test("an explicit server plan lock can resume its offer without a second reservation key", async () => {
  const f = await fixture(); f.fail({ code: "checkout_plan_locked", plan: "annual", error: "An annual offer is already reserved." });
  await f.button("Review membership").props.onClick();
  assert.ok(f.button("Resume annual membership"));
  f.fail(null); f.setQuote(quoted("annual")); await f.button("Resume annual membership").props.onClick();
  assert.deepEqual(f.calls.at(-1).body, { action: "quote", requestId: "request-1", plan: "annual" });
  assert.match(text(f.render()), /Renews annually/);
});

test("Stripe return waits for verified payment and never creates a second checkout", async () => {
  const f = await fixture({ returned: true }); await f.runEffects();
  assert.match(text(f.render()), /Waiting for Stripe payment confirmation/);
  assert.doesNotMatch(text(f.render()), /Membership payment confirmed/);
  assert.equal(f.button("Review membership"), undefined);
  f.setStatus(status({ eligible: false, paid: true })); await f.runEffects();
  assert.match(text(f.render()), /Membership payment confirmed/);
  assert.equal(f.refreshes, 1);
  assert.ok(f.calls.every(call => call.method === "GET"));
});

test("ineligible accounts cannot quote and preview never reads, writes, or loads Stripe", async () => {
  const blocked = await fixture({ statusChanges: { eligible: false, reason: "This membership already has billing." } });
  assert.equal(blocked.button("Review membership"), undefined);
  assert.match(text(blocked.render()), /already has billing/);
  const preview = await fixture({ preview: true });
  await preview.button("Review membership").props.onClick();
  preview.authority().props.onChange({ target: { checked: true } }); await preview.submit();
  assert.match(text(preview.render()), /No agreement, subscription, or payment is created/);
  assert.equal(preview.embedded(), undefined);
  assert.deepEqual(preview.calls, []);
});

test("embedded Stripe mounts one session and destroys it on cleanup; completion is only a status-check signal", async () => {
  let effect, parameters, destroyed = 0, complete = 0;
  const mounted = [], errors = [];
  const host = {};
  const checkoutModule = load("src/components/platform/OperatorMemberCheckout.tsx", {
    react: { ...React, useRef: () => ({ current: host }), useEffect: fn => { effect = fn; } },
    "next/navigation": {},
    "@stripe/stripe-js": { loadStripe: async () => ({ createEmbeddedCheckoutPage: async input => { parameters = input; return { mount: value => mounted.push(value), destroy: () => destroyed++ }; } }) },
    "@/components/membership/AgreementText": {}, "@/components/platform/operatorStyles": {},
    "@/lib/membership/foundations-schedule": schedule, "@/lib/membership/pricing": pricing, "@/lib/stripe/operator-membership-model": model,
  });
  checkoutModule.OperatorEmbeddedCheckout({ clientSecret: "session-bound-secret", publishableKey: "pk_test_fixture", onError: value => errors.push(value), onComplete: () => complete++ });
  const cleanup = effect(); await flush();
  assert.equal(parameters.clientSecret, "session-bound-secret"); assert.deepEqual(mounted, [host]);
  parameters.onComplete(); assert.equal(complete, 1);
  cleanup(); assert.equal(destroyed, 1);
  parameters.onComplete(); assert.equal(complete, 1);
  assert.deepEqual(errors, []);
});
