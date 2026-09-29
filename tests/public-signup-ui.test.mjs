import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as pricing from "../src/lib/membership/pricing.ts";
import * as phone from "../src/lib/membership/phone.ts";
import * as entryStage from "../src/lib/membership/entry-stage.ts";

function harness() {
  let cursor = 0;
  const slots = [];
  return {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
      useEffect() {},
    },
    render(component, props) { cursor = 0; return component(props); },
  };
}
const Stub = () => null;
function nodes(node) { return React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : []; }
function content(node) { return React.isValidElement(node) ? React.Children.toArray(node.props.children).map(content).join("") : typeof node === "string" ? node : ""; }
async function load(path, dependencies, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports.default;
}

test("direct signup submits the chosen plan through both OTP steps and follows verified server navigation", async () => {
  for (const signupPlan of ["monthly", "annual", undefined]) {
    const hooks = harness(), calls = [], destinations = [], verification = [];
    const component = await load("src/components/platform/PasswordlessAccessForm.tsx", { react: hooks.react, "next/link": Stub }, {
      fetch: async (url, request) => { calls.push({ url, body: JSON.parse(request.body) }); return { ok: true, json: async () => ({ requestId: "request-1", redirectTo: "/my/join" }) }; },
      window: { location: { assign: href => destinations.push(href) } },
      FormData: class { get() { return "123456"; } },
    });
    const props = { enabled: true, signupPlan, onVerificationChange: value => verification.push(value) };
    const render = () => hooks.render(component, props);
    nodes(render()).find(node => node.props.name === "email").props.onChange({ target: { value: " PERSON@Example.test " } });
    await render().props.onSubmit({ preventDefault() {} });
    assert.equal(calls[0].url, "/api/auth/otp/request");
    assert.equal(calls[0].body.email, "person@example.test");
    assert.deepEqual(calls[0].body.signup, signupPlan ? { plan: signupPlan } : undefined);
    assert.equal(verification[0], true, "plan choice freezes as soon as a request begins");
    assert.equal(/active account or current invitation/.test(content(render())), !signupPlan);
    await render().props.onSubmit({ preventDefault() {}, currentTarget: {} });
    assert.equal(calls[1].url, "/api/auth/otp/verify");
    assert.equal(calls[1].body.token, "123456");
    assert.deepEqual(calls[1].body.signup, signupPlan ? { plan: signupPlan } : undefined);
    assert.deepEqual(destinations, ["/my/join"]);
  }
});

test("disabled signup cannot send an email even when native submission is invoked", async () => {
  const hooks = harness();
  const component = await load("src/components/platform/PasswordlessAccessForm.tsx", { react: hooks.react, "next/link": Stub }, {
    fetch: async () => assert.fail("Unavailable signup must not request email"),
  });
  const tree = hooks.render(component, { enabled: false, signupPlan: "annual" });
  await tree.props.onSubmit({ preventDefault() {} });
  assert.match(content(tree), /Signup is not available yet/);
});

async function checkoutFixture({ initialPlan = "annual", membershipFunding = "self" } = {}) {
  const hooks = harness(), calls = [], responses = [];
  const component = await load("src/components/membership/JoinForm.tsx", {
    react: hooks.react, "next/link": Stub,
    "@stripe/stripe-js": { loadStripe: () => assert.fail("Do not initialize an actual payment in tests") },
    "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
    "@/components/membership/CoupleMembershipApproval": Stub,
    "@/components/membership/AgreementText": Stub, "@/components/membership/MemberPhotoUpload": Stub,
    "@/components/membership/MemberPaymentMethod": Stub,
    "@/lib/membership/pricing": pricing, "@/lib/membership/phone": phone, "@/lib/membership/entry-stage": entryStage,
  }, {
    fetch: async (url, request) => { const body = JSON.parse(request.body); calls.push({ url, body }); return responses.shift() ?? { ok: true, json: async () => url.endsWith("membership-offer")
      ? body.action === "release" ? {released:true} : {quote:{id:body.requestId,expiresAt:new Date(Date.now()+3600000).toISOString(),offer:pricing.MEMBERSHIP_OFFERS[`founding_individual_${body.plan}`],billingTermsVersion:"membership-billing-v2",buyoutCap:150000,participants:[{memberId:"own",name:"Member"}]}}
      : {clientSecret:"cs_test_fixture_secret",plan:body.plan,commercialReservationId:body.commercialReservationId} }; },
  });
  const props = { enabled: true, checkoutEnabled: true, publishableKey: "pk_test_fixture", initialPlan, minimumAge: 18,
    initialOnboarding: { email: "member@example.test", membershipFunding, billingState:"active", requiredFieldsComplete: true, agreement: { acceptanceId: "saved-agreement" }, profile: { mobile: null, fulfillmentAddress: null, apparelSizing: null } },
  };
  const render = () => hooks.render(component, props);
  const consent = () => nodes(render()).find(node => node.props.name === "recurring-payment-accepted");
  const pay = () => nodes(render()).find(node => node.type === "button" && /Open test checkout/.test(content(node)));
  const option = plan => nodes(render()).find(node => node.props.name === "checkout-plan" && node.props.value === plan);
  const review = () => nodes(render()).find(node => node.type === "button" && /Review membership offer/.test(content(node)));
  return { render, consent, pay, option, calls, responses, review };
}

test("payment reviews the actual founding offer and resets consent when cadence changes", async () => {
  const f = await checkoutFixture();
  assert.equal(f.option("annual").props.checked, true);
  assert.equal(f.consent(), undefined, "no consent before a durable server quote");
  assert.equal(f.pay(), undefined);
  await f.review().props.onClick();
  assert.match(content(f.render()), /\$3,490 USD due at signup/);
  assert.match(content(f.render()), /Renews annually at \$3,490/);
  assert.match(content(f.render()), /founding rate continues/);
  assert.match(content(f.render()), /Your quoted price is held until/);
  const holdTime = nodes(f.render()).find(node => node.type === "time");
  assert.ok(holdTime.props.dateTime);
  assert.ok(new Date(holdTime.props.dateTime) > new Date());
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.pay().props.disabled, true);
  await f.pay().props.onClick();
  assert.equal(f.calls.length, 1, "an unchecked payment cannot contact Checkout");
  f.consent().props.onChange({ target: { checked: true } });
  await f.option("monthly").props.onChange();
  assert.equal(f.consent(), undefined);
  assert.equal(f.calls[1].body.action, "release");
  await f.review().props.onClick();
  assert.equal(f.consent().props.checked, false);
  assert.match(content(f.render()), /12 payments of \$349, totaling \$4,188/);
  assert.match(content(f.render()), /lower of \$1,500 or your unpaid remaining first-year installments/);
  assert.match(content(f.render()), /This charge replaces those installments/);
  assert.doesNotMatch(content(f.render()), /no cancellation fee|cancel anytime/i);
  assert.match(content(f.render()), /Refund requests are reviewed individually/);
  f.consent().props.onChange({ target: { checked: true } });
  await f.pay().props.onClick();
  const checkout=f.calls.at(-1);
  assert.equal(checkout.url, "/api/stripe/checkout");
  assert.equal(checkout.body.plan, "monthly");
  assert.equal(checkout.body.recurringPaymentAccepted, true);
  assert.equal(checkout.body.acceptanceId, "saved-agreement");
  assert.equal(checkout.body.attemptId, checkout.body.commercialReservationId);
  assert.notEqual(checkout.body.attemptId,f.calls[0].body.requestId);
  assert.equal(f.pay(), undefined, "an initialized checkout cannot be submitted again");
});

test("a payment already open in another plan must be explicitly resumed with fresh reviewed consent", async () => {
  const f = await checkoutFixture();
  f.responses.push({ ok: false, json: async () => ({ code: "checkout_plan_locked", plan: "monthly", kind:"individual", error: "Another plan is already open." }) });
  await f.review().props.onClick();
  assert.equal(f.option("annual").props.checked, true, "a server conflict must not silently switch the price");
  assert.equal(f.consent(),undefined);
  await nodes(f.render()).find(node => node.type === "button" && /Use monthly plan/.test(content(node))).props.onClick();
  assert.equal(f.option("monthly").props.checked,true);
  await f.review().props.onClick();
  assert.equal(f.consent().props.checked,false);
  f.consent().props.onChange({target:{checked:true}});
  await f.pay().props.onClick();
  assert.equal(f.calls.at(-1).body.plan,"monthly");
});

test("complimentary and operator memberships never show billing plans or recurring authorization", async () => {
  for (const membershipFunding of ["complimentary", "operator", "couple"]) {
    const f = await checkoutFixture({ membershipFunding });
    assert.equal(f.consent(), undefined);
    assert.equal(f.option("monthly"), undefined);
    assert.equal(f.pay(), undefined);
    assert.match(content(f.render()), membershipFunding === "couple" ? /no separate payment is needed/ : /no payment is needed/);
  }
});

test('a temporarily held founding place gives a retry action and never substitutes standard-price consent',async()=>{
 const f=await checkoutFixture({initialPlan:'monthly'});
 f.responses.push({ok:false,json:async()=>({code:'founding_place_pending',retryable:true,error:'A founding place is temporarily reserved in another checkout. Please try again shortly.'})});
 await f.review().props.onClick();assert.match(content(f.render()),/Please try again shortly/);assert.equal(f.consent(),undefined);assert.equal(f.pay(),undefined);
 const retry=nodes(f.render()).find(node=>node.type==='button'&&/Check founding availability again/.test(content(node)));assert.ok(retry);
 await retry.props.onClick();assert.match(content(f.render()),/Founding individual membership/);assert.match(content(f.render()),/\$349 USD due at signup/);assert.equal(f.consent().props.checked,false);
});
