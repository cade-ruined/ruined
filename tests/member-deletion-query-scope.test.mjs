import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const current = id(1), deleted = id(2), admin = id(3), announcement = id(4), award = id(5);
class RepositoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
async function load(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    assert.ok(name in dependencies, `Unexpected live dependency: ${name}`); return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function fixture(t) {
  const PGlite = await loadPGliteForSchemaChecks(); const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`
    create schema private;
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql as 'select false';
    create table ruined_members(id uuid primary key,person_id uuid,deleted_at timestamptz);
    create table member_lifecycle(member_id uuid,account_state text default 'active',billing_state text default 'active',
      administrative_onboarding_state text default 'completed',standing_state text default 'active',cancellation_effective_at timestamptz,current_progression_level_slug text default 'member');
    create table platform_users(auth_user_id uuid,person_id uuid,status text default 'active');
    create table platform_role_grants(auth_user_id uuid,role_slug text default 'member',revoked_at timestamptz);
    create table person_profiles(person_id uuid,preferred_name text,display_name text,avatar_storage_path text,timezone text,location_label text,bio text,building_now text,updated_at timestamptz);
    create table person_private_profiles(person_id uuid,legal_name text,mobile_e164 text,default_fulfillment_address jsonb,apparel_sizing jsonb,accessibility_notes text,updated_at timestamptz);
    create table member_directory_preferences(member_id uuid,directory_status text default 'hidden');
    create table circle_member_assignments(member_id uuid,circle_id uuid,ended_at timestamptz);
    create table block_circle_assignments(circle_id uuid,block_id uuid,ended_at timestamptz);
    create table artifact_awards(id uuid,member_id uuid,artifact_template_version_id uuid,member_input_snapshot jsonb,status text);
    create table member_announcements(id uuid,title text,body_text text,image_storage_path text,action_label text,action_url text,status text,published_at timestamptz);
    create table member_announcement_targets(announcement_id uuid,target_type text,member_id uuid,circle_id uuid,block_id uuid,progression_level_slug text);
    create table member_notifications(id uuid primary key default gen_random_uuid(),person_id uuid,member_id uuid,announcement_id uuid,notification_type text,channel text,title_snapshot text,body_snapshot text,
      image_storage_path_snapshot text,action_label_snapshot text,action_url_snapshot text,status text,sent_at timestamptz,delivered_at timestamptz,dedupe_key text unique);
    create table member_notification_events(id bigint generated always as identity primary key,notification_id uuid,event_type text,evidence jsonb,dedupe_key text unique);
  `);
  for (const member of [current, deleted]) {
    await pg.query("insert into ruined_members values($1,$1,$2)", [member, member === deleted ? new Date().toISOString() : null]);
    await pg.query("insert into member_lifecycle(member_id) values($1)", [member]);
    await pg.query("insert into platform_users(auth_user_id,person_id) values($1,$1)", [member]);
    await pg.query("insert into platform_role_grants(auth_user_id) values($1)", [member]);
    await pg.query("insert into person_profiles(person_id,display_name) values($1,$2)", [member, member === current ? "Current member" : "Deleted member"]);
  }
  const queries = [];
  const sql = async (strings, ...values) => {
    // postgres-js supplies text parameter types; PGlite needs that annotation
    // for variadic functions such as jsonb_build_object.
    const query = strings.reduce((result, part, index) => result + (index ? `$${index}${typeof values[index - 1] === "string" ? "::text" : ""}` : "") + part, "");
    queries.push(query);
    if (query.includes("from platform_users platform_user") && !query.includes("from ruined_members")) return [{ auth_user_id: admin }];
    if (query.includes("from ruined_members member") || query.includes("from artifact_awards award") || query.includes("with announcement_source as")) return (await pg.query(query, values)).rows;
    if (query.includes("insert into artifact_jobs")) throw new Error("CURRENT_MEMBER_REACHED_PRODUCTION_INSERT");
    return [];
  };
  sql.begin = callback => callback(sql); sql.json = JSON.stringify;
  const dependencies = {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError },
    "@/lib/platform/artifact-invariants": {}, "@/lib/platform/ops-notification-model": {},
    "@/lib/membership/agreement-receipt": {},
  };
  return { pg, queries, dependencies };
}

test("Artifact and notification member selectors exclude deleted rows with otherwise eligible access", async t => {
  const f = await fixture(t);
  const artifacts = await load("src/lib/platform/ops-artifact-repository.ts", f.dependencies);
  const notifications = await load("src/lib/platform/ops-notification-repository.ts", f.dependencies);
  assert.deepEqual((await artifacts.getOpsArtifactControlData(admin)).members.map(row => row.memberId), [current]);
  assert.deepEqual((await notifications.getOpsNotificationCenter(admin)).members.map(row => row.id), [current]);
  assert.equal((await f.pg.query("select count(*)::int as count from ruined_members")).rows[0].count, 2);
});

test("profile support neither exposes nor rewrites a deleted member's retained identity", async t => {
  const f = await fixture(t);
  const repository = await load("src/lib/platform/ops-profile-repository.ts", f.dependencies);
  assert.equal((await repository.getOpsMemberProfileSupport(admin, current)).displayName, "Current member");
  f.queries.length = 0;
  assert.equal(await repository.getOpsMemberProfileSupport(admin, deleted), null);
  await assert.rejects(repository.updateOpsMemberProfileSupport({ actorAuthUserId: admin, memberId: deleted,
    expectedVersion: "0|0", reason: "Correct the display name", displayName: "Restored accidentally" }), { code: "not_found" });
  assert.ok(f.queries.every(query => !/insert into|update person_profiles|update person_private_profiles/.test(query)));
  assert.equal((await f.pg.query("select display_name from person_profiles where person_id=$1", [deleted])).rows[0].display_name, "Deleted member");
});

const action = (actionType, targetType, targetId) => ({ actionType, targetType, targetId, id: id(10), idempotencyKey: "deleted-member-scope", payload: {} });

test("an old Artifact workflow cannot create new production for a deletion tombstone", async t => {
  const f = await fixture(t); const repository = await load("src/lib/workflows/repository.ts", f.dependencies);
  await f.pg.query("insert into artifact_awards values($1,$2,$3,'{}','awarded')", [award, deleted, id(6)]);
  await assert.rejects(repository.executeWorkflowAction(action("create_artifact_job", "artifact_award", award)), /not production-ready/);
  assert.ok(f.queries.every(query => !query.includes("insert into artifact_jobs")));
  await f.pg.query("update artifact_awards set member_id=$1 where id=$2", [current, award]);
  f.queries.length = 0;
  await assert.rejects(repository.executeWorkflowAction(action("create_artifact_job", "artifact_award", award)), /CURRENT_MEMBER_REACHED_PRODUCTION_INSERT/);
  const memberLock = f.queries.findIndex(query => query.includes("for update of member_record"));
  const awardLock = f.queries.findIndex(query => query.includes("for update of award"));
  const productionInsert = f.queries.findIndex(query => query.includes("insert into artifact_jobs"));
  assert.ok(memberLock >= 0 && awardLock > memberLock && productionInsert > awardLock, "member ownership is locked before the child award and new production");
});

test("announcement fanout creates notifications only for current members and retains tombstone history", async t => {
  const f = await fixture(t); const repository = await load("src/lib/workflows/repository.ts", f.dependencies);
  await f.pg.query("insert into member_announcements(id,title,body_text,status,published_at) values($1,'A note','For members','published',now())", [announcement]);
  await f.pg.query("insert into member_announcement_targets(announcement_id,target_type) values($1,'all_active_members')", [announcement]);
  const result = await repository.executeWorkflowAction(action("send_notification", "member_announcement", announcement));
  assert.equal(result.eligibleCount, 1); assert.equal(result.createdCount, 1); assert.equal(result.eventCount, 1);
  assert.deepEqual((await f.pg.query("select member_id from member_notifications")).rows, [{ member_id: current }]);
  assert.equal((await f.pg.query("select count(*)::int as count from ruined_members")).rows[0].count, 2);
});
