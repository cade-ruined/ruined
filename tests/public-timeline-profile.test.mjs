import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
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

test("Circle public profile links resolve a full roster in one read with canonical legacy fallbacks", async t => {
  const f = await publicJournalFixture(t);
  let profileQueries = 0;
  f.setAfterQuery(query => { if (query.includes("select member.id as member_id")) profileQueries++; });
  const links = await f.cardRepository.getPublicMemberProfileLinks([
    timelineIds.member, timelineIds.otherMember, timelineIds.member,
    randomUUID(), "shared_tag", `member:${timelineIds.member}`, "not-a-member",
  ]);
  assert.deepEqual(links, new Map([
    [timelineIds.member, "/profile/shared_tag"],
    [timelineIds.otherMember, "/profile/other_tag"],
  ]));
  assert.equal(profileQueries, 1, "One profile read serves the entire roster.");
  assert.doesNotMatch(JSON.stringify([...links]), /PRIVATE|email|phone|location|building|avatar/);

  await f.db.query("update person_profiles set member_tag=null");
  await f.db.query("delete from member_public_cards where member_id=$1", [timelineIds.otherMember]);
  assert.deepEqual(await f.cardRepository.getPublicMemberProfileLinks([timelineIds.member, timelineIds.otherMember]), new Map([
    [timelineIds.member, `/profile/${f.token}`],
    [timelineIds.otherMember, `/profile/${timelineIds.otherMember}`],
  ]), "Tagless members retain existing token or real member UUID links without enabling cards.");
  assert.equal((await f.db.query("select count(*)::int n from member_public_cards where public_enabled")).rows[0].n, 0);
  const queriesBeforeEmpty = profileQueries;
  assert.deepEqual(await f.cardRepository.getPublicMemberProfileLinks([]), new Map());
  assert.deepEqual(await f.cardRepository.getPublicMemberProfileLinks(["shared_tag", `member:${timelineIds.member}`]), new Map());
  assert.equal(profileQueries, queriesBeforeEmpty, "Empty or invalid member-ID lists do not query profiles.");
});

test("profile identity excludes inactive members and never falls back to private contact details", async t => {
  const f = await publicJournalFixture(t);
  await f.db.query("update person_profiles set display_name=null,preferred_name=null where person_id=$1",[timelineIds.person]);
  assert.equal((await f.cardRepository.getPublicMemberProfile("shared_tag")).name,"Member");
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1",[timelineIds.auth]);
  assert.equal(await f.cardRepository.getPublicMemberProfile("shared_tag"),null);
});

test("released completed members can publish their profile and Timeline without a collectible-card activation date", async t => {
  const f = await publicJournalFixture(t);
  await f.enable();
  await f.db.query("update ruined_members set membership_activated_at=null where id=$1", [timelineIds.member]);
  await f.db.query("insert into member_registration_access(member_id,profile_activated_at) values($1,now())", [timelineIds.member]);
  const privateEntry = await f.journal.createJournalEntry(timelineIds.auth, {
    id: randomUUID(), kind: "text", title: "PRIVATE JOURNAL", body: "PRIVATE BODY", mediaIds: [],
    visibility: "private", includeOnTimeline: true, eventYear: 2002,
  });
  for (const scenario of [
    { name: "released funded onboarding member", program: "onboarding", billing: "pending", operator: true, complimentary: true },
    { name: "complimentary member", program: "active", billing: "pending", operator: false, complimentary: true },
    { name: "self-paid member", program: "active", billing: "active", operator: false, complimentary: false },
  ]) {
    await f.db.query("update member_lifecycle set program_state=$2,billing_state=$3 where member_id=$1", [timelineIds.member, scenario.program, scenario.billing]);
    await f.db.query("delete from platform_role_grants where auth_user_id=$1 and role_slug='ops_admin'", [timelineIds.auth]);
    await f.db.query("delete from member_complimentary_grants where member_id=$1", [timelineIds.member]);
    if (scenario.operator) await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [timelineIds.auth]);
    if (scenario.complimentary) await f.db.query("insert into member_complimentary_grants(member_id) values($1)", [timelineIds.member]);
    assert.deepEqual(await f.cardRepository.getPublicMemberProfile("shared_tag"), {
      name: "Shared name", memberTag: "shared_tag", bio: "PUBLIC BIO", memberNumber: null,
    }, scenario.name);
    assert.equal((await f.cardRepository.getPublicMemberProfileLinks([timelineIds.member])).get(timelineIds.member), "/profile/shared_tag", scenario.name);
    const entry = await f.journal.createJournalEntry(timelineIds.auth, {
      id: randomUUID(), kind: "text", title: "", body: scenario.name, mediaIds: [], visibility: "public", includeOnTimeline: true,
    });
    const feed = await f.visitor.getPublicJournal("shared_tag");
    assert.ok(feed.entries.some(item => item.id === entry.id), scenario.name);
    assert.equal(feed.entries.some(item => item.id === privateEntry.id), false);
    assert.doesNotMatch(JSON.stringify(feed), /PRIVATE/);
    assert.equal((await f.journal.getJournal(timelineIds.auth)).publicUrl, "/profile/shared_tag");
    assert.equal(await f.cardRepository.getPublicMemberCard(f.token), null, "Collectible cards still require an activation date.");
  }
  const before = await f.cardRepository.getPublicMemberProfile("shared_tag");
  await f.db.query("update ruined_members set membership_activated_at='2200-01-01' where id=$1", [timelineIds.member]);
  assert.deepEqual(await f.cardRepository.getPublicMemberProfile("shared_tag"), before, "A future card date cannot hide an otherwise eligible profile.");
  assert.ok((await f.visitor.getPublicJournal("shared_tag")).entries.length);
  assert.equal(await f.cardRepository.getPublicMemberCard(f.token), null, "A future activation date still cannot publish a collectible card.");
});

test("profile eligibility keeps incomplete, suspended, ended, unreleased and removed members private", async t => {
  const f = await publicJournalFixture(t);
  await f.db.query("update ruined_members set membership_activated_at=null where id=$1", [timelineIds.member]);
  const denied = async message => {
    assert.equal(await f.cardRepository.getPublicMemberProfile("shared_tag"), null, message);
    assert.equal(await f.cardRepository.getOwnMemberProfilePublicScope(timelineIds.member), null, message);
    assert.equal(await f.visitor.getPublicJournal("shared_tag"), null, message);
    assert.deepEqual(await f.cardRepository.getPublicMemberProfileLinks([timelineIds.member, timelineIds.otherMember]),
      new Map([[timelineIds.otherMember, "/profile/other_tag"]]), message);
  };
  for (const assignment of [
    "account_state='provisional'", "account_state='invited'", "account_state='suspended'", "account_state='closed'",
    "administrative_onboarding_state='not_started'", "administrative_onboarding_state='in_progress'",
    "billing_state='pending'", "billing_state='attention_required'", "billing_state='ended'",
    "program_state='offboarded'", "standing_state='pre_active'", "standing_state='paused'",
    "standing_state='inactive'", "standing_state='alumni'",
    "standing_state='cancellation_requested',cancellation_effective_at=null",
    "standing_state='cancellation_requested',cancellation_effective_at='2000-01-01'",
  ]) {
    await f.db.query(`update member_lifecycle set ${assignment} where member_id=$1`, [timelineIds.member]);
    await denied(assignment);
    await f.db.query("update member_lifecycle set account_state='active',administrative_onboarding_state='completed',billing_state='active',program_state='active',standing_state='active',cancellation_effective_at=null where member_id=$1", [timelineIds.member]);
  }
  await f.db.query("insert into member_registration_access(member_id,profile_activated_at) values($1,null)", [timelineIds.member]);
  await denied("registration hold");
  await f.db.query("update member_registration_access set profile_activated_at=now() where member_id=$1", [timelineIds.member]);
  await f.db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [timelineIds.auth]);
  await denied("revoked member role");
  await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [timelineIds.auth]);
  await f.db.query("update platform_users set status='inactive' where auth_user_id=$1", [timelineIds.auth]);
  await denied("inactive platform user");
  await f.db.query("update platform_users set status='active' where auth_user_id=$1", [timelineIds.auth]);
  await f.db.query("update ruined_members set deleted_at=now() where id=$1", [timelineIds.member]);
  await denied("removed member");
});

test("profile media without card activation still requires public Timeline consent and current membership", async t => {
  const f = await publicJournalFixture(t);
  await f.db.query("update ruined_members set membership_activated_at=null where id=$1", [timelineIds.member]);
  const entry = randomUUID(), media = randomUUID(), path = `${timelineIds.member}/verified/${media}.webp`;
  await f.db.query("insert into member_journal_entries(id,member_id,kind,title,event_year,visibility,include_on_timeline) values($1,$2,'images','Photo',2024,'public',true)", [entry, timelineIds.member]);
  await f.db.query("insert into member_journal_media(id,member_id,entry_id,storage_path,mime_type,byte_size,verified_at,state) values($1,$2,$3,$4,'image/webp',8,now(),'ready')", [media, timelineIds.member, entry, path]);
  f.blobs.set(path, new Blob(["photo123"], { type: "image/webp" }));
  assert.equal((await f.visitor.getPublicJournalMedia("shared_tag", media)).mimeType, "image/webp");
  await f.db.query("update member_journal_entries set visibility='private' where id=$1", [entry]);
  assert.equal(await f.visitor.getPublicJournalMedia("shared_tag", media), null);
  await f.db.query("update member_journal_entries set visibility='public',include_on_timeline=false where id=$1", [entry]);
  assert.equal(await f.visitor.getPublicJournalMedia("shared_tag", media), null);
  await f.db.query("update member_journal_entries set include_on_timeline=true where id=$1", [entry]);
  f.setStorageHook(() => f.db.query("insert into member_registration_access(member_id,profile_activated_at) values($1,null)", [timelineIds.member]));
  assert.equal(await f.visitor.getPublicJournalMedia("shared_tag", media), null, "A registration hold during download discards media bytes.");
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
