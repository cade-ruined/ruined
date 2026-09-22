import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react/jsx-runtime") return require(name);
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error(`Unexpected portrait dependency: ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}

function portraitFixture() {
  const slots = [];
  let index = 0, changed = false, contextValue = null;
  const hooks = {
    ...React,
    useState(initial) {
      const key = index++;
      if (!(key in slots)) slots[key] = typeof initial === "function" ? initial() : initial;
      return [slots[key], (next) => {
        const value = typeof next === "function" ? next(slots[key]) : next;
        changed ||= value !== slots[key];
        slots[key] = value;
      }];
    },
    useContext: () => contextValue,
    useCallback: callback => callback,
    useMemo: callback => callback(),
  };
  const portrait = load("src/components/membership/MemberPortraitState.tsx", { react: hooks });
  const children = React.createElement("form", { "data-draft": "Unfinished profile" });
  function render(ownerId) {
    let tree;
    let renders = 0;
    do {
      assert.ok(renders++ < 5, "owner change must settle without a render loop");
      index = 0; changed = false;
      tree = portrait.default({ ownerId, children });
    } while (changed);
    contextValue = tree.props.value;
    assert.equal(tree.props.children, children, "portrait updates must preserve the exact child subtree");
    return tree;
  }
  return { render, read: portrait.useMemberPortrait, outside: () => { contextValue = null; } };
}

const first = "/api/member-photos/member-a/first.webp";
const saved = "/api/member-photos/member-a/saved.webp";
const other = "/api/member-photos/member-b/current.webp";

test("portrait updates override cached route props, and removal is distinct from no override", () => {
  const fixture = portraitFixture();
  fixture.render("owner-a");
  assert.equal(fixture.read(null).avatarUrl, null);
  fixture.read(null).setAvatarUrl(first);
  fixture.render("owner-a");
  fixture.read(first).setAvatarUrl(saved);
  fixture.render("owner-a");
  assert.equal(fixture.read(null).avatarUrl, saved, "returning to an old home without a photo shows the saved portrait");
  assert.equal(fixture.read(first).avatarUrl, saved, "returning to an old uploader also shows the saved portrait");
  fixture.read(first).setAvatarUrl(null);
  fixture.render("owner-a");
  assert.equal(fixture.read(saved).avatarUrl, null, "cached pages cannot restore a removed photo");
});

test("a genuinely new server photo is not overwritten by a local mutation against an older snapshot", () => {
  const fixture = portraitFixture();
  fixture.render("owner-a");
  fixture.read(first).setAvatarUrl(saved);
  fixture.render("owner-a");
  const newer = "/api/member-photos/member-a/newer-device.webp";
  assert.equal(fixture.read(newer).avatarUrl, newer);
  assert.equal(fixture.read(first).avatarUrl, saved);
  fixture.read(newer).setAvatarUrl(null);
  fixture.render("owner-a");
  assert.equal(fixture.read(newer).avatarUrl, null);
  assert.equal(fixture.read(first).avatarUrl, null);
  assert.equal(fixture.read(saved).avatarUrl, null);
});

test("verified owner switches clear the override and ignore late callbacks from every prior account scope", () => {
  const fixture = portraitFixture();
  fixture.render("owner-a");
  const priorSetter = fixture.read(first).setAvatarUrl;
  priorSetter(saved);
  fixture.render("owner-a");
  fixture.render("owner-b");
  assert.equal(fixture.read(other).avatarUrl, other);
  priorSetter(first);
  fixture.render("owner-b");
  assert.equal(fixture.read(other).avatarUrl, other);
  fixture.render("owner-a");
  priorSetter(saved);
  fixture.render("owner-a");
  assert.equal(fixture.read(first).avatarUrl, first, "returning to the first account cannot revive an earlier scope");
  fixture.read(first).setAvatarUrl(saved);
  fixture.render("owner-a");
  assert.equal(fixture.read(first).avatarUrl, saved, "the current account can still publish a new success");
});

test("unverified, standalone and independent provider instances never share portrait overrides", () => {
  const firstView = portraitFixture(), secondView = portraitFixture();
  firstView.render("owner-a");
  assert.equal(firstView.read(null).ownerId, "owner-a");
  firstView.read(null).setAvatarUrl(saved);
  firstView.render("owner-a");
  secondView.render("owner-a");
  assert.equal(secondView.read(first).avatarUrl, first);
  firstView.render(undefined);
  assert.equal(firstView.read(null).ownerId, undefined);
  firstView.read(null).setAvatarUrl(saved);
  firstView.render(undefined);
  assert.equal(firstView.read(null).avatarUrl, null);
  firstView.render("owner-a");
  assert.equal(firstView.read(first).avatarUrl, first);
  firstView.outside();
  firstView.read(first).setAvatarUrl(saved);
  assert.equal(firstView.read(first).avatarUrl, first);
});

test("home consumes the portrait override without mutating its cached member or changing the empty-photo link", () => {
  const fixture = portraitFixture();
  fixture.render("owner-a");
  const Image = () => null, Link = () => null;
  const home = load("src/components/platform/MemberHome.tsx", {
    react: { ...React, useState: value => [value, () => {}], useRef: value => ({ current: value }), useId: () => "test", useEffect: () => {} },
    "next/image": Image,
    "next/link": Link,
    "@/components/membership/MemberJournal": () => null,
    "@/components/membership/MemberPortraitState": { useMemberPortrait: fixture.read },
    "@/lib/membership/access-policy": { memberCan: () => false },
    "@/lib/membership/member-number": { memberTier: () => null },
    "./MemberProfile.module.css": {},
  }).default;
  const member = { avatarUrl: null, displayName: "Member", profile: {}, identity: { standingState: "active" }, nextAction: { kind: "explore" } };
  const before = JSON.stringify(member);
  const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  function photo() {
    const tree = home({ member });
    return nodes(tree).find(node => node.type === "figure");
  }
  assert.ok(nodes(photo()).find(node => node.type === Link && node.props["aria-label"] === "Add your profile photo"));
  fixture.read(null).setAvatarUrl(saved);
  fixture.render("owner-a");
  const filled = nodes(photo());
  assert.equal(filled.find(node => node.type === Image).props.src, saved);
  assert.equal(filled.find(node => node.type === "figcaption").props.children, "the ruined project");
  assert.equal(filled.some(node => node.type === Link), false);
  fixture.read(saved).setAvatarUrl(null);
  fixture.render("owner-a");
  assert.equal(nodes(photo()).find(node => node.type === "figcaption").props.children, "Add your photo");
  assert.equal(JSON.stringify(member), before);
});

test("layout scopes portrait memory to verified members inside session recovery and outside every page shell", async () => {
  const Session = () => null, Portrait = () => null, Draft = () => null, JournalDraft = () => null, Shell = () => null;
  for (const status of ["authenticated", "signed_out", "unavailable"]) {
    const layout = load("app/my/layout.tsx", {
      "next/navigation": { notFound: () => assert.fail("member area is visible") },
      "next/headers": {},
      "@/components/membership/MemberPreviewSwitcher": () => null,
      "@/lib/membership/preview-scenarios": {},
      "@/components/membership/MemberJourneyShell": Shell,
      "@/components/membership/MemberSessionContinuity": Session,
      "@/components/membership/MemberPortraitState": Portrait,
      "@/components/membership/MemberTimelineDraftState": Draft,
      "@/components/membership/MemberJournalDraftState": JournalDraft,
      "@/lib/auth/session": { resolveCurrentPlatformSession: async () => ({ status, viewer: { authUserId: "verified-owner", email: "private@example.test" } }) },
      "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
      "@/lib/platform/repository": { getOperatorRole: async () => null },
      "@/lib/platform/visibility": { isMyRuinedVisible: () => true },
      "@/lib/sharing": { privateSharingMetadata: {} },
    }).default;
    const tree = await layout({ children: "page" });
    assert.equal(tree.type, Session);
    const portrait = tree.props.children;
    assert.equal(portrait.type, Portrait);
    assert.equal(portrait.props.ownerId, status === "authenticated" ? "verified-owner" : undefined);
    assert.equal(portrait.props.children.type, Draft);
    assert.equal(portrait.props.children.props.ownerId, status === "authenticated" ? "verified-owner" : undefined);
    assert.equal(portrait.props.children.props.temporarilyUnavailable, status === "unavailable");
    const journalDraft = portrait.props.children.props.children;
    assert.equal(journalDraft.type, JournalDraft);
    assert.equal(journalDraft.props.ownerId, status === "authenticated" ? "verified-owner" : undefined);
    assert.equal(journalDraft.props.temporarilyUnavailable, status === "unavailable");
    assert.equal(journalDraft.props.children.type, Shell);
    assert.equal(Object.hasOwn(portrait.props, "email"), false);
  }
});
