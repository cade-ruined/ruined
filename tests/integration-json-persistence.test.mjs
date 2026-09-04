import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";

import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const ids = {
  member: "11111111-1111-4111-8111-111111111111",
  person: "22222222-2222-4222-8222-222222222222",
  template: "33333333-3333-4333-8333-333333333333",
  award: "44444444-4444-4444-8444-444444444444",
  action: "55555555-5555-4555-8555-555555555555",
  contact: "66666666-6666-4666-8666-666666666666",
};
const input = { inscription: "Make fewer promises.", measurements: { size: 12 }, approved: true };
const address = { addressLine1: "100 Test Street", addressLine2: null, city: "Test City", countryCode: "US" };

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function exactTable(migration, table) {
  const statement = migration.match(new RegExp(`create table if not exists (?:public\\.)?${table} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(statement, `The shipped ${table} definition must exist`);
  return statement;
}

async function loadRepository(path, database) {
  const compiled = ts.transpileModule(await source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    "server-only": {},
    "node:crypto": crypto,
    "@/lib/database/server": { getApplicationDatabase: () => database },
    "@/lib/membership/agreement-receipt": {},
  };
  const cjsModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, cjsModule, cjsModule.exports);
  return cjsModule.exports;
}

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  // No driver query is ever executed. Its real typed parameter and serializer
  // feed wire values to isolated PostgreSQL instead of a permissive SQL mock.
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  const wrap = (engine) => {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const parameters = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) {
          assert.equal(value.type, 3802);
          return driver.options.serializers[3802](value.value);
        }
        // Model PostgreSQL's inferred JSONB parameter type. This deliberately
        // preserves the old double-encoding defect if stringified JSON returns.
        if (value !== null && /^\s*::jsonb\b/.test(strings[index + 1])) {
          return driver.options.serializers[3802](value);
        }
        return value instanceof Date ? types.date.serialize(value) : value;
      });
      return (await engine.query(query, parameters)).rows;
    };
    sql.json = driver.json;
    sql.begin = (callback) => engine.transaction((transaction) => callback(wrap(transaction)));
    return sql;
  };
  return { db, database: wrap(db), driver };
}

async function seedArtifacts(db, fulfillmentAddress = address) {
  const foundation = await source("db/migrations/20260819_platform_foundation.sql");
  const automation = await source("db/migrations/20260826_membership_operating_spine_04_foundations_automation.sql");
  const awardColumn = automation.match(/alter table public\.artifact_jobs\s+add column if not exists artifact_award_id uuid;/)?.[0];
  assert.ok(awardColumn);
  await db.exec(`
    create table ruined_members (id uuid primary key, person_id uuid not null);
    create table platform_users (auth_user_id uuid primary key);
    create table artifact_template_versions (id uuid primary key);
    create table artifact_awards (id uuid primary key, member_id uuid, artifact_template_version_id uuid, member_input_snapshot jsonb, status text);
    create table person_private_profiles (person_id uuid primary key, default_fulfillment_address jsonb);
    ${exactTable(foundation, "artifact_jobs")}
    ${awardColumn}
    ${exactTable(foundation, "artifact_job_events")}
  `);
  await db.query("insert into ruined_members values ($1,$2)", [ids.member, ids.person]);
  await db.query("insert into artifact_template_versions values ($1)", [ids.template]);
  await db.query("insert into artifact_awards values ($1,$2,$3,$4::jsonb,'awarded')", [ids.award, ids.member, ids.template, JSON.stringify(input)]);
  await db.query("insert into person_private_profiles values ($1,$2::jsonb)", [ids.person, fulfillmentAddress === null ? null : JSON.stringify(fulfillmentAddress)]);
}

const artifactAction = {
  id: ids.action, actionType: "create_artifact_job", targetType: "artifact_award",
  targetId: ids.award, idempotencyKey: "fixture-artifact-job", payload: {},
};

test("Artifact workflow persists usable JSON snapshots and replays without changing the work order", async (t) => {
  const { db, database, driver } = await fixture(t);
  await seedArtifacts(db);
  const repository = await loadRepository("src/lib/workflows/repository.ts", database);
  // Establish that the installed driver + real engine distinguish the old
  // broken encoding from a JSON object, independent of source-string checks.
  const oldWire = driver.options.serializers[3802](JSON.stringify(input));
  assert.equal((await db.query("select jsonb_typeof($1::jsonb) as type", [oldWire])).rows[0].type, "string");
  const created = await repository.executeWorkflowAction(artifactAction);
  assert.equal(created.created, true);
  const stored = (await db.query("select input_snapshot, fulfillment_address_snapshot, input_snapshot->>'inscription' as inscription from artifact_jobs where id=$1", [created.artifactJobId])).rows[0];
  assert.deepEqual(stored.input_snapshot, input);
  assert.deepEqual(stored.fulfillment_address_snapshot, address);
  assert.equal(stored.inscription, input.inscription);

  await db.query("update person_private_profiles set default_fulfillment_address=$1::jsonb", [JSON.stringify({ ...address, city: "Changed later" })]);
  assert.deepEqual(await repository.executeWorkflowAction(artifactAction), { artifactJobId: created.artifactJobId, created: false });
  assert.equal((await db.query("select count(*)::int as count from artifact_jobs")).rows[0].count, 1);
  assert.equal((await db.query("select count(*)::int as count from artifact_job_events")).rows[0].count, 1);
  assert.deepEqual((await db.query("select fulfillment_address_snapshot from artifact_jobs")).rows[0].fulfillment_address_snapshot, address);
});

test("Artifact workflow keeps a missing address as SQL NULL and does not create work for revoked awards", async (t) => {
  const { db, database } = await fixture(t);
  await seedArtifacts(db, null);
  const repository = await loadRepository("src/lib/workflows/repository.ts", database);
  const result = await repository.executeWorkflowAction(artifactAction);
  assert.equal((await db.query("select fulfillment_address_snapshot is null as missing from artifact_jobs where id=$1", [result.artifactJobId])).rows[0].missing, true);
  await db.query("update artifact_awards set status='revoked'");
  await assert.rejects(() => repository.executeWorkflowAction({ ...artifactAction, idempotencyKey: "second-request" }), /not production-ready/);
  assert.equal((await db.query("select count(*)::int as count from artifact_jobs")).rows[0].count, 1);
});

test("Resend contact-sync completion satisfies the shipped JSON constraint and respects its lease", async (t) => {
  const { db, database, driver } = await fixture(t);
  const migration = await source("db/migrations/20260819_communications.sql");
  const snapshotConstraint = migration.match(/alter table communication_contacts\s+add constraint communication_contacts_resend_preferences_snapshot_check[\s\S]*?\n  \);/)?.[0];
  assert.ok(snapshotConstraint);
  await db.exec(`create table ruined_members (id uuid primary key); ${exactTable(migration, "communication_contacts")} ${snapshotConstraint}`);
  const topics = { store: "opt_in", artifacts: "opt_out", about: "opt_in" };
  await db.query("insert into communication_contacts (id,email_normalized,resend_sync_locked_by,resend_sync_started_at,resend_sync_snapshot) values ($1,'member@example.test','fixture-lease',now(),$2::jsonb)", [ids.contact, JSON.stringify(topics)]);
  const oldWire = driver.options.serializers[3802](JSON.stringify(topics));
  await assert.rejects(() => db.query("update communication_contacts set resend_preferences_snapshot=$1::jsonb where id=$2", [oldWire, ids.contact]), { code: "23514" });
  const repository = await loadRepository("src/lib/communications/outbox.ts", database);
  const completedAt = new Date("2026-09-04T12:34:56.123Z");
  await assert.rejects(() => repository.completeResendContactSync(ids.contact, "wrong-lease", "provider-contact", topics, completedAt), /lease was lost/);
  await repository.completeResendContactSync(ids.contact, "fixture-lease", "provider-contact", topics, completedAt);
  const row = (await db.query("select resend_contact_id, resend_preferences_snapshot, resend_sync_locked_by, resend_sync_started_at, resend_sync_snapshot, resend_preferences_synced_at from communication_contacts where id=$1", [ids.contact])).rows[0];
  assert.equal(row.resend_contact_id, "provider-contact");
  assert.deepEqual(row.resend_preferences_snapshot, topics);
  assert.equal(new Date(row.resend_preferences_synced_at).toISOString(), completedAt.toISOString());
  assert.equal(row.resend_sync_locked_by, null);
  assert.equal(row.resend_sync_started_at, null);
  assert.equal(row.resend_sync_snapshot, null);
  await assert.rejects(() => repository.completeResendContactSync(ids.contact, "fixture-lease", "provider-contact", topics, completedAt), /lease was lost/);
});
