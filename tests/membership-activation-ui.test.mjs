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
async function joinFixture(extra = {}) {
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
  }, { fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ clientSecret: "secret", plan: "monthly", commercialReservationId: "quote-id" }) }; } })).default;
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
