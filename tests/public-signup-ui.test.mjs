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
    "@/components/membership/AgreementText": Stub, "@/components/membership/MemberPhotoUpload": Stub,
    "@/lib/membership/pricing": pricing, "@/lib/membership/phone": phone, "@/lib/membership/entry-stage": entryStage,
  }, {
    fetch: async (url, request) => { calls.push({ url, body: JSON.parse(request.body) }); return responses.shift() ?? { ok: true, json: async () => ({ clientSecret: "cs_test_fixture_secret", plan: JSON.parse(request.body).plan }) }; },
  });
  const props = { enabled: true, checkoutEnabled: true, publishableKey: "pk_test_fixture", initialPlan, minimumAge: 18,
    initialOnboarding: { email: "member@example.test", membershipFunding, requiredFieldsComplete: true, agreement: { acceptanceId: "saved-agreement" }, profile: { mobile: null, fulfillmentAddress: null, apparelSizing: null } },
  };
  const render = () => hooks.render(component, props);
  const consent = () => nodes(render()).find(node => node.props.name === "recurring-payment-accepted");
  const pay = () => nodes(render()).find(node => node.type === "button" && /Open test checkout/.test(content(node)));
  const option = plan => nodes(render()).find(node => node.props.name === "checkout-plan" && node.props.value === plan);
  return { render, consent, pay, option, calls, responses };
}

test("payment uses persisted annual choice and requires a new affirmative consent after changing plans", async () => {
  const f = await checkoutFixture();
  assert.equal(f.option("annual").props.checked, true);
  assert.match(content(f.render()), /\$5,040 USD due at signup/);
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.pay().props.disabled, true);
  await f.pay().props.onClick();
  assert.equal(f.calls.length, 0);
  f.consent().props.onChange({ target: { checked: true } });
  f.option("monthly").props.onChange();
  assert.equal(f.consent().props.checked, false);
  assert.match(content(f.render()), /Renews at \$499 each month/);
  f.consent().props.onChange({ target: { checked: true } });
  await f.pay().props.onClick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/stripe/checkout");
  assert.equal(f.calls[0].body.plan, "monthly");
  assert.equal(f.calls[0].body.recurringPaymentAccepted, true);
  assert.equal(f.calls[0].body.acceptanceId, "saved-agreement");
  assert.ok(f.calls[0].body.attemptId);
  assert.equal(f.pay(), undefined, "an initialized checkout cannot be submitted again");
});

test("a checkout already open in another plan requires explicit resume and fresh consent", async () => {
  const f = await checkoutFixture();
  f.responses.push({ ok: false, json: async () => ({ code: "checkout_plan_locked", plan: "monthly", error: "Another plan is already open." }) });
  f.consent().props.onChange({ target: { checked: true } });
  await f.pay().props.onClick();
  assert.equal(f.option("annual").props.checked, true, "a server conflict must not silently switch the price");
  assert.equal(f.consent().props.checked, false);
  assert.equal(f.pay().props.disabled, true);
  nodes(f.render()).find(node => node.type === "button" && /Use monthly plan/.test(content(node))).props.onClick();
  assert.equal(f.option("monthly").props.checked, true);
  assert.equal(f.consent().props.checked, false);
  f.consent().props.onChange({ target: { checked: true } });
  await f.pay().props.onClick();
  assert.equal(f.calls[1].body.plan, "monthly");
  assert.notEqual(f.calls[1].body.attemptId, f.calls[0].body.attemptId);
});

test("complimentary and operator memberships never show billing plans or recurring authorization", async () => {
  for (const membershipFunding of ["complimentary", "operator"]) {
    const f = await checkoutFixture({ membershipFunding });
    assert.equal(f.consent(), undefined);
    assert.equal(f.option("monthly"), undefined);
    assert.equal(f.pay(), undefined);
    assert.match(content(f.render()), /no payment is needed/);
  }
});
