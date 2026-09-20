import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const compiled = ts.transpileModule(await source("src/lib/membership/access-policy.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadedModule = { exports: {} };
new Function("require", "module", "exports", compiled)(() => { throw Error("Unexpected dependency"); }, loadedModule, loadedModule.exports);
const { deriveMemberAccessPolicy, memberCan } = loadedModule.exports;
const active = { accountState: "active", administrativeOnboardingState: "completed", billingState: "pending", cancellationEffectiveAt: null, programState: "onboarding", standingState: "active", membershipFunding: "operator" };

test("complimentary funding bypasses payment only, never membership safeguards", () => {
  for (const membershipFunding of ["operator", "complimentary"]) for (const billingState of ["pending", "active", "attention_required", "ended"]) {
    const access = deriveMemberAccessPolicy({ ...active, membershipFunding, billingState });
    assert.equal(memberCan(access, "foundations.write"), true);
    assert.equal(memberCan(access, "circle.read"), true);
    assert.equal(memberCan(access, "experiences.member"), false, "Foundations Circle exception must not grant every experience");
  }
  for (const membershipFunding of ["operator", "complimentary"]) for (const restricted of [
    { accountState: "suspended" }, { accountState: "closed" },
    { administrativeOnboardingState: "in_progress" }, { standingState: "paused" },
    { standingState: "inactive" }, { standingState: "cancellation_requested" },
    { standingState: "cancellation_requested", cancellationEffectiveAt: "2000-01-01T00:00:00Z" },
    { programState: "withdrawn" }, { programState: "completed" },
  ]) assert.equal(memberCan(deriveMemberAccessPolicy({ ...active, membershipFunding, ...restricted }), "foundations.write"), false, JSON.stringify(restricted));
  assert.equal(memberCan(deriveMemberAccessPolicy({ ...active, membershipFunding: "self" }), "circle.read"), false);
  assert.equal(memberCan(deriveMemberAccessPolicy({ ...active, membershipFunding: "self", billingState: "active" }), "circle.read"), true);
});

const ids = { member: "11111111-1111-4111-8111-111111111111", person: "22222222-2222-4222-8222-222222222222", auth: "33333333-3333-4333-8333-333333333333" };

test("shipped SQL funds only current canonical operators, preserves unpaid records and enforces entry checkpoints", async (t) => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people (id uuid primary key, status text);
    create table ruined_members (id uuid primary key, person_id uuid);
    create table platform_users (auth_user_id uuid primary key, member_id uuid, person_id uuid, status text);
    create table platform_role_grants (id bigint generated always as identity primary key, auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table member_lifecycle (member_id uuid primary key, account_state text, billing_state text, administrative_onboarding_state text, standing_state text, cancellation_effective_at timestamptz);
    create table person_profiles (person_id uuid, preferred_name text, display_name text);
    create table person_email_addresses (person_id uuid, verification_state text, retired_at timestamptz);
    create table membership_agreement_acceptances (member_id uuid, person_id uuid, accepted_at timestamptz);
    create table member_onboardings (member_id uuid primary key, state text, profile_completed_at timestamptz, agreement_completed_at timestamptz, billing_confirmed_at timestamptz, started_at timestamptz, completed_at timestamptz);
    create function private.ruined_current_auth_user_id() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(await source("db/migrations/20260914181653_operator_complimentary_membership.sql"));
  await db.exec(`create trigger verify_entry before insert or update of state on member_onboardings for each row execute function private.ruined_validate_member_onboarding_completion()`);
  await db.query("insert into people values ($1,'active')", [ids.person]);
  await db.query("insert into ruined_members values ($1,$2)", [ids.member, ids.person]);
  await db.query("insert into platform_users values ($1,$2,$3,'active')", [ids.auth, ids.member, ids.person]);
  await db.query("insert into member_lifecycle values ($1,'active','pending','in_progress','pre_active',null)", [ids.member]);
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'member')", [ids.auth]);
  const funded = async () => (await db.query("select private.ruined_member_has_operator_funding($1) as allowed", [ids.member])).rows[0].allowed;
  assert.equal(await funded(), false);
  for (const role of ["ops_admin", "circle_leader", "guide"]) {
    await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,$2)", [ids.auth, role]);
    assert.equal(await funded(), true, role);
    await db.query("update platform_role_grants set revoked_at=now() where role_slug=$1", [role]);
    assert.equal(await funded(), false, "Revocation must immediately remove funding");
  }
  await db.query("insert into platform_role_grants (auth_user_id,role_slug) values ($1,'guide')", [ids.auth]);
  for (const update of [
    "update platform_users set status='suspended'",
    "update platform_users set member_id=null",
    "update platform_users set person_id=null",
    "update people set status='inactive'",
    "update platform_role_grants set revoked_at=now() where role_slug='member'",
  ]) {
    await db.exec("begin"); await db.exec(update); assert.equal(await funded(), false, update); await db.exec("rollback");
  }
  assert.equal((await db.query("select private.ruined_lock_member_operator_funding($1) as allowed", [ids.member])).rows[0].allowed, true);
  await db.query("insert into person_profiles values ($1,'Member',null)", [ids.person]);
  await db.query("insert into person_email_addresses values ($1,'verified',null)", [ids.person]);
  await db.query("insert into membership_agreement_acceptances values ($1,$2,now())", [ids.member, ids.person]);
  await db.query("insert into member_onboardings(member_id,state) values ($1,'in_progress')", [ids.member]);
  await assert.rejects(() => db.exec("update member_onboardings set state='completed'"), /checkpoints/);
  await db.exec("update member_onboardings set profile_completed_at=now()");
  await assert.rejects(() => db.exec("update member_onboardings set state='completed'"), /checkpoints/);
  await db.exec("update member_onboardings set agreement_completed_at=now(), state='completed'");
  assert.equal((await db.query("select billing_confirmed_at from member_onboardings")).rows[0].billing_confirmed_at, null);
  assert.equal((await db.query("select billing_state from member_lifecycle")).rows[0].billing_state, "pending");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.auth]);
  const allowed = async () => (await db.query("select private.ruined_current_active_access_member_id() as id")).rows[0].id;
  assert.equal(await allowed(), null, "Funding alone does not complete entry");
  await db.exec("update member_lifecycle set administrative_onboarding_state='completed',standing_state='active'");
  assert.equal(await allowed(), ids.member);
  await db.exec("update member_lifecycle set standing_state='cancellation_requested'");
  assert.equal(await allowed(), null, "Unknown cancellation date fails closed");
  await db.exec("update member_lifecycle set standing_state='active'; update platform_role_grants set revoked_at=now() where role_slug='guide'");
  assert.equal(await allowed(), null);
  await db.exec("update member_lifecycle set billing_state='active'");
  assert.equal(await allowed(), ids.member, "Paid membership survives operator removal");
  const privileges = (await db.query("select has_function_privilege('anon','private.ruined_member_has_operator_funding(uuid)','execute') as anon, has_function_privilege('authenticated','private.ruined_lock_member_operator_funding(uuid)','execute') as member")).rows[0];
  assert.deepEqual(privileges, { anon: false, member: false });
});

test("entry renders activation instead of checkout for operators and server rejects complimentary checkout", async () => {
  const form = await source("src/components/membership/JoinForm.tsx");
  assert.match(form, /stage === "payment" && complimentary/);
  assert.match(form, /stage === "payment" && !complimentary/);
  assert.match(form, /JSON.stringify\(\{ action: "complete" \}\)/);
  assert.match(await source("src/lib/stripe/billing-repository.ts"), /funding\.complimentary_funded \|\|/);
});
