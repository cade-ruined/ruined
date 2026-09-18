import assert from "node:assert/strict";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, arraySerializer, types } from "../node_modules/postgres/src/types.js";
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
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text, member_id uuid, email_normalized text);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz, id bigint generated always as identity primary key);
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
  await installOperatorFundingFunctions(pg);
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
  await pg.exec(`
    alter table ruined_members add column membership_activated_at timestamptz default '2020-01-01';
    create table member_milestones(id uuid primary key, member_id uuid, person_id uuid, title text, visibility text, occurred_at timestamptz, source_entity_type text, source_entity_id text);
    create table artifact_awards(id uuid primary key, member_id uuid, person_id uuid, status text, revoked_at timestamptz, awarded_at timestamptz);
  `);
  await pg.exec(await readFile(new URL("../db/migrations/20260917200000_public_member_cards.sql", import.meta.url), "utf8"));
  await pg.exec(await readFile(new URL("../db/migrations/20260919210000_member_profile_card_sync.sql", import.meta.url), "utf8"));
  await pg.exec(await readFile(new URL("../db/migrations/20260920200000_member_tags.sql", import.meta.url), "utf8"));
  const identity = { account_state: "active", administrative_onboarding_state: "completed", auth_user_id: ids.auth, billing_state: "active", cancellation_effective_at: null, email: "member@example.test", foundations_state: "in_progress", member_id: ids.member, person_id: ids.person, program_state: "onboarding", standing_state: "active" };
  const makeDb = (engine) => {
    // postgres-js tags are lazy, composable query objects. A nested tag is SQL,
    // not a value parameter or an independently executed partial statement.
    class Query {
      constructor(strings, values) { this.strings = strings; this.values = values; }
      compile(parameters) {
        let query = this.strings[0];
        this.values.forEach((value, index) => {
          if (value instanceof Query) query += value.compile(parameters);
          else {
            const parameter = value instanceof Parameter
              ? value.array ? arraySerializer(value.value) : types.json.serialize(value.value)
              : /^\s*::jsonb\b/.test(this.strings[index + 1]) ? types.json.serialize(value)
                : value instanceof Date ? types.date.serialize(value) : value;
            parameters.push(parameter);
            query += `$${parameters.length}`;
          }
          query += this.strings[index + 1];
        });
        return query;
      }
      async execute() {
        const parameters = [], query = this.compile(parameters);
        // Identity linkage is independently covered; all scoped data queries and
        // writes under test execute against PostgreSQL, not fake result branches.
        if (query.includes("from platform_users platform_user")) return [identity];
        if (query.includes("pg_advisory_xact_lock")) return [];
        return (await engine.query(query, parameters)).rows;
      }
      then(resolve, reject) { return this.execute().then(resolve, reject); }
    }
    const sql = (strings, ...values) => new Query(strings, values);
    sql.json = driver.json;
    sql.array = driver.array;
    sql.begin = (callback) => pg.transaction((transaction) => callback(makeDb(transaction)));
    return sql;
  };
  const policy = await loadModule("src/lib/membership/access-policy.ts", {});
  const experienceAccess = await loadModule("src/lib/platform/experience-member-access.ts", {
    "@/lib/membership/access-policy": policy,
    "@/lib/membership/member-tag": await loadModule("src/lib/membership/member-tag.ts", {}),
  });
  const cardModel = await loadModule("src/lib/membership/public-card-model.ts", {});
  let cardRepository;
  const repository = await loadModule("src/lib/membership/repository.ts", {
    "./public-card-model": cardModel,
    "./public-card-repository": { saveProfileCardSettings: (...args) => cardRepository.saveProfileCardSettings(...args) },
    "libphonenumber-js/min": require("libphonenumber-js/min"),
    "@/lib/database/server": { getApplicationDatabase: () => makeDb(pg) },
    "@/lib/membership/access-policy": policy,
    "@/lib/membership/member-tag": await loadModule("src/lib/membership/member-tag.ts", {}),
    "@/lib/membership/phone": {},
    "@/lib/membership/avatar-url": { safeMemberAvatarUrl: (value) => value },
    "@/lib/events/member-experiences": { mergeUpcomingPublicMemberExperiences: (items) => items, publicEventDetailHref: (slug) => `/community#${slug}` },
    "@/lib/events/community-event-repository": { getPublicCommunityEvents: async () => [] },
    "@/lib/google/communications": { googleCommunicationLivemode: () => false, googleCommunicationUrlFromMetadata: (_kind, metadata) => metadata?.url ?? null },
    "@/lib/membership/artifact-products": {},
    "@/lib/platform/ops-calendar-repository": { markOpsExperienceCalendarPending: async () => false },
    "@/lib/platform/calendar-audience-invalidation": {},
    "@/lib/platform/experience-member-access": experienceAccess,
  });
  cardRepository = await loadModule("src/lib/membership/public-card-repository.ts", {
    "node:crypto": require("node:crypto"), "@supabase/supabase-js": {},
    "@/lib/database/server": { getApplicationDatabase: () => makeDb(pg) },
    "@/lib/membership/access-policy": policy,
    "@/lib/membership/member-tag": await loadModule("src/lib/membership/member-tag.ts", {}),
    "@/lib/membership/repository": { getMemberIdentity: repository.getMemberIdentity },
    "@/lib/membership/photo-policy": await loadModule("src/lib/membership/photo-policy.ts", {}),
    "./public-card-model": cardModel,
  });
  return { pg, identity, repository, cardRepository, cardModel };
}

test("profile save commits typed privacy snapshots and reloads its changes through real PostgreSQL", async () => {
  const { pg, repository } = await fixture();
  try {
    const saved = await repository.saveMemberProfile(ids.auth, { revision: (await repository.getMemberProfile(ids.auth)).revision, websiteUrl: "https://example.test", displayName: "Updated name", memberTag: "updated", timezone: "America/Denver", location: "Utah", bio: "Updated bio", buildingNow: "New work", accessibilityNotes: "Private note", directory: { directoryStatus: "circle_visible", avatarVisible: true, locationVisible: true, bioVisible: true, buildingVisible: false, emailScope: "none", phoneScope: "none" } });
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
    await pg.query("update person_profiles set member_tag='circle_shaper' where person_id=$1", [ids.shaperPerson]);
    await pg.query("update person_profiles set member_tag='my_private_tag' where person_id=$1", [ids.person]);
    let circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.members[0].id, "member:1");
    assert.equal(circle.members[0].memberTag, "my_private_tag", "the owner can see their own tag while their directory profile is hidden");
    assert.equal(circle.shaper.id, "shaper:1");
    assert.equal(circle.members.some((member) => member.id === circle.shaper.id), false);
    for (const field of ["avatarUrl", "bio", "location", "buildingNow", "email", "phone", "memberTag"]) assert.equal(circle.shaper[field], null, field);
    await pg.query("update member_directory_preferences set directory_status='circle_visible',avatar_visible=true,bio_visible=true,email_scope='circle',phone_scope='circle' where member_id=$1", [ids.shaperMember]);
    circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.shaper.memberTag, "circle_shaper");
    assert.equal(circle.shaper.email, "shaper@example.test");
    assert.equal(circle.shaper.phone, "+12025550123");
    assert.equal(circle.shaper.bio, "Private by choice");
    assert.ok(circle.shaper.avatarUrl);
    assert.equal(circle.shaper.location, null);
    assert.equal(circle.shaper.buildingNow, null);
    await pg.query("update circle_staff_assignments set circle_id=$1", [ids.otherCircle]);
    circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.shaper, null);
    assert.doesNotMatch(JSON.stringify(circle), /circle_shaper/, "a shared tag stays scoped to the member's Circle");
    await pg.query("update circle_staff_assignments set circle_id=$1", [ids.circle]);
    await pg.exec("update platform_role_grants set revoked_at=now()");
    assert.equal((await repository.getMemberCircle(ids.auth)).shaper, null);
  } finally { await pg.close(); }
});

test("an administrator assigned as Shaper appears without a second role grant and keeps directory privacy", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("update platform_role_grants set role_slug='ops_admin' where auth_user_id=$1", [ids.shaperAuth]);
    const grantsBefore = (await pg.query("select * from platform_role_grants where auth_user_id=$1", [ids.shaperAuth])).rows;
    let circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.shaper.displayName, "Circle Shaper");
    for (const field of ["avatarUrl", "bio", "location", "buildingNow", "email", "phone"]) assert.equal(circle.shaper[field], null, field);
    await pg.query("update member_directory_preferences set directory_status='circle_visible',email_scope='circle' where member_id=$1", [ids.shaperMember]);
    circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.shaper.email, "shaper@example.test");
    assert.equal(circle.shaper.phone, null);
    assert.deepEqual((await pg.query("select * from platform_role_grants where auth_user_id=$1", [ids.shaperAuth])).rows, grantsBefore);
    await pg.query("update platform_users set status='suspended' where auth_user_id=$1", [ids.shaperAuth]);
    assert.equal((await repository.getMemberCircle(ids.auth)).shaper, null);
    await pg.query("update platform_users set status='active' where auth_user_id=$1", [ids.shaperAuth]);
    await pg.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [ids.shaperAuth]);
    assert.equal((await repository.getMemberCircle(ids.auth)).shaper, null);
    await pg.query("update platform_role_grants set revoked_at=null,role_slug='guide' where auth_user_id=$1", [ids.shaperAuth]);
    assert.equal((await repository.getMemberCircle(ids.auth)).shaper, null);
    await pg.query("update platform_role_grants set role_slug='ops_admin' where auth_user_id=$1", [ids.shaperAuth]);
    await pg.exec("update circle_staff_assignments set ended_at=now()");
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


test("profile text and public choices commit together; stale sharing and profile versions roll back every field", async () => {
  const { pg, repository, cardRepository } = await fixture();
  try {
    const initialProfile = await repository.getMemberProfile(ids.auth);
    const initialCard = await cardRepository.getOwnMemberCard(ids.auth);
    const input = {
      revision: initialProfile.revision, displayName: "N".repeat(120), memberTag: "preferred", timezone: "America/Denver", location: "L".repeat(160),
      bio: "B".repeat(1200), buildingNow: "W".repeat(500), websiteUrl: "https://example.test/", accessibilityNotes: "PRIVATE NOTES",
      directory: { directoryStatus: "hidden", avatarVisible: false, locationVisible: false, bioVisible: false, buildingVisible: false, emailScope: "none", phoneScope: "none" },
      card: { ...initialCard.settings, publicEnabled: true, showBio: true, showBuilding: true, showWebsite: true, version: initialCard.version },
    };
    const saved = await repository.saveMemberProfile(ids.auth, input);
    assert.equal(saved.directory.displayName.length, 120); assert.equal(saved.directory.bio.length, 1200); assert.equal(saved.directory.buildingNow.length, 500);
    const publicState = await cardRepository.getOwnMemberCard(ids.auth), token = publicState.publicUrl.split("/").pop();
    assert.equal((await cardRepository.getPublicMemberCard(token)).bio, input.bio);
    const hiding = { ...input, revision: saved.revision, bio: "NEW PRIVATE BIO", card: { ...publicState.settings, showBio: false, version: publicState.version } };
    const hidden = await repository.saveMemberProfile(ids.auth, hiding);
    assert.equal(hidden.directory.bio, "NEW PRIVATE BIO"); assert.equal((await cardRepository.getPublicMemberCard(token)).bio, null);
    await assert.rejects(repository.saveMemberProfile(ids.auth, { ...input, bio: "STALE PROFILE" }), { name: "MembershipConflictError" });
    const currentCard = await cardRepository.getOwnMemberCard(ids.auth);
    await cardRepository.saveOwnMemberCard(ids.auth, { ...currentCard.settings, publicEnabled: false, version: currentCard.version });
    await assert.rejects(repository.saveMemberProfile(ids.auth, { ...hiding, revision: hidden.revision, bio: "SHOULD ROLL BACK", accessibilityNotes: "SHOULD ALSO ROLL BACK", card: { ...currentCard.settings, version: currentCard.version } }), { status: 409 });
    const latest = await repository.getMemberProfile(ids.auth);
    assert.equal(latest.directory.bio, "NEW PRIVATE BIO"); assert.equal(latest.privateProfile.accessibilityNotes, "PRIVATE NOTES");
    assert.equal(latest.revision, hidden.revision); assert.equal(await cardRepository.getPublicMemberCard(token), null);
    assert.equal((await pg.query("select count(*)::int as count from member_directory_preference_events")).rows[0].count, 2);
  } finally { await pg.close(); }
});

function tagProfileInput(snapshot, changes = {}) {
  return { revision: snapshot.revision, displayName: snapshot.directory.displayName, memberTag: snapshot.directory.memberTag ?? "",
    websiteUrl: "", timezone: "America/Denver", location: "Utah", bio: "Original bio", buildingNow: "Original work", accessibilityNotes: "Private note",
    directory: { directoryStatus: "hidden", avatarVisible: false, locationVisible: false, bioVisible: false, buildingVisible: false, emailScope: "none", phoneScope: "none" }, ...changes };
}

test("legacy profiles can remain untagged; claiming a canonical tag preserves names and cannot be silently cleared", async () => {
  const { pg, identity, repository } = await fixture();
  try {
    const initial = await repository.getMemberProfile(ids.auth);
    assert.equal(initial.directory.memberTag, null);
    const legacy = await repository.saveMemberProfile(ids.auth, tagProfileInput(initial));
    assert.equal(legacy.directory.memberTag, null);
    assert.equal(legacy.directory.preferredName, "One");
    assert.equal(legacy.access.mode, "onboarding");
    assert.equal(identity.administrative_onboarding_state, "completed");
    const claimed = await repository.saveMemberProfile(ids.auth, tagProfileInput(legacy, { memberTag: " @Member_One " }));
    assert.equal(claimed.directory.memberTag, "member_one");
    assert.equal(claimed.directory.displayName, "Member One");
    assert.equal(claimed.directory.preferredName, "One");
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(claimed, { memberTag: "", bio: "Should not persist" })), repository.MembershipInputError);
    assert.equal((await repository.getMemberProfile(ids.auth)).revision, claimed.revision);
    for (const memberTag of ["ab", "tag with space", "@", "x".repeat(25)]) {
      await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(claimed, { memberTag })), repository.MembershipInputError);
    }
  } finally { await pg.close(); }
});

test("tag duplicate, stale revision and sharing conflict roll back the complete profile save", async () => {
  const { pg, repository, cardRepository } = await fixture();
  try {
    const saved = await repository.saveMemberProfile(ids.auth, tagProfileInput(await repository.getMemberProfile(ids.auth), { memberTag: "member_one" }));
    await pg.query("update person_profiles set member_tag='already_taken' where person_id=$1", [ids.shaperPerson]);
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(saved, { memberTag: "@Already_Taken", displayName: "Should roll back", accessibilityNotes: "Never persist" })),
      error => error instanceof repository.MembershipConflictError && error.code === "member_tag_unavailable");
    assert.equal((await repository.getMemberProfile(ids.auth)).revision, saved.revision);
    await pg.query("update person_profiles set member_tag='updated_elsewhere' where person_id=$1", [ids.person]);
    const refreshed = await repository.getMemberProfile(ids.auth);
    assert.notEqual(refreshed.revision, saved.revision, "tag alone contributes to the profile revision");
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(saved)), error => error instanceof repository.MembershipConflictError && !error.code);
    const card = await cardRepository.getOwnMemberCard(ids.auth);
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(refreshed, { memberTag: "rollback_tag", bio: "Never persist", accessibilityNotes: "Never persist",
      card: { ...card.settings, publicEnabled: true, version: card.version + 1 } })), { status: 409 });
    assert.equal((await repository.getMemberProfile(ids.auth)).revision, refreshed.revision);
    assert.equal((await pg.query("select count(*)::int as count from person_profiles where member_tag='rollback_tag'")).rows[0].count, 0);
    assert.equal((await pg.query("select count(*)::int as count from member_directory_preference_events")).rows[0].count, 1);
  } finally { await pg.close(); }
});

test("generated display names follow renamed tags while an explicitly edited name wins", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("update person_profiles set member_tag='old_tag',display_name='@old_tag' where person_id=$1", [ids.person]);
    const initial = await repository.getMemberProfile(ids.auth);
    const renamed = await repository.saveMemberProfile(ids.auth, tagProfileInput(initial, { memberTag: "new_tag" }));
    assert.equal(renamed.directory.displayName, "@new_tag");
    const custom = await repository.saveMemberProfile(ids.auth, tagProfileInput(renamed, { memberTag: "another_tag", displayName: "An authored name" }));
    assert.equal(custom.directory.displayName, "An authored name");
    const unchanged = await repository.saveMemberProfile(ids.auth, tagProfileInput(custom, { memberTag: "last_tag" }));
    assert.equal(unchanged.directory.displayName, "An authored name");
  } finally { await pg.close(); }
});

test("new profile creation requires a tag and legacy names never become public legal names", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("delete from person_profiles where person_id=$1", [ids.person]);
    const empty = await repository.getMemberProfile(ids.auth);
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(empty)), repository.MembershipInputError);
    assert.equal((await pg.query("select count(*)::int as count from person_profiles where person_id=$1", [ids.person])).rows[0].count, 0);
    await pg.query("insert into person_profiles(person_id) values($1)", [ids.person]);
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(await repository.getMemberProfile(ids.auth))), repository.MembershipInputError);
    const created = await repository.saveMemberProfile(ids.auth, tagProfileInput(empty, { memberTag: "new_member", displayName: "Chosen public name" }));
    assert.equal(created.directory.memberTag, "new_member");
    assert.equal(created.directory.preferredName, null);
    assert.equal(created.directory.displayName, "Chosen public name");
  } finally { await pg.close(); }
});
