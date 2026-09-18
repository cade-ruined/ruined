import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = { admin: uuid(1), guide: uuid(2), member: uuid(3), person: uuid(4), circle: uuid(5) };
function tableFrom(sql, table) {
  const match = sql.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`));
  assert.ok(match, `Shipped ${table} table exists`);
  return match[0];
}
async function load(path, dependencies) {
  const output = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", output)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    if (name in dependencies) return dependencies[name];
    throw Error(`Unexpected dependency ${name}`);
  }, mod, mod.exports);
  return mod.exports;
}
async function fixture(t, { migrate = true } = {}) {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  const community = await source("db/migrations/20260826_membership_operating_spine_03_community_experiences.sql");
  const content = await source("db/migrations/20260826_membership_operating_spine_05_content_operations.sql");
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table platform_users(auth_user_id uuid primary key, status text);
    create table platform_role_grants(auth_user_id uuid references platform_users, role_slug text, revoked_at timestamptz);
    create table people(id uuid primary key);
    create table ruined_members(id uuid primary key, person_id uuid references people, deleted_at timestamptz, unique(id,person_id));
    create table member_lifecycle(member_id uuid references ruined_members, account_state text);
    create table circles(id uuid primary key, status text);
    create table membership_blocks(id uuid primary key, status text);
    create table membership_progression_levels(slug text primary key);
    ${["learning_collections", "learning_resources", "learning_resource_versions", "learning_resource_targets"].map((name) => tableFrom(community, name)).join("\n")}
    alter table learning_resources add constraint learning_resources_current_version_fkey foreign key(current_version_id,id) references learning_resource_versions(id,learning_resource_id);
    ${["member_announcements", "member_announcement_targets", "member_notifications", "operator_audit_events"].map((name) => tableFrom(content, name)).join("\n")}
    create table domain_events(id uuid primary key default gen_random_uuid(), aggregate_type text, aggregate_id text, event_type text, actor_auth_user_id uuid, payload jsonb, dedupe_key text unique);
    create table workflow_actions(id uuid primary key default gen_random_uuid(), domain_event_id uuid, action_type text, target_type text, target_id text, payload jsonb, idempotency_key text unique);
    insert into platform_users values ('${ids.admin}','active'),('${ids.guide}','active');
    insert into platform_role_grants values ('${ids.admin}','ops_admin',null),('${ids.guide}','guide',null);
    insert into people values ('${ids.person}');
    insert into ruined_members(id,person_id) values ('${ids.member}','${ids.person}');
    insert into member_lifecycle values ('${ids.member}','active');
    insert into circles values ('${ids.circle}','active');
  `);
  await db.exec(await source("db/migrations/20260828_operator_academy.sql"));
  if (migrate) await db.exec(await source("db/migrations/20260914221725_academy_unused_draft_retirement.sql"));
  function bridge(engine) {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const params = values.map((value, index) => { query += `$${index + 1}${strings[index + 1]}`; return value; });
      return (await engine.query(query, params)).rows;
    };
    sql.json = JSON.stringify;
    sql.begin = (callback) => engine.transaction((tx) => callback(bridge(tx)));
    return sql;
  }
  const common = { "@/lib/database/server": { getApplicationDatabase: () => bridge(db) } };
  const ops = await load("src/lib/platform/ops-operating-repository.ts", {
    ...common, "@/lib/google/calendar": {}, "@/lib/google/communications": {}, "@/lib/support/delivery": {}, "@/lib/platform/ops-delivery-health": {},
  });
  const academy = await load("src/lib/platform/ops-academy-repository.ts", { ...common, "@/lib/platform/ops-operating-repository": ops });
  const row = async (query, values = []) => (await db.query(query, values)).rows[0];
  return { db, ops, academy, row };
}
const lesson = (overrides = {}) => ({ audiences: [{ kind: "all_members" }], bodyText: "Original lesson", captionsUrl: "", collectionId: "", contentType: "article", durationLabel: "", externalUrl: "", featured: false, position: 1, presenter: "", slug: "first-lesson", summary: "", thumbnailUrl: "", title: "First lesson", videoUrl: "", ...overrides });
const post = (overrides = {}) => ({ actorAuthUserId: ids.admin, title: "Circle gathering", body: "Bring your journal.", targetKind: "circle", targetId: ids.circle, ...overrides });

test("Academy revision publishing keeps the live version available until the new version commits", async (t) => {
  const { academy, row, db } = await fixture(t);
  const first = await academy.saveOpsAcademyResource(ids.admin, lesson());
  await academy.changeOpsAcademyResourceState(ids.admin, { resourceId: first.resourceId, expectedRevision: 1, action: "publish" });
  const live = await row("select * from learning_resources where id=$1", [first.resourceId]);
  await academy.saveOpsAcademyResource(ids.admin, lesson({ resourceId: first.resourceId, expectedRevision: 2, title: "Revised lesson", bodyText: "New lesson copy", audiences: [{ kind: "circle", id: ids.circle }] }));
  const saved = await row("select * from learning_resources where id=$1", [first.resourceId]);
  assert.equal(saved.status, "published");
  assert.equal(saved.current_version_id, live.current_version_id);
  assert.equal(saved.title, "First lesson");
  assert.equal((await row("select audience_type from learning_resource_targets")).audience_type, "all_members");
  await assert.rejects(academy.changeOpsAcademyResourceState(ids.admin, { resourceId: first.resourceId, expectedRevision: 2, action: "publish" }), /changed/);
  await academy.changeOpsAcademyResourceState(ids.admin, { resourceId: first.resourceId, expectedRevision: 3, action: "publish" });
  const updated = await row("select * from learning_resources where id=$1", [first.resourceId]);
  assert.equal(updated.status, "published");
  assert.equal(updated.title, "Revised lesson");
  assert.notEqual(updated.current_version_id, live.current_version_id);
  assert.deepEqual(updated.published_at, live.published_at);
  assert.equal((await row("select body_text from learning_resource_versions where id=$1", [live.current_version_id])).body_text, "Original lesson");
  assert.equal((await row("select audience_type from learning_resource_targets")).audience_type, "circle");
  assert.equal((await db.query("select * from operator_audit_events where action='academy.resource_unpublished'")).rows.length, 0);
});

test("unused Academy drafts retire with retained history and no fabricated publication; schema still rejects unproved publication", async (t) => {
  const { academy, row, db } = await fixture(t, { migrate: false });
  const first = await academy.saveOpsAcademyResource(ids.admin, lesson());
  await assert.rejects(academy.changeOpsAcademyResourceState(ids.admin, { resourceId: first.resourceId, expectedRevision: 1, action: "retire" }), /learning_resources_check/);
  await db.exec(await source("db/migrations/20260914221725_academy_unused_draft_retirement.sql"));
  await academy.changeOpsAcademyResourceState(ids.admin, { resourceId: first.resourceId, expectedRevision: 1, action: "retire" });
  const retired = await row("select * from learning_resources where id=$1", [first.resourceId]);
  assert.equal(retired.status, "retired"); assert.equal(retired.published_at, null); assert.equal(retired.current_version_id, null);
  assert.ok(retired.retired_at);
  assert.equal(Number((await row("select count(*) as count from learning_resource_versions")).count), 1);
  await assert.rejects(academy.saveOpsAcademyResource(ids.admin, lesson({ resourceId: first.resourceId, expectedRevision: 2 })), /retired/);
  const collection = await academy.saveOpsAcademyCollection(ids.admin, { name: "Unused collection", slug: "unused", position: 1, summary: "" });
  await academy.changeOpsAcademyCollectionState(ids.admin, { collectionId: collection.collectionId, expectedRevision: 1, action: "retire" });
  assert.equal((await row("select published_at from learning_collections")).published_at, null);
  const next = await academy.saveOpsAcademyResource(ids.admin, lesson({ slug: "next-lesson" }));
  await assert.rejects(db.query("update learning_resources set status='published',revision=revision+1 where id=$1", [next.resourceId]), /publication_state_check/);
});

test("retiring a collection cannot strand its remaining lessons", async (t) => {
  const { academy } = await fixture(t);
  const collection = await academy.saveOpsAcademyCollection(ids.admin, { name: "Working collection", slug: "working", position: 1, summary: "" });
  await academy.saveOpsAcademyResource(ids.admin, lesson({ collectionId: collection.collectionId }));
  await assert.rejects(academy.changeOpsAcademyCollectionState(ids.admin, { collectionId: collection.collectionId, expectedRevision: 1, action: "retire" }), /remaining lessons/);
});

test("announcement edits preserve an existing audience and stale publish/discard cannot act on unseen changes", async (t) => {
  const { ops, row } = await fixture(t);
  const draft = await ops.createOpsAnnouncement(post());
  await ops.correctOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 1, action: "edit", title: "Updated gathering", body: "Updated details." });
  assert.equal((await row("select circle_id from member_announcement_targets")).circle_id, ids.circle);
  for (const action of ["discard", "retract"]) await assert.rejects(ops.correctOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 1, action, reason: "Wrong event" }), /changed/);
  await assert.rejects(ops.publishOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 1 }), /changed/);
  assert.equal(Number((await row("select count(*) as count from workflow_actions")).count), 0);
  await ops.publishOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 2 });
  assert.equal((await row("select status from member_announcements")).status, "published");
  await assert.rejects(ops.correctOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 3, action: "edit", title: "Changed live title", body: "Changed live body" }), /Only a draft/);
});

test("announcement audience corrections validate targets and rollback; guide and revoked admin cannot mutate", async (t) => {
  const { ops, row, db } = await fixture(t);
  const draft = await ops.createOpsAnnouncement(post());
  const input = { actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 1, action: "edit", title: "Changed title", body: "Changed copy", targetKind: "member", targetId: uuid(99) };
  await assert.rejects(ops.correctOpsAnnouncement(input), /Active member not found/);
  assert.equal((await row("select title from member_announcements")).title, "Circle gathering");
  assert.equal((await row("select circle_id from member_announcement_targets")).circle_id, ids.circle);
  await assert.rejects(ops.correctOpsAnnouncement({ ...input, actorAuthUserId: ids.guide, targetId: ids.member }), /Operations access/);
  await ops.correctOpsAnnouncement({ ...input, targetId: ids.member });
  const target = await row("select * from member_announcement_targets");
  assert.equal(target.member_id, ids.member); assert.equal(target.circle_id, null);
  await db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [ids.admin]);
  await assert.rejects(ops.correctOpsAnnouncement({ ...input, expectedVersion: 2, action: "discard" }), /Operations access/);
  await assert.rejects(ops.publishOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 2 }), /Operations access/);
});

test("retraction preserves the post and audit evidence while removing board and inbox visibility", async (t) => {
  const { ops, row, db } = await fixture(t);
  const draft = await ops.createOpsAnnouncement(post());
  await ops.publishOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 1 });
  await db.query("insert into member_notifications(person_id,member_id,announcement_id,notification_type,channel,title_snapshot,body_snapshot,status,dedupe_key) values ($1,$2,$3,'announcement','in_app','Circle gathering','Bring journal','delivered','test-alert')", [ids.person, ids.member, draft.id]);
  await assert.rejects(ops.correctOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 2, action: "retract", reason: "" }), /Retraction reason/);
  await ops.correctOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 2, action: "retract", reason: "Wrong date in the post" });
  const saved = await row("select * from member_announcements");
  assert.equal(saved.status, "archived"); assert.equal(saved.body_text, "Bring your journal."); assert.ok(saved.published_at); assert.ok(saved.archived_at);
  assert.equal((await row("select status from member_notifications")).status, "cancelled");
  assert.equal(Number((await row("select count(*) as count from member_announcements where status='published'")).count), 0);
  const audit = await row("select after_snapshot from operator_audit_events where action='announcement.retracted'");
  assert.equal(audit.after_snapshot.reason, "Wrong date in the post");
});

test("discard retains the draft and audience without creating any delivery work", async (t) => {
  const { ops, row } = await fixture(t);
  const draft = await ops.createOpsAnnouncement(post());
  await ops.correctOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 1, action: "discard" });
  assert.equal((await row("select status from member_announcements")).status, "cancelled");
  assert.equal((await row("select circle_id from member_announcement_targets")).circle_id, ids.circle);
  assert.equal(Number((await row("select count(*) as count from workflow_actions")).count), 0);
  await assert.rejects(ops.publishOpsAnnouncement({ actorAuthUserId: ids.admin, announcementId: draft.id, expectedVersion: 2 }), /Only a draft/);
});
