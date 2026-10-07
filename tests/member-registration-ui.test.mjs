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
const Image = ({ fill, priority, ...props }) => { void fill; void priority; return React.createElement("img", props); };
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const redirect = href => { throw Object.assign(Error("redirect"), { href }); };
async function load(path, deps = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), js)(name => name in deps ? deps[name] : require(name), loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports;
}
const registration = changes => ({ memberId: "test-member", state: "collecting", registeredAt: null, profileActivatedAt: null, requiresPaymentMethod: true, profileComplete: false, ready: changes?.state === "registered", version: 1, ...changes });
const onboarding = changes => ({ state: "in_progress", billingState: "pending", membershipFunding: "self", requiredFieldsComplete: false, email: "new@example.test", agreement: { acceptanceId: null, id: null, body: null }, profile: {}, ...changes });
const context = (changes = {}) => ({ state: "authenticated", viewer: { authUserId: "test-auth", email: "new@example.test" }, data: onboarding(), configuration: { mode: "connected", stripeCheckoutReady: true, stripePaymentSetupReady: true, minimumAge: 18 }, ...changes });
const previewDeps = { MEMBER_PREVIEW_COOKIE: "fixture", memberPreviewScenario: value => value, memberRegistrationPreview: value => value === "registered" ? registration({ state: "registered", profileComplete: true }) : registration() };
const legalNotice = {
  state: "required", privacyVersion: "privacy-2026-08-19", privacyHref: "/privacy",
  agreementVersionId: "11111111-1111-4111-8111-111111111111", agreementVersion: 1,
  agreementTitle: "Ruined Registration Terms", agreementHref: "/membership/agreement/ruined_registration-v1",
  noticeText: "I have read the Privacy Policy and reviewed the Membership Terms. Registration and saving a card do not start a paid membership or authorize a charge.",
};

async function pageFixture(path, initialRegistration, initialContext = context(), initialLegalNotice = null) {
  let currentRegistration = initialRegistration, currentContext = initialContext, currentLegalNotice = initialLegalNotice;
  const Form = () => null, Payment = () => null, Receipt = () => null, Progress = () => null;
  const page = (await load(path, {
    "next/image": Image, "next/link": Link, "next/navigation": { redirect },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "registration-info" }) }) },
    "@/components/membership/JoinForm": Form, "@/components/membership/MemberPaymentMethod": Payment,
    "@/components/membership/MemberRegistrationReceipt": Receipt,
    "@/components/membership/MemberSettingsHeader": Stub, "@/components/platform/PlatformUnavailable": Stub,
    "@/components/membership/MembershipEntryProgress": { MembershipEntryProgress: Progress, MembershipEntryProgressProvider: Stub },
    "@/lib/membership/page-context": { getMembershipPageContext: async (preview, loader, area) => {
      if (area === "registration") return { ...currentContext, data: currentContext.state === "preview" ? preview : { registration: currentRegistration } };
      return currentContext;
    } },
    "@/lib/membership/registration-repository": { getMemberRegistration: async () => currentRegistration },
    "@/lib/membership/registration-routing": await load("src/lib/membership/registration-routing.ts"),
    "@/lib/membership/registration-legal": { getMemberRegistrationLegalNotice: async () => currentLegalNotice },
    "@/lib/membership/preview-scenarios": previewDeps,
    "@/lib/membership/repository": { getMemberOnboarding: () => assert.fail("No live database reads") },
    "@/lib/membership/preview": { PREVIEW_MEMBER_ONBOARDING: {} },
    "@/lib/membership/entry-stage": await load("src/lib/membership/entry-stage.ts"),
    "@/lib/membership/public-signup-admission": { getMemberSignupPlan: async () => "monthly" },
    "@/lib/membership/photos": { isMemberPhotoStorageConfigured: () => false },
    "@/lib/platform/config": { getStripePublishableKey: () => null },
  })).default;
  return { page: (query = {}) => page({ searchParams: Promise.resolve(query) }), Form, Payment, Receipt, Progress,
    setRegistration: value => { currentRegistration = value; }, setContext: value => { currentContext = value; }, setLegalNotice: value => { currentLegalNotice = value; } };
}

test("held join shows the details-agreement-payment journey when paid checkout is available", async () => {
  const f = await pageFixture("app/my/join/page.tsx", registration());
  const tree = await f.page(), form = nodes(tree).find(node => node.type === f.Form);
  assert.equal(form.props.registrationOnly, true);
  assert.equal(form.props.checkoutEnabled, false);
  assert.equal(form.props.registrationRequiresPaymentMethod, true);
  assert.equal(nodes(tree).some(node => node.type === f.Progress), true);
  assert.equal(form.props.registrationNextHref, "/my/activate");
  f.setRegistration(registration({ requiresPaymentMethod: false }));
  assert.equal(nodes(await f.page()).find(node => node.type === f.Form).props.registrationRequiresPaymentMethod, false);
});

test("returning registrations resume checkout or receipt while existing activated accounts keep home access", async () => {
  const f = await pageFixture("app/my/join/page.tsx", registration({ profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my/activate");
  f.setRegistration(registration({ state: "registered", profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my/registered");
  f.setRegistration(null); f.setContext(context({ data: onboarding({ state: "completed", billingState: "active" }) }));
  await assert.rejects(f.page, error => error.href === "/my");
});

test("stale ineligible registration details reopen intake even when the onboarding timestamp says complete", async () => {
  const f = await pageFixture("app/my/join/page.tsx", registration({ profileComplete: false }), context({ data: onboarding({ requiredFieldsComplete: true, profile: { legalName: "Saved Name", birthDate: "2018-01-01", fulfillmentAddress: { countryCode: "CA" } } }) }));
  const tree = await f.page(), form = nodes(tree).find(node => node.type === f.Form);
  assert.equal(form.props.registrationOnly, true);
  assert.equal(form.props.initialOnboarding.requiredFieldsComplete, false);
  assert.equal(form.props.initialOnboarding.profile.legalName, "Saved Name", "Preserve saved details for correction");
  assert.equal(form.props.initialOnboarding.profile.fulfillmentAddress.countryCode, "CA");
});

test("registration legal acknowledgment keeps completed details on intake until the notice is recorded", async () => {
  const f = await pageFixture("app/my/join/page.tsx", registration({ profileComplete: true }), context({ data: onboarding({ requiredFieldsComplete: true }) }), legalNotice);
  for (const notice of [legalNotice, { state: "unavailable", message: "The membership terms are temporarily unavailable." }]) {
    f.setLegalNotice(notice);
    const form = nodes(await f.page()).find(node => node.type === f.Form);
    assert.equal(form.props.registrationLegalNotice, notice);
    assert.equal(form.props.initialOnboarding.requiredFieldsComplete, false);
  }
  f.setLegalNotice(null);
  await assert.rejects(f.page, error => error.href === "/my/activate");
});

test("card page sends incomplete details back to entry and exempts complimentary registration", async () => {
  const f = await pageFixture("app/my/payment-method/page.tsx", registration());
  await assert.rejects(f.page, error => error.href === "/my/join");
  f.setRegistration(registration({ profileComplete: true, requiresPaymentMethod: false }));
  await assert.rejects(f.page, error => error.href === "/my/registered");
  f.setRegistration(registration({ profileComplete: true }));
  f.setContext(context({ data: onboarding({ requiredFieldsComplete: true }) }));
  await assert.rejects(f.page, error => error.href === "/my/activate");
  const tree = await f.page({ setup: "returned" });
  assert.equal(nodes(tree).find(node => node.type === f.Payment).props.registrationOnly, true);
  assert.equal(nodes(tree).some(node => node.props.href === "/my"), false);
});

test("receipt requires registered server state and cannot grant access from a URL", async () => {
  const f = await pageFixture("app/my/registered/page.tsx", registration());
  await assert.rejects(f.page, error => error.href === "/my/join");
  f.setRegistration(registration({ profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my/activate");
  f.setRegistration(registration({ state: "registered", profileComplete: true }));
  const tree = await f.page();
  assert.equal(tree.type, f.Receipt); assert.equal(tree.props.email, "new@example.test"); assert.equal(tree.props.preview, false);
  const foundingPricing = {confirmed:true,awardedAt:"2026-10-02T18:00:00Z",monthlyAmountCents:34900,annualAmountCents:349000,currency:"usd"};
  f.setRegistration(registration({state:"registered",profileComplete:true,foundingPricing}));
  assert.deepEqual((await f.page()).props.foundingPricing,foundingPricing,"Use the server's persisted rate on the receipt");
  f.setRegistration(registration({ state: "registered", profileComplete: true, ready: false }));
  await assert.rejects(f.page, error => error.href === "/my/activate");
  f.setRegistration(registration({ state: "activated", profileComplete: true }));
  await assert.rejects(f.page, error => error.href === "/my");
  f.setContext(context({ state: "signed_out", viewer: null }));
  await assert.rejects(f.page, error => error.href === "/my/access");
});

test("receipt preview is inert and does not require an account", async () => {
  const f = await pageFixture("app/my/registered/page.tsx", null, context({ state: "preview", viewer: null }));
  const tree = await f.page(); assert.equal(tree.type, f.Receipt); assert.equal(tree.props.preview, true); assert.equal(tree.props.email, "you@example.com");
});

function hookFixture() {
  let cursor = 0; const slots = [];
  return { react: { ...React, useEffect() {},
    useRef(value) { const slot = cursor++; return slots[slot] ??= { current: value }; },
    useState(value) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof value === "function" ? value() : value; return [slots[slot], next => { slots[slot] = typeof next === "function" ? next(slots[slot]) : next; }]; },
  }, render(Component, props) { cursor = 0; return Component(props); } };
}

async function detailsFixture(requiresPaymentMethod, changes = {}) {
  const h = hookFixture(), calls = [], redirects = [];
  let ok = true, preferenceFails = false, preferenceSaves = 0, errorPayload = { error: "Try again." };
  let responseOnboarding = onboarding({ requiredFieldsComplete: true });
  const preference = { saved: { status: "none", partnerEmail: null }, kind: "individual", partnerEmail: "", consent: false, loading: false, loadError: null,
    save: async () => { assert.ok(calls.some(call => call.url === "/api/my/onboarding"), "Save details before pairing"); preferenceSaves++; if (preferenceFails) throw Error("Your Circle preference could not be saved."); } };
  const values = { "member-tag": "new_member", "mobile-country": "US", "mobile-national": "8015550123", "legal-name": "New Member", "birth-date": "1990-01-01", "apparel-size": "M", "address-line-1": "123 Main", city: "Provo", region: "UT", "postal-code": "84601", "country-code": "US" };
  const Form = (await load("src/components/membership/JoinForm.tsx", {
    react: h.react, "next/link": Link, "@stripe/stripe-js": { loadStripe: () => assert.fail("No checkout") },
    "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
    "@/components/membership/CoupleMembershipApproval": Stub, "@/components/membership/AgreementText": Stub,
    "@/components/membership/RegistrationCouplePreference": { useRegistrationCouple: () => preference, RegistrationCoupleFields: Stub },
    "@/components/membership/MemberPhotoUpload": Stub, "@/components/membership/MemberPaymentMethod": Stub,
    "@/lib/membership/entry-stage": await load("src/lib/membership/entry-stage.ts"),
    "@/lib/membership/pricing": await load("src/lib/membership/pricing.ts"),
    "@/lib/membership/phone": await load("src/lib/membership/phone.ts"),
    "@/lib/membership/member-communication-preferences-model": await load("src/lib/membership/member-communication-preferences-model.ts"),
  }, {
    FormData: class { get(key) { return values[key] ?? ""; } },
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok, json: async () => ok ? { onboarding: responseOnboarding } : errorPayload }; },
    window: { location: { assign: url => redirects.push(url) } },
  })).default;
  const props = { enabled: true, checkoutEnabled: false, disabledReason: null, checkoutDisabledReason: null, initialOnboarding: onboarding(), minimumAge: 18, photoStorageReady: false, publishableKey: null, registrationOnly: true, registrationRequiresPaymentMethod: requiresPaymentMethod, ...changes };
  const render = () => h.render(Form, props);
  return { calls, redirects, render, preference, values, setResponseOnboarding: value => { responseOnboarding = value; }, preferenceSaves: () => preferenceSaves, fail: payload => { ok = false; if (payload) errorPayload = payload; }, failPreference: value => { preferenceFails = value; }, submit: () => nodes(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: {} }) };
}

const updatePreferences = changes => ({ email: null, sms: null, smsPhone: null, revision: "server-revision-0", ...changes });
const updateOnboarding = changes => onboarding({ profile: { mobile: "+18015550123" }, communicationPreferences: updatePreferences(changes) });
const inputNamed = (fixture, name) => nodes(fixture.render()).find(node => node.type === "input" && node.props.name === name);
const chooseUpdate = (fixture, channel, checked) => inputNamed(fixture, `membership-${channel}-updates`).props.onChange({ currentTarget: { checked } });

test("reminder choices preserve saved decisions and remain separate from required legal acceptance", async () => {
  for (const [saved, expectedEmail, expectedSms] of [
    [{}, true, false],
    [{ email: false, sms: false }, false, false],
    [{ email: true, sms: true, smsPhone: "+18015550123" }, true, true],
    [{ email: false, sms: true, smsPhone: "+18015550999" }, false, false],
  ]) {
    const f = await detailsFixture(true, { initialOnboarding: updateOnboarding(saved), registrationLegalNotice: legalNotice });
    const email = inputNamed(f, "membership-email-updates"), sms = inputNamed(f, "membership-text-updates");
    assert.equal(email.props.checked, expectedEmail);
    assert.equal(sms.props.checked, expectedSms);
    assert.equal(email.props.required, undefined); assert.equal(sms.props.required, undefined);
    assert.equal(inputNamed(f, "registration-legal-acknowledged").props.defaultChecked, false);
    assert.match(renderToStaticMarkup(f.render()), /Message frequency varies.*Message and data rates may apply/);
    assert.match(renderToStaticMarkup(f.render()), /Security, account and registration emails still arrive/);
    assert.match(renderToStaticMarkup(f.render()), /mailto:connect@theruinedproject.com/);
  }
});

test("independent optional reminder choices submit explicit false and active SMS evidence without click requests", async () => {
  for (const [email, sms] of [[false, false], [false, true], [true, false], [true, true]]) {
    const f = await detailsFixture(true, { initialOnboarding: updateOnboarding() });
    chooseUpdate(f, "email", email); chooseUpdate(f, "text", sms);
    assert.deepEqual(f.calls, [], "Checkbox clicks must not send or persist anything");
    await f.submit();
    assert.deepEqual(f.calls[0].body.communicationPreferences, {
      email, sms, expectedRevision: "server-revision-0", noticeVersion: "membership-reminders-v1",
      ...(sms ? { smsOptIn: { phone: "+18015550123" } } : {}),
    });
    assert.deepEqual(f.redirects, ["/my/payment-method"], "Declining both channels does not block registration");
  }
  const resumed = await detailsFixture(true, { initialOnboarding: updateOnboarding({ sms: true, smsPhone: "+18015550123" }) });
  await resumed.submit();
  assert.equal(resumed.calls[0].body.communicationPreferences.sms, true);
  assert.equal("smsOptIn" in resumed.calls[0].body.communicationPreferences, false, "Do not fabricate a new active selection on resume");
});

test("changing a consent-bound mobile resets texts until deliberately selected for the new number", async () => {
  const f = await detailsFixture(true, { initialOnboarding: updateOnboarding({ sms: true, smsPhone: "+18015550123" }) });
  const editPhone = value => {
    f.values["mobile-national"] = value;
    inputNamed(f, "mobile-national").props.onInput({ currentTarget: { value, setCustomValidity() {} } });
  };
  editPhone("(801) 555-0123");
  assert.equal(inputNamed(f, "membership-text-updates").props.checked, true, "Formatting alone does not change the consent target");
  editPhone("8015550124");
  assert.equal(inputNamed(f, "membership-text-updates").props.checked, false);
  assert.match(renderToStaticMarkup(f.render()), /Select text updates again for this number/);
  chooseUpdate(f, "text", true);
  await f.submit();
  assert.deepEqual(f.calls[0].body.communicationPreferences.smsOptIn, { phone: "+18015550124" });

  const autofill = await detailsFixture(true, { initialOnboarding: updateOnboarding({ sms: true, smsPhone: "+18015550123" }) });
  autofill.values["mobile-national"] = "8015550124";
  await autofill.submit();
  assert.equal(autofill.calls[0].body.communicationPreferences.sms, false, "Recheck the actual submitted number even without an input event");
  assert.equal("smsOptIn" in autofill.calls[0].body.communicationPreferences, false);

  const country = await detailsFixture(true, { initialOnboarding: updateOnboarding({ sms: true, smsPhone: "+18015550123" }) });
  nodes(country.render()).find(node => node.props.name === "mobile-country").props.onChange({ currentTarget: { value: "GB" } });
  assert.equal(inputNamed(country, "membership-text-updates").props.checked, false);
});

test("successful detail saves refresh preference revision before retrying a failed Circle preference", async () => {
  const f = await detailsFixture(true, { initialOnboarding: updateOnboarding() });
  chooseUpdate(f, "text", true);
  f.setResponseOnboarding(onboarding({ requiredFieldsComplete: true, communicationPreferences: updatePreferences({ email: true, sms: true, smsPhone: "+18015550123", revision: "server-revision-1" }) }));
  f.failPreference(true);
  await f.submit();
  assert.deepEqual(f.redirects, []);
  f.failPreference(false);
  await f.submit();
  assert.equal(f.calls[1].body.communicationPreferences.expectedRevision, "server-revision-1");
  assert.equal("smsOptIn" in f.calls[1].body.communicationPreferences, false, "Successful stored consent is reused without a fabricated second selection");
  assert.deepEqual(f.redirects, ["/my/payment-method"]);
});

test("stale reminder choices keep entered details visible and offer a reload instead of overwriting newer choices", async () => {
  for (const code of ["communication_preferences_changed", "communication_notice_changed"]) {
    const f = await detailsFixture(true, { initialOnboarding: updateOnboarding() });
    f.values["legal-name"] = "Still Entered";
    f.fail({ code, error: "Your update preferences changed. Reload before continuing." });
    await f.submit();
    assert.deepEqual(f.redirects, []);
    assert.equal(f.values["legal-name"], "Still Entered");
    assert.ok(nodes(f.render()).some(node => node.type === "form"));
    assert.ok(nodes(f.render()).some(node => node.type === "button" && node.props.children === "Reload current update preferences ↻"));
    await f.submit();
    assert.equal(f.calls.length, 1);
  }
});

test("legacy missing snapshots and paid profile edits do not invent communication choices", async () => {
  for (const changes of [{}, { registrationOnly: false, initialOnboarding: updateOnboarding() }]) {
    const f = await detailsFixture(true, changes);
    assert.equal(inputNamed(f, "membership-email-updates"), undefined);
    await f.submit();
    assert.equal("communicationPreferences" in f.calls[0].body, false);
  }
});

test("new registrations must acknowledge linked documents without accepting paid terms", async () => {
  for (const requiresPaymentMethod of [true, false]) {
    const f = await detailsFixture(requiresPaymentMethod, { registrationLegalNotice: legalNotice });
    const tree = f.render();
    const acknowledgment = nodes(tree).find(node => node.props.name === "registration-legal-acknowledged");
    assert.equal(acknowledgment.props.required, true);
    assert.equal(acknowledgment.props.defaultChecked, false, "Consent must begin unchecked");
    for (const href of ["/privacy", "/membership/agreement/ruined_registration-v1"]) {
      const link = nodes(tree).find(node => node.type === "a" && node.props.href === href);
      assert.equal(link?.props.target, "_blank", "Reading the docs must preserve entered details");
      assert.equal(link?.props.rel, "noopener noreferrer");
    }
    assert.match(renderToStaticMarkup(tree), /do not start a paid membership or authorize a charge/);
    assert.match(renderToStaticMarkup(tree), /separately review the price and terms and confirm payment/);
    await f.submit();
    assert.deepEqual(f.calls, [], "An unchecked acknowledgment must block programmatic submission too");
    assert.deepEqual(f.redirects, []);
    assert.equal(f.preferenceSaves(), 0);
    f.values["registration-legal-acknowledged"] = "on";
    await f.submit();
    assert.deepEqual(f.calls.map(call => call.url), ["/api/my/onboarding"]);
    assert.deepEqual(f.calls[0].body.legalAcknowledgment, { acknowledged: true, privacyVersion: legalNotice.privacyVersion, agreementVersionId: legalNotice.agreementVersionId });
    assert.equal("affirmativeAction" in f.calls[0].body, false, "Acknowledgment does not submit paid agreement acceptance");
    assert.deepEqual(f.redirects, [requiresPaymentMethod ? "/my/payment-method" : "/my/registered"]);
  }
});

test("unavailable terms block intake with a recovery link while existing paid intake stays unchanged", async () => {
  const f = await detailsFixture(true, { registrationLegalNotice: { state: "unavailable", message: "The membership terms are temporarily unavailable." } });
  assert.equal(nodes(f.render()).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
  assert.ok(nodes(f.render()).some(node => node.type === "button" && node.props.children === "Reload registration ↻"));
  await f.submit();
  assert.deepEqual(f.calls, []); assert.deepEqual(f.redirects, []);
  for (const registrationOnly of [true, false]) {
    const existing = await detailsFixture(true, { registrationOnly, registrationLegalNotice: registrationOnly ? null : legalNotice });
    assert.equal(nodes(existing.render()).some(node => node.props.name === "registration-legal-acknowledged"), false);
    await existing.submit();
    assert.equal("legalAcknowledgment" in existing.calls[0].body, false);
  }
});

test("a changed registration document requires a fresh review before retrying", async () => {
  const f = await detailsFixture(true, { registrationLegalNotice: legalNotice });
  f.values["registration-legal-acknowledged"] = "on";
  f.fail({ code: "registration_documents_changed", error: "The registration documents have changed. Reload and review them before continuing." });
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.redirects, []);
  assert.equal(f.preferenceSaves(), 0);
  const tree = f.render();
  assert.equal(nodes(tree).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
  assert.ok(nodes(tree).some(node => node.type === "button" && node.props.children === "Reload & review updated documents ↻"));
  await f.submit();
  assert.equal(f.calls.length, 1, "Do not retry with an obsolete document version");
});

test("details save follows server confirmation to required card or complimentary receipt without activating membership", async () => {
  for (const required of [true, false]) {
    const f = await detailsFixture(required);
    const markup = renderToStaticMarkup(f.render());
    assert.doesNotMatch(markup, /Profile photo|public profile|Save my profile|Review agreement/);
    assert.match(markup, /Your details|Reserve your unique/);
    await f.submit();
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, "/api/my/onboarding"); assert.equal(f.calls[0].body.action, "save_profile");
    assert.deepEqual(f.redirects, [required ? "/my/payment-method" : "/my/registered"]);
  }
  const f = await detailsFixture(true); f.fail(); await f.submit();
  assert.deepEqual(f.redirects, []); assert.match(renderToStaticMarkup(f.render()), /Try again/);
  assert.equal(f.preferenceSaves(), 0, "Failed intake must not save a Circle preference");
});

test("saved details stay on the form when Circle preference saving fails, and retry advances only after both succeed", async () => {
  for (const required of [true, false]) {
    const f = await detailsFixture(required);
    f.preference.kind = "couple"; f.preference.partnerEmail = "partner@example.test"; f.preference.consent = true;
    f.failPreference(true);
    await f.submit();
    assert.equal(f.calls.length, 1); assert.equal(f.preferenceSaves(), 1);
    assert.deepEqual(f.redirects, []);
    assert.ok(nodes(f.render()).some(node => node.type === "form"));
    assert.match(renderToStaticMarkup(f.render()), /Your Circle preference could not be saved/);
    f.failPreference(false);
    await f.submit();
    assert.equal(f.preferenceSaves(), 2);
    assert.deepEqual(f.redirects, [required ? "/my/payment-method" : "/my/registered"]);
  }
});

test("unknown Circle preference and read-only preview cannot submit profile details", async () => {
  for (const state of [{ loading: true }, { loadError: "Retry loading" }]) {
    const f = await detailsFixture(true); Object.assign(f.preference, state);
    await f.submit(); assert.deepEqual(f.calls, []); assert.deepEqual(f.redirects, []);
  }
  const f = await detailsFixture(true, { enabled: false, preview: true });
  await f.submit(); assert.deepEqual(f.calls, []); assert.deepEqual(f.redirects, []);
});

test("new registration offers only US shipping while existing intake retains international country choices", async () => {
  for (const registrationOnly of [true, false]) {
    const f = await detailsFixture(true, { registrationOnly });
    const tree = f.render();
    const shipping = nodes(tree).find(node => node.type === "select" && node.props.name === "country-code");
    const countries = nodes(shipping).filter(node => node.type === "option").map(node => node.props.value);
    if (registrationOnly) assert.deepEqual(countries, ["US"]);
    else {
      assert.ok(countries.length > 200);
      for (const country of ["US", "CA", "GB", "AE"]) assert.ok(countries.includes(country), country);
    }
    const phone = nodes(tree).find(node => node.type === "select" && node.props.name === "mobile-country");
    assert.ok(nodes(phone).filter(node => node.type === "option").length > 200, "A US resident may still use an international mobile number");
    const birthDate = nodes(tree).find(node => node.props.name === "birth-date");
    if (registrationOnly) assert.match(birthDate.props.max, /^\d{4}-\d{2}-\d{2}$/);
    else assert.equal(birthDate.props.max, undefined, "Historical details remain editable");
  }
});

test("held shell omits member navigation, settings, updates and badge entry points while keeping support and sign-out", async () => {
  const Shell = (await load("src/components/membership/MemberJourneyShell.tsx", {
    "next/image": Image, "next/link": Link, "next/navigation": { usePathname: () => "/my/payment-method" },
    "@/components/platform/MemberNavigationFab": () => React.createElement("span", null, "PRIVATE MENU"),
    "@/components/membership/MemberIcon": Stub, "@/components/membership/InstallRuined": Stub,
    "@/lib/membership/navigation": await load("src/lib/membership/navigation.ts"),
    "@/lib/site": { publicWebsiteHref: path => `https://theruinedproject.com${path}` },
    "@/styles/member-journey-pages.css": {}, "./MemberJourneyShell.module.css": {},
  })).default;
  const render = registrationOnly => renderToStaticMarkup(React.createElement(Shell, { configuration: { mode: "connected" }, viewerLabel: "new@example.test", registrationOnly }, "Content"));
  const held = render(true);
  assert.doesNotMatch(held, /PRIVATE MENU|href="\/my(?:\/|\")|Member pages|Updates/);
  assert.match(held, /mailto:connect@theruinedproject.com/); assert.match(held, /Sign out/); assert.match(held, /Dark mode/);
  assert.match(render(false), /Member pages|PRIVATE MENU/);
});

test("registration receipt preserves charge boundaries, email privacy and a visible install control", async () => {
  const Editor = ({ preview }) => React.createElement("div", { "data-circle-preference-editor": true, "data-preview": preview }, "Registering with your partner?");
  const Receipt = (await load("src/components/membership/MemberRegistrationReceipt.tsx", {
    "next/image": Image, "next/link": Link,
    "@/lib/membership/registration-pricing-confirmation": await load("src/lib/membership/registration-pricing-confirmation.ts"),
    "@/lib/membership/pricing": await load("src/lib/membership/pricing.ts"),
    "@/components/membership/RegistrationCouplePreference": Editor,
    "@/components/membership/InstallRuined": ({ variant }) => React.createElement("button", { "data-variant": variant }, "Install Ruined"),
  })).default;
  const render = (requiresPaymentMethod, foundingPricing = null) => renderToStaticMarkup(React.createElement(Receipt, { email: "new@example.test", registeredAt: "2026-09-30T16:00:00Z", requiresPaymentMethod, foundingPricing }));
  const html = render(true);
  assert.match(html, /You’re registered/); assert.match(html, /Saving a card does not authorize a charge/); assert.doesNotMatch(html, /no subscription has started/); assert.match(html, /We’ll email/);
  assert.match(html, /Install Ruined/); assert.match(html, /data-variant="profile"/);
  assert.match(html, /data-circle-preference-editor="true"/); assert.match(html, /Registering with your partner/);
  const previewTree = Receipt({ email: "new@example.test", registeredAt: null, requiresPaymentMethod: true, preview: true });
  assert.equal(nodes(previewTree).find(node => node.type === Editor).props.preview, true);
  assert.doesNotMatch(html, /email (sent|delivered)|href="\/my(?:\"|\/profile|\/circle|\/foundations)/i);
  assert.match(render(false), /No payment card is required/); assert.doesNotMatch(render(false), /Manage saved card|Your card is saved/);
  const foundingPricing = {confirmed:true,awardedAt:"2026-10-02T18:00:00Z",monthlyAmountCents:34900,annualAmountCents:349000,currency:"usd"};
  const confirmed = render(true,foundingPricing);
  assert.match(confirmed,/Your Founding rate is locked in/);
  assert.match(confirmed,/\$349\/month/); assert.match(confirmed,/\$3,490\/year/);
  assert.match(confirmed,/Individual membership/); assert.match(confirmed,/applicable tax added at checkout/);
  assert.match(confirmed,/continuously active/); assert.match(confirmed,/Billing requires a separate review of your price and terms and your confirmation/);
  assert.doesNotMatch(render(true),/Founding rate is locked|\$349/);
  assert.doesNotMatch(render(false,foundingPricing),/Founding rate is locked|\$349/);
  assert.doesNotMatch(render(true,{...foundingPricing,confirmed:false}),/Founding rate is locked|\$349/);
});

test("layout withholds premature badge celebrations and fails navigation closed if registration lookup fails", async () => {
  const Session = () => null, Shell = () => null, Celebration = () => null;
  for (const value of [null, registration(), registration({ state: "registered" }), registration({ state: "activated" }), "failure"]) {
    const Layout = (await load("app/my/layout.tsx", {
      "next/navigation": { notFound: () => assert.fail("Visible member site") }, "next/headers": {},
      "@/components/membership/MemberPreviewSwitcher": Stub, "@/lib/membership/preview-scenarios": {},
      "@/components/membership/MemberJourneyShell": Shell, "@/components/membership/MemberSessionContinuity": Session,
      "@/components/membership/MemberBadgeCelebration": Celebration, "@/components/membership/MemberPortraitState": Stub,
      "@/components/membership/MemberTimelineDraftState": Stub, "@/components/membership/MemberJournalDraftState": Stub,
      "@/lib/auth/session": { resolveCurrentPlatformSession: async () => ({ status: "authenticated", viewer: { authUserId: "new-member", email: "new@example.test" } }) },
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
      "@/lib/platform/repository": { getOperatorRole: async () => null },
      "@/lib/membership/registration-repository": { getMemberRegistration: async () => { if (value === "failure") throw Error("unavailable"); return value; } },
      "@/lib/platform/visibility": { isMyRuinedVisible: () => true }, "@/lib/sharing": { privateSharingMetadata: {} },
    }, { console: { error() {} } })).default;
    const tree = await Layout({ children: "content" });
    const held = value === "failure" || Boolean(value && value.state !== "activated");
    assert.equal(nodes(tree).find(node => node.type === Shell).props.registrationOnly, held);
    assert.equal(tree.props.celebration === null, held);
  }
});


test("new paid registration skips card setup and cannot see a receipt before verified payment", async () => {
  const pending = registration({ profileComplete: true, requiresInitialPayment: true, requiresPaymentMethod: false });
  for (const path of ["app/my/join/page.tsx", "app/my/payment-method/page.tsx", "app/my/registered/page.tsx"]) {
    const f = await pageFixture(path, pending);
    await assert.rejects(f.page, error => error.href === "/my/activate");
  }
  const f = await detailsFixture(false, { registrationRequiresInitialPayment: true });
  assert.match(renderToStaticMarkup(f.render()), /Continue to agreement &amp; payment/);
  await f.submit();
  assert.deepEqual(f.redirects, ["/my/activate"]);
});

test("paid registration receipt uses confirmed amount and cohort without claiming a saved-card-only registration", async () => {
  const Receipt = (await load("src/components/membership/MemberRegistrationReceipt.tsx", {
    "next/image": Image, "next/link": Link,
    "@/lib/membership/registration-pricing-confirmation": await load("src/lib/membership/registration-pricing-confirmation.ts"),
    "@/lib/membership/pricing": await load("src/lib/membership/pricing.ts"),
    "@/components/membership/RegistrationCouplePreference": Stub,
    "@/components/membership/InstallRuined": Stub,
  })).default;
  const schedule = (await load("src/lib/membership/foundations-schedule.ts")).foundationsBillingScheduleForMonth("2026-11", "monthly");
  const props = { email:"paid@example.test", registeredAt:"2026-10-06T18:00:00Z", requiresPaymentMethod:false,
    initialPayment:{amountPaid:37000,installmentDues:34900,plan:"monthly",currency:"usd",offerId:"founding_individual_monthly",billingSchedule:schedule,paidAt:"2026-10-06T18:00:00Z",isPayer:true} };
  const html = renderToStaticMarkup(React.createElement(Receipt, props));
  for (const phrase of ["$370 paid", "$349 plus applicable tax", "November 5, 2026", "December 5, 2026", "November 5, 2027", "Eleven further monthly installments", "full refund", "$1,500", "Founding rate stays protected", "profile stays closed"]) assert.ok(html.includes(phrase), phrase);
  assert.doesNotMatch(html, /Nothing has been charged|Your card is saved|complimentary registration|Registering with your partner/);
  const withTax = renderToStaticMarkup(React.createElement(Receipt, {...props,initialPayment:{...props.initialPayment,amountPaid:37518}}));
  assert.match(withTax, /\$375\.18 paid/);
  assert.doesNotMatch(withTax, /\$375 paid/, "Never round a confirmed tax-inclusive payment");
  const partner = renderToStaticMarkup(React.createElement(Receipt, {...props,initialPayment:{...props.initialPayment,offerId:"couple_monthly",isPayer:false}}));
  assert.match(partner,/Your shared membership is paid/); assert.doesNotMatch(partner, /\$370 paid/);
});

test("historical details proceed directly to paid checkout without changing the stored no-charge requirement", async () => {
  const f = await detailsFixture(true, { registrationRequiresInitialPayment: false, registrationNextHref: "/my/activate" });
  assert.match(renderToStaticMarkup(f.render()), /Continue to agreement &amp; payment/);
  await f.submit();
  assert.deepEqual(f.redirects, ["/my/activate"]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/my/onboarding");
  assert.equal("requiresInitialPayment" in f.calls[0].body, false);
});

test("historical registration pages retain the no-charge card step while paid checkout is closed", async () => {
  const closed = context({ configuration: { mode: "connected", stripeCheckoutReady: false, stripeActivationReady: false, stripePaymentSetupReady: true, minimumAge: 18 }, data: onboarding({ requiredFieldsComplete: true }) });
  const registrationWithDetails = registration({ profileComplete: true });
  const join = await pageFixture("app/my/join/page.tsx", registrationWithDetails, closed);
  await assert.rejects(join.page, error => error.href === "/my/payment-method");
  const card = await pageFixture("app/my/payment-method/page.tsx", registrationWithDetails, closed);
  assert.equal(nodes(await card.page()).some(node => node.type === card.Payment), true);
});

test("saved-card registrations with verified payment display the paid receipt without another payment prompt", async () => {
  const initialPayment = { amountPaid: 34900, installmentDues: 34900, currency: "usd", offerId: "founding_individual_monthly", plan: "monthly", isPayer: true, billingSchedule: {}, paidAt: "2026-10-07T18:00:00Z" };
  const f = await pageFixture("app/my/registered/page.tsx", registration({ state: "registered", profileComplete: true, completionBasis: "saved_card", initialPayment }));
  assert.deepEqual((await f.page()).props.initialPayment, initialPayment);
});
