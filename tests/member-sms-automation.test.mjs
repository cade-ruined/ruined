import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { configuration, id, sid, loader, read } from "./helpers/member-sms-fixture.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";

// Lazy fragments reproduce postgres-js nested SQL without opening a network client.
function sqlBridge(engine) {
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
      return engine.query(this.compile(parameters), parameters).then(result => result.rows).then(resolve, reject);
    }
  }
  const sql = (strings, ...values) => new Query(strings, values);
  sql.json = JSON.stringify;
  sql.begin = run => engine.transaction(tx => run(sqlBridge(tx)));
  return sql;
}

test("SMS automation requires two deliberate switches, valid activation time, provider config and cron authorization", async () => {
  const model = loader()("src/lib/communications/member-sms-automation-model.ts");
  for (const value of ["", "yesterday", "2026-10-08", "2026-02-30T10:00:00Z", "2026-10-08T10:00:00-06:00"]) {
    assert.equal(model.readMemberSmsAutomationConfiguration({ MEMBER_SMS_AUTOMATION_ACTIVATED_AT: value }).ready, false);
  }
  for (const env of [{}, { MEMBER_SMS_ENABLED: "true" }, { MEMBER_SMS_AUTOMATION_ENABLED: "true" },
    { ...configuration(), MEMBER_SMS_ENABLED: "true", MEMBER_SMS_AUTOMATION_ENABLED: "true" }]) {
    const load = loader(env, { "@/lib/database/server": { getApplicationDatabase: () => assert.fail("Disabled worker read database") } });
    assert.equal((await load("src/lib/communications/member-sms-automation.ts").runMemberSmsAutomation()).skipped,
      env.MEMBER_SMS_ENABLED && env.MEMBER_SMS_AUTOMATION_ENABLED ? "unconfigured" : "disabled");
  }
  const route = loader({ CRON_SECRET: "fixture-cron" }, {
    "@/lib/communications/member-sms-automation": { runMemberSmsAutomation: () => ({ enabled: false, skipped: "disabled" }) },
  })("app/api/internal/communications/member-sms/route.ts");
  for (const authorization of ["", "Bearer wrong", "fixture-cron"]) {
    assert.equal((await route.GET(new Request("https://example.test/cron", { headers: { authorization } }))).status, 401);
  }
  const response = await route.GET(new Request("https://example.test/cron", { headers: { authorization: "Bearer fixture-cron" } }));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(JSON.parse(read("vercel.json")).crons.find(row => row.path === "/api/internal/communications/member-sms").schedule, "*/5 * * * *");
});

test("durable SMS automation exercises current calendar access and no-retry behavior in isolated PostgreSQL", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table ruined_members(id uuid primary key,person_id uuid,membership_state text,deleted_at timestamptz);
    create table people(id uuid primary key,status text);
    create table person_private_profiles(person_id uuid primary key,mobile_e164 text);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text,email_normalized text);
    create table platform_role_grants(id uuid primary key default gen_random_uuid(),auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text,administrative_onboarding_state text,
      billing_state text,cancellation_effective_at timestamptz,foundations_state text,program_state text,standing_state text,current_progression_level_slug text);
    create table member_registration_access(member_id uuid primary key,profile_activated_at timestamptz);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,
      policy_version text,decision text,accepted_at timestamptz,source text,actor_auth_user_id uuid,evidence jsonb,dedupe_key text unique);
    create table circles(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz);
    create table circle_member_assignments(id uuid primary key default gen_random_uuid(),member_id uuid,circle_id uuid,ended_at timestamptz,assigned_at timestamptz);
    create table membership_blocks(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz);
    create table block_circle_assignments(id uuid primary key default gen_random_uuid(),circle_id uuid,block_id uuid,ended_at timestamptz,assigned_at timestamptz);
    create table experiences(id uuid primary key,title text,timezone text,kind text,visibility text,circle_id uuid,block_id uuid,
      progression_level_slug text,registration_mode text,status text,starts_at timestamptz,cancelled_at timestamptz);
    create table experience_registrations(id uuid primary key default gen_random_uuid(),experience_id uuid,person_id uuid,status text);
    create table integration_entity_links(id uuid primary key default gen_random_uuid(),provider text,local_entity_type text,
      local_entity_id text,external_entity_type text,livemode boolean,metadata jsonb);`);
  const profileMigration = read("db/migrations/20260930140000_member_registration_access.sql");
  const start = profileMigration.indexOf("create function private.ruined_member_profile_released(");
  await db.exec(profileMigration.slice(start, profileMigration.indexOf("$$;", start) + 3));
  await installOperatorFundingFunctions(db);
  await db.exec(read("db/migrations/20261008220000_member_sms_transport.sql"));
  await db.exec(read("db/migrations/20261008230000_member_sms_automation.sql"));
  const sql = sqlBridge(db), env = { ...configuration(), MEMBER_SMS_ENABLED: "true", MEMBER_SMS_AUTOMATION_ENABLED: "true",
    MEMBER_SMS_AUTOMATION_ACTIVATED_AT: new Date(Date.now() - 60 * 60_000).toISOString(), GOOGLE_COMMUNICATIONS_LIVEMODE: "true" };
  let providerFails = false; const sends = [];
  const load = loader(env, { "@/lib/database/server": { getApplicationDatabase: () => sql },
    twilio: () => ({ messages: { create: async payload => {
      sends.push(payload); if (providerFails) throw new Error("private provider failure"); return { sid: sid(sends.length + 1000) };
    } } }),
  });
  const automation = load("src/lib/communications/member-sms-automation.ts");
  const repo = load("src/lib/communications/member-sms-automation-repository.ts");
  const transport = load("src/lib/communications/member-sms-repository.ts");
  const config = load("src/lib/communications/member-sms-automation-model.ts").readMemberSmsAutomationConfiguration(env);
  let serial = 100;
  const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
  async function member() {
    const memberId = id(serial++), personId = id(serial++), authId = id(serial++), phone = `+1202555${String(serial).padStart(4, "0")}`;
    await db.query("insert into ruined_members values($1,$2,'active',null)", [memberId, personId]);
    await db.query("insert into people values($1,'active')", [personId]);
    await db.query("insert into person_private_profiles values($1,$2)", [personId, phone]);
    await db.query("insert into platform_users values($1,$2,$3,'active','fixture@example.test')", [authId, memberId, personId]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [authId]);
    await db.query("insert into member_lifecycle values($1,'active','completed','active',null,'completed','active','active',null)", [memberId]);
    return { memberId, personId, authId, phone };
  }
  async function consent(m, acceptedAt = ago(30), overrides = {}) {
    const evidence = { context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "sms",
      destination: m.phone, requested: true, action: "sms_checkbox_checked", marketingConsent: false,
      termsVersion: "membership-text-messages-v1", ...overrides.evidence };
    const result = await db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence)
      values($1,'communications',$2,$3,$4,'member',$5,$6) returning id::text`,
    [m.memberId, overrides.version ?? "membership-reminders-v2", overrides.decision ?? "accepted", acceptedAt, m.authId, JSON.stringify(evidence)]);
    return result.rows[0].id;
  }
  async function event(overrides = {}) {
    const e = { eventId: id(serial++), title: "TIME / SEE", startsAt: ago(-58), timeZone: "America/Denver", ...overrides };
    await db.query(`insert into experiences(id,title,timezone,kind,visibility,registration_mode,status,starts_at)
      values($1,$2,$3,'weekly_call','all_members','none','published',$4)`, [e.eventId, e.title, e.timeZone, e.startsAt]);
    await db.query(`insert into integration_entity_links(provider,local_entity_type,local_entity_id,external_entity_type,livemode,metadata)
      values('google','experience',$1,'meet_space',true,'{"meetingUri":"https://meet.google.com/abc-defg-hij"}')`, [e.eventId]);
    return e;
  }
  async function acceptedConfirmation(m, consentId) {
    await db.query(`insert into private.member_sms_delivery_attempts(member_id,reminder_key,reminder_kind,destination_e164,consent_id,body_sha256,status,twilio_message_sid)
      values($1,$2,'opt_in_confirmation',$3,$4,$5,'accepted',$6)`,
    [m.memberId, `consent:${consentId}`, m.phone, consentId, "0".repeat(64), sid(serial++)]);
  }
  async function reset() {
    await db.exec(`truncate private.member_sms_automation_jobs,private.member_sms_delivery_attempts,private.member_sms_inbound_receipts,
      private.member_sms_phone_suppressions,member_consents,ruined_members,people,person_private_profiles,platform_users,platform_role_grants,
      member_lifecycle,member_registration_access,circles,circle_member_assignments,membership_blocks,block_circle_assignments,
      experiences,experience_registrations,integration_entity_links,member_complimentary_grants cascade;`);
    sends.length = 0; providerFails = false;
  }
  async function nextReminder() {
    await repo.enqueueMemberSmsAutomation(sql, config);
    const job = await repo.claimMemberSmsAutomationJob(sql);
    assert.ok(job);
    const input = await repo.memberSmsAutomationReminder(sql, job);
    return { job, input, options: { guard: tx => repo.validateMemberSmsAutomationOccurrence(tx, input, config) } };
  }

  await t.test("confirmation is for fresh exact v2 evidence; preactivation, old, withdrawn and old versions do not enroll", async () => {
    await reset();
    const fresh = await member(); const consentId = await consent(fresh, ago(1));
    await db.query("update ruined_members set membership_state='pending' where id=$1", [fresh.memberId]);
    await db.query("update member_lifecycle set account_state='provisional',billing_state='pending' where member_id=$1", [fresh.memberId]);
    for (const settings of [{ acceptedAt: ago(90) }, { acceptedAt: ago(12) }, { version: "membership-reminders-v1" }, { decision: "withdrawn" }]) {
      const m = await member(); await consent(m, settings.acceptedAt ?? ago(1), settings);
    }
    const result = await automation.runMemberSmsAutomation();
    assert.equal(result.queued, 1); assert.equal(result.accepted, 1);
    assert.match(sends[0].body, /You opted in/);
    assert.equal((await db.query("select reminder_key from private.member_sms_delivery_attempts")).rows[0].reminder_key, `consent:${consentId}`);
    assert.equal((await automation.runMemberSmsAutomation()).processed, 0);
  });
  await t.test("one hour call reminder includes local time/calendar link and replays never send twice", async () => {
    await reset(); const m = await member(); await consent(m); await event();
    const result = await automation.runMemberSmsAutomation();
    assert.equal(result.accepted, 1); assert.equal(result.confirmationsAccepted, 1); assert.equal(sends.length, 2);
    assert.match(sends[0].body, /You opted in/);
    assert.match(sends[1].body, /TIME \/ SEE starts/); assert.match(sends[1].body, /\/my\/experiences/);
    assert.match(sends[1].body, /M[SD]T/);
    assert.equal((await automation.runMemberSmsAutomation()).processed, 0);
  });
  await t.test("too early, stale, cancelled, draft, offline and wrong-mode calls never generate reminders", async () => {
    await reset(); const m = await member(); await consent(m);
    await event({ startsAt: ago(-65) }); await event({ startsAt: ago(-49) });
    const cancelled = await event(); await db.query("update experiences set status='cancelled',cancelled_at=now() where id=$1", [cancelled.eventId]);
    const draft = await event(); await db.query("update experiences set status='draft' where id=$1", [draft.eventId]);
    const offline = await event(); await db.query("delete from integration_entity_links where local_entity_id=$1", [offline.eventId]);
    const sandbox = await event(); await db.query("update integration_entity_links set livemode=false where local_entity_id=$1", [sandbox.eventId]);
    assert.equal((await automation.runMemberSmsAutomation()).processed, 0); assert.equal(sends.length, 0);
  });
  await t.test("profile hold, removed role, suspended status, and paused participation suppress call access", async () => {
    for (const mutation of [
      async m => db.query("insert into member_registration_access values($1,null)", [m.memberId]),
      async m => db.query("update platform_role_grants set revoked_at=now() where auth_user_id=$1", [m.authId]),
      async m => db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [m.memberId]),
      async m => db.query("update member_lifecycle set standing_state='paused' where member_id=$1", [m.memberId]),
    ]) {
      await reset(); const m = await member(); await consent(m); await event(); await mutation(m);
      await automation.runMemberSmsAutomation(); assert.equal(sends.length, 0);
    }
  });
  await t.test("invite-only, public and registration-required calls require registered attendance; cancellation always wins", async () => {
    for (const visibility of ["invite_only", "public", "all_members"]) {
      for (const status of [null, "waitlisted", "cancelled", "external_pending", "registered"]) {
        await reset(); const m = await member(); await consent(m); const e = await event();
        await db.query("update experiences set visibility=$2,registration_mode='internal' where id=$1", [e.eventId, visibility]);
        if (status) await db.query("insert into experience_registrations(experience_id,person_id,status) values($1,$2,$3)", [e.eventId, m.personId, status]);
        const result = await automation.runMemberSmsAutomation(); assert.equal(result.accepted, status === "registered" ? 1 : 0);
      }
    }
    await reset(); const m = await member(); await consent(m); const e = await event();
    await db.query("insert into experience_registrations(experience_id,person_id,status) values($1,$2,'cancelled')", [e.eventId, m.personId]);
    await automation.runMemberSmsAutomation(); assert.equal(sends.length, 0);
  });
  await t.test("Circle and Block calls follow current dated assignments, completed Foundations and active rooms", async () => {
    for (const variant of ["valid", "unassigned", "forming", "future", "ended", "foundations_pending", "block", "wrong_block"]) {
      await reset(); const m = await member(); await consent(m); const e = await event(); const circle = id(serial++), block = id(serial++);
      await db.query("insert into circles values($1,$2,$3,null)", [circle, variant === "forming" ? "forming" : "active", ago(60)]);
      if (variant !== "unassigned") await db.query(`insert into circle_member_assignments(member_id,circle_id,ended_at,assigned_at)
        values($1,$2,$3,$4)`, [m.memberId, circle, variant === "ended" ? ago(1) : null, variant === "future" ? ago(-60) : ago(60)]);
      await db.query("update experiences set visibility='circle',circle_id=$2 where id=$1", [e.eventId, circle]);
      if (variant === "foundations_pending") await db.query("update member_lifecycle set foundations_state='in_progress' where member_id=$1", [m.memberId]);
      if (["block", "wrong_block"].includes(variant)) {
        await db.query("insert into membership_blocks values($1,'active',$2,null)", [block, ago(60)]);
        await db.query("insert into block_circle_assignments(circle_id,block_id,assigned_at) values($1,$2,$3)", [circle, block, ago(60)]);
        await db.query("update experiences set visibility='block',circle_id=null,block_id=$2 where id=$1", [e.eventId, variant === "wrong_block" ? id(serial++) : block]);
      }
      assert.equal((await automation.runMemberSmsAutomation()).accepted, ["valid", "block"].includes(variant) ? 1 : 0, variant);
    }
  });
  await t.test("final dispatch rejects cancellation, changed start, audience removal, link removal, stale window and new withdrawal", async () => {
    for (const mutation of [
      async (m,e) => db.query("update experiences set status='cancelled',cancelled_at=now() where id=$1", [e.eventId]),
      async (m,e) => db.query("update experiences set starts_at=starts_at+interval '1 day' where id=$1", [e.eventId]),
      async (m,e) => db.query("update experiences set visibility='invite_only' where id=$1", [e.eventId]),
      async (m,e) => db.query("delete from integration_entity_links where local_entity_id=$1", [e.eventId]),
      async () => db.exec("update private.member_sms_automation_jobs set expires_at=now()-interval '1 second'"),
      async m => consent(m, ago(0), { decision: "withdrawn" }),
    ]) {
      await reset(); const m = await member(); const consentId = await consent(m); await acceptedConfirmation(m, consentId); const e = await event();
      const { input, options } = await nextReminder();
      const reservation = await transport.reserveMemberSmsAttempt(sql, input, "fixture", options);
      assert.ok(reservation.attemptId); await mutation(m,e);
      const result = await transport.dispatchReservedMemberSms(sql, input, reservation, () => assert.fail("Changed source must not send"), options);
      assert.equal(result.status, "blocked");
    }
  });
  await t.test("rescheduling creates only a fresh future occurrence and an unknown result is never retried", async () => {
    await reset(); const m = await member(); const consentId = await consent(m); await acceptedConfirmation(m, consentId); const e = await event(); providerFails = true;
    assert.equal((await automation.runMemberSmsAutomation()).unknown, 1);
    assert.equal((await automation.runMemberSmsAutomation()).processed, 0); assert.equal(sends.length, 1);
    providerFails = false;
    await db.query("update experiences set starts_at=$2 where id=$1", [e.eventId, ago(-57)]);
    assert.equal((await automation.runMemberSmsAutomation()).accepted, 1); assert.equal(sends.length, 2);
  });
  await t.test("a failed or uncertain enrollment confirmation blocks the call and never triggers an automatic resend", async () => {
    await reset(); const m = await member(); await consent(m, ago(90)); const e = await event(); providerFails = true;
    const result = await automation.runMemberSmsAutomation();
    assert.equal(result.unknown, 1); assert.equal(result.accepted, 0); assert.equal(sends.length, 1);
    assert.match(sends[0].body, /You opted in/);
    providerFails = false;
    await db.query("update experiences set starts_at=$2 where id=$1", [e.eventId, ago(-57)]);
    assert.equal((await automation.runMemberSmsAutomation()).accepted, 0); assert.equal(sends.length, 1);
    await reset(); const another = await member(); const consentId = await consent(another); await acceptedConfirmation(another, consentId);
    await db.exec("update private.member_sms_delivery_attempts set delivery_status='undelivered'"); await event();
    assert.equal((await automation.runMemberSmsAutomation()).accepted, 0); assert.equal(sends.length, 0);
  });
  await t.test("claimed worker crashes are not reclaimed; blocked jobs do not starve eligible later jobs", async () => {
    await reset(); const m = await member(); await consent(m); await event();
    const { job } = await nextReminder();
    assert.equal((await automation.runMemberSmsAutomation()).processed, 0);
    assert.equal((await db.query("select status from private.member_sms_automation_jobs where id=$1", [job.id])).rows[0].status, "processing");
    await reset(); const valid = await member(); await consent(valid); await event();
    await db.query(`insert into private.member_sms_automation_jobs(member_id,reminder_kind,reminder_key,due_at,expires_at)
      select $1,'opt_in_confirmation','invalid:'||n::text,now()-interval '5 minutes',now()+interval '5 minutes'
      from generate_series(1,105) n`, [valid.memberId]);
    const first = await automation.runMemberSmsAutomation(); assert.equal(first.processed, 100); assert.equal(first.blocked, 100);
    const second = await automation.runMemberSmsAutomation(); assert.equal(second.processed, 6); assert.equal(second.accepted, 1);
    assert.equal(sends.length, 2);
  });
});
