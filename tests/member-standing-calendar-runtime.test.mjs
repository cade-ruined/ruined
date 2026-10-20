import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}, unused = []) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name === "server-only" || unused.includes(name)) return {};
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    throw Error(`Unexpected dependency: ${name}`);
  }, result, result.exports);
  return result.exports;
}

// The two Calendar queries execute in an isolated PostgreSQL engine. Identity
// and standing-invitation policy are separate contracts tested in their suites.
// This fixture never reads an environment file or connects to production.
test("member Calendar and Meet consume standing invitations without creating member reservations", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  const ids = Object.fromEntries(["auth", "member", "person", "circle", "otherCircle", "block", "otherBlock"].map(key => [key, randomUUID()]));
  const identity = { auth_user_id: ids.auth, member_id: ids.member, person_id: ids.person, email: "founder@example.test", account_state: "active", administrative_onboarding_state: "completed", billing_state: "active", program_state: "active", standing_state: "active", foundations_state: "completed", cancellation_effective_at: null, operator_funded: true, complimentary_funded: false, registration_held: false, circle_revealed: true };
  let allowlist = [], standing = true, allowlistChecks = 0, publicEvents = [];
  const publicEvent = { id: "public-call", dateTime: "2100-01-01T22:00:00.000Z", title: "Public call", summary: "Public description", status: "Upcoming", timezone: "America/Denver", location: "Online", registration: { status: "Open", href: "https://example.test/reserve" } };
  const publicSummaries = load("src/lib/events/member-experiences.ts", { "@/data/events": { EVENTS: [publicEvent] } });
  const readQueries = [];
  const sql = async (strings, ...values) => {
    const query = strings.reduce((text, fragment, index) => text + (index ? `$${index}` : "") + fragment, "");
    if (query.includes("platform_user.auth_user_id")) return [identity];
    assert.match(query.trim(), /^with membership_scope/);
    readQueries.push(query);
    return (await db.query(query, values)).rows;
  };
  sql.array = values => `{${values.join(",")}}`;
  const policy = load("src/lib/membership/access-policy.ts");
  const communications = load("src/lib/google/communications.ts");
  const repository = load("src/lib/membership/repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/membership/access-policy": policy,
    "@/lib/events/member-experiences": publicSummaries,
    "@/lib/events/community-event-repository": { getPublicCommunityEvents: async () => publicEvents },
    "@/lib/google/communications": { ...communications, googleCommunicationLivemode: () => false },
    "@/lib/platform/experience-member-access": {
      getEligibleExplicitExperienceInvitationIds: async auth => { assert.equal(auth, ids.auth); allowlistChecks++; return allowlist; },
      memberHasStandingFounderInvitation: async (_tx, member) => { assert.equal(member, ids.member); return standing; },
    },
  }, ["./member-communication-preferences", "./registration-legal", "./registration-repository", "./badge-repository", "libphonenumber-js/min", "@/lib/foundations/availability", "@/lib/membership/artifact-products", "@/lib/membership/avatar-url", "@/lib/membership/phone", "@/lib/membership/member-tag", "@/lib/platform/ops-calendar-repository", "@/lib/platform/calendar-audience-invalidation"]);
  await db.exec(`
    create schema private;
    create function private.ruined_member_circle_is_revealed(uuid) returns boolean language sql as 'select true';
    create table member_lifecycle(member_id uuid primary key,current_progression_level_slug text);
    create table circles(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz);
    create table circle_member_assignments(member_id uuid,circle_id uuid,ended_at timestamptz,assigned_at timestamptz);
    create table block_circle_assignments(circle_id uuid,block_id uuid,ended_at timestamptz);
    create table experiences(id uuid primary key,slug text,kind text,title text,summary text,starts_at timestamptz,ends_at timestamptz,timezone text,location_label text,registration_mode text,registration_opens_at timestamptz,registration_closes_at timestamptz,external_registration_url text,visibility text,status text,circle_id uuid,block_id uuid,progression_level_slug text);
    create table experience_registrations(experience_id uuid,person_id uuid,status text);
    create table integration_entity_links(provider text,local_entity_type text,local_entity_id text,external_entity_type text,livemode boolean,metadata jsonb);
    insert into member_lifecycle values ('${ids.member}','beginning');
    insert into circles values ('${ids.circle}','active','2020-01-01',null);
    insert into circle_member_assignments values ('${ids.member}','${ids.circle}',null,'2020-01-01');
    insert into block_circle_assignments values ('${ids.circle}','${ids.block}',null);
  `);
  const events = {};
  for (const [key, visibility, registration, status] of [
    ["private", "invite_only", "internal", "published"], ["otherCircle", "circle", "internal", "published"],
    ["otherBlock", "block", "internal", "published"], ["progression", "progression", "internal", "published"],
    ["all", "all_members", "internal", "published"], ["past", "invite_only", "internal", "completed"],
    ["draft", "invite_only", "internal", "draft"], ["archived", "invite_only", "internal", "archived"],
  ]) {
    const id = randomUUID(); events[key] = id;
    await db.query(`insert into experiences values ($1,$2,'academy_session',$2,null,$3,null,'America/Denver',null,$4,null,'2020-01-01',null,$5,$6,$7,$8,'advanced')`, [id, key, key === "past" ? "2020-01-01" : "2100-01-01", registration, visibility, status, ids.otherCircle, ids.otherBlock]);
    await db.query(`insert into integration_entity_links values ('google','experience',$1,'meet_space',false,$2)`, [id, JSON.stringify({ meetingUri: "https://meet.google.com/abc-defg-hij" })]);
  }
  allowlist = Object.values(events);
  await t.test("full-access founders see and join every invited audience without reserving a seat", async () => {
    const snapshot = await repository.getMemberExperiences(ids.auth);
    assert.equal(snapshot.access.mode, "full");
    assert.deepEqual(new Set(snapshot.upcoming.map(event => event.id)), new Set([events.private, events.otherCircle, events.otherBlock, events.progression, events.all]));
    assert.deepEqual(snapshot.past.map(event => event.id), [events.past]);
    assert.equal(snapshot.upcoming.find(event => event.id === events.otherCircle).audienceLabel, "Circle call");
    assert.equal(snapshot.upcoming.find(event => event.id === events.otherBlock).audienceLabel, "Block call");
    for (const event of [...snapshot.upcoming, ...snapshot.past]) {
      assert.equal(event.registrationState, "none");
      assert.equal(event.registrationHref, null);
      assert.equal(event.meetingUrl, `/api/my/experiences/${event.id}/join`);
      assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, event.id), "https://meet.google.com/abc-defg-hij");
    }
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.draft), null);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.archived), null);
    assert.ok(allowlistChecks >= 9, "full capability must not skip invitation resolution");
  });
  await t.test("existing founder registrations remain real while direct-join controls do not offer another reservation", async () => {
    await db.query("insert into experience_registrations values ($1,$2,'registered')", [events.private, ids.person]);
    const event = (await repository.getMemberExperiences(ids.auth)).upcoming.find(event => event.id === events.private);
    assert.equal(event.registrationState, "registered");
    assert.equal(event.registrationHref, null);
    assert.ok(event.meetingUrl);
    assert.equal((await db.query("select status from experience_registrations")).rows[0].status, "registered");
    await db.query("delete from experience_registrations");
  });
  await t.test("held founders retain Calendar-only access with direct Join rather than a reserve step", async () => {
    identity.registration_held = true;
    const snapshot = await repository.getMemberExperiences(ids.auth);
    assert.equal(snapshot.access.mode, "entry");
    assert.ok(snapshot.upcoming.some(event => event.id === events.private && event.meetingUrl && !event.registrationHref));
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.otherCircle), "https://meet.google.com/abc-defg-hij");
    identity.registration_held = false;
  });
  await t.test("removing an invitation immediately closes cross-circle Meet access", async () => {
    allowlist = allowlist.filter(id => id !== events.otherCircle);
    assert.ok(!(await repository.getMemberExperiences(ids.auth)).upcoming.some(event => event.id === events.otherCircle));
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.otherCircle), null);
  });
  await t.test("public event merging never reintroduces registration for a standing call invitation", async () => {
    const publicId = randomUUID();
    publicEvents = [publicEvent];
    await db.query(`insert into experiences select $1, 'public-call',kind,title,summary,starts_at,ends_at,timezone,location_label,'external',registration_opens_at,null,'https://example.test/reserve','public',status,null,null,null from experiences where id=$2`, [publicId, events.all]);
    await db.query(`insert into integration_entity_links values ('google','experience',$1,'meet_space',false,$2)`, [publicId, JSON.stringify({ meetingUri: "https://meet.google.com/abc-defg-hij" })]);
    allowlist.push(publicId);
    const summary = (await repository.getMemberExperiences(ids.auth)).upcoming.find(event => event.id === publicId);
    assert.equal(summary.title, publicEvent.title, "real public-event merge ran");
    assert.equal(summary.registrationHref, null);
    assert.equal(summary.registrationState, "none");
    assert.ok(summary.meetingUrl);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, publicId), "https://meet.google.com/abc-defg-hij");
    await db.query("delete from experiences where id=$1", [publicId]);
    publicEvents = [];
    allowlist = allowlist.filter(id => id !== publicId);
  });
  await t.test("regular members retain audience, registration, and cancellation boundaries", async () => {
    standing = false; allowlist = [];
    let snapshot = await repository.getMemberExperiences(ids.auth);
    assert.deepEqual(snapshot.upcoming.map(event => event.id), [events.all]);
    assert.equal(snapshot.upcoming[0].meetingUrl, null);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.all), null);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.private), null);
    await db.query("insert into experience_registrations values ($1,$2,'registered')", [events.private, ids.person]);
    allowlist = [events.private];
    snapshot = await repository.getMemberExperiences(ids.auth);
    const invited = snapshot.upcoming.find(event => event.id === events.private);
    assert.equal(invited.registrationState, "registered");
    assert.equal(invited.registrationHref, `/api/my/experiences/${events.private}/register`, "activated regular invitees keep their release-place control");
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.private), "https://meet.google.com/abc-defg-hij");
    await db.query("update experience_registrations set status='cancelled'"); allowlist = [];
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, events.private), null);
    assert.ok(!(await repository.getMemberExperiences(ids.auth)).upcoming.some(event => event.id === events.private));
  });
  assert.equal((await db.query("select count(*)::int as count from experience_registrations")).rows[0].count, 1, "Calendar reads never add founder registrations");
  assert.ok(readQueries.length > 0);
});

test("standing call summaries render Join room without Reserve, Register or Release controls", () => {
  const Stub = () => null;
  let stateSlot = 0;
  const Component = load("src/components/membership/MemberExperiences.tsx", {
    // Render the selected call's opened detail dialog, as after a calendar click.
    react: { ...React, useState: initial => [stateSlot++ === 6 ? true : typeof initial === "function" ? initial() : initial, () => {}] },
    "next/link": ({ children, ...props }) => React.createElement("a", props, children),
    "next/image": Stub,
    "@/lib/events/use-public-events": { usePublicEvents: () => [] },
    "./MemberExperiences.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Component, {
    initialExperiences: { access: { capabilities: [] }, past: [], upcoming: [{ id: "standing-call", title: "Foundations 1", kind: "academy_session", startsAt: "2100-01-01T22:00:00.000Z", endsAt: null, timezone: "America/Denver", audienceLabel: "Invited members", locationLabel: null, detailHref: "/my/experiences#experience-standing-call", summary: null, registrationState: "none", registrationHref: null, meetingUrl: "/api/my/experiences/standing-call/join" }] },
    writable: true,
  }));
  assert.match(html, /Join room/);
  assert.match(html, /No reservation needed/);
  assert.doesNotMatch(html, /Reserve place|Release place|Register ↗/);
});
