import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as profileFields from "../src/lib/membership/profile-fields.ts";

const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
function hooks() {
  let cursor = 0;
  const slots = [], effects = [];
  return {
    react: { ...React,
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
      useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
      useCallback(callback, dependencies) { const index = cursor++; if (!same(slots[index]?.dependencies, dependencies)) slots[index] = { callback, dependencies }; return slots[index].callback; },
      useEffect(callback, dependencies) { const index = cursor++; if (!same(slots[index]?.dependencies, dependencies)) effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; }); },
    },
    render(component, props) { cursor = 0; const result = component(props); effects.splice(0).forEach(effect => effect()); return result; },
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
async function load(path, dependencies, globals = {}) {
  const compiled = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports, ...Object.values(globals));
  return loaded.exports.default;
}
function elements(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...["children", "headerActions", "footerActions"].flatMap(key => React.Children.toArray(element.props[key]).flatMap(elements))];
}
const text = element => typeof element === "string" || typeof element === "number" ? String(element)
  : React.isValidElement(element) ? React.Children.toArray(element.props.children).map(text).join("") : "";
const findButton = (tree, label) => elements(tree).find(element => element.type === "button" && text(element) === label);
const Link = () => null, Room = () => null, Photo = () => null;
const settings = { publicEnabled: false, showPortrait: true, showMemberSince: false, showLocation: false, showBio: true, showBuilding: false, showWebsite: false, labelIds: [] };
const card = { name: "Saved Name", avatarUrl: null, memberSince: null, location: null, bio: "Saved biography", buildingNow: null, websiteUrl: null, labels: [], wearSeed: "saved-wear" };
const snapshot = { card, settings, version: 27, writable: true, eligible: true, publicUrl: null, source: { name: "PRIVATE SOURCE" }, sourceRevision: "PRIVATE REVISION", availableLabels: [] };

async function ownerFixture(props = {}) {
  const state = hooks(), calls = [], copies = [], shares = [], listeners = new Map();
  const savedUrl = `/card/${"S".repeat(43)}`;
  const response = { ...snapshot, settings: { ...settings, publicEnabled: true }, version: 28, publicUrl: savedUrl };
  const owner = await load("src/components/membership/MemberCardEditor.tsx", {
    react: state.react, "next/link": Link, "@/components/membership/card/PublicMemberCardPage": Room,
  }, {
    window: { location: { origin: "https://members.example.test", href: "https://members.example.test/my/card" }, addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: event => listeners.delete(event) },
    document: { hidden: false, addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: event => listeners.delete(event) },
    navigator: { share: async value => { shares.push(value); }, clipboard: { writeText: async value => { copies.push(value); } } },
    fetch: async (url, options) => { calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined }); return { ok: true, json: async () => ({ snapshot: response }) }; },
  });
  const input = { initialSnapshot: snapshot, writable: true, ...props };
  const render = () => state.render(owner, input);
  render();
  return { render, calls, copies, shares, savedUrl, listeners, cleanup: state.cleanup };
}

test("owner card room links to invitations without any customization controls", async () => {
  const view = await ownerFixture();
  const tree = view.render(), nodes = elements(tree);
  assert.equal(tree.type, Room); assert.equal(tree.props.card, snapshot.card);
  assert.equal(nodes.filter(node => node.type === Link && node.props.href === "/my/invitation").length, 1);
  assert.doesNotMatch(nodes.map(text).join(" "), /customiz|add details/i);
  assert.equal(nodes.some(node => node.type === "form" || node.type === "textarea" || node.type === "select" || node.type === "input" && !node.props.readOnly), false);
  assert.equal(view.calls.length, 0, "mounting a saved owner snapshot must not issue another request");
  view.cleanup(); assert.equal(view.listeners.size, 0);
});

test("owner card has no public sharing controls or publication writes", async () => {
  const view = await ownerFixture();
  const tree = view.render();
  for (const label of ["Make card public", "Make private", "Copy link", "Share card ↗"]) assert.equal(findButton(tree, label), undefined);
  assert.match(tree.props.footerNote, /full name.*person you’re inviting/);
  assert.equal(view.calls.length, 0);
  assert.equal(elements(tree).some(node => node.type === "input"), false);
  view.cleanup();
});

test("preview card never loads or publishes remote data", async () => {
  const view = await ownerFixture({ preview: true });
  assert.equal(view.render().props.preview, true);
  assert.equal(view.calls.length, 0); assert.equal(view.listeners.size, 0);
  view.cleanup();
});

async function profileFixture() {
  const state = hooks();
  const profile = { revision: "a".repeat(64), access: {}, directory: { displayName: "N".repeat(120), preferredName: "Preferred", bio: "B".repeat(1200), buildingNow: "C".repeat(500), websiteUrl: "https://example.test", location: "Alpine", timezone: "America/Denver", avatarUrl: null }, preferences: { directoryStatus: "hidden", avatarVisible: false, locationVisible: false, bioVisible: false, buildingVisible: false, emailScope: "none", phoneScope: "none" }, privateProfile: { accessibilityNotes: "" } };
  const initialCard = { ...snapshot, settings: { ...settings, publicEnabled: true } };
  const editor = await load("src/components/membership/MemberProfileEditor.tsx", {
    react: state.react, "next/link": Link, "@/components/membership/MemberSettingsHeader": () => null,
    "@/components/membership/MemberPhotoUpload": Photo,
    "@/lib/membership/profile-fields": profileFields,
    "./MemberProfileEditor.module.css": {},
    "@/components/support/supportStyles": { SUPPORT_ACTION_CLASS: "", SUPPORT_FIELD_CLASS: "", SUPPORT_LABEL_CLASS: "", SUPPORT_LINK_CLASS: "" },
  });
  const render = () => state.render(editor, { initialProfile: profile, initialCard, photoStorageReady: true, writable: true });
  return { render, profile, initialCard };
}

test("the profile form preserves full text limits and removes obsolete sharing controls", async () => {
  const view = await profileFixture(), nodes = elements(view.render());
  assert.equal(nodes.filter(node => node.type === "form").length, 1);
  for (const [name, maximum, value] of [["full-name", 120, view.profile.directory.displayName], ["bio", 1200, view.profile.directory.bio], ["building-now", 500, view.profile.directory.buildingNow]]) {
    const fields = nodes.filter(node => node.props.name === name);
    assert.equal(fields.length, 1); assert.equal(fields[0].props.maxLength, maximum); assert.equal(fields[0].props.defaultValue, value);
  }
  assert.equal(nodes.some(node => ["website-url", "accessibility-notes", "circle-directory-enabled"].includes(node.props.name)), false);
});

test("photo work prevents profile saves and does not depend on removed sharing controls", async () => {
  const view = await profileFixture();
  let nodes = elements(view.render());
  assert.equal(nodes.find(node => node.type === Photo).props.enabled, true);
  nodes.find(node => node.type === Photo).props.onBusyChange(true);
  nodes = elements(view.render());
  assert.equal(nodes.find(node => node.type === "fieldset").props.disabled, true);
  assert.equal(nodes.find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
  nodes.find(node => node.type === Photo).props.onBusyChange(false);
  nodes = elements(view.render());
  assert.equal(nodes.find(node => node.type === "fieldset").props.disabled, false);
});
