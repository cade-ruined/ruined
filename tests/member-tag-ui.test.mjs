import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as phone from "../src/lib/membership/phone.ts";
import * as memberNumber from "../src/lib/membership/member-number.ts";
import * as entryStage from "../src/lib/membership/entry-stage.ts";

function hooks() {
  let cursor = 0;
  const slots = [];
  return {
    react: { ...React,
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
      useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
      useId() { return "member-tag-test"; }, useEffect() {},
    },
    render(component, props) { cursor = 0; return component(props); },
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
async function fixture(kind, tag = null) {
  const state = hooks(), calls = [], responses = [];
  const onboarding = { profile: { memberTag: tag, preferredName: "Legacy preferred", legalName: "Private Legal Name", mobile: "+18015550100", fulfillmentAddress: { countryCode: "US" }, apparelSizing: {} }, agreement: { acceptanceId: null }, requiredFieldsComplete: false, membershipFunding: "self", email: "private@example.test" };
  const initialProfile = { ...profile, directory: { ...profile.directory, memberTag: tag } };
  const component = await load(`src/components/membership/${kind === "join" ? "JoinForm" : "MemberProfileEditor"}.tsx`, {
    react: state.react, "next/link": Stub, "@stripe/stripe-js": { loadStripe: () => assert.fail("No payment during profile editing") },
    "@/components/membership/MembershipEntryProgress": { useMembershipEntryProgressStage() {} },
    "@/components/membership/AgreementText": Stub, "@/components/membership/MemberPhotoUpload": Stub,
    "@/components/membership/MemberSettingsHeader": Stub, "@/components/membership/MemberPublicSharingSettings": Stub,
    "@/components/support/supportStyles": {}, "@/lib/membership/entry-stage": entryStage, "@/lib/membership/phone": phone,
  }, {
    FormData: class { constructor(values) { this.values = values; } get(name) { return this.values[name] ?? null; } },
    fetch: async (url, request) => { const body = JSON.parse(request.body); calls.push({ url, body }); return responses.shift() ?? { ok: true, status: 200, json: async () => ({ onboarding, profile: { ...initialProfile, directory: { ...initialProfile.directory, memberTag: body.memberTag || null } } }) }; },
  });
  const props = kind === "join" ? { initialOnboarding: onboarding, minimumAge: 18, enabled: true, photoStorageReady: true } : { initialProfile, photoStorageReady: true, writable: true };
  const render = () => state.render(component, props);
  async function submit(tagValue) { await elements(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { "member-tag": tagValue, "legal-name": "Private Legal Name", "display-name": "Public Name", "mobile-country": "US", "mobile-national": "8015550100" } }); }
  return { render, submit, calls, responses };
}

test("joining requires a tag, retains private legal name, and never asks for another public name", async () => {
  const view = await fixture("join"), tree = view.render(), input = field(tree);
  assert.equal(input.props.required, true); assert.equal(input.props.maxLength, 24);
  assert.equal(input.props.autoComplete, "username"); assert.equal(input.props.autoCapitalize, "none"); assert.equal(input.props.spellCheck, false);
  assert.equal(input.props.pattern, "[a-z0-9_]{3,24}");
  assert.ok(elements(tree).some(node => node.props.name === "legal-name"));
  assert.equal(elements(tree).some(node => ["preferred-name", "display-name"].includes(node.props.name)), false);
  assert.match(text(tree), /Private · For your membership records/);
  assert.match(text(tree), /alongside your display name when you share your card or invitation/);
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
    if (kind === "profile") assert.equal(view.calls[0].body.displayName, "Public Name");
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

test("profile legacy blank tags remain optional, but a successful claim becomes required", async () => {
  const legacy = await fixture("profile");
  assert.equal(field(legacy.render()).props.required, false); await legacy.submit(""); assert.equal(legacy.calls.length, 1);
  await legacy.submit("new_tag"); assert.equal(field(legacy.render()).props.required, true);
  assert.equal(field(legacy.render()).props.value, "new_tag");
  const claimed = await fixture("profile", "saved_tag");
  assert.equal(field(claimed.render()).props.required, true); await claimed.submit(""); assert.equal(claimed.calls.length, 0);
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
  const Home = await load("src/components/platform/MemberHome.tsx", { react: state.react, "next/link": Stub, "next/image": Stub, "@/components/membership/MemberJournal": Stub, "@/components/membership/MemberPortraitState": { useMemberPortrait: avatarUrl => ({ avatarUrl }) }, "@/components/membership/MemberProfileShare": Stub, "@/lib/membership/member-number": memberNumber, "@/lib/membership/access-policy": { memberCan: () => false }, "./MemberProfile.module.css": new Proxy({}, { get: (_, key) => key }) });
  const render = (displayName, memberTag) => state.render(Home, { member: { displayName, profile: { memberTag, displayName }, circleMembers: [], identity: { standingState: "active" }, nextAction: { kind: "explore" } } });
  const named = render("Public Name", "member_tag");
  const heading = elements(named).find(node => node.type === "h1");
  assert.equal(heading.props["aria-label"] ?? text(heading), "Public Name");
  assert.equal(elements(named).filter(node => node.type === "p" && text(node) === "@member_tag").length, 1);
  assert.equal(elements(render("@Member_Tag", "member_tag")).filter(node => node.type === "p" && text(node) === "@member_tag").length, 1);
  assert.equal(elements(render("Legacy Name", null)).some(node => node.type === "p" && text(node).startsWith("@")), false);
});


test("a saved default display name follows a changed tag in the uncontrolled field", async () => {
  const view = await fixture("profile", "old_tag");
  const originalKey = elements(view.render()).find(node => node.props.name === "display-name").key;
  view.responses.push({ ok: true, status: 200, json: async () => ({ profile: { ...profile, directory: { ...profile.directory, displayName: "@new_tag", memberTag: "new_tag" } } }) });
  await view.submit("new_tag");
  const display = elements(view.render()).find(node => node.props.name === "display-name");
  assert.equal(display.props.defaultValue, "@new_tag");
  assert.notEqual(display.key, originalKey, "React remounts the uncontrolled input when the canonical saved name changes");
});
