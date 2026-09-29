import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const registry = await source("scripts/migrate-platform.mjs");
const paths = [...registry.matchAll(/"\.\.\/(db\/migrations\/[^\"]+)"/g)].map(match => match[1]);
const migrations = await Promise.all(paths.map(source));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function load(path, dependencies) {
  const js = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}

test("full migration chain preserves funding, service departure, capacity approval and Foundations reveal together", async t => {
  const serviceIndex = paths.indexOf("db/migrations/20260930100000_supporter_service.sql");
  assert.ok(serviceIndex > 0);
  assert.deepEqual(paths.slice(serviceIndex,serviceIndex + 4).map(path => path.split("/").at(-1)), [
    "20260930100000_supporter_service.sql", "20260930101000_circle_placement.sql",
    "20260930102000_circle_reveal.sql", "20260930103000_leadership_terminology.sql",
  ]);
  // Complete shipped schema, existing triggers and RLS. This engine is entirely
  // in memory; the lazy postgres client supplies serializers, never a connection.
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  const driver = postgres({ host: "127.0.0.1", port: 1, max: 1 });
  t.after(async () => { await db.close(); await driver.end(); });
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (let i = 0; i < migrations.length; i++) {
    try { await db.exec(migrations[i]); } catch (error) { throw new Error(`Migration failed: ${paths[i]}`, { cause: error }); }
  }
  // Later leadership/reveal migrations must retain commercial shared billing.
  for (const signature of ["private.ruined_current_active_access_member_id()", "private.ruined_current_updates_member_id()", "private.ruined_member_can_share_invitation(uuid)", "private.ruined_guard_new_supporter_service()"]) {
    const definition = (await db.query("select pg_get_functiondef($1::regprocedure) as body", [signature])).rows[0].body;
    assert.match(definition, /ruined_member_shared_billing_state\(member.id\)/, signature);
  }
  const circleAccess = (await db.query("select pg_get_functiondef('private.ruined_current_active_access_block_id()'::regprocedure) as body")).rows[0].body;
  assert.match(circleAccess, /ruined_current_circle_is_revealed\(\)/);
  assert.match(circleAccess, /ruined_current_active_access_member_id\(\)/);
  function wrap(engine) {
    const sql = async (strings, ...values) => {
      let query = strings[0];
      const parameters = values.map((value, index) => {
        query += `$${index + 1}${strings[index + 1]}`;
        if (value instanceof Parameter) return driver.options.serializers[value.type](value.value);
        if (/^\s*::jsonb\b/.test(strings[index + 1]) && value !== null) return types.json.serialize(value);
        return value instanceof Date ? types.date.serialize(value) : value;
      });
      return (await engine.query(query, parameters)).rows;
    };
    sql.json = driver.json;
    sql.begin = callback => engine.transaction(tx => callback(wrap(tx)));
    return sql;
  }
  const calendars = await load("src/lib/platform/calendar-audience-invalidation.ts", {
    "server-only": {}, "@/lib/platform/ops-calendar-repository": {
      markOpsExperienceCalendarPending: () => { throw Error("This fixture has no linked Calendar events"); },
    },
  });
  const ops = await load("src/lib/platform/ops-repository.ts", {
    "server-only": {}, "node:crypto": crypto, "@/lib/identity/repository": {},
    "@/lib/platform/calendar-audience-invalidation": calendars,
    "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) }, "@/lib/stripe/membership-state": {},
  });
  const model = await load("src/lib/platform/leadership-model.ts", {});
  const leadership = await load("src/lib/platform/leadership-repository.ts", {
    "server-only": {}, "@/lib/stripe/database": { getBillingDatabase: () => wrap(db) },
    "@/lib/platform/ops-repository": ops, "@/lib/platform/leadership-model": model,
  });
  const admin = id(1), circleA = id(2), circleB = id(3), program = id(4), version = id(5), unit = id(6), agreement = id(7);
  await db.query("insert into platform_users(auth_user_id,email_normalized,user_type,status) values($1,'integration-admin@example.test','staff','active')", [admin]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [admin]);
  const command = body => leadership.executeLeadershipCommand(admin, { reason: "Reviewed integration service and placement.", ...body });
  for (const capability of ["circle_placement", "circle_exception", "supporter_readiness"]) {
    await command({ action: "grant", authUserId: admin, capability });
  }
  await db.query("insert into circles(id,name,slug) values($1,'First Circle','integration-first'),($2,'Second Circle','integration-second')", [circleA,circleB]);

  // A legitimate small test curriculum keeps the proof contract exercised:
  // published version, completed final unit, active Circle and immutable proof.
  await db.query("insert into foundation_programs(id,slug,name,status) values($1,'integration-program','Integration program','active')", [program]);
  await db.query("insert into foundation_versions(id,foundation_program_id,version,title,configuration) values($1,$2,1,'Integration version',$3::jsonb)", [version,program,JSON.stringify({ final_unit_slug: "final", required_prior_unit_count: 0, required_member_requirements: [] })]);
  await db.query("insert into foundation_units(id,foundation_version_id,unit_slug,position,title) values($1,$2,'final',1,'Final step')", [unit,version]);
  await db.query("update foundation_versions set status='published',published_at=statement_timestamp() where id=$1", [version]);
  await db.query("insert into membership_agreement_versions(id,agreement_key,version,title,body_text,content_sha256,status,published_at) values($1,'integration',1,'Integration agreement','Synthetic agreement',$2,'published',statement_timestamp())", [agreement,crypto.createHash("sha256").update("Synthetic agreement").digest("hex")]);
  async function member(number) {
    const memberId = id(100 + number), authUserId = id(200 + number), email = `integration-${number}@example.test`;
    await db.query("insert into ruined_members(id,email,email_normalized,membership_state) values($1,$2,$2,'active')", [memberId,email]);
    const personId = (await db.query("select person_id from ruined_members where id=$1", [memberId])).rows[0].person_id;
    await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized,status) values($1,$2,$3,$4,'active')", [authUserId,memberId,personId,email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [authUserId]);
    await db.query("insert into member_lifecycle(member_id,account_state,billing_state,program_state,administrative_onboarding_state,standing_state,foundations_state) values($1,'active','active','onboarding','in_progress','active','in_progress')", [memberId]);
    await db.query("insert into person_profiles(person_id,display_name) values($1,'Integration member') on conflict(person_id) do update set display_name=excluded.display_name", [personId]);
    await db.query("update person_email_addresses set verification_state='verified',verified_at=statement_timestamp() where person_id=$1 and email_normalized=$2", [personId,email]);
    await db.query(`insert into membership_agreement_acceptances(agreement_version_id,person_id,member_id,accepted_by_auth_user_id,signer_name_snapshot,signer_email_snapshot,affirmative_action,accepted_at,agreement_key_snapshot,agreement_version_snapshot,agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,dedupe_key)
      select id,$2,$3,$4,'Integration member',$5,'checkbox_and_submit',statement_timestamp(),agreement_key,version,title,content_sha256,body_text,$6 from membership_agreement_versions where id=$1`, [agreement,personId,memberId,authUserId,email,`integration:${memberId}`]);
    await db.query("update member_onboardings set state='completed',profile_completed_at=statement_timestamp(),agreement_completed_at=statement_timestamp(),billing_confirmed_at=statement_timestamp() where member_id=$1", [memberId]);
    await db.query("update member_lifecycle set administrative_onboarding_state='completed' where member_id=$1", [memberId]);
    return { memberId, authUserId, personId };
  }
  const place = (who, circleId, extra = {}) => ops.assignMemberToCircle({ actorAuthUserId: admin, memberId: who.memberId, circleId, ...extra });
  async function complete(who) {
    const enrollment = crypto.randomUUID();
    await db.transaction(async tx => {
      await tx.query("insert into foundation_enrollments(id,member_id,foundation_version_id,status) values($1,$2,$3,'in_progress')", [enrollment,who.memberId,version]);
      await tx.query("insert into foundation_unit_progress(enrollment_id,unit_id,foundation_version_id,status,progress_percent,completed_at) values($1,$2,$3,'completed',100,statement_timestamp())", [enrollment,unit,version]);
      await tx.query("update foundation_enrollments set status='completed' where id=$1", [enrollment]);
      await tx.query("update member_lifecycle set foundations_state='completed',program_state='active' where member_id=$1", [who.memberId]);
    });
    return enrollment;
  }
  async function visibleAssignments(who) {
    return db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [who.authUserId]);
      await tx.exec("set local role authenticated");
      return (await tx.query("select circle_id from circle_member_assignments where ended_at is null")).rows;
    });
  }
  const count = async circle => Number((await db.query("select private.ruined_circle_participant_count($1) count", [circle])).rows[0].count);

  const supporter = await member(1), newcomer = await member(2);
  const original = await place(supporter,circleA);
  await place(newcomer,circleA);
  await ops.activateCircle({ actorAuthUserId: admin, circleId: circleA });
  assert.deepEqual(await visibleAssignments(newcomer), [], "approved placement stays hidden before completion");
  await assert.rejects(command({ action: "ready", authUserId: newcomer.authUserId, circleId: circleA }), /active member|Foundations|membership entry/);
  const proof = await complete(supporter);
  assert.deepEqual(await visibleAssignments(supporter), [{ circle_id: circleA }]);
  await command({ action: "ready", authUserId: supporter.authUserId, circleId: circleA });
  await command({ action: "start", authUserId: supporter.authUserId, circleId: circleA, temporary: false });
  assert.equal(await count(circleA), 2, "a Supporter who is already a member occupies one place");
  assert.equal((await db.query("select private.ruined_member_has_complimentary_funding($1) funded", [supporter.memberId])).rows[0].funded, false, "service role never supplies its own complimentary funding");
  await complete(newcomer);
  assert.deepEqual(await visibleAssignments(newcomer), [{ circle_id: circleA }]);

  for (let n = 3; n <= 14; n++) await place(await member(n),circleB);
  await ops.activateCircle({ actorAuthUserId: admin, circleId: circleB });
  const thirteenth = await member(15);
  await assert.rejects(place(thirteenth,circleB), /reason|exception/i);
  assert.equal(await count(circleB), 12);
  await place(thirteenth,circleB,{ exceptionReason: "Approved extra place for this shared meeting schedule." });
  assert.equal(await count(circleB), 13);
  const moved = await ops.transferMemberToCircle({ actorAuthUserId: admin, memberId: supporter.memberId, assignmentId: original.id, fromCircleId: circleA, toCircleId: circleB, exceptionReason: "Approved transfer to preserve the member's established connection." });
  assert.equal(await count(circleA), 1);
  assert.equal(await count(circleB), 14);
  assert.deepEqual(await visibleAssignments(supporter), [{ circle_id: circleB }]);
  assert.equal((await db.query("select completion_circle_assignment_id::text proof from foundation_enrollments where id=$1", [proof])).rows[0].proof, original.id, "transfer preserves original completion evidence");
  assert.equal((await db.query("select count(*)::int count from circle_staff_assignments where auth_user_id=$1 and ended_at is null", [supporter.authUserId])).rows[0].count, 0);
  assert.equal((await db.query("select count(*)::int count from platform_role_grants where auth_user_id=$1 and role_slug='circle_leader' and revoked_at is null", [supporter.authUserId])).rows[0].count, 0);
  await command({ action: "ready", authUserId: supporter.authUserId, circleId: circleB });
  await command({ action: "start", authUserId: supporter.authUserId, circleId: circleB, temporary: true });
  assert.equal(await count(circleB), 14);
  await ops.endMemberCircleAssignment({ actorAuthUserId: admin, memberId: supporter.memberId, circleId: circleB });
  assert.equal(await count(circleB), 13);
  assert.deepEqual(await visibleAssignments(supporter), []);
  assert.equal((await db.query("select count(*)::int count from platform_role_grants where auth_user_id=$1 and role_slug='member' and revoked_at is null", [supporter.authUserId])).rows[0].count, 1, "stepping out of service preserves membership");
  assert.equal((await db.query("select count(*)::int count from operator_audit_events where action='supporter.service_ended_membership'")).rows[0].count, 2);
  await assert.rejects(db.query("update circle_staff_assignments set end_reason='rewrite' where auth_user_id=$1", [supporter.authUserId]), /immutable/);
  assert.equal((await db.query("select count(*)::int count from circle_placement_reviews where status='placed'")).rows[0].count, 2);
  assert.notEqual(moved.id, original.id);
  assert.equal((await db.query("select display_name from platform_roles where role_slug='circle_leader'")).rows[0].display_name, "Circle Supporter");
  assert.deepEqual((await db.query("select slug from membership_progression_levels where status='retired' order by slug")).rows.map(row => row.slug), ["author","builder","partner"]);
});
