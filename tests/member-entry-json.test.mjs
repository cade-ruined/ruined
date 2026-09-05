import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { Parameter, types as postgresTypes } from "../node_modules/postgres/src/types.js";

const require = createRequire(import.meta.url);
// No query is submitted to this lazy client. Its actual json() helper and
// serializer are used so mocks cannot silently accept pre-stringified JSON.
const driver = postgres({ host: "127.0.0.1", max: 1, prepare: false });
const ids = {
  auth: "11111111-1111-4111-8111-111111111111",
  person: "22222222-2222-4222-8222-222222222222",
  member: "33333333-3333-4333-8333-333333333333",
  agreement: "44444444-4444-4444-8444-444444444444",
  attempt: "55555555-5555-4555-8555-555555555555",
  acceptance: "66666666-6666-4666-8666-666666666666",
};
const profileInput = {
  apparelTopSize: "L", birthDate: "1990-01-15", legalName: "Test Member", mobile: "+12025550123", preferredName: "Test",
  shippingAddress: { addressLine1: "100 Test Street", addressLine2: null, city: "Test City", countryCode: "US", postalCode: "84000", region: "UT" },
};
const agreementInput = {
  affirmativeAction: "checkbox_and_submit", ageConfirmed: true, agreementVersionId: ids.agreement,
  evidence: { origin: "https://members.example.test", userAgent: "x".repeat(600) },
  minimumAge: 18, signerName: profileInput.legalName, attemptId: ids.attempt,
};

async function loadModule(path, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

const accessPolicy = await loadModule("src/lib/membership/access-policy.ts", {});
async function loadEntryRepository(database) {
  return loadModule("src/lib/membership/repository.ts", {
    "libphonenumber-js/min": require("libphonenumber-js/min"),
    "@/lib/database/server": { getApplicationDatabase: () => database },
    "@/lib/membership/access-policy": accessPolicy,
    "@/lib/membership/phone": { supportedShippingCountry: (country) => country === "US" ? "US" : null },
    "@/lib/membership/avatar-url": { safeMemberAvatarUrl: (url) => url },
    "@/lib/events/member-experiences": {},
    "@/lib/google/communications": {},
    "@/lib/membership/artifact-products": {},
    "@/lib/platform/ops-calendar-repository": {},
    "@/lib/platform/calendar-audience-invalidation": { markCalendarAudiencesPendingForMember: async () => {} },
    "@/lib/platform/experience-member-access": {},
  });
}

function compiledQuery(strings, values, jsonParameters) {
  let query = strings[0];
  const parameters = values.map((value, index) => {
    query += `$${index + 1}${strings[index + 1]}`;
    const jsonCast = /^\s*::jsonb\b/.test(strings[index + 1]);
    if (jsonCast) {
      assert.ok(value instanceof Parameter, "JSONB entry parameters must use the actual postgres-js json() helper");
      assert.equal(value.type, 3802);
      assert.equal(typeof value.value, "object");
      assert.ok(value.value !== null && !Array.isArray(value.value));
      const serialized = postgresTypes.json.serialize(value.value);
      assert.equal(typeof JSON.parse(serialized), "object");
      jsonParameters.push(JSON.parse(serialized));
      return serialized;
    }
    if (value instanceof Date) return postgresTypes.date.serialize(value);
    return value;
  });
  return { query, parameters };
}

function fakeEntryDatabase(birthDate = new Date("1990-01-15T00:00:00.000Z")) {
  const queries = [];
  const jsonParameters = [];
  let completed = false;
  const database = (strings, ...values) => {
    const { query, parameters } = compiledQuery(strings, values, jsonParameters);
    queries.push(query.replace(/\s+/g, " ").trim());
    if (query.includes("from platform_users platform_user")) return [{
      account_state: "active", administrative_onboarding_state: completed ? "completed" : "in_progress",
      auth_user_id: ids.auth, billing_state: "active", cancellation_effective_at: null,
      email: "member@example.test", foundations_state: "not_started", member_id: ids.member, person_id: ids.person,
      program_state: "prospect", standing_state: "pre_active",
    }];
    if (query.includes("with current_agreement as")) return [{
      state: completed ? "completed" : "in_progress", completed_at: completed ? new Date() : null,
      preferred_name: "Test", avatar_storage_path: null, legal_name: profileInput.legalName,
      mobile_e164: profileInput.mobile, birth_date: birthDate, shipping_address: profileInput.shippingAddress,
      apparel_sizing: { top: profileInput.apparelTopSize }, agreement_id: ids.agreement,
      agreement_version: 1, agreement_title: "Membership", agreement_body: "Test agreement", agreement_published_at: new Date(),
      acceptance_id: null, accepted_at: null, receipt_id: null,
    }];
    if (query.includes("select private_profile.birth_date")) return [{ birth_date: birthDate, legal_name: profileInput.legalName }];
    if (query.includes("as eligible")) return [{ eligible: true }];
    if (query.includes("select id, agreement_key, version")) return [{ id: ids.agreement, agreement_key: "ruined_membership", version: 1, title: "Membership", body_text: "Test agreement", content_sha256: "a".repeat(64) }];
    if (query.includes("insert into member_consents")) return [{ id: 1 }];
    if (query.includes("insert into membership_agreement_acceptances")) return [{ id: ids.acceptance, accepted_at: new Date(), agreement_key_snapshot: "ruined_membership", agreement_version_snapshot: 1 }];
    if (query.includes("select administrative_onboarding_state, program_state")) return [{ administrative_onboarding_state: "in_progress", program_state: "prospect", standing_state: "pre_active" }];
    if (query.includes("update member_onboardings onboarding")) { completed = true; return [{ member_id: parameters[0] }]; }
    return [];
  };
  database.json = driver.json;
  database.begin = async (callback) => callback(database);
  return { database, queries, jsonParameters };
}

test("postgres-js JSON serializer reproduces the old double-serialization defect", () => {
  const object = { top: "L" };
  const oldWireValue = postgresTypes.json.serialize(JSON.stringify(object));
  assert.equal(typeof JSON.parse(oldWireValue), "string");
  const typed = driver.json(object);
  assert.ok(typed instanceof Parameter);
  assert.equal(typed.type, 3802);
  assert.deepEqual(JSON.parse(postgresTypes.json.serialize(typed.value)), object);
});

test("the complete entry save and agreement transactions send all six JSON parameters as typed objects", async () => {
  const fixture = fakeEntryDatabase();
  const repository = await loadEntryRepository(fixture.database);
  const saved = await repository.saveMemberOnboardingProfile(ids.auth, profileInput);
  assert.equal(saved.requiredFieldsComplete, true);
  assert.equal(saved.profile.birthDate, profileInput.birthDate);
  const accepted = await repository.acceptPublishedMembershipAgreement(ids.auth, agreementInput);
  assert.equal(accepted.acceptance.id, ids.acceptance);
  assert.equal(fixture.jsonParameters.length, 6);
  assert.deepEqual(fixture.jsonParameters[0], profileInput.shippingAddress);
  assert.deepEqual(fixture.jsonParameters[1], { top: "L" });
  assert.equal(fixture.jsonParameters[2].shippingAddress, true);
  assert.deepEqual(fixture.jsonParameters[3], { minimumAge: 18, source: "my_ruined" });
  assert.deepEqual(fixture.jsonParameters[4], { channel: "my_ruined", origin: agreementInput.evidence.origin, userAgent: "x".repeat(500) });
  assert.deepEqual(fixture.jsonParameters[5], fixture.jsonParameters[2]);
  assert.ok(fixture.queries.some((query) => query.includes("(select accepted_at from membership_agreement_acceptances where id = ")),
    "The agreement checkpoint must reuse PostgreSQL timestamp precision instead of the rounded JavaScript Date");
  const completed = await repository.completeMemberAdministrativeOnboarding(ids.auth);
  assert.equal(completed.state, "completed");
  assert.equal(fixture.jsonParameters.length, 6, "completion uses safe static JSON literals, not stringified parameters");
  for (const table of ["person_profiles", "person_private_profiles", "member_onboardings", "member_onboarding_events", "member_consents", "membership_agreement_acceptances", "member_state_history"]) {
    assert.ok(fixture.queries.some((query) => query.includes(`insert into ${table}`)), `The full entry path must write ${table}`);
  }
});

test("entry reload returns a date-input-compatible birth date for Date and string database values", async () => {
  for (const input of [new Date("1990-01-15T00:00:00.000Z"), "1990-01-15", "1990-01-15T00:00:00.000Z"]) {
    const { database } = fakeEntryDatabase(input);
    assert.equal((await (await loadEntryRepository(database)).getMemberOnboarding(ids.auth)).profile.birthDate, "1990-01-15");
  }
  const { database } = fakeEntryDatabase(null);
  assert.equal((await (await loadEntryRepository(database)).getMemberOnboarding(ids.auth)).profile.birthDate, null);
});

test("entry date validation rejects impossible, pre-1900 and future dates before any transaction writes", async () => {
  for (const birthDate of ["1899-12-31", "0000-01-01", "2001-02-29", "2000-02-30", "1990-04-31", "1990-13-01", "1990-00-01", "2999-01-01", "01/15/1990"]) {
    const { database, queries } = fakeEntryDatabase();
    const repository = await loadEntryRepository(database);
    await assert.rejects(() => repository.saveMemberOnboardingProfile(ids.auth, { ...profileInput, birthDate }), (error) => error instanceof repository.MembershipInputError);
    assert.equal(queries.some((query) => /^(insert|update)/i.test(query)), false);
  }
  for (const birthDate of ["1900-01-01", "2000-02-29", "1990-01-15"]) {
    const { database } = fakeEntryDatabase(birthDate);
    const repository = await loadEntryRepository(database);
    assert.equal((await repository.saveMemberOnboardingProfile(ids.auth, { ...profileInput, birthDate })).profile.birthDate, birthDate);
  }
});

function exactTable(source, name) {
  const definition = source.match(new RegExp(`create table if not exists (?:public\\.)?${name} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(definition, `Shipped ${name} table definition must be available`);
  return definition;
}

test("entry saves, reloads, accepts the agreement and completes against actual isolated PostgreSQL constraints", async () => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  const identitySchema = await readFile(new URL("../db/migrations/20260826_membership_operating_spine_01_person_identity.sql", import.meta.url), "utf8");
  const lifecycleSchema = await readFile(new URL("../db/migrations/20260826_membership_operating_spine_02_lifecycle_agreements.sql", import.meta.url), "utf8");
  const foundationSchema = await readFile(new URL("../db/migrations/20260819_platform_foundation.sql", import.meta.url), "utf8");
  const phoneMigration = await readFile(new URL("../db/migrations/20260903225243_member_phone_e164_constraint.sql", import.meta.url), "utf8");
  const jsonParameters = [];
  const wrap = (engine) => {
    const database = async (strings, ...values) => {
      const { query, parameters } = compiledQuery(strings, values, jsonParameters);
      const result = await engine.query(query, parameters);
      return result.rows.map((row) => ({
        ...row,
        ...(row.birth_date ? { birth_date: new Date(row.birth_date) } : {}),
        ...(row.accepted_at ? { accepted_at: new Date(row.accepted_at) } : {}),
      }));
    };
    database.json = driver.json;
    database.begin = (callback) => engine.transaction((transaction) => callback(wrap(transaction)));
    return database;
  };
  try {
    await db.exec(`
      create table people (id uuid primary key);
      create table ruined_members (id uuid primary key, person_id uuid not null references people(id), email text, unique(id,person_id));
      create table platform_users (auth_user_id uuid primary key, person_id uuid, status text);
      create table platform_role_grants (auth_user_id uuid, role_slug text, revoked_at timestamptz);
      create table person_email_addresses (person_id uuid, email text, verification_state text, retired_at timestamptz, is_primary boolean, created_at timestamptz);
      create table member_lifecycle (member_id uuid primary key, account_state text, billing_state text, program_state text,
        foundations_state text, administrative_onboarding_state text, standing_state text, cancellation_effective_at timestamptz,
        access_started_at timestamptz, version bigint not null default 1, updated_at timestamptz not null default now());
      create table member_state_history (member_id uuid, dimension text, previous_state text, next_state text, reason_code text,
        source text, actor_auth_user_id uuid, dedupe_key text unique);
      ${exactTable(identitySchema, "person_profiles")}
      ${exactTable(identitySchema, "person_private_profiles")}
      ${exactTable(lifecycleSchema, "member_onboardings")}
      ${exactTable(lifecycleSchema, "member_onboarding_events")}
      ${exactTable(foundationSchema, "member_consents")}
      ${exactTable(lifecycleSchema, "membership_agreement_versions")}
      ${exactTable(lifecycleSchema, "membership_agreement_acceptances")}
      ${exactTable(lifecycleSchema, "membership_agreement_receipts")}
    `);
    const guardStart = lifecycleSchema.indexOf("create or replace function private.ruined_validate_member_onboarding_completion()");
    const guardEnd = lifecycleSchema.indexOf("create or replace function private.ruined_validate_lifecycle_onboarding_projection()", guardStart);
    assert.ok(guardStart >= 0 && guardEnd > guardStart);
    await db.exec(`create schema private; ${lifecycleSchema.slice(guardStart, guardEnd)}`);
    // Ensure sub-millisecond precision in this isolated fixture rather than
    // making the regression probabilistic on the database clock.
    await db.exec(`
      create function private.fixture_acceptance_precision() returns trigger language plpgsql as $$
      begin
        new.accepted_at := date_trunc('milliseconds', new.accepted_at) + interval '456 microseconds';
        return new;
      end;
      $$;
      create trigger fixture_acceptance_precision before insert on membership_agreement_acceptances
      for each row execute function private.fixture_acceptance_precision();
    `);
    await db.exec(phoneMigration);
    await db.query("insert into people values ($1)", [ids.person]);
    await db.query("insert into ruined_members values ($1,$2,$3)", [ids.member, ids.person, "member@example.test"]);
    await db.query("insert into platform_users values ($1,$2,'active')", [ids.auth, ids.person]);
    await db.query("insert into platform_role_grants values ($1,'member',null)", [ids.auth]);
    await db.query("insert into person_email_addresses values ($1,'member@example.test','verified',null,true,now())", [ids.person]);
    await db.query("insert into member_lifecycle (member_id,account_state,billing_state,program_state,foundations_state,administrative_onboarding_state,standing_state) values ($1,'active','active','prospect','not_started','in_progress','pre_active')", [ids.member]);
    await db.query("insert into membership_agreement_versions (id,agreement_key,version,title,body_text,content_sha256,status,published_at) values ($1,'ruined_membership',1,'Test agreement','Fictional agreement',$2,'published',now())", [ids.agreement, "a".repeat(64)]);

    // PGlite receives exactly the wire value produced by postgres-js, rather
    // than a JS object that its own convenience serializer would repair.
    const oldWire = postgresTypes.json.serialize(JSON.stringify({ top: "L" }));
    assert.equal((await db.query("select jsonb_typeof($1::jsonb) as type", [oldWire])).rows[0].type, "string");
    await assert.rejects(() => db.query("insert into person_private_profiles (person_id,apparel_sizing) values ($1,$2::jsonb)", [ids.person, oldWire]), { code: "23514" });

    const repository = await loadEntryRepository(wrap(db));
    const saved = await repository.saveMemberOnboardingProfile(ids.auth, profileInput);
    assert.equal(saved.requiredFieldsComplete, true);
    assert.equal(saved.profile.birthDate, "1990-01-15");
    assert.deepEqual(saved.profile.apparelSizing, { top: "L" });
    assert.deepEqual(saved.profile.fulfillmentAddress, profileInput.shippingAddress);
    const updated = await repository.saveMemberOnboardingProfile(ids.auth, { ...profileInput, apparelTopSize: "XL" });
    assert.deepEqual(updated.profile.apparelSizing, { top: "XL" });
    const accepted = await repository.acceptPublishedMembershipAgreement(ids.auth, agreementInput);
    assert.ok(accepted.acceptance.id);
    assert.equal(accepted.onboarding.agreement.acceptanceId, accepted.acceptance.id);
    const again = await repository.acceptPublishedMembershipAgreement(ids.auth, agreementInput);
    assert.equal(again.acceptance.id, accepted.acceptance.id);
    assert.equal((await db.query("select count(*)::int as count from membership_agreement_acceptances")).rows[0].count, 1);
    const precision = (await db.query(`
      select acceptance.accepted_at::text as accepted_at,
        acceptance.accepted_at = onboarding.agreement_completed_at as exact_checkpoint,
        mod(extract(microseconds from acceptance.accepted_at), 1000)::int as sub_millisecond
      from membership_agreement_acceptances acceptance
      join member_onboardings onboarding on onboarding.member_id = acceptance.member_id
    `)).rows[0];
    assert.equal(precision.sub_millisecond, 456);
    assert.equal(precision.exact_checkpoint, true);
    await db.query("update member_onboardings set agreement_completed_at=$1::timestamptz where member_id=$2", [new Date(precision.accepted_at).toISOString(), ids.member]);
    await assert.rejects(() => repository.completeMemberAdministrativeOnboarding(ids.auth), /durable agreement acceptance/);
    await db.query("update member_onboardings set agreement_completed_at=(select accepted_at from membership_agreement_acceptances where id=$1) where member_id=$2", [accepted.acceptance.id, ids.member]);
    const completed = await repository.completeMemberAdministrativeOnboarding(ids.auth);
    assert.equal(completed.state, "completed");
    assert.equal(completed.requiredFieldsComplete, true);
    const stored = (await db.query("select jsonb_typeof(default_fulfillment_address) as address_type, jsonb_typeof(apparel_sizing) as sizing_type from person_private_profiles")).rows[0];
    assert.deepEqual(stored, { address_type: "object", sizing_type: "object" });
    assert.equal((await db.query("select jsonb_typeof(requirements_snapshot) as type from member_onboardings")).rows[0].type, "object");
    assert.equal((await db.query("select jsonb_typeof(acceptance_evidence) as type from membership_agreement_acceptances")).rows[0].type, "object");
    assert.equal((await db.query("select jsonb_typeof(evidence) as type from member_consents")).rows[0].type, "object");
  } finally {
    await db.close();
  }
});
