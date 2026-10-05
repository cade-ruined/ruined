import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";
import { taggedDatabase } from "../scripts/check-support-repository.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const ids = Object.fromEntries(["admin", "guide", "leader", "member", "target", "person", "circle"].map((key) => [key, crypto.randomUUID()]));
const privateBody = "Private note body that must never enter an audit or Circle projection.";

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create table platform_users(auth_user_id uuid primary key, person_id uuid, status text);
    create table platform_role_grants(auth_user_id uuid references platform_users, role_slug text, revoked_at timestamptz);
    create table ruined_members(id uuid primary key, person_id uuid, deleted_at timestamptz);
    create table person_profiles(person_id uuid primary key, preferred_name text, display_name text);
    create table circle_member_assignments(member_id uuid references ruined_members, circle_id uuid, ended_at timestamptz);
    create table circle_staff_assignments(auth_user_id uuid references platform_users, circle_id uuid, role_slug text, ended_at timestamptz);
  `);
  const migration = await source("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  for (const table of ["operator_member_notes", "operator_member_note_redactions", "operator_audit_events"]) {
    const definition = migration.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    assert.ok(definition, `Shipped ${table} definition exists`);
    await db.exec(definition);
  }
  for (const [actor, role] of [[ids.admin, "ops_admin"], [ids.guide, "guide"], [ids.leader, "circle_leader"], [ids.member, "member"]]) {
    await db.query("insert into platform_users values($1,$2,'active')", [actor, actor]);
    await db.query("insert into platform_role_grants values($1,$2,null)", [actor, role]);
  }
  await db.query("insert into ruined_members values($1,$2,null)", [ids.target, ids.person]);
  await db.query("insert into person_profiles values($1,'Administrator Name',null)", [ids.admin]);
  await db.query("insert into circle_member_assignments values($1,$2,null)", [ids.target, ids.circle]);
  await db.query("insert into circle_staff_assignments values($1,$3,'guide',null),($2,$3,'circle_leader',null)", [ids.guide, ids.leader, ids.circle]);

  const statements = [];
  const base = {
    member_id: ids.target, person_id: ids.person, preferred_name: "Test member", primary_email: "member@example.test",
    account_state: "active", administrative_onboarding_state: "completed", admission_state: "accepted", artifact_state: "not_started",
    billing_state: "active", foundations_state: "not_started", standing_state: "active", lifecycle_version: 1,
    email_scope: "none", phone_scope: "none", operator_funded: false, complimentary_funded: false,
    circle_id: null, circle_name: null, circle_state: null, block_id: null, block_name: null, block_state: null,
  };
  // Execute authorization, assignments, durable notes, redactions and audit SQL
  // against PostgreSQL. Unrelated member-profile branches have empty fixtures;
  // this keeps private-note coverage independent of the full membership schema.
  const query = (engine) => async (sql, params) => {
    statements.push(sql);
    if (/\boperator_member_notes\b|\boperator_member_note_redactions\b|\boperator_audit_events\b/.test(sql)) return engine.query(sql, params);
    if (/member\.id\s+as\s+member_id/.test(sql)) return { rows: [base] };
    if (/from (member_onboardings|person_email_addresses|person_private_profiles|member_directory_preferences|membership_agreement_acceptances|stripe_subscriptions|membership_cancellation_requests|foundation_enrollments|artifact_awards|experience_registrations|operator_tasks|member_state_overrides|member_onboarding_events|artifact_job_events|member_state_history)\b/.test(sql)) return { rows: [] };
    return engine.query(sql, params);
  };
  const sql = taggedDatabase({ query: query(db), transaction: (work) => db.transaction((tx) => work({ query: query(tx) })) });
  const compiled = ts.transpileModule(await source("src/lib/platform/ops-operating-repository.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const dependencies = {
    "server-only": {}, "node:crypto": crypto, "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/google/calendar": {}, "@/lib/google/communications": {}, "@/lib/support/delivery": {}, "@/lib/platform/ops-delivery-health": {},
  };
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected repository dependency ${name}`);
  }, mod, mod.exports);
  const rows = async (query, values = []) => (await db.query(query, values)).rows;
  return { db, rows, repository: mod.exports, statements };
}

test("private member notes execute administrator authorization, durable storage, and body-free audit", async (t) => {
  const { db, repository, rows, statements } = await fixture(t);
  const input = { actorAuthUserId: ids.admin, memberId: ids.target, category: "support", body: privateBody };
  const forbidden = (error) => error instanceof repository.OpsOperatingRepositoryError && error.code === "forbidden";
  let saved;

  await t.test("members and assigned Circle operators cannot append notes", async () => {
    for (const actor of [ids.member, ids.guide, ids.leader]) {
      await assert.rejects(repository.appendOpsMemberNote({ ...input, actorAuthUserId: actor }), forbidden);
    }
    assert.equal((await rows("select * from operator_member_notes")).length, 0);
    assert.equal((await rows("select * from operator_audit_events")).length, 0);
  });

  await t.test("an active administrator appends a persistent attributed note and metadata-only audit", async () => {
    saved = await repository.appendOpsMemberNote(input);
    const [note] = await rows("select * from operator_member_notes where id=$1", [saved.id]);
    assert.equal(note.body_text, privateBody);
    assert.equal(note.member_id, ids.target);
    assert.equal(note.authored_by_auth_user_id, ids.admin);
    assert.equal(note.note_type, "support");
    assert.equal(note.source, "operator");
    assert.equal(new Date(note.occurred_at).toISOString(), saved.createdAt);
    const [audit] = await rows("select * from operator_audit_events");
    assert.equal(audit.actor_auth_user_id, ids.admin);
    assert.equal(audit.subject_id, saved.id);
    assert.equal(audit.action, "member.note_added");
    assert.deepEqual(audit.after_snapshot, { noteType: "support" });
    assert.equal(audit.before_snapshot, null);
    assert.equal(audit.reason, null);
    assert.deepEqual(audit.metadata, {});
    assert.equal(JSON.stringify(audit).includes(privateBody), false);
    assert.equal(JSON.stringify(saved).includes(privateBody), false);
  });

  await t.test("administrators can read saved notes; assigned Circle readers never query or receive note content", async () => {
    const admin = await repository.getOpsMemberOperatingRecord(ids.admin, ids.target);
    assert.deepEqual(admin.operational.notes, [{ body: privateBody, category: "support", createdAt: saved.createdAt, createdBy: "Administrator Name", noteId: saved.id, visibility: "ops_admin" }]);
    for (const actor of [ids.guide, ids.leader]) {
      statements.length = 0;
      const record = await repository.getOpsMemberOperatingRecord(actor, ids.target);
      assert.deepEqual(record.operational.notes, []);
      assert.equal(record.access.capabilities.includes("member.note.write"), false);
      assert.equal(JSON.stringify(record).includes(privateBody), false);
      assert.equal(statements.some((sql) => /operator_member_notes/.test(sql)), false);
    }
    await assert.rejects(repository.getOpsMemberOperatingRecord(ids.member, ids.target), forbidden);
  });

  await t.test("revocation and inactive administrator state deny both reads and new writes", async () => {
    await db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [ids.admin]);
    await assert.rejects(repository.appendOpsMemberNote(input), forbidden);
    await assert.rejects(repository.getOpsMemberOperatingRecord(ids.admin, ids.target), forbidden);
    await db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [ids.admin]);
    await db.query("update platform_users set status='suspended' where auth_user_id=$1", [ids.admin]);
    await assert.rejects(repository.appendOpsMemberNote(input), forbidden);
    await assert.rejects(repository.getOpsMemberOperatingRecord(ids.admin, ids.target), forbidden);
    await db.query("update platform_users set status='active' where auth_user_id=$1", [ids.admin]);
    assert.equal((await rows("select * from operator_member_notes")).length, 1);
    assert.equal((await rows("select * from operator_audit_events")).length, 1);
  });

  await t.test("deleted members reject new notes without changing durable content or audit", async () => {
    await db.query("update ruined_members set deleted_at=now() where id=$1", [ids.target]);
    await assert.rejects(repository.appendOpsMemberNote(input), (error) => error.code === "not_found");
    assert.equal((await rows("select * from operator_member_notes")).length, 1);
    assert.equal((await rows("select * from operator_audit_events")).length, 1);
  });
});
