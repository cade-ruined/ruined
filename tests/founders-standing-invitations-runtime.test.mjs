import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";
import ts from "typescript";
import { Parameter, arraySerializer, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("standing founder invitations are call-only and require the current original founding team", async t => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  const driver = postgres({ host: "127.0.0.1", port: 1, prepare: false }); // Serializers only; never connects.
  t.after(async () => { await db.close(); await driver.end(); });
  const queries = [];
  function bridge(engine) {
    class Query {
      constructor(strings, values) { this.strings = strings; this.values = values; }
      compile(params) {
        let query = this.strings[0];
        this.values.forEach((value, index) => {
          if (value instanceof Query) query += value.compile(params);
          else {
            params.push(value instanceof Parameter ? value.array ? arraySerializer(value.value) : types.json.serialize(value.value) : value);
            query += `$${params.length}`;
          }
          query += this.strings[index + 1];
        });
        return query;
      }
      then(resolve, reject) {
        const params = [], query = this.compile(params);
        queries.push(query);
        return engine.query(query, params).then(result => result.rows).then(resolve, reject);
      }
    }
    const sql = (strings, ...values) => new Query(strings, values);
    sql.array = driver.array; sql.json = driver.json;
    sql.begin = fn => engine.transaction(tx => fn(bridge(tx)));
    return sql;
  }
  async function load(path, dependencies) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const compiledModule = { exports: {} };
    new Function("require", "module", "exports", code)(name => {
      if (name === "server-only") return {};
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    }, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  const policy = await load("src/lib/membership/access-policy.ts", {});
  const sql = bridge(db);
  const access = await load("src/lib/platform/experience-member-access.ts", {
    "@/lib/membership/access-policy": policy,
    "@/lib/database/server": { getApplicationDatabase: () => sql },
  });
  await db.exec(`
    create schema private;
    create table people(id uuid primary key,status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,deleted_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text default 'active',
      standing_state text default 'active',cancellation_effective_at timestamptz,
      administrative_onboarding_state text default 'completed',billing_state text default 'pending',
      foundations_state text default 'not_started',program_state text default 'onboarding',current_progression_level_slug text);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text default 'active',email_normalized text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table person_email_addresses(person_id uuid,is_primary boolean default true,retired_at timestamptz,verification_state text default 'verified');
    create table circles(id uuid primary key,name text,status text default 'active',activated_at timestamptz default now()-interval '1 day',ends_at timestamptz);
    create table circle_member_assignments(id bigint generated always as identity primary key,member_id uuid,circle_id uuid,ended_at timestamptz,assigned_at timestamptz default now()-interval '1 day');
    create table experiences(id uuid primary key,status text default 'published',visibility text,registration_mode text default 'internal',starts_at timestamptz default now()+interval '1 day');
    create table experience_registrations(id bigint generated always as identity primary key,experience_id uuid,member_id uuid,person_id uuid,status text,source text);
    create function private.ruined_member_has_complimentary_funding(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_lock_member_complimentary_funding(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_lock_member_operator_funding(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_member_paid_reservation(uuid) returns uuid language sql as $$select null::uuid$$;
    create function private.ruined_member_circle_is_revealed(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_member_profile_released(uuid) returns boolean language sql as $$select false$$;
  `);
  await db.query("insert into people(id) values($1)", [id(1)]);
  await db.query("insert into ruined_members values($1,$2,null)", [id(2), id(1)]);
  await db.query("insert into member_lifecycle(member_id) values($1)", [id(2)]);
  await db.query("insert into platform_users(auth_user_id,member_id,person_id,email_normalized) values($1,$2,$3,'founder@example.test')", [id(3), id(2), id(1)]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member'),($1,'ops_admin')", [id(3)]);
  await db.query("insert into person_email_addresses(person_id) values($1)", [id(1)]);
  await db.query("insert into circles(id,name) values($1,'Renamed founding team'),($2,'Founders Circle')", [access.FOUNDERS_CIRCLE_ID, id(4)]);
  await db.query("insert into circle_member_assignments(member_id,circle_id) values($1,$2)", [id(2), access.FOUNDERS_CIRCLE_ID]);
  const visibilities = ["public", "all_members", "circle", "block", "invite_only", "progression"];
  const experiences = visibilities.map((visibility, index) => ({ id: id(20 + index), visibility, circle_id: id(4), block_id: id(5), registration_mode: "internal" }));
  for (const experience of experiences) await db.query("insert into experiences(id,visibility) values($1,$2)", [experience.id, experience.visibility]);
  await db.query("insert into experiences(id,visibility,status) values($1,'invite_only','draft'),($2,'invite_only','cancelled'),($3,'invite_only','completed')", [id(30), id(31), id(32)]);

  await t.test("the original Circle identity survives rename; admin or Founding pricing alone is insufficient", async () => {
    assert.equal(await access.memberHasStandingFounderInvitation(sql, id(2)), true);
    assert.deepEqual(await access.getStandingFounderInvitationMemberIds(sql), [id(2)]);
    assert.equal(await access.memberHasStandingFounderInvitation(sql, null), false);
    assert.equal(await access.memberHasStandingFounderInvitation(sql, id(99)), false);
    await db.query("update circle_member_assignments set circle_id=$1", [id(4)]);
    assert.equal(await access.memberHasStandingFounderInvitation(sql, id(2)), false, "A different Circle with the same display name is not the founding team");
    assert.deepEqual(await access.getStandingFounderInvitationMemberIds(sql), []);
    await db.query("update circle_member_assignments set circle_id=$1", [access.FOUNDERS_CIRCLE_ID]);
  });

  await t.test("revocation, suspension, stale assignment, and unverified identity remove the standing invitation", async () => {
    for (const [restrict, restore] of [
      ["update platform_role_grants set revoked_at=now() where role_slug='ops_admin'", "update platform_role_grants set revoked_at=null"],
      ["update platform_role_grants set revoked_at=now() where role_slug='member'", "update platform_role_grants set revoked_at=null"],
      ["update circle_member_assignments set ended_at=now()", "update circle_member_assignments set ended_at=null"],
      ["update circle_member_assignments set assigned_at=now()+interval '1 day'", "update circle_member_assignments set assigned_at=now()-interval '1 day'"],
      ["update circles set status='archived'", "update circles set status='active'"],
      ["update people set status='inactive'", "update people set status='active'"],
      ["update ruined_members set deleted_at=now()", "update ruined_members set deleted_at=null"],
      ["update platform_users set status='suspended'", "update platform_users set status='active'"],
      ["update member_lifecycle set account_state='suspended'", "update member_lifecycle set account_state='active'"],
      ["update member_lifecycle set standing_state='suspended'", "update member_lifecycle set standing_state='active'"],
      ["update person_email_addresses set verification_state='unverified'", "update person_email_addresses set verification_state='verified'"],
      ["update person_email_addresses set retired_at=now()", "update person_email_addresses set retired_at=null"],
      ["update person_email_addresses set is_primary=false", "update person_email_addresses set is_primary=true"],
      ["update member_lifecycle set standing_state='cancellation_requested',cancellation_effective_at=now()-interval '1 day'", "update member_lifecycle set standing_state='active',cancellation_effective_at=null"],
    ]) {
      await db.exec(restrict);
      assert.equal(await access.memberHasStandingFounderInvitation(sql, id(2)), false, restrict);
      assert.deepEqual(await access.getStandingFounderInvitationMemberIds(sql), [], restrict);
      await db.exec(restore);
      assert.equal(await access.memberHasStandingFounderInvitation(sql, id(2)), true, restore);
    }
  });

  await t.test("all published/completed call scopes are available without registrations, capacity, or cohort changes", async () => {
    const before = queries.length;
    for (const experience of experiences) {
      assert.equal(await access.memberEligibleForExperienceSnapshot(sql, experience, id(2)), true, experience.visibility);
    }
    assert.equal(await access.memberEligibleForExperienceSnapshot(sql, { ...experiences[4], id: id(30) }, id(2)), false, "Draft call remains unavailable");
    assert.equal(await access.memberEligibleForExperienceSnapshot(sql, { ...experiences[4], id: id(31) }, id(2)), false, "Cancelled call remains unavailable");
    assert.deepEqual(new Set(await access.getEligibleExplicitExperienceInvitationIds(id(3))), new Set([...experiences.map(e => e.id), id(32)]));
    assert.ok(queries.slice(before).every(query => /^\s*select\b/i.test(query)), "Read access must not create registrations or alter cohorts/billing");
    assert.equal((await db.query("select count(*)::int as total from experience_registrations")).rows[0].total, 0);
    assert.equal((await db.query("select count(*)::int as total from circle_member_assignments")).rows[0].total, 1);
    const lifecycle = (await db.query("select billing_state,foundations_state,program_state from member_lifecycle")).rows[0];
    assert.deepEqual(lifecycle, { billing_state: "pending", foundations_state: "not_started", program_state: "onboarding" });
    assert.equal(policy.memberCan(policy.deriveMemberAccessPolicy({
      accountState: "active", administrativeOnboardingState: "completed", billingState: "pending", foundationsState: "not_started",
      standingState: "active", programState: "onboarding", registrationHeld: true,
    }), "circle.read"), false, "The underlying private Circle policy is unchanged");
  });

  await t.test("an explicit per-call cancellation opts out without cancelling the founder's other calls", async () => {
    await db.query("insert into experience_registrations(experience_id,member_id,person_id,status,source) values($1,$2,$3,'cancelled','member')", [experiences[4].id, id(2), id(1)]);
    assert.equal(await access.memberEligibleForExperienceSnapshot(sql, experiences[4], id(2)), false);
    assert.equal((await access.getEligibleExplicitExperienceInvitationIds(id(3))).includes(experiences[4].id), false);
    assert.equal(await access.memberEligibleForExperienceSnapshot(sql, experiences[2], id(2)), true);
    await db.exec("update member_lifecycle set foundations_state='completed',program_state='active',billing_state='active'");
    assert.equal(await access.memberEligibleForExperienceSnapshot(sql, experiences[4], id(2)), false, "Regular member entitlement cannot override an explicit founder opt-out");
    await db.exec("update member_lifecycle set foundations_state='not_started',program_state='onboarding',billing_state='pending'");
    await db.exec("delete from experience_registrations");
  });

  await t.test("send authorization locks founder evidence; snapshots remain read-only", async () => {
    let before = queries.length;
    assert.equal(await access.memberEligibleForExperienceSnapshot(sql, experiences[2], id(2)), true);
    assert.ok(queries.slice(before).every(query => !/for share/i.test(query)));
    before = queries.length;
    assert.equal(await sql.begin(tx => access.memberEligibleForExperience(tx, experiences[2], id(2))), true);
    assert.ok(queries.slice(before).some(query => /for share of member, person, lifecycle, account, member_grant, admin_grant, email_address, assignment, circle/.test(query)));
  });
});
