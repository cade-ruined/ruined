import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const token = "x".repeat(43);
const card = { name: "Shared name", memberTag: "member", avatarUrl: null, bio: null, labels: [], memberSince: null, location: null, buildingNow: null, websiteUrl: null, wearSeed: "fixture" };
const badge = { key: "early-supporter", label: "I Was Here", description: "Activated an early membership.", earnedAt: "2026-09-30T12:00:00.000Z" };
function load(path, dependencies = {}, fetchOverride) {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "fetch", output)(name => {
    if (name === "server-only") return {};
    if (name in dependencies) return dependencies[name];
    if (["react", "react/jsx-runtime"].includes(name)) return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  }, loaded, loaded.exports, fetchOverride);
  return loaded.exports;
}
function repository({ scopes = [{ memberId: "owner", version: 1 }, { memberId: "owner", version: 1 }], publicCard = card, awards = [badge] } = {}) {
  const calls = [];
  return { calls, ...load("src/lib/membership/public-badge-repository.ts", {
    "./public-card-model": { MEMBER_CARD_TOKEN: /^[A-Za-z0-9_-]{43}$/ },
    "./public-card-repository": {
      getPublicMemberCardScope: async value => { assert.equal(value, token); calls.push("scope"); return scopes.shift() ?? null; },
      getPublicMemberCard: async value => { assert.equal(value, token); calls.push("card"); return publicCard; },
    },
    "./badge-repository": { getMemberBadges: async id => { assert.equal(id, "owner"); calls.push("badges"); return awards; } },
  }) };
}

test("public badge projection never reads awards before a current shared-profile scope", async () => {
  const invalid = repository();
  assert.equal(await invalid.getPublicMemberTimelineProfile("guess"), null);
  assert.deepEqual(invalid.calls, []);
  const hidden = repository({ scopes: [null] });
  assert.equal(await hidden.getPublicMemberTimelineProfile(token), null);
  assert.deepEqual(hidden.calls, ["scope"]);
});

test("public Timeline retains withheld profile fields and exposes badge display fields only", async () => {
  const f = repository({ awards: [{ ...badge, sourceInvoiceId: "private-invoice", verifiedEmail: "private@example.test", memberId: "owner" }] });
  const result = await f.getPublicMemberTimelineProfile(token);
  assert.deepEqual(result, { card, badges: [badge] });
  assert.equal(result.card.avatarUrl, null);
  assert.equal(result.card.bio, null);
  assert.deepEqual(f.calls, ["scope", "badges", "card", "scope"]);
});

test("consent-filtered profile reads wait until slow badge loading has finished", async () => {
  let finishBadges;
  const awards = new Promise(resolve => { finishBadges = resolve; });
  const f = repository({ awards });
  const pending = f.getPublicMemberTimelineProfile(token);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ["scope", "badges"]);
  finishBadges([badge]);
  assert.deepEqual(await pending, { card, badges: [badge] });
  assert.deepEqual(f.calls, ["scope", "badges", "card", "scope"]);
});

test("withdrawal, changed sharing choices, or a changed member during badge reads discard the whole profile", async () => {
  for (const current of [null, { memberId: "owner", version: 2 }, { memberId: "other", version: 1 }]) {
    const f = repository({ scopes: [{ memberId: "owner", version: 1 }, current] });
    assert.equal(await f.getPublicMemberTimelineProfile(token), null);
  }
});

const Image = ({ src, alt }) => React.createElement("img", { src, alt });
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const Badges = ({ badges }) => React.createElement("div", { "data-badge-dock": true }, badges.map(item => React.createElement("span", { key: item.key }, item.label)));
const css = new Proxy({}, { get: (_, key) => key });
const dependencies = { "next/image": Image, "next/link": Link, "./MemberBadges": Badges, "./PublicJournal.module.css": css };

test("visitor Timeline displays only supplied public photo and bio, with the earned badge dock and no messaging invention", () => {
  const Component = load("src/components/membership/PublicJournal.tsx", dependencies).default;
  const props = { token, identity: { ...card, avatarUrl: "/public-photo.webp", bio: "A shared bio." }, badges: [badge] };
  const html = renderToStaticMarkup(React.createElement(Component, props));
  assert.match(html, />Timeline<\/h2>/);
  assert.match(html, /public-photo.webp/);
  assert.match(html, /A shared bio\./);
  assert.match(html, /data-badge-dock/);
  assert.match(html, /I Was Here/);
  assert.doesNotMatch(html, /mailto:|chat.google|Message|>Journal<\/h2>/);
  const withheld = renderToStaticMarkup(React.createElement(Component, { token, identity: card, badges: [] }));
  assert.doesNotMatch(withheld, /<img|A shared bio|data-badge-dock/);
});

test("visitor profile and badges disappear when the feed reports withdrawn sharing", async () => {
  const slots = []; let cursor = 0, effects = [];
  const react = {
    ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) { slots[index] = deps; effects.push(effect); } },
  };
  const Component = load("src/components/membership/PublicJournal.tsx", { ...dependencies, react }, async () => ({ status: 404 })).default;
  const props = { token, identity: { ...card, bio: "A shared bio." }, badges: [badge] };
  const render = () => { cursor = 0; return Component(props); };
  render(); const cleanup = effects.map(effect => effect()); effects = [];
  await new Promise(resolve => setImmediate(resolve));
  const html = renderToStaticMarkup(render());
  assert.match(html, /This Timeline is not being shared/);
  assert.doesNotMatch(html, /Shared name|A shared bio|I Was Here|data-badge-dock/);
  cleanup.forEach(fn => fn?.());
});

test("public card links to its token-scoped Timeline and the visitor route passes only public profile data", async () => {
  const Room = () => null;
  const notFound = () => { throw new Error("not found"); };
  const CardPage = load("app/card/[token]/page.tsx", {
    "next/link": Link, "next/navigation": { notFound },
    "@/lib/membership/public-card-model": { MEMBER_CARD_TOKEN: /^[A-Za-z0-9_-]{43}$/, publicMemberCardIdentity: item => item.name },
    "@/lib/membership/public-card-repository": { getPublicMemberCard: async () => card },
    "@/components/membership/card/PublicMemberCardPage": Room,
  }).default;
  const cardPage = await CardPage({ params: Promise.resolve({ token }) });
  assert.equal(cardPage.props.footerActions.props.href, `/journal/${token}`);
  assert.equal(cardPage.props.footerActions.props.children, "View Timeline ↗");
  const Timeline = () => null;
  const route = load("app/journal/[token]/page.tsx", {
    "next/navigation": { notFound }, "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/membership/public-card-model": { MEMBER_CARD_TOKEN: /^[A-Za-z0-9_-]{43}$/ },
    "@/lib/membership/public-badge-repository": { getPublicMemberTimelineProfile: async () => ({ card, badges: [badge] }) },
    "@/components/membership/PublicJournal": Timeline,
  });
  const rendered = await route.default({ params: Promise.resolve({ token }) });
  assert.deepEqual(rendered.props.identity, { name: card.name, memberTag: card.memberTag, avatarUrl: null, bio: null, labels: [] });
  assert.deepEqual(rendered.props.badges, [badge]);
  assert.equal(route.metadata.title, "Timeline / Ruined");
  assert.deepEqual(route.metadata.robots, { index: false, follow: false });
});
