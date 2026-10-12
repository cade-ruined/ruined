import { existingMemberIntakeDependencies, existingMemberRegistration, installRegistrationProfileReleaseFunction } from "./helpers/registration-access-fixture.mjs";
import assert from "node:assert/strict";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";
import { loadFoundationsAvailability } from "./helpers/foundations-availability-fixture.mjs";
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

const phoneModel = await loadModule("src/lib/membership/phone.ts", {
  "libphonenumber-js/min": require("libphonenumber-js/min"),
  "i18n-iso-countries/langs/en.json": require("i18n-iso-countries/langs/en.json"),
});

async function fixture({ revealed = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const pg = new PGlite();
  // Read paths use the real SQL against a small isolated relational fixture.
  // The profile audit table below is taken verbatim from the shipped migration.
  await pg.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key, status text default 'active');
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text, member_id uuid, email_normalized text);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz, id bigint generated always as identity primary key);
    create table ruined_members(id uuid primary key, person_id uuid, deleted_at timestamptz);
    create table member_lifecycle(member_id uuid, current_progression_level_slug text default 'member', account_state text default 'active', administrative_onboarding_state text default 'completed', billing_state text default 'active', cancellation_effective_at timestamptz, foundations_state text default 'completed', program_state text default 'onboarding', standing_state text default 'active');
    create table person_profiles(person_id uuid primary key, display_name text, preferred_name text, avatar_storage_path text, timezone text, location_label text, bio text, building_now text, updated_at timestamptz);
    create table person_private_profiles(person_id uuid primary key, legal_name text, mobile_e164 text, birth_date date, default_fulfillment_address jsonb check(default_fulfillment_address is null or jsonb_typeof(default_fulfillment_address)='object'), apparel_sizing jsonb check(apparel_sizing is null or jsonb_typeof(apparel_sizing)='object'), accessibility_notes text, updated_at timestamptz);
    create table person_email_addresses(person_id uuid, email text, is_primary boolean, verification_state text, retired_at timestamptz, created_at timestamptz default now());
    create table member_directory_preferences(member_id uuid primary key, directory_status text default 'hidden', avatar_visible boolean default true, location_visible boolean default false, bio_visible boolean default false, building_visible boolean default false, email_scope text default 'none', phone_scope text default 'none', version integer default 1, updated_at timestamptz);
    create table circles(id uuid primary key, name text, status text, activated_at timestamptz, ends_at timestamptz, story text);
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
  await installRegistrationProfileReleaseFunction(pg);
  const community = await readFile(new URL("../db/migrations/20260826_membership_operating_spine_03_community_experiences.sql", import.meta.url), "utf8");
  await pg.exec(community.match(/create table if not exists public\.member_directory_preference_events \([\s\S]*?\n\);/)[0]);
  await pg.query("insert into people(id) values($1),($2)", [ids.person, ids.shaperPerson]);
  await pg.query("insert into platform_users values($1,$2,'active',$3,'member@example.test'),($4,$5,'active',$6,'shaper@example.test')", [ids.auth, ids.person, ids.member, ids.shaperAuth, ids.shaperPerson, ids.shaperMember]);
  await pg.query("insert into platform_role_grants values($1,'circle_leader',null)", [ids.shaperAuth]);
  await pg.query("insert into platform_role_grants values($1,'member',null)", [ids.auth]);
  await pg.query("insert into ruined_members(id,person_id) values($1,$2),($3,$4)", [ids.member, ids.person, ids.shaperMember, ids.shaperPerson]);
  await pg.query("insert into member_lifecycle(member_id) values($1)", [ids.member]);
  await pg.query("insert into person_profiles(person_id,display_name,preferred_name,avatar_storage_path,bio,location_label,building_now) values($1,'Member One','One',null,'Member bio','Utah','Building'),($2,'Circle Shaper','Shaper','/api/member-photos/' || $3 || '/portrait.webp','Private by choice','Utah','Shaping')", [ids.person, ids.shaperPerson, ids.shaperMember]);
  await pg.query("insert into person_private_profiles(person_id,mobile_e164) values($1,'+12025550123')", [ids.shaperPerson]);
  await pg.query("insert into person_email_addresses(person_id,email,is_primary,verification_state) values($1,'shaper@example.test',true,'verified')", [ids.shaperPerson]);
  await pg.query("insert into member_directory_preferences(member_id) values($1),($2)", [ids.member, ids.shaperMember]);
  await pg.query("insert into circles(id,name,status,activated_at,ends_at) values($1,'Circle One','active',now()-interval '1 day',null),($2,'Other Circle','active',now()-interval '1 day',null)", [ids.circle, ids.otherCircle]);
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
  await pg.exec(await readFile(new URL("../db/migrations/20261012185853_member_profile_identity.sql", import.meta.url), "utf8"));
  const identity = { account_state: "active", administrative_onboarding_state: "completed", auth_user_id: ids.auth, billing_state: "active", cancellation_effective_at: null, email: "member@example.test", foundations_state: revealed ? "completed" : "in_progress", member_id: ids.member, person_id: ids.person, program_state: "onboarding", standing_state: "active" };
  if (!revealed) await pg.exec("update member_lifecycle set foundations_state='in_progress'");
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
              : value !== null && /^\s*::jsonb\b/.test(this.strings[index + 1]) ? types.json.serialize(value)
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
    "@/lib/database/server": { getApplicationDatabase: () => makeDb(pg) },
    "@/lib/membership/access-policy": policy,
    "@/lib/membership/member-tag": await loadModule("src/lib/membership/member-tag.ts", {}),
  });
  const cardModel = await loadModule("src/lib/membership/public-card-model.ts", {});
  let cardRepository;
  const repository = await loadModule("src/lib/membership/repository.ts", {
    "@/lib/foundations/availability": loadFoundationsAvailability(),
    "./badge-repository": { getMemberBadges: async () => [] },
    "./registration-repository": existingMemberRegistration,
    ...existingMemberIntakeDependencies,
    "./public-card-model": cardModel,
    "./public-card-repository": { saveProfileCardSettings: (...args) => cardRepository.saveProfileCardSettings(...args) },
    "libphonenumber-js/min": require("libphonenumber-js/min"),
    "@/lib/database/server": { getApplicationDatabase: () => makeDb(pg) },
    "@/lib/membership/access-policy": policy,
    "@/lib/membership/member-tag": await loadModule("src/lib/membership/member-tag.ts", {}),
    "@/lib/membership/phone": phoneModel,
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
    assert.equal(rows[0].previous_preferences.directory_status, "circle_visible");
    assert.equal(rows[0].next_preferences.directory_status, "circle_visible");
  } finally { await pg.close(); }
});

test("Circle identity and bio are visible by default; contact and location fields require explicit sharing", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("update person_profiles set member_tag='circle_shaper' where person_id=$1", [ids.shaperPerson]);
    await pg.query("update person_profiles set member_tag='my_private_tag' where person_id=$1", [ids.person]);
    let circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.members[0].id, "member:1");
    assert.equal(circle.members[0].memberTag, "my_private_tag", "the owner can see their own tag while their directory profile is hidden");
    assert.equal(circle.shaper.id, "shaper:1");
    assert.equal(circle.members.some((member) => member.id === circle.shaper.id), false);
    for (const field of ["location", "buildingNow", "email", "phone"]) assert.equal(circle.shaper[field], null, field);
    assert.equal(circle.shaper.memberTag, "circle_shaper");
    assert.equal(circle.shaper.bio, "Private by choice");
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

test("Circle roster excludes a deleted member even when a historical placement remains open", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)", [ids.shaperMember, ids.circle]);
    const before = await repository.getMemberCircle(ids.auth);
    assert.equal(before.members.length, 2);
    await pg.query("update ruined_members set deleted_at=now() where id=$1", [ids.shaperMember]);
    const after = await repository.getMemberCircle(ids.auth);
    assert.equal(after.members.length, 1);
    assert.equal(after.members[0].id, before.members[0].id);
    assert.equal((await pg.query("select count(*)::int as count from circle_member_assignments where ended_at is null")).rows[0].count, 2, "the read filter preserves historical placement records");
  } finally { await pg.close(); }
});

test("an administrator assigned as Shaper appears without a second role grant and keeps directory privacy", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("update platform_role_grants set role_slug='ops_admin' where auth_user_id=$1", [ids.shaperAuth]);
    const grantsBefore = (await pg.query("select * from platform_role_grants where auth_user_id=$1", [ids.shaperAuth])).rows;
    let circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.shaper.displayName, "Circle Shaper");
    for (const field of ["location", "buildingNow", "email", "phone"]) assert.equal(circle.shaper[field], null, field);
    assert.equal(circle.shaper.bio, "Private by choice");
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

test("revealed members with a legacy onboarding projection can still join their active Circle gathering", async () => {
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

test("held funded members can view and join only an explicit operator invitation without opening their profile", async () => {
  const { pg, identity, repository } = await fixture({ revealed: false });
  const invitedId = uuid(18), uninvitedId = uuid(19), selfRegisteredId = uuid(20);
  try {
    identity.registration_held = true;
    await pg.query("insert into member_registration_access(member_id,profile_activated_at) values($1,null)", [ids.member]);
    await pg.query("insert into person_email_addresses(person_id,email,is_primary,verification_state) values($1,'member@example.test',true,'verified')", [ids.person]);
    for (const id of [invitedId, uninvitedId, selfRegisteredId]) {
      await pg.query("insert into experiences(id,slug,kind,title,starts_at,ends_at,timezone,registration_mode,visibility,status) values($1,$2,'membership_call','Foundations call',now()+interval '1 day',now()+interval '1 day 90 minutes','America/Denver','internal','invite_only','published')", [id, `invited-${id}`]);
      await pg.query("insert into integration_entity_links values('google','experience',$1,'meet_space',false,$2)", [id, JSON.stringify({ url: "https://meet.google.com/abc-defg-hij" })]);
    }
    for (const [id, source] of [[invitedId, "ops"], [selfRegisteredId, "member"]]) {
      await pg.query("insert into experience_registrations(experience_id,person_id,member_id,status,source,registered_at) values($1,$2,$3,'registered',$4,now())", [id, ids.person, ids.member, source]);
    }
    const before = (await pg.query("select * from member_lifecycle where member_id=$1", [ids.member])).rows;
    const calendar = await repository.getMemberExperiences(ids.auth);
    assert.deepEqual(calendar.upcoming.map(event => event.id), [invitedId]);
    assert.equal(calendar.upcoming[0].registrationHref, null, "A directly invited member does not need to reserve a place");
    assert.equal(calendar.upcoming[0].meetingUrl, `/api/my/experiences/${invitedId}/join`);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, invitedId), "https://meet.google.com/abc-defg-hij");
    for (const id of [ids.event, ids.otherEvent, ids.allEvent, uninvitedId, selfRegisteredId]) {
      await assert.rejects(() => repository.getMemberExperienceMeetingDestination(ids.auth, id), repository.MembershipAccessDeniedError);
    }
    for (const action of ["register", "cancel"]) {
      await assert.rejects(() => repository.setMemberExperienceRegistration(ids.auth, invitedId, action), repository.MembershipAccessDeniedError);
    }
    await assert.rejects(() => repository.getMemberProfile(ids.auth), repository.MembershipAccessDeniedError);
    const circle = await repository.getMemberCircle(ids.auth);
    assert.equal(circle.revealStatus, "locked");
    assert.equal(circle.circle, null);
    assert.deepEqual(circle.members, []);
    assert.deepEqual(circle.meetings, []);
    assert.deepEqual((await pg.query("select * from member_lifecycle where member_id=$1", [ids.member])).rows, before);
    assert.equal((await pg.query("select profile_activated_at from member_registration_access where member_id=$1", [ids.member])).rows[0].profile_activated_at, null);

    for (const status of ["cancelled", "waitlisted", "external_pending"]) {
      await pg.query("update experience_registrations set status=$1 where experience_id=$2", [status, invitedId]);
      assert.deepEqual((await repository.getMemberExperiences(ids.auth)).upcoming, []);
      await assert.rejects(() => repository.getMemberExperienceMeetingDestination(ids.auth, invitedId), repository.MembershipAccessDeniedError);
    }
    await pg.query("update experience_registrations set status='registered' where experience_id=$1", [invitedId]);
    await pg.query("update experiences set status='draft' where id=$1", [invitedId]);
    assert.deepEqual((await repository.getMemberExperiences(ids.auth)).upcoming, []);
    await pg.query("update experiences set status='published' where id=$1", [invitedId]);
    await pg.query("update person_email_addresses set verification_state='unverified' where person_id=$1", [ids.person]);
    assert.deepEqual((await repository.getMemberExperiences(ids.auth)).upcoming, []);
    await pg.query("update person_email_addresses set verification_state='verified' where person_id=$1", [ids.person]);
    await pg.query("update platform_users set status='suspended' where auth_user_id=$1", [ids.auth]);
    assert.deepEqual((await repository.getMemberExperiences(ids.auth)).upcoming, []);
  } finally { await pg.close(); }
});

test("revealed members retain explicitly assigned Circle resources within existing access policy", async () => {
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
      await pg.query("insert into ruined_members(id,person_id) values($1,$1)", [member]);
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
      card: { ...initialCard.settings, publicEnabled: true, version: initialCard.version },
    };
    const saved = await repository.saveMemberProfile(ids.auth, input);
    assert.equal(saved.directory.displayName.length, 120); assert.equal(saved.directory.bio.length, 1200); assert.equal(saved.directory.buildingNow.length, 500);
    const publicState = await cardRepository.getOwnMemberCard(ids.auth), token = publicState.publicUrl.split("/").pop();
    assert.equal((await cardRepository.getPublicMemberCard(token)).bio, null);
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

test("tag first-claim conflict, permanent tag and stale revision roll back the complete save", async () => {
  const { pg, repository } = await fixture();
  try {
    const initial = await repository.getMemberProfile(ids.auth);
    await pg.query("update person_profiles set member_tag='already_taken' where person_id=$1", [ids.shaperPerson]);
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(initial, { memberTag: "@Already_Taken", displayName: "Should roll back" })),
      error => error instanceof repository.MembershipConflictError && error.code === "member_tag_unavailable");
    assert.equal((await repository.getMemberProfile(ids.auth)).revision, initial.revision);
    const saved = await repository.saveMemberProfile(ids.auth, tagProfileInput(initial, { memberTag: "member_one" }));
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(saved, { memberTag: "replacement", bio: "Never persist" })), repository.MembershipInputError);
    assert.equal((await repository.getMemberProfile(ids.auth)).revision, saved.revision);
    await assert.rejects(pg.query("update person_profiles set member_tag='bypass' where person_id=$1", [ids.person]), { code: "P4210" });
    await assert.rejects(pg.query("update person_profiles set member_tag=null where person_id=$1", [ids.person]), { code: "P4210" });
    await pg.query("update person_profiles set bio='Changed elsewhere' where person_id=$1", [ids.person]);
    await assert.rejects(repository.saveMemberProfile(ids.auth, tagProfileInput(saved)), repository.MembershipConflictError);
  } finally { await pg.close(); }
});

test("full name replaces a generated tag label, city and state round trip, and removed fields are preserved", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("update person_profiles set member_tag='old_tag',display_name='@old_tag',website_url='https://kept.example.test' where person_id=$1", [ids.person]);
    await pg.query("insert into person_private_profiles(person_id,legal_name,accessibility_notes) values($1,'Alex Morgan','Keep this private')", [ids.person]);
    const initial = await repository.getMemberProfile(ids.auth);
    assert.equal(initial.directory.fullName, "Alex Morgan");
    const input = { revision: initial.revision, fullName: "Alex Morgan", memberTag: "old_tag", city: "Salt Lake City", state: "Utah", bio: "A public bio", buildingNow: "A project", timezone: "America/Denver", directory: { emailScope: "circle", phoneScope: "none" } };
    const saved = await repository.saveMemberProfile(ids.auth, input);
    assert.equal(saved.directory.displayName, "Alex Morgan");
    assert.equal(saved.directory.city, "Salt Lake City");
    assert.equal(saved.directory.state, "Utah");
    assert.equal(saved.directory.location, "Salt Lake City, Utah");
    assert.equal(saved.directory.websiteUrl, "https://kept.example.test");
    assert.equal(saved.privateProfile.accessibilityNotes, "Keep this private");
    assert.equal(saved.preferences.directoryStatus, "circle_visible");
    assert.equal(saved.preferences.bioVisible, true);
    assert.equal(saved.preferences.emailScope, "circle");
    assert.equal(saved.preferences.phoneScope, "none");
    await assert.rejects(repository.saveMemberProfile(ids.auth, { ...input, revision: saved.revision, timezone: "Not/A_Timezone" }), repository.MembershipInputError);
    assert.equal((await repository.getMemberProfile(ids.auth)).revision, saved.revision);
    const cleared = await repository.saveMemberProfile(ids.auth, { ...input, revision: saved.revision, city: "", state: "" });
    assert.equal(cleared.directory.city, null);
    assert.equal(cleared.directory.state, null);
    assert.equal(cleared.directory.location, null);
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


test("approved placement reveals no Circle data or direct links until Foundations completes", async () => {
  const { pg, identity, repository } = await fixture({ revealed: false });
  try {
    await pg.query("update circles set story='A private Circle story' where id=$1", [ids.circle]);
    await pg.query("insert into integration_entity_links values('google','circle',$1,'chat_space',false,$2)", [ids.circle, JSON.stringify({ url: "https://chat.google.com/room/private" })]);
    const hidden = await repository.getMemberCircle(ids.auth);
    assert.equal(hidden.revealStatus, "locked");
    assert.equal(hidden.circle, null);
    assert.equal(hidden.shaper, null);
    assert.equal(hidden.block, null);
    for (const field of ["members", "meetings", "resources"]) assert.deepEqual(hidden[field], []);
    assert.equal(hidden.communication.chatHref, null);
    assert.doesNotMatch(JSON.stringify(hidden), /Circle One|private Circle story|shaper@example|Private Circle content/);
    assert.equal(await repository.getMemberCircleChatDestination(ids.auth), null);
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, ids.event), null);
    assert.equal((await repository.getMemberExperiences(ids.auth)).upcoming.length, 0);
    assert.equal(await repository.getMemberLearningResource(ids.auth, "circle-notes"), null);
    await assert.rejects(() => repository.setMemberExperienceRegistration(ids.auth, ids.event, "register"), repository.MembershipAccessDeniedError);
    identity.foundations_state = "completed";
    await pg.exec("update member_lifecycle set foundations_state='completed'");
    const visible = await repository.getMemberCircle(ids.auth);
    assert.equal(visible.revealStatus, "revealed");
    assert.equal(visible.circle.name, "Circle One");
    assert.equal(visible.circle.story, "A private Circle story");
    assert.ok(visible.members.length);
    assert.ok(visible.meetings.length);
    assert.ok(await repository.getMemberCircleChatDestination(ids.auth));
    assert.ok(await repository.getMemberLearningResource(ids.auth, "circle-notes"));
    assert.equal(await repository.getMemberExperienceMeetingDestination(ids.auth, ids.otherEvent), null);
  } finally { await pg.close(); }
});


const privateDetails = (changes = {}) => ({
  mobile: "+12025550124", birthDate: "1992-02-29", apparelTopSize: "Custom tall",
  shippingAddress: { addressLine1: "12 Private Lane", addressLine2: "Unit 4", city: "Denver", region: "CO", postalCode: "80202", countryCode: "US" },
  ...changes,
});
const privateProfileInput = (snapshot, changes = {}) => ({
  revision: snapshot.revision, fullName: "Member One", memberTag: snapshot.directory.memberTag ?? "member_one",
  city: "Public City", state: "Public State", bio: "Public bio", buildingNow: "Current work", timezone: "America/Denver",
  directory: { emailScope: "none", phoneScope: "none" }, privateProfile: privateDetails(), ...changes,
});
async function installProfileConsentFixture(pg) {
  const foundation = await readFile(new URL("../db/migrations/20260819_platform_foundation.sql", import.meta.url), "utf8");
  const start = foundation.indexOf("create table if not exists member_consents (");
  await pg.exec(foundation.slice(start, foundation.indexOf("create index if not exists member_consents_member_idx", start)));
  await pg.exec(await readFile(new URL("../db/migrations/20261008210000_member_sms_phone_consent.sql", import.meta.url), "utf8"));
}

test("one profile save round trips private details, preserves legacy metadata, and exposes only public fields", async () => {
  const { pg, identity, repository, cardRepository } = await fixture();
  try {
    await pg.query("insert into person_private_profiles(person_id,legal_name,accessibility_notes,default_fulfillment_address,apparel_sizing) values($1,'Private legal name','Preserve these private notes',$2,$3)",
      [ids.person, JSON.stringify({ deliveryInstructions: "Side door", recipient: "Keep recipient", city: "Old City" }), JSON.stringify({ top: "S", pants: "32", fit: { sleeve: "long" } })]);
    await pg.query("update person_profiles set website_url='https://kept.example.test' where person_id=$1", [ids.person]);
    const initial = await repository.getMemberProfile(ids.auth);
    const saved = await repository.saveMemberProfile(ids.auth, privateProfileInput(initial));
    assert.equal(saved.privateProfile.mobile, "+12025550124");
    assert.equal(saved.privateProfile.birthDate, "1992-02-29");
    assert.deepEqual(saved.privateProfile.fulfillmentAddress, { ...privateDetails().shippingAddress, deliveryInstructions: "Side door", recipient: "Keep recipient" });
    assert.deepEqual(saved.privateProfile.apparelSizing, { top: "Custom tall", pants: "32", fit: { sleeve: "long" } });
    assert.equal(saved.privateProfile.legalName, "Private legal name");
    assert.equal(saved.privateProfile.accessibilityNotes, "Preserve these private notes");
    assert.equal(saved.directory.websiteUrl, "https://kept.example.test");
    assert.equal(saved.directory.location, "Public City, Public State");
    assert.equal(saved.preferences.phoneScope, "none");
    await pg.exec("alter table ruined_members add column member_number integer default 7");
    const publicProfile = await cardRepository.getPublicMemberProfile("member_one");
    assert.deepEqual(publicProfile, { name: "Member One", memberTag: "member_one", bio: "Public bio", memberNumber: 7 });
    await pg.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)", [ids.shaperMember, ids.circle]);
    const originalIdentity = { ...identity };
    Object.assign(identity, { auth_user_id: ids.shaperAuth, member_id: ids.shaperMember, person_id: ids.shaperPerson, email: "shaper@example.test" });
    const peerCircle = await repository.getMemberCircle(ids.shaperAuth);
    Object.assign(identity, originalIdentity);
    const publicProjections = JSON.stringify([publicProfile, (await cardRepository.getOwnMemberCard(ids.auth)).card,
      await cardRepository.getInvitationMemberCard(ids.member), peerCircle]);
    for (const secret of ["12025550124", "1992-02-29", "12 Private Lane", "Unit 4", "80202", "Custom tall", "Side door", "Private legal name", "Preserve these private notes"]) assert.equal(publicProjections.includes(secret), false, secret);
    const omitted = await repository.saveMemberProfile(ids.auth, privateProfileInput(saved, { privateProfile: undefined }));
    assert.deepEqual(omitted.privateProfile, saved.privateProfile, "older clients preserve private fields they do not submit");
    const blank = privateDetails({ mobile: "", birthDate: "", apparelTopSize: "", shippingAddress: { addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", countryCode: "US" } });
    const cleared = await repository.saveMemberProfile(ids.auth, privateProfileInput(omitted, { privateProfile: blank }));
    assert.equal(cleared.privateProfile.mobile, null); assert.equal(cleared.privateProfile.birthDate, null);
    assert.deepEqual(cleared.privateProfile.fulfillmentAddress, { deliveryInstructions: "Side door", recipient: "Keep recipient" });
    assert.deepEqual(cleared.privateProfile.apparelSizing, { pants: "32", fit: { sleeve: "long" } });
  } finally { await pg.close(); }
});

test("private field validation rejects malformed or overlong values without changing any profile state", async () => {
  const { pg, repository } = await fixture();
  try {
    const initial = await repository.getMemberProfile(ids.auth);
    const details = privateDetails();
    const invalid = [null, [], { ...details, sms: true }, { ...details, mobile: 123 },
      { ...details, mobile: "2025550124" }, { ...details, mobile: "+1" }, { ...details, mobile: "+12025550124 ext 2" },
      ...["1899-12-31", "2999-01-01", "2023-02-29", "1992-2-29", "not-a-date"].map(birthDate => ({ ...details, birthDate })),
      { ...details, apparelTopSize: "X".repeat(41) }, { ...details, shippingAddress: null },
      { ...details, shippingAddress: { ...details.shippingAddress, surprise: "hidden" } },
      ...["addressLine1", "city", "region", "postalCode", "countryCode"].map(key => ({ ...details, shippingAddress: { ...details.shippingAddress, [key]: "" } })),
      { ...details, shippingAddress: { ...details.shippingAddress, countryCode: "ZZ" } },
      ...[["addressLine1", 161], ["addressLine2", 161], ["city", 101], ["region", 101], ["postalCode", 25]].map(([key, length]) => ({ ...details, shippingAddress: { ...details.shippingAddress, [key]: "x".repeat(length) } })),
    ];
    for (const privateProfile of invalid) {
      await assert.rejects(repository.saveMemberProfile(ids.auth, privateProfileInput(initial, { bio: "Must not persist", privateProfile })), repository.MembershipInputError);
      assert.equal((await repository.getMemberProfile(ids.auth)).revision, initial.revision);
    }
    assert.equal((await pg.query("select count(*)::int as count from member_directory_preference_events")).rows[0].count, 0);
    const blank = privateDetails({ mobile: "", birthDate: "", apparelTopSize: "", shippingAddress: { addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", countryCode: "US" } });
    const empty = await repository.saveMemberProfile(ids.auth, privateProfileInput(initial, { privateProfile: blank }));
    assert.equal(empty.privateProfile.fulfillmentAddress, null); assert.equal(empty.privateProfile.apparelSizing, null);
  } finally { await pg.close(); }
});

test("private field edits in another session invalidate stale profile revisions", async () => {
  const { pg, repository } = await fixture();
  try {
    let saved = await repository.saveMemberProfile(ids.auth, privateProfileInput(await repository.getMemberProfile(ids.auth)));
    for (const change of ["mobile_e164='+12025550125'", "birth_date='1990-01-01'", "default_fulfillment_address=default_fulfillment_address || '{\"city\":\"Changed elsewhere\"}'::jsonb", "apparel_sizing=apparel_sizing || '{\"top\":\"Changed size\"}'::jsonb"]) {
      await pg.query(`update person_private_profiles set ${change} where person_id=$1`, [ids.person]);
      const current = await repository.getMemberProfile(ids.auth);
      assert.notEqual(current.revision, saved.revision);
      await assert.rejects(repository.saveMemberProfile(ids.auth, privateProfileInput(saved)), repository.MembershipConflictError);
      assert.deepEqual((await repository.getMemberProfile(ids.auth)).privateProfile, current.privateProfile);
      saved = current;
    }
  } finally { await pg.close(); }
});

test("private profile phone changes withdraw SMS consent, retain login identity, and roll back with the entire save", async () => {
  const { pg, repository } = await fixture();
  try {
    await pg.query("insert into person_private_profiles(person_id,mobile_e164) values($1,'+12025550124')", [ids.person]);
    await installProfileConsentFixture(pg);
    await pg.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
      values($1,'communications','membership-reminders-v1','accepted',now(),'member',$2,$3,'fixture-sms-consent')`,
      [ids.member, ids.auth, JSON.stringify({ context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "sms", destination: "+12025550124", action: "sms_checkbox_checked", requested: true })]);
    const accountBefore = (await pg.query("select * from platform_users where auth_user_id=$1", [ids.auth])).rows;
    const originalConsent = (await pg.query("select * from member_consents order by id")).rows[0];
    let saved = await repository.saveMemberProfile(ids.auth, privateProfileInput(await repository.getMemberProfile(ids.auth)));
    assert.equal((await pg.query("select count(*)::int as count from member_consents")).rows[0].count, 1, "unchanged phone retains original consent");
    await pg.exec("create function reject_profile_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture save failure'; end$$; create trigger reject_profile_audit before insert on member_directory_preference_events for each row execute function reject_profile_audit()");
    await assert.rejects(repository.saveMemberProfile(ids.auth, privateProfileInput(saved, { bio: "Rollback public bio", privateProfile: privateDetails({ mobile: "+12025550125" }) })), /Fixture save failure/);
    assert.equal((await repository.getMemberProfile(ids.auth)).revision, saved.revision);
    assert.equal((await pg.query("select count(*)::int as count from member_consents")).rows[0].count, 1, "consent withdrawal rolls back with private and public edits");
    await pg.exec("drop trigger reject_profile_audit on member_directory_preference_events");
    saved = await repository.saveMemberProfile(ids.auth, privateProfileInput(saved, { privateProfile: privateDetails({ mobile: "+12025550125" }) }));
    const consent = (await pg.query("select * from member_consents order by id")).rows;
    assert.equal(consent.length, 2); assert.deepEqual(consent[0], originalConsent);
    assert.equal(consent[1].decision, "withdrawn"); assert.equal(consent[1].evidence.action, "profile_phone_changed");
    assert.equal(consent[1].evidence.destination, "+12025550124");
    await repository.saveMemberProfile(ids.auth, privateProfileInput(saved));
    assert.equal((await pg.query("select count(*)::int as count from member_consents")).rows[0].count, 2, "returning to the old number never restores consent");
    assert.deepEqual((await pg.query("select * from platform_users where auth_user_id=$1", [ids.auth])).rows, accountBefore);
  } finally { await pg.close(); }
});
