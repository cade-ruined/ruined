import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const require = createRequire(import.meta.url);
const driver = postgres({ host: "127.0.0.1", prepare: false }); // Lazy; no network queries.
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = { auth: uuid(1), person: uuid(2), member: uuid(3), circle: uuid(4), otherCircle: uuid(5), shaperAuth: uuid(6), shaperPerson: uuid(7), shaperMember: uuid(8), event: uuid(9), otherEvent: uuid(10), allEvent: uuid(11), resource: uuid(12), version: uuid(13), otherResource: uuid(14), otherVersion: uuid(15) };

async function loadModule(path, dependencies) {
  const output = ts.transpileModule(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

async function fixture() {
  const PGlite = await loadPGliteForSchemaChecks();
  const pg = new PGlite();
  // Read paths use the real SQL against a small isolated relational fixture.
  // The profile audit table below is taken verbatim from the shipped migration.
  await pg.exec(`
    create table people(id uuid primary key, status text default 'active');
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text, member_id uuid, email_normalized text);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members(id uuid primary key, person_id uuid);
    create table member_lifecycle(member_id uuid, current_progression_level_slug text default 'member', account_state text default 'active', administrative_onboarding_state text default 'completed', billing_state text default 'active', cancellation_effective_at timestamptz, foundations_state text default 'in_progress', program_state text default 'onboarding', standing_state text default 'active');
    create table person_profiles(person_id uuid primary key, display_name text, preferred_name text, avatar_storage_path text, timezone text, location_label text, bio text, building_now text, updated_at timestamptz);
    create table person_private_profiles(person_id uuid primary key, legal_name text, mobile_e164 text, birth_date date, default_fulfillment_address jsonb, apparel_sizing jsonb, accessibility_notes text, updated_at timestamptz);
    create table person_email_addresses(person_id uuid, email text, is_primary boolean, verification_state text, retired_at timestamptz, created_at timestamptz default now());
    create table member_directory_preferences(member_id uuid primary key, directory_status text default 'hidden', avatar_visible boolean default true, location_visible boolean default false, bio_visible boolean default false, building_visible boolean default false, email_scope text default 'none', phone_scope text default 'none', version integer default 1, updated_at timestamptz);
    create table circles(id uuid primary key, name text, status text, activated_at timestamptz, ends_at timestamptz);
    create table circle_member_assignments(id bigint generated always as identity primary key, member_id uuid, circle_id uuid, assigned_at timestamptz default now(), ended_at timestamptz);
    create table circle_staff_assignments(id bigint generated always as identity primary key, auth_user_id uuid, role_slug text, circle_id uuid, assigned_at timestamptz default now(), ended_at timestamptz);
    create table block_circle_assignments(circle_id uuid, block_id uuid, ended_at timestamptz);
    create table membership_blocks(id uuid, name text, status text);
    create table experiences(id uuid primary key, slug text, kind text, title text, summary text, starts_at timestamptz, ends_at timestamptz, timezone text, location_label text, registration_mode text, registration_opens_at timestamptz, registration_closes_at timestamptz, external_registration_url text, visibility text, circle_id uuid, block_id uuid, progression_level_slug text, status text, capacity integer, waitlist_enabled boolean default true);
    create table experience_registrations(id uuid primary key default gen_random_uuid(), experience_id uuid, person_id uuid, member_id uuid, status text, source text, registered_at timestamptz, waitlisted_at timestamptz, cancelled_at timestamptz, cancellation_reason text, promoted_at timestamptz, version integer default 1, updated_at timestamptz, unique(experience_id, person_id));
    create table experience_registration_events(registration_id uuid, experience_id uuid, person_id uuid, previous_status text, next_status text, source text, actor_auth_user_id uuid, reason text, dedupe_key text);
    create table integration_entity_links(provider text, local_entity_type text, local_entity_id text, external_entity_type text, livemode boolean, metadata jsonb);
    create table learning_resources(id uuid primary key, slug text, title text, summary text, content_type text, status text, published_at timestamptz default now(), current_version_id uuid, collection_id uuid, position integer);
    create table learning_resource_versions(id uuid primary key, learning_resource_id uuid, version integer, body_text text, external_url text, metadata jsonb default '{}', storage_bucket text, storage_path text);
    create table learning_resource_targets(learning_resource_id uuid, audience_type text, circle_id uuid, block_id uuid, progression_level_slug text);
    create table learning_collections(id uuid, name text, slug text, summary text, status text, position integer);
    create table circle_resources(id uuid default gen_random_uuid(), circle_id uuid, learning_resource_version_id uuid, ended_at timestamptz, is_pinned boolean, position integer, created_at timestamptz default now());
  `);
  const community = await readFile(new URL("../db/migrations/20260826_membership_operating_spine_03_community_experiences.sql", import.meta.url), "utf8");
  await pg.exec(community.match(/create table if not exists public\.member_directory_preference_events \([\s\S]*?\n\);/)[0]);
  await pg.query("insert into people(id) values($1),($2)", [ids.person, ids.shaperPerson]);
  await pg.query("insert into platform_users values($1,$2,'active',$3,'member@example.test'),($4,$5,'active',$6,'shaper@example.test')", [ids.auth, ids.person, ids.member, ids.shaperAuth, ids.shaperPerson, ids.shaperMember]);
  await pg.query("insert into platform_role_grants values($1,'circle_leader',null)", [ids.shaperAuth]);
  await pg.query("insert into platform_role_grants values($1,'member',null)", [ids.auth]);
  await pg.query("insert into ruined_members values($1,$2),($3,$4)", [ids.member, ids.person, ids.shaperMember, ids.shaperPerson]);
  await pg.query("insert into member_lifecycle(member_id) values($1)", [ids.member]);
  await pg.query("insert into person_profiles(person_id,display_name,preferred_name,avatar_storage_path,bio,location_label,building_now) values($1,'Member One','One',null,'Member bio','Utah','Building'),($2,'Circle Shaper','Shaper','/api/member-photos/' || $3 || '/portrait.webp','Private by choice','Utah','Shaping')", [ids.person, ids.shaperPerson, ids.shaperMember]);
  await pg.query("insert into person_private_profiles(person_id,mobile_e164) values($1,'+12025550123')", [ids.shaperPerson]);
  await pg.query("insert into person_email_addresses(person_id,email,is_primary,verification_state) values($1,'shaper@example.test',true,'verified')", [ids.shaperPerson]);
  await pg.query("insert into member_directory_preferences(member_id) values($1),($2)", [ids.member, ids.shaperMember]);
  await pg.query("insert into circles values($1,'Circle One','active',now()-interval '1 day',null),($2,'Other Circle','active',now()-interval '1 day',null)", [ids.circle, ids.otherCircle]);
  await pg.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)", [ids.member, ids.circle]);
  await pg.query("insert into circle_staff_assignments(auth_user_id,role_slug,circle_id) values($1,'circle_leader',$2)", [ids.shaperAuth, ids.circle]);
  for (const [id, circle, visibility] of [[ids.event, ids.circle, "circle"], [ids.otherEvent, ids.otherCircle, "circle"], [ids.allEvent, null, "all_members"]]) {
    await pg.query("insert into experiences(id,slug,kind,title,starts_at,ends_at,timezone,registration_mode,visibility,circle_id,status) values($1,$2,'circle_meeting','Gathering',now()+interval '1 day',now()+interval '1 day 1 hour','UTC','none',$3,$4,'published')", [id, `event-${id}`, visibility, circle]);
    await pg.query("insert into integration_entity_links values('google','experience',$1,'meet_space',false,$2)", [id, JSON.stringify({ url: "https://meet.google.com/abc-defg-hij" })]);
  }
  for (const [resource, version, slug, circle] of [[ids.resource, ids.version, "circle-notes", ids.circle], [ids.otherResource, ids.otherVersion, "other-notes", ids.otherCircle]]) {
    await pg.query("insert into learning_resources(id,slug,title,content_type,status,current_version_id) values($1,$2,'Circle notes','article','published',$3)", [resource, slug, version]);
    await pg.query("insert into learning_resource_versions(id,learning_resource_id,version,body_text) values($1,$2,1,'Private Circle content')", [version, resource]);
    await pg.query("insert into circle_resources(circle_id,learning_resource_version_id) values($1,$2)", [circle, version]);
    await pg.query("insert into learning_resource_targets(learning_resource_id,audience_type) values($1,'all_members')", [resource]);
  }
  const identity = { account_state: "active", administrative_onboarding_state: "completed", auth_user_id: ids.auth, billing_state: "active", cancellation_effective_at: null, email: "member@example.test", foundations_state: "in_progress", member_id: ids.member, person_id: ids.person, program_state: "onboarding", standing_state: "active" };
  const makeDb = (engine) => {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const parameters = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) return types.json.serialize(value.value);
        if (/^\s*::jsonb\b/.test(strings[index + 1])) return types.json.serialize(value);
        return value;
      });
      // Identity linkage is independently covered; all scoped data queries and
      // writes under test execute against PostgreSQL, not fake result branches.
      if (query.includes("from platform_users platform_user")) return [identity];
      if (query.includes("pg_advisory_xact_lock")) return [];
      return (await engine.query(query, parameters)).rows;
    };
    sql.json = driver.json;
    sql.begin = (callback) => pg.transaction((transaction) => callback(makeDb(transaction)));
    return sql;
  };
  const policy = await loadModule("src/lib/membership/access-policy.ts", {});
  const experienceAccess = await loadModule("src/lib/platform/experience-member-access.ts", {
    "@/lib/membership/access-policy": policy,
  });
  const repository = await loadModule("src/lib/membership/repository.ts", {
    "libphonenumber-js/min": require("libphonenumber-js/min"),
    "@/lib/database/server": { getApplicationDatabase: () => makeDb(pg) },
    "@/lib/membership/access-policy": policy,
    "@/lib/membership/phone": {},
    "@/lib/membership/avatar-url": { safeMemberAvatarUrl: (value) => value },
    "@/lib/events/member-experiences": { mergeUpcomingPublicMemberExperiences: (items) => items, publicEventDetailHref: (slug) => `/community#${slug}` },
    "@/lib/google/communications": { googleCommunicationLivemode: () => false, googleCommunicationUrlFromMetadata: (_kind, metadata) => metadata?.url ?? null },
    "@/lib/membership/artifact-products": {},
    "@/lib/platform/ops-calendar-repository": { markOpsExperienceCalendarPending: async () => false },
    "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/platform/experience-member-access": experienceAccess,
  });
  return { pg, identity, repository };
}

test("profile save commits typed privacy snapshots and reloads its changes through real PostgreSQL", async () => {
  const { pg, repository } = await fixture();
  try {
    const saved = await repository.saveMemberProfile(ids.auth, { displayName: "Updated name", preferredName: "Updated", timezone: "America/Denver", location: "Utah", bio: "Updated bio", buildingNow: "New work", accessibilityNotes: "Private note", directory: { directoryStatus: "circle_visible", avatarVisible: true, locationVisible: true, bioVisible: true, buildingVisible: false, emailScope: "none", phoneScope: "none" } });
    assert.equal(saved.directory.displayName, "Updated name");
    assert.equal(saved.preferences.directoryStatus, "circle_visible");
    assert.equal(saved.privateProfile.accessibilityNotes, "Private note");
    const rows = (await pg.query("select previous_preferences,next_preferences from member_directory_preference_events")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].previous_preferences.directory_status, "hidden");
    assert.equal(rows[0].next_preferences.directory_status, "circle_visible");
  } finally { await pg.close(); }
});

test("Circle Shaper IDs cannot collide with member IDs and optional fields require explicit sharing", async () => {
  const { pg, repository } = await fixture();
  try {
    let circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.members[0].id, "member:1");
    assert.equal(circle.shaper.id, "shaper:1");
    assert.equal(circle.members.some((member) => member.id === circle.shaper.id), false);
    for (const field of ["avatarUrl", "bio", "location", "buildingNow", "email", "phone"]) assert.equal(circle.shaper[field], null, field);
    await pg.query("update member_directory_preferences set directory_status='circle_visible',avatar_visible=true,bio_visible=true,email_scope='circle',phone_scope='circle' where member_id=$1", [ids.shaperMember]);
    circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.shaper.email, "shaper@example.test");
    assert.equal(circle.shaper.phone, "+12025550123");
    assert.equal(circle.shaper.bio, "Private by choice");
    assert.ok(circle.shaper.avatarUrl);
    assert.equal(circle.shaper.location, null);
    assert.equal(circle.shaper.buildingNow, null);
    await pg.query("update circle_staff_assignments set circle_id=$1", [ids.otherCircle]);
    assert.equal((await repository.getMemberCircle(ids.auth)).shaper, null);
    await pg.query("update circle_staff_assignments set circle_id=$1", [ids.circle]);
    await pg.exec("update platform_role_grants set revoked_at=now()");
    assert.equal((await repository.getMemberCircle(ids.auth)).shaper, null);
  } finally { await pg.close(); }
});

test("onboarding members can join and register for only their active Circle gathering", async () => {
  const { pg, identity, repository } = await fixture();
  try {
    assert.equal((await repository.getMemberExperiences(ids.auth)).upcoming.length, 1);
    const circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.meetings[0].detailHref, `/my/experiences#experience-${ids.event}`);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, ids.event), "https://meet.google.com/abc-defg-hij");
    for (const id of [ids.otherEvent, ids.allEvent]) {
      assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, id), null);
      await assert.rejects(() => repository.setMemberExperienceRegistration(ids.auth, id, "register"), repository.MembershipAccessDeniedError);
    }
    await pg.query("update experiences set registration_mode='internal' where id=$1", [ids.event]);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, ids.event), null);
    assert.deepEqual(await repository.setMemberExperienceRegistration(ids.auth, ids.event, "register"), { status: "registered" });
    assert.ok(await repository.getMemberExperienceMeetingDestination(ids.auth, ids.event));
    await pg.exec("update circle_member_assignments set ended_at=now()");
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, ids.event), null);
    assert.equal((await repository.getMemberExperiences(ids.auth)).upcoming.length, 0);
    await assert.rejects(() => repository.setMemberExperienceRegistration(ids.auth, ids.event, "register"), repository.MembershipAccessDeniedError);
    identity.billing_state = "pending";
    await assert.rejects(() => repository.getMemberExperienceMeetingDestination(ids.auth, ids.event), repository.MembershipAccessDeniedError);
  } finally { await pg.close(); }
});

test("onboarding opens explicitly assigned Circle resources without opening the general Academy", async () => {
  const { pg, identity, repository } = await fixture();
  try {
    assert.deepEqual((await repository.getMemberLearning(ids.auth)).collections, []);
    assert.equal((await repository.getMemberLearningResource(ids.auth, "circle-notes")).bodyMarkdown, "Private Circle content");
    assert.equal(await repository.getMemberLearningResource(ids.auth, "other-notes"), null);
    await pg.exec("update circle_resources set ended_at=now()");
    assert.equal(await repository.getMemberLearningResource(ids.auth, "circle-notes"), null);
    await pg.exec("update circle_resources set ended_at=null; update circles set status='archived'");
    assert.equal(await repository.getMemberLearningResource(ids.auth, "circle-notes"), null);
    await pg.exec("update circles set status='active'; update circle_member_assignments set assigned_at=now()+interval '1 day'");
    assert.equal(await repository.getMemberLearningResource(ids.auth, "circle-notes"), null);
    identity.billing_state = "pending";
    assert.equal(await repository.getMemberLearningResource(ids.auth, "circle-notes"), null);
  } finally { await pg.close(); }
});

test("member cancellation skips ineligible waitlisted people before promoting the first eligible person", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("update experiences set registration_mode='internal' where id=$1", [ids.event]);
    await repository.setMemberExperienceRegistration(ids.auth, ids.event, "register");
    for (const member of [uuid(21), uuid(22), uuid(23)]) {
      await pg.query("insert into people(id) values($1)", [member]);
      await pg.query("insert into ruined_members values($1,$1)", [member]);
      await pg.query("insert into platform_users values($1,$1,'active',$1,'waiting@example.test')", [member]);
      await pg.query("insert into platform_role_grants values($1,'member',null)", [member]);
      await pg.query("insert into member_lifecycle(member_id,billing_state) values($1,$2)", [member, member === uuid(21) ? "pending" : "active"]);
      await pg.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)", [member, member === uuid(23) ? ids.otherCircle : ids.circle]);
      await pg.query("insert into experience_registrations(experience_id,person_id,member_id,status,waitlisted_at,registered_at) values($1,$2,$2,'waitlisted',clock_timestamp(),clock_timestamp())", [ids.event, member]);
    }
    await repository.setMemberExperienceRegistration(ids.auth, ids.event, "cancel");
    const statuses = (await pg.query("select member_id,status from experience_registrations where member_id <> $1 order by member_id", [ids.member])).rows;
    assert.deepEqual(statuses.map((row) => row.status), ["waitlisted", "registered", "waitlisted"]);
    const events = (await pg.query("select person_id from experience_registration_events where source='system' and next_status='registered'")).rows;
    assert.deepEqual(events.map((row) => row.person_id), [uuid(22)]);
  } finally { await pg.close(); }
});

test("new admission rechecks changed billing, standing, suspension and grants instead of trusting the request snapshot", async () => {
  const { pg, identity, repository } = await fixture();
  try {
    await pg.query("update experiences set registration_mode='internal' where id=$1", [ids.event]);
    // The initial request identity remains active throughout. These changes
    // represent state committed before the registration transaction starts.
    for (const [column, value] of [["billing_state", "pending"], ["standing_state", "paused"], ["account_state", "suspended"]]) {
      await pg.exec("update member_lifecycle set billing_state='active',standing_state='active',account_state='active'");
      await pg.query(`update member_lifecycle set ${column}=$1 where member_id=$2`, [value, ids.member]);
      assert.equal(identity.billing_state, "active");
      assert.equal(identity.account_state, "active");
      await assert.rejects(() => repository.setMemberExperienceRegistration(ids.auth, ids.event, "register"), repository.MembershipAccessDeniedError);
      assert.equal((await pg.query("select count(*)::int as count from experience_registrations")).rows[0].count, 0);
    }
    await pg.exec("update member_lifecycle set billing_state='active',standing_state='active',account_state='active'");
    await pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1 and role_slug='member'", [ids.auth]);
    await assert.rejects(() => repository.setMemberExperienceRegistration(ids.auth, ids.event, "register"), repository.MembershipAccessDeniedError);
    await pg.query("update platform_role_grants set revoked_at=null where auth_user_id=$1 and role_slug='member'", [ids.auth]);
    assert.deepEqual(await repository.setMemberExperienceRegistration(ids.auth, ids.event, "register"), { status: "registered" });
    await pg.exec("update member_lifecycle set standing_state='paused'");
    assert.deepEqual(await repository.setMemberExperienceRegistration(ids.auth, ids.event, "cancel"), { status: "cancelled" }, "Cleanup does not require new admission eligibility");
  } finally { await pg.close(); }
});

test("legacy progression events retain exact-match admission without bypassing the current membership policy", async () => {
  const { pg, identity, repository } = await fixture();
  try {
    identity.program_state = "active";
    await pg.exec("update member_lifecycle set program_state='active'");
    await pg.query("update experiences set registration_mode='internal',visibility='progression',progression_level_slug='member' where id=$1", [ids.allEvent]);
    assert.deepEqual(await repository.setMemberExperienceRegistration(ids.auth, ids.allEvent, "register"), { status: "registered" });
    await pg.exec("update member_lifecycle set current_progression_level_slug='different'");
    await assert.rejects(() => repository.setMemberExperienceRegistration(ids.auth, ids.allEvent, "register"), repository.MembershipAccessDeniedError);
  } finally { await pg.close(); }
});
