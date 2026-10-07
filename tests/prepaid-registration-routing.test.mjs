import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

// All authentication, persistence and provider boundaries are local fixtures.
// Unexpected imports or network calls fail instead of using application secrets.
async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const result = { exports: {} };
  const injected = { fetch: () => assert.fail("Unexpected network call"), ...globals };
  new Function("require", "module", "exports", ...Object.keys(injected), code)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, result, result.exports, ...Object.values(injected));
  return result.exports;
}
const nodes = node => React.isValidElement(node)
  ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const visible = node => React.isValidElement(node)
  ? React.Children.toArray(node.props.children).map(visible).join("")
  : typeof node === "string" || typeof node === "number" ? String(node) : "";
const flush = () => new Promise(resolve => setImmediate(resolve));
const pricing = await load("src/lib/membership/pricing.ts");
const schedules = await load("src/lib/membership/foundations-schedule.ts");
const schedule = schedules.createFoundationsBillingSchedule(new Date("2026-10-06T18:00:00Z"), "monthly");
const onboarding = {
  requiredFieldsComplete: true, membershipFunding: "self", billingState: "pending",
  agreement: { id: "agreement", version: 3, acceptanceId: "accepted", body: "Published agreement" },
};
const paidRegistration = {
  state: "registered", ready: true, profileComplete: true,
  requiresInitialPayment: true, registeredAt: "2026-10-06T18:00:00Z",
  completionBasis: "paid_membership", initialPayment: { billingSchedule: schedule },
};
class MemberRegistrationError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function statusRoute({ signedIn = true, registration = paidRegistration, error } = {}) {
  const reads = [];
  const route = await load("app/api/my/registration/status/route.ts", {
    "next/server": { NextResponse: { json: (body, options) => new Response(JSON.stringify(body), options) } },
    "@/lib/auth/session": { getCurrentPlatformViewer: async () => signedIn ? { authUserId: "authenticated-owner" } : null },
    "@/lib/membership/registration-repository": {
      MemberRegistrationError,
      getMemberRegistration: async id => { reads.push(id); if (error) throw error; return registration; },
    },
  });
  return { route, reads };
}

test("payment status requires authentication and does not read registration for a signed-out caller", async () => {
  const { route, reads } = await statusRoute({ signedIn: false });
  const response = await route.GET();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(reads, []);
  assert.equal("POST" in route, false, "Polling must not expose a registration mutation");
});

test("payment status reads only the signed-in owner and returns no account or payment details", async () => {
  const { route, reads } = await statusRoute();
  const response = await route.GET(new Request("https://example.test/api/my/registration/status?memberId=another-member&paymentConfirmed=true"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(reads, ["authenticated-owner"]);
  assert.deepEqual(await response.json(), { paymentConfirmed: true });
});

test("payment status never treats saved cards, complimentary grants, incomplete or refunded registrations as paid", async () => {
  for (const registration of [
    null,
    { ...paidRegistration, ready: false },
    { ...paidRegistration, registeredAt: null },
    { ...paidRegistration, initialPayment: null },
    { ...paidRegistration, completionBasis: "saved_card" },
    { ...paidRegistration, completionBasis: "complimentary" },
  ]) {
    const { route } = await statusRoute({ registration });
    assert.deepEqual(await (await route.GET()).json(), { paymentConfirmed: false });
  }
});

test("payment status fails closed for revoked account access and transient storage errors", async () => {
  for (const [error, expectedStatus] of [[new MemberRegistrationError(403, "private account details"), 403], [new Error("private database detail"), 503]]) {
    const { route } = await statusRoute({ error });
    const response = await route.GET();
    assert.equal(response.status, expectedStatus);
    const body = await response.text();
    assert.doesNotMatch(body, /private|paymentConfirmed/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

function Activation() { return null; }
function Unavailable() { return null; }
function Progress() { return null; }
function Provider({ children }) { return children; }
class Redirect extends Error {
  constructor(destination) { super(destination); this.destination = destination; }
}
async function activationPage({ registration = paidRegistration, state = "ready", data = onboarding, currentOffer = null, searchParams = {}, coupleAuthorization = null } = {}) {
  const reads = [];
  const context = { state, data, viewer: { authUserId: "authenticated-owner" },
    configuration: { stripeActivationReady: true, stripeCheckoutReady: false, minimumAge: 18 } };
  const Page = (await load("app/my/activate/page.tsx", {
    "next/navigation": { redirect: destination => { throw new Redirect(destination); } },
    "@/components/membership/MemberActivation": Activation,
    "@/components/membership/MembershipEntryProgress": { MembershipEntryProgress: Progress, MembershipEntryProgressProvider: Provider },
    "@/lib/membership/entry-stage": await load("src/lib/membership/entry-stage.ts"),
    "@/components/platform/PlatformUnavailable": Unavailable,
    "@/lib/membership/page-context": { getMembershipPageContext: async () => context },
    "@/lib/membership/preview": { PREVIEW_MEMBER_ONBOARDING: onboarding },
    "@/lib/membership/repository": { getMemberOnboarding: () => assert.fail("Context owns the member read") },
    "@/lib/membership/registration-repository": { getMemberRegistration: async id => { reads.push(id); return registration; } },
    "@/lib/membership/public-signup-admission": { getMemberSignupPlan: async () => "monthly" },
    "@/lib/membership/paid-launch": { getMembershipFirstChargeAt: () => null },
    "@/lib/membership/cohort-prepayment": { isMembershipCohortPrepaymentEnabled: () => true },
    "@/lib/membership/foundations-schedule": { createFoundationsBillingSchedule: () => schedule },
    "@/lib/membership/commercial-repository": { getCurrentCommercialMembershipReservation: async () => currentOffer,
      getCoupleMembershipAuthorization: async () => coupleAuthorization },
    "@/lib/platform/repository": { requireActivePlatformMemberLink: async () => ({ memberId: "owner-member" }) },
    "@/lib/platform/config": { getStripePublishableKey: () => "pk_test_inert_fixture" },
  }, { process: { env: { STRIPE_MEMBERSHIP_PAID_AGREEMENT_VERSION: "ruined_membership-v3" } } })).default;
  return { reads, render: async () => Page({ searchParams: Promise.resolve(searchParams) }) };
}

test("billing page denies signed-out and unauthorized accounts before reading registration", async () => {
  const signedOut = await activationPage({ state: "signed_out" });
  await assert.rejects(signedOut.render, error => error instanceof Redirect && error.destination === "/my/access");
  assert.deepEqual(signedOut.reads, []);
  const denied = await activationPage({ state: "denied" });
  assert.equal((await denied.render()).type, Unavailable);
  assert.deepEqual(denied.reads, []);
});

test("only the targeted partner receives an agreement-only return to shared membership approval", async () => {
  const id = "c941bd49-a4a1-45fd-acbb-836d4659758a";
  const authorization = { id, partnerMemberId: "owner-member", memberId: "paying-partner", revokedAt: null, expiresAt: new Date("2100-01-01") };
  const valid = await activationPage({ searchParams: { coupleAuthorization: id }, coupleAuthorization: authorization });
  const component = nodes(await valid.render()).find(node => node.type === Activation);
  assert.equal(component.props.agreementOnlyReturnHref, `/my/couple?authorization=${id}`);
  for (const value of [null, { ...authorization, partnerMemberId: "another-member" },
    { ...authorization, revokedAt: new Date() }, { ...authorization, expiresAt: new Date("2020-01-01") }]) {
    const denied = await activationPage({ searchParams: { coupleAuthorization: id }, coupleAuthorization: value });
    assert.equal((await denied.render()).type, Unavailable);
  }
  const invalid = await activationPage({ searchParams: { coupleAuthorization: "https://another.example" } });
  await assert.rejects(invalid.render, error => error instanceof Redirect && error.destination === "/my/couple");
});

test("new prepaid members finish intake before agreement/payment, without requiring an already saved card", async () => {
  const incomplete = await activationPage({ registration: { ...paidRegistration, registeredAt: null, state: "collecting", ready: false, profileComplete: false, initialPayment: null } });
  await assert.rejects(incomplete.render, error => error instanceof Redirect && error.destination === "/my/join");
  const collected = await activationPage({ registration: { ...paidRegistration, registeredAt: null, state: "collecting", ready: false, initialPayment: null } });
  const component = nodes(await collected.render()).find(node => node.type === Activation);
  assert.equal(component.props.enabled, true);
  assert.equal(component.props.completingRegistration, true);
  assert.deepEqual(component.props.billingSchedule, schedule);
});

test("paid held registrations can manage cancellation without being sent back to the receipt", async () => {
  const fixture = await activationPage();
  const component = nodes(await fixture.render()).find(node => node.type === Activation);
  assert.equal(component.props.enabled, true);
  assert.equal(component.props.completingRegistration, false);
  assert.equal(component.props.returnedFromCheckout, false);
});

test("Stripe return still confirms registration when the payment webhook completed before the browser arrived", async () => {
  const fixture = await activationPage({ searchParams: { checkout: "returned" } });
  const component = nodes(await fixture.render()).find(node => node.type === Activation);
  assert.equal(component.props.enabled, true);
  assert.equal(component.props.completingRegistration, true);
  assert.equal(component.props.returnedFromCheckout, true);
});

test("a refunded completed registration can review a new payment while its completion identity stays historical", async () => {
  const fixture = await activationPage({ registration: { ...paidRegistration, ready: false, initialPayment: null } });
  const component = nodes(await fixture.render()).find(node => node.type === Activation);
  assert.equal(component.props.enabled, true, "A succeeded pre-service refund must not strand re-registration behind a paid-ready gate");
  assert.equal(component.props.completingRegistration, false);
});

test("complimentary accounts and unfinished legacy saved-card accounts cannot enter new paid onboarding", async () => {
  const complimentary = await activationPage({ data: { ...onboarding, membershipFunding: "complimentary" } });
  assert.equal(nodes(await complimentary.render()).find(node => node.type === Activation).props.enabled, false);
  const legacy = await activationPage({ registration: { ...paidRegistration, requiresInitialPayment: false, ready: false, registeredAt: null, initialPayment: null } });
  const component = nodes(await legacy.render()).find(node => node.type === Activation);
  assert.equal(component.props.enabled, false);
  assert.equal(component.props.completingRegistration, false);
});

function hooks() {
  let cursor = 0;
  const slots = [], queued = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef(initial) { return slots[cursor++] ??= { current: initial }; },
      useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
      useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps }; queued.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
    },
    render(Component, props) { cursor = 0; return Component(props); },
    async effects() { queued.splice(0).forEach(effect => effect()); await flush(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function Cancellation() { return null; }
function JoinForm() { return null; }
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const commitment = { startsAt: schedule.serviceStartsAt, initialTermEndsAt: schedule.initialTermEndsAt,
  plan: "monthly", installmentDues: 34900, billingSchedule: schedule, status: "scheduled", canCancelBeforeStart: true };
async function activationView({ completingRegistration = false, paymentConfirmed = true, billing = commitment } = {}) {
  const state = hooks(), reads = [], navigations = [], timers = new Map();
  let timerId = 0;
  const Component = (await load("src/components/membership/MemberActivation.tsx", {
    react: state.react, "next/link": Link, "@/components/membership/JoinForm": JoinForm,
    "@/components/membership/MembershipCancellation": Cancellation, "@/lib/membership/pricing": pricing,
  }, {
    fetch: async (url, options) => { assert.equal(options.method, undefined); reads.push(url); return { ok: true, json: async () => url === "/api/my/registration/status" ? { paymentConfirmed } : { commitment: billing } }; },
    window: { location: { replace: url => navigations.push(url) } },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  })).default;
  const props = { onboarding, enabled: true, disabledReason: null, initialPlan: "monthly", firstChargeAt: null,
    billingSchedule: schedule, minimumAge: 18, publishableKey: "pk_test_inert_fixture", completingRegistration };
  const render = () => state.render(Component, props);
  render(); await state.effects(); render(); await state.effects();
  return { render, state, reads, navigations, timers };
}

test("normal billing management retains refund controls and never polls or auto-navigates to registration", async t => {
  const fixture = await activationView(); t.after(fixture.state.dispose);
  assert.ok(nodes(fixture.render()).some(node => node.type === Cancellation));
  assert.deepEqual(fixture.reads, ["/api/stripe/cancellation"]);
  assert.deepEqual(fixture.navigations, []);
});

test("new onboarding advances automatically only after the server confirms paid registration", async t => {
  for (const paymentConfirmed of [false, true]) {
    const fixture = await activationView({ completingRegistration: true, paymentConfirmed }); t.after(fixture.state.dispose);
    assert.ok(fixture.reads.includes("/api/my/registration/status"));
    assert.deepEqual(fixture.navigations, paymentConfirmed ? ["/my/registered"] : []);
    if (!paymentConfirmed) assert.equal(fixture.timers.size, 1, "A pending webhook is retried without beginning another checkout");
  }
});

test("completed, refunded members explicitly choose reentry and no read authorizes another charge", async t => {
  const fixture = await activationView({ billing: { ...commitment, status: "canceled", canceledBeforeStart: true, refundStatus: "succeeded" } });
  t.after(fixture.state.dispose);
  const button = nodes(fixture.render()).find(node => node.type === "button" && visible(node) === "Review membership again");
  assert.ok(button);
  button.props.onClick();
  const form = nodes(fixture.render()).find(node => node.type === JoinForm);
  assert.equal(form.props.enabled, true);
  assert.equal(form.props.initialQuote, null);
  assert.deepEqual(fixture.reads, ["/api/stripe/cancellation"]);
  assert.deepEqual(fixture.navigations, []);
});
