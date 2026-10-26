import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as phone from "../src/lib/membership/phone.ts";
import * as memberNumber from "../src/lib/membership/member-number.ts";
import * as profileFields from "../src/lib/membership/profile-fields.ts";
import * as pricing from "../src/lib/membership/pricing.ts";
import * as entryStage from "../src/lib/membership/entry-stage.ts";
import * as communicationPreferences from "../src/lib/membership/member-communication-preferences-model.ts";

function hooks(runEffects = false) {
  let cursor = 0;
  const slots = [];
  return {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
      useId() { return "member-tag-test"; }, useEffect(effect, dependencies) {
        const i = cursor++;
        if (!runEffects) return;
        const prior = slots[i];
        if (!prior || dependencies.some((value, index) => value !== prior.dependencies[index])) {
          prior?.cleanup?.(); slots[i] = { dependencies, cleanup: effect() };
        }
      },
    },
    render(component, props) { cursor = 0; return component(props); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
function elements(node) { return React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : []; }
function text(node) { return React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : ""; }
function field(tree) { return elements(tree).find(node => node.props.name === "member-tag"); }
const Stub = () => null;
async function load(path, dependencies, globals = {}) {
  const compiled = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports.default;
}
const profile = { revision: "a".repeat(64), directory: { displayName: "Public Name", preferredName: "Legacy preferred", memberTag: null, avatarUrl: null }, preferences: {}, privateProfile: {}, access: {} };
async function fixture(kind, tag = null, profileOverrides = {}) {
  const state = hooks(kind === "profile"), calls = [], responses = [], refreshes = [], events = [];
  const router = { refresh() { refreshes.push(true); } };
  const window = new EventTarget(); window.addEventListener("ruined:member-progress", event => events.push(event.type));
  const onboarding = { profile: { memberTag: tag, preferredName: "Legacy preferred", legalName: "Private Legal Name", mobile: "+18015550100", fulfillmentAddress: { countryCode: "US" }, apparelSizing: {} }, agreement: { acceptanceId: null }, requiredFieldsComplete: false, membershipFunding: "self", email: "private@example.test" };
  const initialProfile = { ...profile, ...profileOverrides, directory: { ...profile.directory, ...profileOverrides.directory, memberTag: tag }, privateProfile: { ...profile.privateProfile, ...profileOverrides.privateProfile } };
  const component = await load(`src/components/membership/${kind === "join" ? "JoinForm" : "MemberProfileEditor"}.tsx`, {
    "next/navigation": { useRouter: () => router },
    react: state.react, "next/link": Stub, "@stripe/stripe-js": { loadStripe: () => assert.fail("No payment during profile editing") },
    "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
    "@/components/membership/RegistrationCouplePreference": { useRegistrationCouple: () => ({ loading: false, loadError: null }), RegistrationCoupleFields: Stub },
    "@/components/membership/CoupleMembershipApproval": Stub,
    "@/components/membership/AgreementText": Stub, "@/components/membership/MemberPhotoUpload": Stub,
    "@/components/membership/MemberPaymentMethod": Stub,
    "@/components/membership/MemberSmsConsentDisclosure": Stub,
    "@/components/membership/MemberSettingsHeader": Stub,
    "@/lib/membership/profile-fields": profileFields,
    "./MemberProfileEditor.module.css": new Proxy({}, { get: (_, key) => key }),
    "@/components/support/supportStyles": {}, "@/lib/membership/entry-stage": entryStage, "@/lib/membership/pricing": pricing, "@/lib/membership/phone": phone,
    "@/lib/membership/member-communication-preferences-model": communicationPreferences,
  }, {
    window,
    FormData: class { constructor(values) { this.values = values; } get(name) { return this.values[name] ?? null; } },
    fetch: async (url, request) => { const body = JSON.parse(request.body); calls.push({ url, method: request.method, body }); return responses.shift() ?? { ok: true, status: 200, json: async () => ({ onboarding, profile: { ...initialProfile, directory: { ...initialProfile.directory, memberTag: body.memberTag || null } } }) }; },
  });
  const props = kind === "join" ? { initialOnboarding: onboarding, minimumAge: 18, enabled: true, photoStorageReady: true } : { initialProfile, photoStorageReady: true, writable: true };
  const render = () => state.render(component, props);
  async function submit(tagValue, values = {}) { await elements(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { "member-tag": tagValue, "legal-name": "Private Legal Name", "full-name": "Public Name", "city": "Salt Lake City", "state": "Utah", "timezone": "America/Denver", "mobile-country": "US", "mobile-national": "8015550100", ...values } }); }
  return { render, submit, calls, responses, refreshes, events, props, unmount: state.unmount };
}

test("joining requires a permanent tag and explains the public full name", async () => {
  const view = await fixture("join"), tree = view.render(), input = field(tree);
  assert.equal(input.props.required, true); assert.equal(input.props.maxLength, 24);
  assert.equal(input.props.autoComplete, "username"); assert.equal(input.props.autoCapitalize, "none"); assert.equal(input.props.spellCheck, false);
  assert.equal(input.props.pattern, "[a-z0-9_]{3,24}");
  assert.ok(elements(tree).some(node => node.props.name === "legal-name"));
  assert.equal(elements(tree).some(node => ["preferred-name", "display-name"].includes(node.props.name)), false);
  assert.match(text(tree), /Your name appears on your public profile and member card/);
  assert.match(text(tree), /Choose your permanent @tag/);
});

test("both profile forms protect unapplied photo drafts without disabling crop controls", async () => {
  for (const kind of ["join", "profile"]) {
    const view = await fixture(kind);
    const photo = elements(view.render()).find(node => typeof node.props.onDraftChange === "function");
    photo.props.onDraftChange(true);
    const editing = view.render();
    assert.equal(elements(editing).find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
    assert.equal(elements(editing).some(node => node.type === "fieldset" && node.props.disabled), false);
    assert.match(text(editing), /Use your photo or cancel the crop/);
    await view.submit("valid_member"); assert.equal(view.calls.length, 0, "Enter-key submission must also preserve the photo draft");
    photo.props.onDraftChange(false);
    await view.submit("valid_member"); assert.equal(view.calls.length, 1);
  }
});

test("both forms normalize pasted @tags before maxlength can consume the prefix", async () => {
  for (const kind of ["join", "profile"]) {
    const view = await fixture(kind), value = "A".repeat(24); let prevented = false;
    field(view.render()).props.onPaste({ preventDefault() { prevented = true; }, currentTarget: { value: "", selectionStart: 0, selectionEnd: 0 }, clipboardData: { getData: () => ` @${value} ` } });
    assert.equal(prevented, true); assert.equal(field(view.render()).props.value, value.toLowerCase());
    field(view.render()).props.onChange({ currentTarget: { value: "@New_Tag" } });
    assert.equal(field(view.render()).props.value, "new_tag");
    await view.submit(" @New_Tag ");
    assert.equal(view.calls.length, 1); assert.equal(view.calls[0].body.memberTag, "new_tag");
    assert.equal("preferredName" in view.calls[0].body, false);
    if (kind === "profile") {
      assert.equal(view.calls[0].body.fullName, "Public Name");
      assert.equal(view.calls[0].body.city, "Salt Lake City");
      assert.equal(view.calls[0].body.state, "Utah");
      assert.equal("websiteUrl" in view.calls[0].body, false);
      assert.equal("accessibilityNotes" in view.calls[0].body, false);
    }
  }
});

test("invalid tags cannot reach either endpoint even if native validation is bypassed", async () => {
  for (const kind of ["join", "profile"]) for (const value of ["ab", "has space", "has-dash", "@@member", "x".repeat(25), "mémber"]) {
    const view = await fixture(kind); await view.submit(value);
    assert.equal(view.calls.length, 0, `${kind}: ${value}`);
    assert.equal(field(view.render()).props["aria-invalid"], true);
    assert.match(text(view.render()), /Use 3–24 letters, numbers, or underscores/);
  }
});

test("profile legacy blank tags remain optional, but a successful claim becomes locked", async () => {
  const legacy = await fixture("profile");
  assert.equal(field(legacy.render()).props.required, false); await legacy.submit(""); assert.equal(legacy.calls.length, 1);
  await legacy.submit("new_tag"); assert.equal(field(legacy.render()).props.required, true);
  assert.equal(field(legacy.render()).props.value, "new_tag");
  const claimed = await fixture("profile", "saved_tag");
  assert.equal(field(claimed.render()).props.readOnly, true);
  field(claimed.render()).props.onChange({ currentTarget: { value: "attempted_change" } });
  assert.equal(field(claimed.render()).props.value, "saved_tag");
  await claimed.submit("attempted_change"); assert.equal(claimed.calls[0].body.memberTag, "saved_tag");
  const joining = await fixture("join"); await joining.submit(""); assert.equal(joining.calls.length, 0);
});

test("taken tags can be corrected and retried while true profile version conflicts still lock saving", async () => {
  for (const kind of ["join", "profile"]) {
    const view = await fixture(kind);
    view.responses.push({ ok: false, status: 409, json: async () => ({ code: "member_tag_unavailable", error: "That member tag is already taken. Choose another." }) });
    await view.submit("taken_tag");
    assert.equal(field(view.render()).props["aria-invalid"], true);
    assert.match(text(view.render()), /That member tag is already taken/);
    assert.doesNotMatch(text(view.render()), /Reload profile/);
    field(view.render()).props.onChange({ currentTarget: { value: "available_tag" } });
    assert.equal(field(view.render()).props["aria-invalid"], false);
    await view.submit("available_tag"); assert.equal(view.calls.length, 2);
  }
  const stale = await fixture("profile", "existing_tag");
  stale.responses.push({ ok: false, status: 409, json: async () => ({ error: "Your profile changed. Reload it." }) });
  await stale.submit("existing_tag"); assert.match(text(stale.render()), /Reload profile/);
  await stale.submit("another_tag"); assert.equal(stale.calls.length, 1);
});

test("home shows the saved display name and only adds a distinct secondary @tag", async () => {
  const state = hooks();
  const router = { refresh() {} };
  const Home = await load("src/components/platform/MemberHome.tsx", { react: state.react, "next/navigation": { useRouter: () => router }, "next/link": Stub, "next/image": Stub, "@/components/membership/InstallRuined": Stub, "@/components/membership/MemberJournal": Stub, "@/components/membership/MemberWelcome": Stub, "@/components/membership/MemberBadges": Stub, "@/components/membership/MemberPortraitState": { useMemberPortrait: avatarUrl => ({ avatarUrl }) }, "@/components/membership/MemberProfileShare": Stub, "@/lib/membership/member-number": memberNumber, "@/lib/membership/access-policy": { memberCan: () => false }, "./MemberProfile.module.css": new Proxy({}, { get: (_, key) => key }) });
  const render = (displayName, memberTag) => state.render(Home, { member: { displayName, profile: { memberTag, displayName }, circleMembers: [], identity: { standingState: "active" }, access: { mode: "full", capabilities: [] }, upcomingExperiences: [], nextAction: { kind: "explore" } } });
  const named = render("Public Name", "member_tag");
  const heading = elements(named).find(node => node.type === "h1");
  assert.equal(heading.props["aria-label"] ?? text(heading), "Public Name");
  assert.equal(elements(named).filter(node => node.type === "p" && text(node) === "@member_tag").length, 1);
  assert.equal(elements(render("@Member_Tag", "member_tag")).filter(node => node.type === "p" && text(node) === "@member_tag").length, 1);
  assert.equal(elements(render("Legacy Name", null)).some(node => node.type === "p" && text(node).startsWith("@")), false);
});


test("full name reflects the canonical saved value while the member tag stays locked", async () => {
  const view = await fixture("profile", "old_tag");
  const originalKey = elements(view.render()).find(node => node.props.name === "full-name").key;
  view.responses.push({ ok: true, status: 200, json: async () => ({ profile: { ...profile, directory: { ...profile.directory, fullName: "New Full Name", displayName: "New Full Name", memberTag: "old_tag" } } }) });
  await view.submit("old_tag");
  const display = elements(view.render()).find(node => node.props.name === "full-name");
  assert.equal(display.props.defaultValue, "New Full Name");
  assert.notEqual(display.key, originalKey);
  assert.equal(field(view.render()).props.readOnly, true);
});

test("profile editor exposes only the relevant identity and contact controls", async () => {
  const view = await fixture("profile", "member_tag"), tree = view.render();
  const names = elements(tree).map(node => node.props.name).filter(Boolean);
  for (const name of ["full-name", "member-tag", "bio", "city", "state", "timezone", "email-scope", "phone-scope"]) assert.ok(names.includes(name), name);
  for (const name of ["display-name", "website-url", "accessibility-notes", "circle-directory-enabled", "avatar-visible", "bio-visible"]) assert.equal(names.includes(name), false, name);
  const timezone = elements(tree).find(node => node.props.name === "timezone");
  assert.equal(timezone.type, "select");
  assert.ok(elements(timezone).some(node => node.type === "option" && node.props.value === "America/Denver"));
  assert.match(text(tree), /Your Journal is private/);
  assert.doesNotMatch(text(tree), /Circle visibility|Private notes|Short biography|Website \/ Optional/);
});


const privateFieldNames = ["mobile-country", "mobile-national", "birth-date", "apparel-size", "shipping-address-line-1", "shipping-address-line-2", "shipping-city", "shipping-region", "shipping-postal-code", "shipping-country-code"];
const valueOf = field => field.props.value ?? field.props.defaultValue;

test("private details are editable with saved values inside the profile form before Save", async () => {
  const view = await fixture("profile", "member_tag", { privateProfile: {
    mobile: "+442079460018", birthDate: "1990-03-04", apparelSizing: { top: "Custom tall fit" },
    fulfillmentAddress: { addressLine1: "12 Saved Street", addressLine2: "Flat 4", city: "London", region: "Greater London", postalCode: "SW1A 1AA", countryCode: "GB" },
  } });
  const tree = view.render(), all = elements(tree), forms = all.filter(node => node.type === "form");
  assert.equal(forms.length, 1);
  const nodes = elements(forms[0]);
  const saveIndex = nodes.findIndex(node => node.type === "button" && node.props.type === "submit");
  assert.ok(saveIndex >= 0);
  for (const name of privateFieldNames) {
    const matches = nodes.filter(node => node.props.name === name);
    assert.equal(matches.length, 1, `${name} belongs to the shared save form`);
    assert.ok(nodes.indexOf(matches[0]) < saveIndex, `${name} appears before Save`);
  }
  const byName = name => nodes.find(node => node.props.name === name);
  assert.equal(valueOf(byName("mobile-country")), "GB");
  assert.equal(valueOf(byName("mobile-national")).replace(/\D/g, ""), "02079460018");
  for (const [name, expected] of Object.entries({
    "birth-date": "1990-03-04", "apparel-size": "Custom tall fit", "shipping-address-line-1": "12 Saved Street", "shipping-address-line-2": "Flat 4", "shipping-city": "London", "shipping-region": "Greater London", "shipping-postal-code": "SW1A 1AA", "shipping-country-code": "GB",
  })) assert.equal(valueOf(byName(name)), expected, name);
  assert.ok(elements(byName("apparel-size")).some(node => node.type === "option" && node.props.value === "Custom tall fit"), "unknown saved sizing stays selectable");
  assert.doesNotMatch(text(tree), /Request a details update/);
  assert.equal(all.some(node => node.props.href === "/my/support"), false);
});

test("one profile save submits edited public and private details with a normalized mobile number", async () => {
  const view = await fixture("profile", "saved_tag");
  await view.submit("saved_tag", {
    "full-name": "Updated Public Name", city: "Alpine", state: "Utah", bio: "A new public bio", "email-scope": "circle", "phone-scope": "none",
    "mobile-country": "US", "mobile-national": "(415) 555-2671", "birth-date": "1991-06-12", "apparel-size": "XL",
    "shipping-address-line-1": "8 New Road", "shipping-address-line-2": "Studio B", "shipping-city": "Manchester", "shipping-region": "Greater Manchester", "shipping-postal-code": "M1 1AE", "shipping-country-code": "GB",
  });
  assert.equal(view.calls.length, 1);
  const request = view.calls[0];
  assert.equal(request.url, "/api/my/profile");
  assert.equal(request.method, "POST");
  assert.equal(request.body.fullName, "Updated Public Name");
  assert.equal(request.body.city, "Alpine");
  assert.equal(request.body.state, "Utah");
  assert.equal(request.body.bio, "A new public bio");
  assert.deepEqual(request.body.directory, { emailScope: "circle", phoneScope: "none" });
  assert.deepEqual(request.body.privateProfile, {
    mobile: "+14155552671", birthDate: "1991-06-12", apparelTopSize: "XL",
    shippingAddress: { addressLine1: "8 New Road", addressLine2: "Studio B", city: "Manchester", region: "Greater Manchester", postalCode: "M1 1AE", countryCode: "GB" },
  });
  assert.match(text(view.render()), /Profile saved/);
});

test("legacy members can save while leaving optional private details blank", async () => {
  const view = await fixture("profile");
  const nodes = elements(view.render());
  for (const name of privateFieldNames) assert.notEqual(nodes.find(node => node.props.name === name)?.props.required, true, name);
  await view.submit("", Object.fromEntries(privateFieldNames.map(name => [name, ""])));
  assert.equal(view.calls.length, 1);
  assert.deepEqual(view.calls[0].body.privateProfile, {
    mobile: "", birthDate: "", apparelTopSize: "",
    shippingAddress: { addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", countryCode: "" },
  });
});

test("invalid nonblank phone details block profile submission and remain correctable", async () => {
  const view = await fixture("profile", "saved_tag");
  await view.submit("saved_tag", { "mobile-country": "US", "mobile-national": "123" });
  assert.equal(view.calls.length, 0);
  assert.match(text(view.render()), /(?:complete|valid).*(?:mobile|phone|number)|(?:mobile|phone).*(?:complete|valid)/i);
  await view.submit("saved_tag", { "mobile-country": "US", "mobile-national": "4155552671" });
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0].body.privateProfile.mobile, "+14155552671");
});

test("a persisted profile save refreshes badge progress and cached pages without remounting form fields", async () => {
  const view = await fixture("profile", "saved_tag", { directory: { bio: "Saved bio" } });
  const before = elements(view.render()).find(node => node.props.name === "bio");
  await view.submit("saved_tag", { bio: "Saved bio" });
  assert.deepEqual(view.events, ["ruined:member-progress"]);
  assert.equal(view.refreshes.length, 1);
  assert.match(text(view.render()), /Profile saved/);
  const after = elements(view.render()).find(node => node.props.name === "bio");
  assert.equal(after.key, before.key, "refresh must not add a remount key to the text field");
  assert.equal(after.props.defaultValue, "Saved bio");
  assert.equal(field(view.render()).props.value, "saved_tag");
  view.unmount();
});

test("failed and preview profile saves never announce progress or invalidate the page", async () => {
  for (const status of [400, 409, 500]) {
    const view = await fixture("profile", "saved_tag");
    view.responses.push({ ok: false, status, json: async () => ({ error: "Could not save this profile." }) });
    await view.submit("saved_tag");
    assert.deepEqual(view.events, []); assert.deepEqual(view.refreshes, []);
    assert.match(text(view.render()), /Could not save this profile/);
    view.unmount();
  }
  const preview = await fixture("profile", "saved_tag");
  preview.props.preview = true;
  await preview.submit("saved_tag");
  assert.deepEqual(preview.calls, []); assert.deepEqual(preview.events, []); assert.deepEqual(preview.refreshes, []);
  preview.unmount();
});

test("late profile success after unmount or an A-to-B-to-A owner change cannot publish progress", async () => {
  for (const change of ["unmount", "owner"]) {
    const view = await fixture("profile", "saved_tag", { memberId: "member-a" });
    let resolve;
    view.responses.push(new Promise(done => { resolve = done; }));
    const saving = view.submit("saved_tag");
    if (change === "unmount") view.unmount();
    else {
      view.props.initialProfile = { ...view.props.initialProfile, memberId: "member-b" }; view.render();
      view.props.initialProfile = { ...view.props.initialProfile, memberId: "member-a" }; view.render();
    }
    resolve({ ok: true, status: 200, json: async () => ({ profile: view.props.initialProfile }) });
    await saving;
    assert.deepEqual(view.events, []); assert.deepEqual(view.refreshes, []);
    assert.doesNotMatch(text(view.render()), /Profile saved/);
    view.unmount();
  }
});
