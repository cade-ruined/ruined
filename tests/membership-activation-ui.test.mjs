import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const Stub = () => null;
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const visible = node => typeof node === "string" || typeof node === "number" ? String(node) : React.isValidElement(node) ? React.Children.toArray(node.props.children).map(visible).join("") : "";
async function load(path, deps = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), js)(name => name in deps ? deps[name] : require(name), result, result.exports, ...Object.values(globals));
  return result.exports;
}
function hooks() {
  let cursor = 0; const slots = [], effects = [];
  return { react: { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const i = cursor++, key = JSON.stringify(deps); if (slots[i] !== key) { slots[i] = key; effects.push(fn); } },
  }, render(Component, props) { cursor = 0; return Component(props); }, async effects() { const queued = effects.splice(0); queued.forEach(effect => effect()); await new Promise(resolve => setTimeout(resolve, 0)); } };
}
const pricing = await load("src/lib/membership/pricing.ts");
const onboarding = { requiredFieldsComplete: true, state: "in_progress", billingState: "pending", membershipFunding: "self", email: "member@example.test",
  agreement: { id: "agreement", acceptanceId: "accepted", body: "Published agreement", title: "Membership agreement", version: "2" }, profile: {} };
const offer = { id: "quote-id", expiresAt: "2026-10-31T20:00:00Z", offer: pricing.MEMBERSHIP_OFFERS.founding_individual_monthly, billingTermsVersion: "membership-billing-v2", buyoutCap: 150000,
  participants: [{ memberId: "member", name: "A member" }], firstChargeAt: "2026-11-01T06:00:00.000Z" };
async function joinFixture(extra = {}, now = "2026-10-05T18:00:00Z") {
  const h = hooks(), calls = [];
  const Form = (await load("src/components/membership/JoinForm.tsx", {
    react: h.react, "next/link": Link, "@stripe/stripe-js": { loadStripe: () => assert.fail("Rendering cannot start Stripe") },
    "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
    "@/components/membership/CoupleMembershipApproval": Stub, "@/components/membership/AgreementText": Stub,
    "@/components/membership/RegistrationCouplePreference": { useRegistrationCouple: () => ({ loading: false, loadError: null }), RegistrationCoupleFields: Stub },
    "@/components/membership/MemberPhotoUpload": Stub, "@/components/membership/MemberPaymentMethod": Stub,
    "@/lib/membership/entry-stage": await load("src/lib/membership/entry-stage.ts"),
    "@/lib/membership/pricing": pricing, "@/lib/membership/phone": await load("src/lib/membership/phone.ts"),
    "@/lib/membership/member-communication-preferences-model": await load("src/lib/membership/member-communication-preferences-model.ts"),
  }, { Date: class extends Date { static now() { return Date.parse(now); } }, fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ clientSecret: "secret", plan: "monthly", commercialReservationId: "quote-id" }) }; } })).default;
  const props = { enabled: true, checkoutEnabled: true, initialOnboarding: onboarding, initialQuote: offer, activationOnly: true, publishableKey: "pk_live_example", minimumAge: 18, ...extra };
  return { calls, render: () => h.render(Form, props) };
}

test("future offer shows exact price/date and 12-month term; only fresh checked consent starts Checkout", async () => {
  const f = await joinFixture(); let tree = f.render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /\$0 today\. First charge November 1, 2026/);
  assert.match(html, /\$349 USD on November 1, 2026/);
  assert.match(html, /12 payments of \$349, totaling \$4,188/);
  assert.match(html, /Cancel before the first charge at 12:00 a.m. Mountain Time/);
  assert.doesNotMatch(html, /USD due at signup|name="legal-name"/);
  let consent = nodes(tree).find(node => node.props.name === "recurring-payment-accepted");
  assert.equal(consent.props.checked, false);
  let submit = nodes(tree).find(node => node.type === "button" && /Confirm future billing/.test(visible(node)));
  assert.equal(submit.props.disabled, true);
  await submit.props.onClick(); assert.equal(f.calls.length, 0);
  consent.props.onChange({ target: { checked: true } }); tree = f.render();
  submit = nodes(tree).find(node => node.type === "button" && /Confirm future billing/.test(visible(node)));
  assert.equal(submit.props.disabled, false); await submit.props.onClick();
  assert.equal(f.calls[0].url, "/api/stripe/checkout");
  assert.equal(f.calls[0].body.firstChargeAt, offer.firstChargeAt);
  assert.equal(f.calls[0].body.recurringPaymentAccepted, true);
  assert.equal(f.calls[0].body.commercialReservationId, offer.id);
});

test("preview offer is inert even if a button handler is invoked", async () => {
  const f = await joinFixture({ preview: true, enabled: false });
  const tree = f.render(); const submit = nodes(tree).find(node => node.type === "button" && /Confirm future billing/.test(visible(node)));
  assert.equal(submit.props.disabled, true); await submit.props.onClick();
  assert.equal(f.calls.length, 0);
});

test("return query alone never claims a scheduled payment; status comes from persisted response", async () => {
  const h = hooks(); let response = { commitment: null };
  const Form = Stub;
  const Component = (await load("src/components/membership/MemberActivation.tsx", {
    react: h.react, "next/link": Link, "@/components/membership/JoinForm": Form,
    "@/components/membership/MembershipCancellation": Stub, "@/lib/membership/pricing": pricing,
  }, { fetch: async () => ({ ok: true, json: async () => response }) })).default;
  const props = { onboarding, enabled: true, disabledReason: null, initialPlan: "monthly", firstChargeAt: offer.firstChargeAt, minimumAge: 18, publishableKey: "pk_live_example", returnedFromCheckout: true };
  h.render(Component, props); await h.effects(); let tree = h.render(Component, props);
  assert.match(visible(tree), /Waiting for Stripe confirmation/);
  assert.equal(nodes(tree).some(node => node.type === Form), false);
  response = { commitment: { startsAt: offer.firstChargeAt, initialTermEndsAt: "2027-11-01T06:00:00Z", plan: "monthly", installmentDues: 34900, status: "pending_payment", canCancelBeforeStart: false } };
  nodes(tree).find(node => node.type === "button" && /Check confirmation/.test(visible(node))).props.onClick();
  h.render(Component, props); await h.effects(); tree = h.render(Component, props);
  assert.match(visible(tree), /first payment is pending/);
  assert.doesNotMatch(visible(tree), /Membership billing confirmed|first payment is scheduled/);
});

test("scheduled cancellation requires a zero-fee quote and a second explicit confirmation", async () => {
  const h = hooks(), calls = [];
  const Component = (await load("src/components/membership/MembershipCancellation.tsx", {
    react: h.react, "next/link": Link, "@/components/support/supportStyles": { SUPPORT_ACTION_CLASS: "", SUPPORT_LINK_CLASS: "" },
  }, { fetch: async (_url, init) => { const body = JSON.parse(init.body); calls.push(body); return { ok: true, json: async () => body.action === "quote"
    ? { quote: { id: "cancel-quote", intent: "cancel_before_start", feeTotal: 0, feeDues: 0, feeTax: 0, effectiveAt: "2026-10-06T06:00:00Z", initialTermEndsAt: "2027-11-01T06:00:00Z" } }
    : { cancellation: { effectiveAt: "2026-10-06T06:00:00Z", invoiceUrl: null } } }; } })).default;
  const props = { initialCommitment: { startsAt: offer.firstChargeAt, initialTermEndsAt: "2027-11-01T06:00:00Z", plan: "monthly", installmentDues: 34900, status: "scheduled", canCancelBeforeStart: true } };
  let tree = h.render(Component, props);
  assert.doesNotMatch(visible(tree), /Turn off renewal|Review early exit/);
  await nodes(tree).find(node => node.type === "button" && /Cancel before first charge/.test(visible(node))).props.onClick();
  assert.deepEqual(calls, [{ action: "quote", intent: "cancel_before_start" }]);
  tree = h.render(Component, props);
  assert.match(visible(tree), /Cancellation fee: \$0/);
  assert.match(visible(tree), /No initial-term installments will be collected/);
  await nodes(tree).find(node => node.type === "button" && /Confirm cancellation/.test(visible(node))).props.onClick();
  assert.deepEqual(calls[1], { action: "confirm", quoteId: "cancel-quote", confirmed: true });
  assert.match(visible(h.render(Component, props)), /Scheduled membership canceled/);
});

test("only a verified prestart cancellation can be explicitly reviewed again, and opening review never creates a checkout", async () => {
  for (const [canceledBeforeStart, enabled] of [[true, true], [false, true], [true, false]]) {
    const h = hooks(); let reads = 0;
    const Form = Stub;
    const Component = (await load("src/components/membership/MemberActivation.tsx", {
      react: h.react, "next/link": Link, "@/components/membership/JoinForm": Form,
      "@/components/membership/MembershipCancellation": Stub, "@/lib/membership/pricing": pricing,
    }, { fetch: async (_url, init) => { assert.equal(init.method, undefined); reads++; return { ok: true, json: async () => ({ commitment: {
      startsAt: offer.firstChargeAt, initialTermEndsAt: "2027-11-01T06:00:00Z", plan: "monthly", installmentDues: 34900,
      status: "canceled", canceledBeforeStart, canCancelBeforeStart: false,
    } }) }; } })).default;
    const props = { onboarding, enabled, disabledReason: null, initialPlan: "monthly", firstChargeAt: offer.firstChargeAt,
      minimumAge: 18, publishableKey: "pk_live_example", returnedFromCheckout: true };
    h.render(Component, props); await h.effects(); let tree = h.render(Component, props);
    assert.equal(nodes(tree).some(node => node.type === Form), false);
    const review = nodes(tree).find(node => node.type === "button" && /Review membership again/.test(visible(node)));
    if (canceledBeforeStart && enabled) {
      assert.ok(review); review.props.onClick(); tree = h.render(Component, props);
      const form = nodes(tree).find(node => node.type === Form);
      assert.ok(form, "Member must be able to reach a new offer after explicit review action");
      assert.equal(form.props.enabled, true); assert.equal(form.props.initialQuote, null);
      assert.doesNotMatch(visible(tree), /Waiting for Stripe confirmation/);
    } else assert.equal(review, undefined);
    assert.equal(reads, 1, "Opening a new review performs no billing mutation");
  }
});

test("scheduled summary displays the commitment end and keeps profile opening separate", async () => {
  const h = hooks();
  const Component = (await load("src/components/membership/MemberActivation.tsx", {
    react: h.react, "next/link": Link, "@/components/membership/JoinForm": Stub,
    "@/components/membership/MembershipCancellation": Stub, "@/lib/membership/pricing": pricing,
  }, { fetch: () => assert.fail("Preview must not read live billing") })).default;
  const tree = h.render(Component, { onboarding, enabled: false, initialPlan: "monthly", firstChargeAt: offer.firstChargeAt,
    minimumAge: 18, publishableKey: null, preview: true, previewView: "scheduled" });
  assert.match(visible(tree), /Initial commitment ends at the start of November 1, 2027, Mountain Time/);
  assert.match(visible(tree), /Your profile opens separately when Ruined releases it/);
});

const scheduleModule = await load("src/lib/membership/foundations-schedule.ts");
const prepaidSchedule = scheduleModule.createFoundationsBillingSchedule(new Date("2026-10-05T18:00:00Z"), "monthly");
test("prepaid monthly offer discloses four calls, payment now, eleven later installments and exact term before fresh consent", async () => {
  const prepaidOffer = { ...offer, firstChargeAt: null, billingSchedule: prepaidSchedule };
  const f = await joinFixture({ initialQuote: prepaidOffer });
  let tree = f.render(); const html = renderToStaticMarkup(tree);
  assert.match(html, /\$349 due today, plus applicable tax/);
  for (const day of [5, 12, 19, 30]) assert.match(html, new RegExp(`November ${day}, 2026 at 3:00 PM`));
  assert.match(html, /November 4, 2026 at 3:00 PM/);
  assert.match(html, /December 5, 2026 at 3:00 PM/);
  assert.match(html, /November 5, 2027 at 4:00 PM/);
  assert.match(html, /11 further monthly installments/);
  assert.match(html, /full refund of your initial payment, including tax/);
  assert.doesNotMatch(html, /Nothing is charged today|\$0 today/);
  const consent = nodes(tree).find(node => node.props.name === "recurring-payment-accepted");
  assert.equal(consent.props.checked, false);
  let pay = nodes(tree).find(node => node.type === "button" && /Pay first period with Stripe/.test(visible(node)));
  assert.equal(pay.props.disabled, true); await pay.props.onClick(); assert.equal(f.calls.length, 0);
  consent.props.onChange({ target: { checked: true } }); tree = f.render();
  pay = nodes(tree).find(node => node.type === "button" && /Pay first period with Stripe/.test(visible(node)));
  await pay.props.onClick();
  assert.deepEqual(f.calls[0].body.billingSchedule, prepaidSchedule);
  assert.equal(f.calls[0].body.firstChargeAt, null);
});

test("expired cohort quote cannot begin payment at the exact cutoff even if an enabled handler is invoked", async () => {
  const f = await joinFixture({ initialQuote: { ...offer, expiresAt: prepaidSchedule.cutoffAt, firstChargeAt: null, billingSchedule: prepaidSchedule } }, prepaidSchedule.cutoffAt);
  let tree = f.render(); nodes(tree).find(node => node.props.name === "recurring-payment-accepted").props.onChange({ target: { checked: true } }); tree = f.render();
  await nodes(tree).find(node => node.type === "button" && /Pay first period/.test(visible(node))).props.onClick();
  assert.equal(f.calls.length, 0);
  assert.match(visible(f.render()), /offer has expired.*Review a new offer/);
});

test("prepaid cancellation retains the same quote while refund is pending and reports refunded only after success", async () => {
  const h = hooks(), calls = []; let confirmations = 0, parentRefreshes = 0;
  const Component = (await load("src/components/membership/MembershipCancellation.tsx", {
    react: h.react, "next/link": Link, "@/components/support/supportStyles": { SUPPORT_ACTION_CLASS: "", SUPPORT_LINK_CLASS: "" },
  }, { fetch: async (_url, init) => { const body = JSON.parse(init.body); calls.push(body); return { ok: true, json: async () => body.action === "quote"
    ? { quote: { id: "refund-quote", intent: "cancel_before_start", feeTotal: 0, feeDues: 0, feeTax: 0, refundAmount: 37692, effectiveAt: "2026-10-06T06:00:00Z", initialTermEndsAt: prepaidSchedule.initialTermEndsAt } }
    : { cancellation: { effectiveAt: "2026-10-06T06:00:00Z", invoiceUrl: null, refundAmount: 37692, refundStatus: ++confirmations === 1 ? "pending" : "succeeded" } } }; } })).default;
  const props = { initialCommitment: { startsAt: prepaidSchedule.serviceStartsAt, initialTermEndsAt: prepaidSchedule.initialTermEndsAt, plan: "monthly", installmentDues: 34900, status: "scheduled", canCancelBeforeStart: true, billingSchedule: prepaidSchedule }, onCanceled() { parentRefreshes++; } };
  let tree = h.render(Component, props);
  assert.doesNotMatch(visible(tree), /no charge|Turn off renewal/);
  await nodes(tree).find(node => node.type === "button" && /Review cancellation and refund/.test(visible(node))).props.onClick();
  tree = h.render(Component, props); assert.match(visible(tree), /Refund: \$376.92, including tax/);
  await nodes(tree).find(node => node.type === "button" && /Confirm cancellation and refund/.test(visible(node))).props.onClick();
  tree = h.render(Component, props); assert.match(visible(tree), /Refund confirmation pending/); assert.doesNotMatch(visible(tree), /has been refunded|canceled\. No membership/); assert.equal(parentRefreshes, 0);
  await nodes(tree).find(node => node.type === "button" && /Check refund status/.test(visible(node))).props.onClick();
  assert.deepEqual(calls.slice(1), [{ action: "confirm", quoteId: "refund-quote", confirmed: true }, { action: "confirm", quoteId: "refund-quote", confirmed: true }]);
  assert.match(visible(h.render(Component, props)), /\$376.92 has been refunded/); assert.equal(parentRefreshes, 1);
});

test("prepaid status is never paid from return query alone and refunded rejoin requires succeeded refund", async () => {
  for (const refundStatus of ["pending", "succeeded"]) {
    const h = hooks(); const Form = Stub;
    const Component = (await load("src/components/membership/MemberActivation.tsx", { react: h.react, "next/link": Link, "@/components/membership/JoinForm": Form, "@/components/membership/MembershipCancellation": Stub, "@/lib/membership/pricing": pricing },
      { fetch: async () => ({ ok: true, json: async () => ({ commitment: { startsAt: prepaidSchedule.serviceStartsAt, initialTermEndsAt: prepaidSchedule.initialTermEndsAt, plan: "monthly", installmentDues: 34900, billingSchedule: prepaidSchedule, status: refundStatus === "pending" ? "refund_pending" : "canceled", canceledBeforeStart: refundStatus === "succeeded", refundStatus } }) }) })).default;
    const props = { onboarding, enabled: true, disabledReason: null, initialPlan: "monthly", firstChargeAt: null, billingSchedule: prepaidSchedule, minimumAge: 18, publishableKey: "pk_live_example", returnedFromCheckout: true };
    h.render(Component, props); await h.effects(); const tree = h.render(Component, props);
    const review = nodes(tree).find(node => node.type === "button" && /Review membership again/.test(visible(node)));
    if (refundStatus === "pending") { assert.equal(review, undefined); assert.doesNotMatch(visible(tree), /has been refunded|first period is paid/); }
    else { assert.ok(review); assert.match(visible(tree), /initial payment has been refunded/); }
  }
});

test("annual prepaid offer charges the complete year now and renews on its accepted service anniversary", async () => {
  const annual = scheduleModule.createFoundationsBillingSchedule(new Date("2026-10-05T18:00:00Z"), "annual");
  const f = await joinFixture({ initialPlan: "annual", initialQuote: { ...offer, firstChargeAt: null, billingSchedule: annual, offer: pricing.MEMBERSHIP_OFFERS.founding_individual_annual } });
  const html = renderToStaticMarkup(f.render());
  assert.match(html, /\$3,490 due today/);
  assert.match(html, /full initial year upfront/);
  assert.match(html, /November 5, 2027 at 4:00 PM/);
  assert.match(html, /annual renewals of \$3,490/);
  assert.doesNotMatch(html, /11 further monthly|Eleven further|\$0 today|Nothing is charged today/);
});

test("persisted prepaid receipt shows paid coverage with future service and keeps the held profile separate", async () => {
  const h = hooks();
  const Component = (await load("src/components/membership/MemberActivation.tsx", { react: h.react, "next/link": Link, "@/components/membership/JoinForm": Stub, "@/components/membership/MembershipCancellation": Stub, "@/lib/membership/pricing": pricing },
    { fetch: async () => ({ ok: true, json: async () => ({ commitment: { startsAt: prepaidSchedule.serviceStartsAt, initialTermEndsAt: prepaidSchedule.initialTermEndsAt, plan: "monthly", installmentDues: 34900, billingSchedule: prepaidSchedule, status: "scheduled", canCancelBeforeStart: true } }) }) })).default;
  const props = { onboarding, enabled: true, disabledReason: null, initialPlan: "monthly", firstChargeAt: null, billingSchedule: prepaidSchedule, minimumAge: 18, publishableKey: "pk_live_example" };
  h.render(Component, props); await h.effects(); const tree = h.render(Component, props);
  assert.match(visible(tree), /first period is paid/);
  assert.match(visible(tree), /Service begins November 5, 2026 at 3:00 PM Mountain Time/);
  assert.match(visible(tree), /December 5, 2026 at 3:00 PM/);
  assert.match(visible(tree), /profile opens separately when Ruined releases it/);
  assert.doesNotMatch(visible(tree), /Nothing is charged before|first payment is scheduled/);
});

test("prepaid cancellation does not substitute zero or claim success when exact refund evidence is missing", async () => {
  for (const missingAt of ["quote", "confirm"]) {
    const h = hooks();
    const Component = (await load("src/components/membership/MembershipCancellation.tsx", {
      react: h.react, "next/link": Link, "@/components/support/supportStyles": { SUPPORT_ACTION_CLASS: "", SUPPORT_LINK_CLASS: "" },
    }, { fetch: async (_url, init) => { const { action } = JSON.parse(init.body); return { ok: true, json: async () => action === "quote"
      ? { quote: { id: "refund-quote", intent: "cancel_before_start", feeTotal: 0, ...(missingAt === "quote" ? {} : { refundAmount: 37692 }) } }
      : { cancellation: { effectiveAt: "2026-10-06T06:00:00Z", invoiceUrl: null } } }; } })).default;
    const props = { initialCommitment: { startsAt: prepaidSchedule.serviceStartsAt, initialTermEndsAt: prepaidSchedule.initialTermEndsAt, plan: "monthly", installmentDues: 34900, status: "scheduled", canCancelBeforeStart: true, billingSchedule: prepaidSchedule } };
    let tree = h.render(Component, props);
    await nodes(tree).find(node => node.type === "button" && /Review cancellation and refund/.test(visible(node))).props.onClick();
    tree = h.render(Component, props);
    if (missingAt === "confirm") { await nodes(tree).find(node => node.type === "button" && /Confirm cancellation and refund/.test(visible(node))).props.onClick(); tree = h.render(Component, props); }
    assert.match(visible(tree), /full refund could not be confirmed/);
    assert.doesNotMatch(visible(tree), /Refund: \$0|has been refunded|Scheduled membership canceled/);
  }
});
