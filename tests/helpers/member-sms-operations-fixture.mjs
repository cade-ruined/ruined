import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { configuration, id, loader, read, installMemberSmsTemplateFixture } from "./member-sms-fixture.mjs";
import { installMemberSmsFundingFixture } from "./member-sms-funding-fixture.mjs";
import { installCircleRevealFunction } from "./circle-reveal-fixture.mjs";
import { installOperatorFundingFunctions } from "./operator-funding-fixture.mjs";
function sqlBridge(engine, queries, readOnly = false) {
  class Query {
    constructor(strings, values) { this.strings = strings; this.values = values; }
    compile(parameters) {
      let query = this.strings[0];
      this.values.forEach((value, index) => {
        if (value instanceof Query) query += value.compile(parameters);
        else { parameters.push(value instanceof Date ? value.toISOString() : value); query += `$${parameters.length}`; }
        query += this.strings[index + 1];
      });
      return query;
    }
    then(resolve, reject) {
      const parameters = [];
      const query = this.compile(parameters);
      queries.push(query);
      if (readOnly) assert.doesNotMatch(query, /\b(insert|update|delete|truncate|alter|create|drop)\b|for\s+(share|update)|ruined_lock_/i);
      return engine.query(query, parameters).then(result => result.rows).then(resolve, reject);
    }
  }
  const sql = (strings, ...values) => new Query(strings, values);
  sql.json = JSON.stringify;
  sql.begin = (options, run) => {
    assert.equal(options, "isolation level repeatable read read only");
    return engine.transaction(async tx => {
      await tx.exec("set transaction isolation level repeatable read read only");
      return run(sqlBridge(tx, queries, true));
    });
  };
  return sql;
}

export async function operationsFixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table ruined_members(id uuid primary key,person_id uuid,membership_state text,deleted_at timestamptz,email_normalized text default 'fixture@example.test');
    create table people(id uuid primary key,status text);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text);
    create table person_email_addresses(person_id uuid,email_normalized text,is_primary boolean,retired_at timestamptz,verification_state text);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text,email_normalized text);
    create table platform_role_grants(id uuid primary key default gen_random_uuid(),auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text,administrative_onboarding_state text,
      billing_state text,cancellation_effective_at timestamptz,foundations_state text,program_state text,standing_state text,current_progression_level_slug text);
    create table member_registration_access(member_id uuid primary key,profile_activated_at timestamptz);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,
      policy_version text,decision text,accepted_at timestamptz,source text,actor_auth_user_id uuid,evidence jsonb,dedupe_key text unique);
    create table circles(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz);
    create table circle_member_assignments(id bigint generated always as identity primary key,member_id uuid,circle_id uuid,ended_at timestamptz,assigned_at timestamptz);
    create table membership_blocks(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz);
    create table block_circle_assignments(id uuid primary key default gen_random_uuid(),circle_id uuid,block_id uuid,ended_at timestamptz,assigned_at timestamptz);
    create table private.member_email_cadence_event_bindings(experience_id uuid primary key,kind text);
    create table experiences(id uuid primary key,title text,timezone text,kind text,visibility text,circle_id uuid,block_id uuid,
      progression_level_slug text,registration_mode text,status text,starts_at timestamptz,cancelled_at timestamptz);
    create table experience_registrations(id uuid primary key default gen_random_uuid(),experience_id uuid,person_id uuid,member_id uuid,status text,source text default 'member');
    create table integration_entity_links(id uuid primary key default gen_random_uuid(),provider text,local_entity_type text,
      local_entity_id text,external_entity_type text,livemode boolean,metadata jsonb);`);
  const profileMigration = read("db/migrations/20260930140000_member_registration_access.sql");
  const start = profileMigration.indexOf("create function private.ruined_member_profile_released(");
  await db.exec(profileMigration.slice(start, profileMigration.indexOf("$$;", start) + 3));
  await installOperatorFundingFunctions(db);
  await installMemberSmsFundingFixture(db);
  await installCircleRevealFunction(db);
  await db.exec(read("db/migrations/20261008220000_member_sms_transport.sql"));
  await db.exec(read("db/migrations/20261008230000_member_sms_automation.sql"));
  await db.exec(read("db/migrations/20261102201731_member_sms_body_snapshot.sql"));
  await db.exec(read("db/migrations/20261102231559_member_sms_one_off_reviews.sql"));
  await installMemberSmsTemplateFixture(db);

  await db.exec("create table person_profiles(person_id uuid primary key,display_name text)");
  const queries = [], sql = sqlBridge(db, queries);
  const env = { ...configuration(), MEMBER_SMS_ENABLED: "true", MEMBER_SMS_AUTOMATION_ENABLED: "true", CRON_SECRET: "fixture-cron",
    MEMBER_SMS_AUTOMATION_ACTIVATED_AT: new Date(Date.now() - 3600_000).toISOString(), GOOGLE_COMMUNICATIONS_LIVEMODE: "true" };
  const admin = id(1), ordinary = id(2);
  await db.query("insert into platform_users(auth_user_id,status) values($1,'active'),($2,'active')", [admin, ordinary]);
  await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin'),($2,'ops_operator')", [admin, ordinary]);
  const load = loader(env, {
    "@/lib/database/server": { getApplicationDatabase: () => sql },
    "./communications-channel-catalog": { getCommunicationsChannelCatalog: () => [] },
    "./communications-catalog": { getManualCommunicationCatalog: () => [] },
    twilio: () => assert.fail("Viewing operations must never contact Twilio"),
  });
  const service = load("src/lib/communications/member-sms-operations.ts");
  const view = options => service.getMemberSmsOperationsOverview(admin, options);
  let serial = 100;
  const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
  async function member() {
    const memberId = id(serial++), personId = id(serial++), authId = id(serial++), phone = `+1202555${String(serial).padStart(4, "0")}`;
    await db.query("insert into ruined_members(id,person_id,membership_state,deleted_at) values($1,$2,'active',null)", [memberId, personId]);
    await db.query("insert into people values($1,'active')", [personId]);
    await db.query("insert into person_private_profiles values($1,$2)", [personId, phone]);
    await db.query("insert into person_profiles values($1,'Test Member')", [personId]);
    await db.query("insert into person_email_addresses values($1,'fixture@example.test',true,null,'verified')", [personId]);
    await db.query("insert into platform_users values($1,$2,$3,'active','fixture@example.test')", [authId, memberId, personId]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [authId]);
    await db.query("insert into member_lifecycle values($1,'active','completed','active',null,'completed','active','active',null)", [memberId]);
    return { memberId, personId, authId, phone };
  }
  async function consent(m, overrides = {}) {
    const evidence = { context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "sms",
      destination: m.phone, requested: true, action: "sms_checkbox_checked", marketingConsent: false,
      termsVersion: "membership-text-messages-v1", ...overrides.evidence };
    const result = await db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence)
      values($1,'communications',$2,$3,$4,'member',$5,$6) returning id::text`,
    [m.memberId, overrides.version ?? "membership-reminders-v2", overrides.decision ?? "accepted", overrides.acceptedAt ?? ago(30), m.authId, JSON.stringify(evidence)]);
    return result.rows[0].id;
  }
  async function event(overrides = {}) {
    const e = { eventId: id(serial++), title: "Membership call", startsAt: ago(-58), timeZone: "America/Denver", ...overrides };
    await db.query(`insert into experiences(id,title,timezone,kind,visibility,registration_mode,status,starts_at)
      values($1,$2,$3,'weekly_call','all_members','none','published',$4)`, [e.eventId, e.title, e.timeZone, e.startsAt]);
    await db.query(`insert into integration_entity_links(provider,local_entity_type,local_entity_id,external_entity_type,livemode,metadata)
      values('google','experience',$1,'meet_space',true,'{"meetingUri":"https://meet.google.com/abc-defg-hij"}')`, [e.eventId]);
    return e;
  }
  return { db, sql, env, queries, admin, ordinary, load, service, view, member, consent, event, ago };
}
