import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { publicJournalFixture, timelineIds } from "./helpers/public-journal-fixture.mjs";

const require = createRequire(import.meta.url);
const token = "x".repeat(43);
const card = { name: "Shared name", memberTag: "member", avatarUrl: null, bio: null, labels: [], memberSince: null, location: null, buildingNow: null, websiteUrl: null, wearSeed: "fixture" };
const profile = { name: "Shared name", memberTag: "member", bio: "A public bio.", memberNumber: 17 };
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
test("public profiles exist without card opt-in and expose exactly the fixed public fields", async t => {
  const f = await publicJournalFixture(t);
  await f.db.query("update ruined_members set member_number=17 where id=$1",[timelineIds.member]);
  const expected = { name: "Shared name", memberTag: "shared_tag", bio: "PUBLIC BIO", memberNumber: 17 };
  assert.deepEqual(await f.cardRepository.getPublicMemberProfile(f.token), expected);
  assert.deepEqual(await f.cardRepository.getPublicMemberProfile("shared_tag"), expected);
  assert.deepEqual(await f.cardRepository.getPublicMemberProfile(timelineIds.member), expected);
  assert.doesNotMatch(JSON.stringify(expected), /PRIVATE|email|phone|website|location|building|avatar|personId|memberId/);
  const scope = await f.cardRepository.getOwnMemberProfilePublicScope(timelineIds.member);
  assert.equal(scope.token, "shared_tag");
  assert.equal(await f.cardRepository.getPublicMemberCard(f.token), null, "card opt-in remains independent");
  await f.db.query("delete from member_public_cards where member_id=$1",[timelineIds.member]);
  assert.deepEqual(await f.cardRepository.getPublicMemberProfile("shared_tag"), expected);
  await f.db.query("update person_profiles set member_tag=null where person_id=$1",[timelineIds.person]);
  assert.equal((await f.cardRepository.getOwnMemberProfilePublicScope(timelineIds.member)).token,timelineIds.member);
  assert.equal((await f.cardRepository.getPublicMemberProfile(timelineIds.member)).name,expected.name);
  assert.equal((await f.db.query("select count(*)::int n from member_public_cards where member_id=$1",[timelineIds.member])).rows[0].n,0,"profile GET never creates cards");
});

test("profile identity excludes inactive members and never falls back to private contact details", async t => {
  const f = await publicJournalFixture(t);
  await f.db.query("update person_profiles set display_name=null,preferred_name=null where person_id=$1",[timelineIds.person]);
  assert.equal((await f.cardRepository.getPublicMemberProfile("shared_tag")).name,"Member");
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[timelineIds.auth]);
  assert.equal(await f.cardRepository.getPublicMemberProfile("shared_tag"),null);
});

const Image = ({ src, alt }) => React.createElement("img", { src, alt });
const Link = ({ children, ...props }) => React.createElement("a", props, children);
const css = new Proxy({}, { get: (_, key) => key });
const dependencies = { "next/image": Image, "next/link": Link, "@/lib/membership/member-number": load("src/lib/membership/member-number.ts"), "./PublicJournal.module.css": css };

test("visitor profile displays full name, tag, bio, join number and tier above Timeline", () => {
  const Component = load("src/components/membership/PublicJournal.tsx", dependencies).default;
  const html = renderToStaticMarkup(React.createElement(Component, { token, identity: profile }));
  assert.match(html, />Timeline<\/h2>/);
  assert.match(html, /Shared name/); assert.match(html, /@member/); assert.match(html, /A public bio/);
  assert.match(html, /Originals/); assert.match(html, /0017/);
  assert.doesNotMatch(html, /mailto:|Message|>Journal<\/h2>|Member card|<img/);
});

test("visitor identity disappears when the feed reports unavailable membership", async () => {
  const slots = []; let cursor = 0, effects = [];
  const react = {
    ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) { slots[index] = deps; effects.push(effect); } },
  };
  const Component = load("src/components/membership/PublicJournal.tsx", { ...dependencies, react }, async () => ({ status: 404 })).default;
  const props = { token, identity: profile };
  const render = () => { cursor = 0; return Component(props); };
  render(); const cleanup = effects.map(effect => effect()); effects = [];
  await new Promise(resolve => setImmediate(resolve));
  const html = renderToStaticMarkup(render());
  assert.match(html, /This profile is unavailable/);
  assert.doesNotMatch(html, /Shared name|A public bio|Originals/);
  cleanup.forEach(fn => fn?.());
});

test("public card links to the profile and visitor route passes only fixed public identity", async () => {
  const Room = () => null;
  const notFound = () => { throw new Error("not found"); };
  const CardPage = load("app/card/[token]/page.tsx", {
    "next/link": Link, "next/navigation": { notFound },
    "@/lib/membership/public-card-model": { MEMBER_CARD_TOKEN: /^[A-Za-z0-9_-]{43}$/, publicMemberCardIdentity: item => item.name },
    "@/lib/membership/public-card-repository": { getPublicMemberCard: async () => card },
    "@/components/membership/card/PublicMemberCardPage": Room,
  }).default;
  const cardPage = await CardPage({ params: Promise.resolve({ token }) });
  assert.equal(cardPage.props.footerActions.props.href, `/profile/${token}`);
  assert.equal(cardPage.props.footerActions.props.children, "View profile ↗");
  const Timeline = () => null;
  const route = load("app/journal/[token]/page.tsx", {
    "next/navigation": { notFound }, "@/lib/platform/config": { getPlatformConfiguration: () => ({ mode: "connected" }) },
    "@/lib/membership/public-card-model": { MEMBER_PROFILE_IDENTIFIER: /^[A-Za-z0-9_-]{43}$/ },
    "@/lib/membership/public-badge-repository": { getPublicMemberTimelineProfile: async () => ({ profile }) },
    "@/components/membership/PublicJournal": Timeline,
  });
  const rendered = await route.default({ params: Promise.resolve({ token }) });
  assert.deepEqual(rendered.props.identity, profile);
  assert.equal(route.metadata.title, "Profile / Ruined");
  assert.deepEqual(route.metadata.robots, { index: false, follow: false });
});
