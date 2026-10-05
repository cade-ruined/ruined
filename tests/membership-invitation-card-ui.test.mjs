import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function load(path, dependencies = {}, globals = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), compiled)(name => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const Card = () => null;
const nodes = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(nodes)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join("") : typeof node === "string" ? node : "";

async function fixture(withObserver = true, archiveShadow = null, props = {}) {
  let cursor = 0;
  const state = [], observers = [], effects = [];
  const react = { ...React, useContext: () => archiveShadow,
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
    useEffect(fn) { cursor++; effects.push(fn); },
  };
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.disconnects = 0; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnects++; }
  }
  const component = (await load("src/components/public-members/MembershipInvitationCard.tsx", { react, "next/dynamic": () => Card }, { IntersectionObserver: withObserver ? Observer : undefined })).default;
  const render = () => { cursor = 0; return component(props); };
  const initial = render(); const element = {}; initial.props.ref.current = element;
  const cleanups = effects.splice(0).map(effect => effect());
  const cleanup = () => cleanups.forEach(fn => fn?.());
  return { initial, render, observer: observers[0], element, cleanup };
}

test("the landing invitation loads only when near the reader and never fabricates issued identity or expiry", async () => {
  const f = await fixture();
  assert.equal(nodes(f.initial).some(node => node.type === Card), false);
  assert.equal(f.observer.element, f.element);
  f.observer.callback([{ isIntersecting: false }]);
  assert.equal(nodes(f.render()).some(node => node.type === Card), false);
  f.observer.callback([{ isIntersecting: true }]);
  const card = nodes(f.render()).find(node => node.type === Card);
  assert.equal(card.props.variant, "invitation");
  assert.equal(card.props.invitationSource, "ruined_direct");
  assert.equal(card.props.embedded, true);
  assert.equal(card.props.card.name, "The Ruined Project");
  assert.equal(card.props.card.memberTag, null);
  assert.equal(card.props.card.memberSince, null);
  assert.equal(card.props.invitationExpiresAt, undefined);
  assert.equal(card.props.invitationRecipientName, null);
  assert.equal(f.observer.disconnects, 1);
  f.cleanup(); assert.equal(f.observer.disconnects, 2);
});

test("older browsers without visibility observers still receive the interactive invitation", async () => {
  const f = await fixture(false);
  assert.ok(nodes(f.render()).some(node => node.type === Card));
});

test("embedded cards retain flip and pause controls without the full card-page chrome", async () => {
  const state = []; let cursor = 0;
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useId: () => "embedded-card", useEffect() {}, useCallback: fn => fn,
  };
  const model = await load("src/lib/membership/public-card-model.ts");
  const component = (await load("src/components/membership/card/MemberCard.tsx", {
    react, "next/dynamic": () => Card, "@/lib/membership/public-card-model": model,
    "./card-artwork": {}, "@/lib/membership/invitation-expiry": { memberInvitationDeadline: () => null }, "./AmbientParticles": Card,
  })).default;
  const props = { embedded: true, variant: "invitation", invitationSource: "ruined_direct", card: { name: "The Ruined Project", labels: [], memberTag: null } };
  const render = () => { cursor = 0; return component(props); };
  let tree = render();
  assert.equal(tree.props["data-card-side"], "front");
  assert.deepEqual(nodes(tree).filter(node => node.type === "button").map(text), ["Flip", "Pause motion"]);
  assert.equal(nodes(tree).some(node => node.type === "details"), false);
  nodes(tree).find(node => node.type === "button" && text(node) === "Flip").props.onClick();
  tree = render(); assert.equal(tree.props["data-card-side"], "back");
  nodes(tree).find(node => node.type === "button" && text(node) === "Pause motion").props.onClick();
  tree = render(); assert.equal(tree.props["data-card-renderer"], "flat");
  assert.ok(nodes(tree).some(node => node.type === "button" && text(node) === "Resume motion"));
  nodes(tree).find(node => node.type === "button" && text(node) === "Flip").props.onClick();
  assert.equal(render().props["data-card-side"], "front", "still rendering remains flippable");
});

test("server fallback is a readable brand invitation with no fabricated sender or deadline", async () => {
  const component = (await load("src/components/public-members/MembershipInvitationCard.tsx", { react: React, "next/dynamic": () => Card })).default;
  const html = renderToStaticMarkup(React.createElement(component));
  assert.match(html, /Ruined invitation/);
  assert.match(html, /You’re allowed/);
  assert.match(html, /to become someone new/);
  assert.doesNotMatch(html, /VALID UNTIL|Cade|Cherry Hill|Read invitation|Save image/);
});


test("a room-bound invitation uses the original archive lights and projects onto its containing room", async () => {
  const updateShadow = () => {};
  const f = await fixture(false, updateShadow);
  const card = nodes(f.render()).find(node => node.type === Card);
  assert.equal(card.props.archive, true);
  assert.equal(card.props.onArchiveShadow, updateShadow);
});

test("the basement wrapper renders the exact room image and keeps its children in the room", async () => {
  const { MembershipInvitationRoom } = await load("src/components/public-members/MembershipInvitationCard.tsx", { react: React, "next/dynamic": () => Card });
  const html = renderToStaticMarkup(React.createElement(MembershipInvitationRoom, { className: "full-width-band" }, React.createElement("form", null, "Register")));
  assert.match(html, /data-archive-room/);
  assert.match(html, /archive-room-v1\.webp/);
  assert.match(html, /class="room full-width-band"/);
  assert.match(html, /<form>Register<\/form>/);
  assert.match(html, /<polygon/);
  assert.doesNotMatch(html, /Share card|MEMBERS’ ARCHIVE|fixed/);
});

for (const frameToCard of [false, true]) test(frameToCard
  ? "card-framed basement scenery remains beneath the card on mobile and desktop with a long pricing panel"
  : "stacked basement scenery ends below the card while desktop defaults to the complete room", async () => {
  let cursor = 0, callback;
  const slots = [], effects = [], properties = new Map(), observed = new Set();
  const media = { matches: true,
    addEventListener(name, listener) { assert.equal(name, "change"); callback = listener; },
    removeEventListener(name, listener) { assert.equal(name, "change"); assert.equal(listener, callback); callback = null; },
  };
  let roomBounds = { width: 390, height: 1704, top: 200 };
  let cardBounds = { bottom: 900 };
  const card = { getBoundingClientRect: () => cardBounds };
  const element = { getBoundingClientRect: () => roomBounds,
    querySelector(selector) { assert.equal(selector, "[data-membership-invitation-preview]"); return card; },
    style: { setProperty(name, value) { properties.set(name, value); } },
  };
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect) { cursor++; effects.push(effect); },
    useCallback: fn => fn,
  };
  const { MembershipInvitationRoom } = await load("src/components/public-members/MembershipInvitationCard.tsx", { react, "next/dynamic": () => Card }, {
    window: { matchMedia: query => { assert.equal(query, "(max-width: 759px)"); return media; } },
    IntersectionObserver: undefined,
    ResizeObserver: class { observe(target) { observed.add(target); } disconnect() { observed.clear(); } },
  });
  const render = () => { cursor = 0; return MembershipInvitationRoom({ children: "Signup", frameToCard }); };
  const initial = render();
  nodes(initial).find(node => "data-archive-room" in node.props).props.ref.current = element;
  const cleanup = effects.splice(0).map(effect => effect());
  assert.equal(properties.get("--membership-room-height"), "732px");
  assert.ok(observed.has(card), "card sizing changes must remeasure the surface");
  assert.ok(observed.has(element));
  assert.match(nodes(render()).find(node => node.type === "img").props.src, /portrait/);
  assert.ok(nodes(render()).some(node => "data-archive-room-surface" in node.props));

  roomBounds = { ...roomBounds, height: 2400 }; callback();
  assert.equal(properties.get("--membership-room-height"), "732px", "longer signup content cannot pull the lamp/table below the card");
  cardBounds = { bottom: 940 }; callback();
  assert.equal(properties.get("--membership-room-height"), "772px");

  roomBounds = { width: 1440, height: 980, top: 200 }; media.matches = false; callback();
  assert.equal(properties.get("--membership-room-height"), frameToCard ? "772px" : "980px", "desktop card framing is opt-in");
  assert.doesNotMatch(nodes(render()).find(node => node.type === "img").props.src, /portrait/);
  roomBounds = { ...roomBounds, height: 2400 }; callback();
  assert.equal(properties.get("--membership-room-height"), frameToCard ? "772px" : "2400px", "only an explicitly card-framed desktop room stays independent of long pricing content");
  cardBounds = { bottom: 1100 }; callback();
  assert.equal(properties.get("--membership-room-height"), frameToCard ? "932px" : "2400px", "the framed desktop surface follows card geometry changes");
  cleanup.forEach(fn => fn?.());
  assert.equal(callback, null); assert.equal(observed.size, 0);
});


test("issued landing cards preserve the inviter, recipient and original deadline in the spinning renderer", async () => {
  const identity = { name: "Cade <Sender>", memberTag: "cade", wearSeed: "inviter-wear", labels: [] };
  const props = { card: identity, recipientName: "Alex Recipient", invitationSource: "member", expiresAt: "2099-01-01T12:00:00Z" };
  const f = await fixture(false, null, props);
  const card = nodes(f.render()).find(node => node.type === Card);
  assert.equal(card.props.card, identity);
  assert.equal(card.props.invitationRecipientName, props.recipientName);
  assert.equal(card.props.invitationSource, "member");
  assert.equal(card.props.invitationExpiresAt, props.expiresAt);
  assert.equal(card.props.embedded, true);
});

test("personal spinning cards preserve a null deadline instead of inventing a date", async () => {
  const identity = { name: "Cade", memberTag: "cade", wearSeed: "inviter-wear", labels: [] };
  const f = await fixture(false, null, { card: identity, recipientName: "Alex Recipient", invitationSource: "member", expiresAt: null });
  const card = nodes(f.render()).find(node => node.type === Card);
  assert.equal(card.props.invitationExpiresAt, null);
  assert.equal(card.props.invitationRecipientName, "Alex Recipient");
  assert.equal(card.props.card, identity);
});

test("member card accessible copy omits missing deadlines while unissued Ruined Direct cards keep their 48-hour description", async () => {
  const model = await load("src/lib/membership/public-card-model.ts");
  const expiry = await load("src/lib/membership/invitation-expiry.ts");
  const component = (await load("src/components/membership/card/MemberCard.tsx", {
    react: React, "next/dynamic": () => Card, "@/lib/membership/public-card-model": model,
    "./card-artwork": {}, "@/lib/membership/invitation-expiry": expiry, "./AmbientParticles": Card,
  })).default;
  for (const embedded of [false, true]) {
    const props = { embedded, variant: "invitation", invitationExpiresAt: null, invitationRecipientName: "Alex", card: { name: "Cade", labels: [], memberTag: "cade" } };
    const personal = renderToStaticMarkup(React.createElement(component, { ...props, invitationSource: "member" }));
    assert.doesNotMatch(personal, /Valid until|Valid for 48 hours|1970/);
    const direct = renderToStaticMarkup(React.createElement(component, { ...props, invitationSource: "ruined_direct" }));
    assert.match(direct, /Valid for 48 hours once created/);
    const finite = renderToStaticMarkup(React.createElement(component, { ...props, invitationSource: "ruined_direct", invitationExpiresAt: "2099-01-01T12:00:00Z" }));
    assert.match(finite, /Valid until/);
    assert.doesNotMatch(finite, /Valid for 48 hours once created/);
  }
});
