import { installRegistrationProfileReleaseFunction } from "./helpers/registration-access-fixture.mjs";
import { installCircleRevealFunction } from "./helpers/circle-reveal-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { id, loader, read } from "./helpers/member-sms-fixture.mjs";
import { installOperatorFundingFunctions } from "./helpers/operator-funding-fixture.mjs";
import { installPaidReservationFunction } from "./helpers/paid-reservation-fixture.mjs";

// The existing SMS fixture's lazy-fragment bridge also supports conditional FOR SHARE clauses.
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
const ago = minutes => new Date(Date.now() - minutes * 60_000).toISOString();
const frozenPayload = email => ({ from: "Ruined <connect@example.test>", to: email,
  replyTo: ["connect@example.test"], subject: "Tomorrow: SEE.", html: "<p>Your call is tomorrow.</p>", text: "Your call is tomorrow." });

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create schema private;
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,membership_state text,deleted_at timestamptz,
      created_at timestamptz not null default statement_timestamp()-interval '2 days');
    create table people(id uuid primary key,status text);
    create table person_profiles(person_id uuid primary key,display_name text);
    create table person_email_addresses(id uuid primary key default gen_random_uuid(),person_id uuid,email_normalized text,
      is_primary boolean,retired_at timestamptz,verification_state text);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text,email_normalized text);
    create table platform_role_grants(id uuid primary key default gen_random_uuid(),auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text,administrative_onboarding_state text,
      billing_state text,cancellation_effective_at timestamptz,foundations_state text,program_state text,standing_state text,current_progression_level_slug text);
    create table member_registration_access(member_id uuid primary key,profile_activated_at timestamptz,registered_at timestamptz);
    create table member_consents(id bigint generated always as identity primary key,member_id uuid,consent_type text,
      policy_version text,decision text,accepted_at timestamptz,source text,actor_auth_user_id uuid,evidence jsonb,dedupe_key text unique);
    create table communication_contacts(id uuid primary key default gen_random_uuid(),email_normalized text,delivery_state text);
    create table circles(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz,name text);
    create table circle_member_assignments(id bigint generated always as identity primary key,member_id uuid,circle_id uuid,ended_at timestamptz,assigned_at timestamptz);
    create table membership_blocks(id uuid primary key,status text,activated_at timestamptz,ends_at timestamptz);
    create table block_circle_assignments(id uuid primary key default gen_random_uuid(),circle_id uuid,block_id uuid,ended_at timestamptz,assigned_at timestamptz);
    create table member_progression_assignments(id uuid primary key default gen_random_uuid(),member_id uuid,
      progression_level_slug text,assigned_at timestamptz,ended_at timestamptz);
    create table experiences(id uuid primary key,title text,timezone text,kind text,visibility text,circle_id uuid,block_id uuid,
      progression_level_slug text,registration_mode text,status text,starts_at timestamptz,ends_at timestamptz,cancelled_at timestamptz,version integer default 1,capacity integer,metadata jsonb default '{}'::jsonb);
    create table experience_registrations(id uuid primary key default gen_random_uuid(),experience_id uuid,person_id uuid,member_id uuid,
      status text,source text default 'member',registered_at timestamptz default clock_timestamp(),metadata jsonb,unique(experience_id,person_id));
    create table experience_registration_events(id uuid primary key default gen_random_uuid(),registration_id uuid,
      next_status text,previous_status text,occurred_at timestamptz default clock_timestamp(),
      experience_id uuid,person_id uuid,source text,actor_auth_user_id uuid,reason text,dedupe_key text unique);
    create table operator_audit_events(actor_auth_user_id uuid,action text,subject_type text,subject_id text,member_id uuid,reason text,metadata jsonb,dedupe_key text unique);
    create table integration_entity_links(id uuid primary key default gen_random_uuid(),provider text,local_entity_type text,
      local_entity_id text,external_entity_type text,livemode boolean,metadata jsonb);
    create function private.ruined_member_paid_reservation(uuid) returns uuid language sql as 'select null::uuid';`);
  // Canonical access and the shipped paid-provider predicate run against isolated fixture evidence.
  await installOperatorFundingFunctions(db);
  await installCircleRevealFunction(db);
  await db.exec("drop table member_registration_access; drop function private.ruined_member_paid_reservation(uuid)");
  await installPaidReservationFunction(db);
  await db.exec(`alter table member_registration_access add column profile_activated_at timestamptz,add column registered_at timestamptz;
    alter table membership_commercial_reservations add column billing_plan text default 'monthly'`);
  await installRegistrationProfileReleaseFunction(db);
  await db.exec(read("db/migrations/20261012230000_member_email_cadence.sql"));
  await db.exec(read("db/migrations/20261012233000_member_email_sequences.sql"));
  const sql = sqlBridge(db);
  const calendar=[];
  const env = { MEMBER_EMAIL_CADENCE_ENABLED: "true", MEMBER_EMAIL_CADENCE_ACTIVATED_AT: ago(2880), GOOGLE_COMMUNICATIONS_LIVEMODE: "true" };
  const load = loader(env, { "@/lib/database/server": { getApplicationDatabase: () => sql },
    "@/lib/platform/ops-calendar-repository": { markOpsExperienceCalendarPending: async (_tx, input) => calendar.push(input) } });
  const repo = load("src/lib/communications/member-email-cadence-repository.ts");
  const model = load("src/lib/communications/member-email-cadence-model.ts");
  const inheritance=load("src/lib/communications/member-email-cadence-inheritance.ts");
  const schedules=load("src/lib/membership/foundations-schedule.ts");
  let serial = 100;
  async function member(options = {}) {
    const m = { memberId: id(serial++), personId: id(serial++), authId: id(serial++), email: `member-${serial}@example.test` };
    await db.query("insert into people values($1,'active')", [m.personId]);
    await db.query("insert into ruined_members(id,person_id,email_normalized,membership_state,deleted_at) values($1,$2,$3,'active',null)", [m.memberId, m.personId, m.email]);
    await db.query("insert into person_profiles values($1,'Avery Example')", [m.personId]);
    await db.query("insert into person_email_addresses(person_id,email_normalized,is_primary,verification_state) values($1,$2,true,'verified')", [m.personId, m.email]);
    await db.query("insert into platform_users values($1,$2,$3,'active',$4)", [m.authId, m.memberId, m.personId, m.email]);
    await db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'member')", [m.authId]);
    await db.query("insert into member_lifecycle values($1,'active','completed','active',null,'completed','active','active',null)", [m.memberId]);
    if (options.onboarding) {
      await db.query("update member_lifecycle set administrative_onboarding_state='pending',billing_state='pending',standing_state='pre_active',program_state='onboarding',foundations_state='in_progress' where member_id=$1", [m.memberId]);
      await db.query("insert into member_registration_access(member_id) values($1)", [m.memberId]);
    }
    if (options.complimentary) await db.query("insert into member_complimentary_grants(member_id,starts_at) values($1,$2)", [m.memberId, ago(2880)]);
    return m;
  }
  async function consent(m, options = {}) {
    const evidence = { context: "member_communication_preferences_v1", purpose: "membership_updates", channel: "email",
      destination: m.email, requested: true, action: "email_preference_on_at_submission", marketingConsent: false, ...options.evidence };
    const result = await db.query(`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence)
      values($1,'communications','membership-reminders-v2',$2,$3,$4,$5,$6) returning id::text`,
    [m.memberId, options.decision ?? "accepted", ago(60), options.source ?? "member", Object.hasOwn(options, "actor") ? options.actor : m.authId, JSON.stringify(evidence)]);
    return result.rows[0].id;
  }
  async function event(options = {}) {
    const e = { id: id(serial++), title: "SEE", timeZone: "America/Denver", startsAt: ago(-1430), endsAt: ago(-1520),
      visibility: "all_members", registrationMode: "internal", kind: "weekly_call", ...options };
    await db.query(`insert into experiences(id,title,timezone,kind,visibility,registration_mode,status,starts_at,ends_at,circle_id,block_id,progression_level_slug)
      values($1,$2,$3,$4,$5,$6,'published',$7,$8,$9,$10,$11)`,
    [e.id, e.title, e.timeZone, e.kind, e.visibility, e.registrationMode, e.startsAt, e.endsAt, e.circleId ?? null, e.blockId ?? null, e.progressionLevel ?? null]);
    await db.query(`insert into integration_entity_links(provider,local_entity_type,local_entity_id,external_entity_type,livemode,metadata)
      values('google','experience',$1,'meet_space',true,'{"meetingUri":"https://meet.google.com/abc-defg-hij"}')`, [e.id]);
    return await repo.readCadenceEvent(sql, e.id);
  }
  async function roster(m, e, options = {}) {
    const { rows } = await db.query("insert into experience_registrations(experience_id,person_id,member_id,status,source,registered_at) values($1,$2,$3,$4,$5,$6) returning id",
      [e.id, m.personId, m.memberId, options.status ?? "registered", options.source ?? "ops", options.registeredAt ?? ago(2880)]);
    await db.query("insert into experience_registration_events(registration_id,next_status,previous_status,occurred_at) values($1,$2,null,$3)",
      [rows[0].id, options.status ?? "registered", options.registeredAt ?? ago(2880)]);
  }
  async function plan(e, actor, options = {}) {
    const planId = id(serial++);
    const snapshot = { eventId: e.id, kind: "membership", track: "members", templateId: id(serial++), templateVersion: "fixture-v1",
      bodyTarget: "copy:body", bindings: {}, template: {}, event: e, siteUrl: "https://members.example.test", ...options.snapshot };
    await db.query(`insert into private.member_email_cadence_plans(id,experience_id,active,activated_at,snapshot,approved_by)
      values($1,$2,$3,$4,$5,$6)`, [planId, e.id, options.active ?? true, options.activatedAt ?? ago(2880), JSON.stringify(snapshot), actor.authId]);
    return planId;
  }
  async function setup(options = {}) {
    const m = await member(options.member); await consent(m);
    const e = await event(options.event); await roster(m, e, options.roster);
    const planId = await plan(e, m, options.plan);
    return { m, e, planId };
  }
  async function reset() {
    await db.exec(`truncate private.member_email_cadence_deliveries,private.member_email_cadence_reviews,private.member_email_cadence_plans,private.member_email_cadence_sequences,private.member_email_cadence_event_bindings,
      ruined_members,people,person_profiles,person_email_addresses,platform_users,platform_role_grants,member_lifecycle,member_registration_access,
      member_consents,communication_contacts,circles,circle_member_assignments,membership_blocks,block_circle_assignments,member_progression_assignments,experiences,
      experience_registrations,experience_registration_events,integration_entity_links,member_complimentary_grants,operator_audit_events,
      membership_commercial_reservations,membership_commercial_participants,stripe_subscriptions,stripe_membership_prepaid_proofs,
      stripe_checkout_attempts,stripe_checkout_sessions,stripe_membership_commitments,stripe_invoices cascade;`);
    calendar.length=0;
    env.MEMBER_EMAIL_CADENCE_ENABLED = "true"; env.MEMBER_EMAIL_CADENCE_ACTIVATED_AT = ago(2880);
  }
  const state = async () => (await db.query("select * from private.member_email_cadence_deliveries order by id")).rows;
  const enqueue = () => repo.enqueueCadenceDeliveries(model.getMemberEmailCadenceConfiguration(env));
  async function claim() {
    const lease = randomUUID(), claimed = await repo.claimCadenceDelivery(lease);
    assert.ok(claimed); return { claim: claimed, lease };
  }
  return { db, sql, env, repo, model, inheritance, schedules, calendar, member, consent, event, roster, plan, setup, reset, state, enqueue, claim };
}

test("cadence repository uses canonical access, exact current consent and durable occurrence delivery", async t => {
  const f = await fixture(t);
  await t.test("canonical call classification and Circle name enrich new snapshots without invalidating legacy snapshots", async () => {
    await f.reset(); const event=await f.event({title:"An authored title"});
    const legacy={...event};delete legacy.callType;delete legacy.circleName;
    await f.db.query(`update experiences set metadata='{"badge_credit":{"track":"membership","stage":"cut","month":"2026-11"}}' where id=$1`,[event.id]);
    const updated=await f.repo.readCadenceEvent(f.sql,event.id);
    assert.equal(updated.callType,"CUT");assert.equal(f.repo.sameCadenceEvent(updated,legacy),true);
    assert.equal(f.repo.sameCadenceEvent(updated,event),false,"new reviewed metadata changes must be reviewed");
    const circle=id(9901);await f.db.query("insert into circles(id,status,activated_at,name) values($1,'active',now(),'Cedar')",[circle]);
    await f.db.query(`update experiences set kind='circle_meeting',visibility='circle',circle_id=$2,metadata='{"badge_credit":{"track":"circle","stage":"implementation","month":"2026-11"}}' where id=$1`,[event.id,circle]);
    const scoped=await f.repo.readCadenceEvent(f.sql,event.id);assert.equal(scoped.callType,"BUILD");assert.equal(scoped.circleName,"Cedar");
    await f.db.query("update experiences set metadata='{}' where id=$1",[event.id]);
    assert.equal((await f.repo.readCadenceEvent(f.sql,event.id)).callType,null,"title does not infer a call stage");
  });
  await t.test("only confirmed eligible recipients queue once across repeated scheduler runs", async () => {
    await f.reset(); const { m, e } = await f.setup();
    for (const status of ["waitlisted", "cancelled", "attended"]) {
      const other = await f.member(); await f.consent(other); await f.roster(other, e, { status });
    }
    const noRoster = await f.member(); await f.consent(noRoster);
    const noConsent = await f.member(); await f.roster(noConsent, e);
    const suspended = await f.member(); await f.consent(suspended); await f.roster(suspended, e);
    await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [suspended.memberId]);
    const rows = await f.repo.readCadenceRecipients(f.sql, e, "members");
    assert.deepEqual(rows.filter(row => row.eligible).map(row => row.memberId), [m.memberId]);
    assert.equal(await f.enqueue(), 1); assert.equal(await f.enqueue(), 0);
    assert.deepEqual((await f.state()).map(row => row.member_id), [m.memberId]);
  });
  await t.test("no-registration member calls use canonical access and preferences while respecting roster exceptions", async () => {
    await f.reset(); const m = await f.member(); await f.consent(m);
    const e = await f.event({ registrationMode: "none" }); await f.plan(e, m);
    for (const status of ["waitlisted", "cancelled", "attended"]) {
      const other = await f.member(); await f.consent(other); await f.roster(other, e, { status });
    }
    await f.member(); // No reminder preference.
    const suspended = await f.member(); await f.consent(suspended);
    await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [suspended.memberId]);
    const unverified = await f.member(); await f.consent(unverified);
    await f.db.query("update person_email_addresses set verification_state='unverified' where person_id=$1", [unverified.personId]);
    const rows = await f.repo.readCadenceRecipients(f.sql, e, "members");
    assert.deepEqual(rows.filter(row => row.eligible).map(row => row.memberId), [m.memberId]);
    assert.equal(await f.enqueue(), 1); assert.equal(await f.enqueue(), 0);
    const current = await f.claim();
    await f.roster(m, e, { status: "cancelled" });
    assert.equal((await f.repo.withCadenceDelivery(current.claim, current.lease, () => assert.fail("cancelled recipient"))).kind, "cancelled");
  });
  await t.test("automatic audiences never bypass internal, founder, invite-only, public or external enrollment", async () => {
    await f.reset(); const m = await f.member(); await f.consent(m);
    const e = await f.event({ registrationMode: "none" });
    for (const [event, track] of [
      [{ ...e, registration_mode: "internal" }, "members"], [e, "founder_test"],
      [{ ...e, visibility: "invite_only" }, "members"], [{ ...e, visibility: "public" }, "members"],
      [{ ...e, registration_mode: "external" }, "members"],
    ]) assert.deepEqual(await f.repo.readCadenceRecipients(f.sql, event, track), []);
    await f.roster(m, e, { source: "member" });
    assert.equal((await f.repo.readCadenceRecipients(f.sql, { ...e, visibility: "invite_only", registration_mode: "internal" }, "members"))[0].eligible, false);
  });
  await t.test("new members, late profile activation and late registration promotions cannot backfill an automatic reminder", async () => {
    for (const lateEnrollment of [
      ({ m }) => f.db.query("update ruined_members set created_at=clock_timestamp() where id=$1", [m.memberId]),
      ({ m }) => f.db.query("insert into member_registration_access(member_id,profile_activated_at,registered_at) values($1,null,clock_timestamp())", [m.memberId]),
      ({ m }) => f.db.query("insert into member_registration_access(member_id,profile_activated_at,registered_at) values($1,clock_timestamp(),$2)", [m.memberId, ago(2880)]),
      async ({ m, e }) => {
        await f.roster(m, e);
        await f.db.exec("insert into experience_registration_events(registration_id,next_status,previous_status,occurred_at) select id,'registered','waitlisted',clock_timestamp() from experience_registrations");
      },
    ]) {
      await f.reset(); const m = await f.member(); await f.consent(m);
      const e = await f.event({ registrationMode: "none" }); await f.plan(e, m);
      await lateEnrollment({ m, e }); assert.equal(await f.enqueue(), 0);
    }
  });
  await t.test("automatic Circle calls require an existing completed member assignment and recheck its enrollment time", async () => {
    await f.reset(); const circleId = id(90002);
    await f.db.query("insert into circles(id,status,activated_at,ends_at) values($1,'active',$2,null)", [circleId, ago(2880)]);
    const m = await f.member(); await f.consent(m);
    await f.db.query("insert into circle_member_assignments(member_id,circle_id,assigned_at) values($1,$2,$3)", [m.memberId, circleId, ago(2880)]);
    const e = await f.event({ registrationMode: "none", visibility: "circle", kind: "circle_meeting", circleId });
    await f.plan(e, m, { snapshot: { kind: "circle" } });
    const missing = await f.member(); await f.consent(missing);
    const incomplete = await f.member(); await f.consent(incomplete);
    await f.db.query("update member_lifecycle set foundations_state='in_progress' where member_id=$1", [incomplete.memberId]);
    for (const [member, assignedAt] of [[incomplete, ago(2880)], [await f.member(), ago(1)]]) {
      if (member !== incomplete) await f.consent(member);
      await f.db.query("insert into circle_member_assignments(member_id,circle_id,assigned_at) values($1,$2,$3)", [member.memberId, circleId, assignedAt]);
    }
    assert.equal(await f.enqueue(), 1); assert.equal((await f.state())[0].member_id, m.memberId);
    const current = await f.claim();
    await f.db.query("update circle_member_assignments set assigned_at=clock_timestamp() where member_id=$1", [m.memberId]);
    assert.equal((await f.repo.withCadenceDelivery(current.claim, current.lease, () => assert.fail("late replacement assignment"))).kind, "cancelled");
  });
  await t.test("automatic block and progression calls include current audience assignment in the enrollment fence", async () => {
    for (const late of [false, true]) {
      await f.reset(); const m = await f.member(); await f.consent(m);
      const circleId = id(90003), blockId = id(90004);
      await f.db.query("insert into circles(id,status,activated_at,ends_at) values($1,'active',$2,null)", [circleId, ago(2880)]);
      await f.db.query("insert into membership_blocks values($1,'active',$2,null)", [blockId, ago(2880)]);
      await f.db.query("insert into circle_member_assignments(member_id,circle_id,assigned_at) values($1,$2,$3)", [m.memberId, circleId, ago(2880)]);
      await f.db.query("insert into block_circle_assignments(circle_id,block_id,assigned_at) values($1,$2,$3)", [circleId, blockId, ago(late ? 1 : 2880)]);
      const e = await f.event({ registrationMode: "none", visibility: "block", blockId }); await f.plan(e, m);
      assert.equal(await f.enqueue(), late ? 0 : 1);
    }
    for (const late of [false, true]) {
      await f.reset(); const m = await f.member(); await f.consent(m);
      await f.db.query("update member_lifecycle set current_progression_level_slug='contributor' where member_id=$1", [m.memberId]);
      await f.db.query("insert into member_progression_assignments(member_id,progression_level_slug,assigned_at) values($1,'contributor',$2)", [m.memberId, ago(late ? 1 : 2880)]);
      const e = await f.event({ registrationMode: "none", visibility: "progression", progressionLevel: "contributor" }); await f.plan(e, m);
      assert.equal(await f.enqueue(), late ? 0 : 1);
    }
  });
  await t.test("latest withdrawal, wrong destination, operator-entered and marketing-only choices do not grant reminder consent", async () => {
    await f.reset(); const actor = await f.member(), e = await f.event(); await f.plan(e, actor);
    for (const options of [{ decision: "withdrawn" }, { evidence: { destination: "old@example.test" } },
      { source: "operator" }, { evidence: { marketingConsent: true } }, { evidence: { purpose: "marketing" } }]) {
      const m = await f.member(); await f.roster(m, e);
      if (options.decision) await f.consent(m);
      await f.consent(m, options);
    }
    assert.equal(await f.enqueue(), 0);
  });
  await t.test("only fully audited admin email preferences qualify, and invalid evidence cannot queue", async () => {
    await f.reset(); const actor = await f.member(), e = await f.event(); await f.plan(e, actor);
    const approval = { action: "operator_email_preference_enabled", operatorApproved: true, memberAffirmed: false, approvalReference: "Approved founder preferences 2026-10-13" };
    const valid = await f.member(); await f.roster(valid, e); await f.consent(valid, { source: "ops", actor: actor.authId, evidence: approval });
    const excluded = [];
    for (const options of [
      { evidence: { action: undefined } }, { evidence: { operatorApproved: undefined } }, { evidence: { operatorApproved: false } },
      { evidence: { memberAffirmed: undefined } }, { evidence: { memberAffirmed: true } },
      ...[undefined, "", " \t\r\n ", null, 123, { approved: true }].map(approvalReference => ({ evidence: { approvalReference } })),
      { evidence: { requested: false } }, { evidence: { requested: undefined } },
      { evidence: { marketingConsent: true } }, { evidence: { marketingConsent: undefined } },
      ...["operator", "migration", "checkout"].map(source => ({ source })),
      { actor: null }, { evidence: { destination: "old@example.test" } },
    ]) {
      const member = await f.member(); excluded.push(member.memberId); await f.roster(member, e);
      await f.consent(member, { source: "ops", actor: actor.authId, ...options, evidence: { ...approval, ...options.evidence } });
    }
    const recipients = await f.repo.readCadenceRecipients(f.sql, await f.repo.readCadenceEvent(f.sql, e.id), "members");
    assert.equal(recipients.find(row => row.memberId === valid.memberId).eligible, true);
    assert.ok(recipients.filter(row => excluded.includes(row.memberId)).every(row => !row.eligible && /not enabled/.test(row.reason)));
    assert.equal(await f.enqueue(), 1);
    assert.deepEqual((await f.state()).map(row => row.member_id), [valid.memberId]);
    const current = await f.claim();
    await f.consent(valid, { decision: "withdrawn", evidence: { requested: false } });
    assert.equal((await f.repo.withCadenceDelivery(current.claim, current.lease, () => assert.fail("withdrawn admin preference must not dispatch"))).kind, "cancelled");
    assert.equal(await f.enqueue(), 0);
  });
  await t.test("an approved admin preference cannot bypass local suppression at enqueue or dispatch", async () => {
    await f.reset(); const actor = await f.member(), m = await f.member(), e = await f.event(); await f.roster(m, e); await f.plan(e, actor);
    await f.consent(m, { source: "ops", actor: actor.authId, evidence: { action: "operator_email_preference_enabled", operatorApproved: true,
      memberAffirmed: false, approvalReference: "Approved founder preferences 2026-10-13" } });
    await f.db.query("insert into communication_contacts(email_normalized,delivery_state) values($1,'unsubscribed')", [m.email]);
    assert.equal(await f.enqueue(), 0);
    await f.db.exec("update communication_contacts set delivery_state='active'");
    assert.equal(await f.enqueue(), 1); const current = await f.claim();
    await f.repo.withCadenceDelivery(current.claim, current.lease, tx => f.repo.freezeCadenceDelivery(tx, current.claim.id, frozenPayload(m.email)));
    await f.db.exec("update communication_contacts set delivery_state='complained'");
    assert.equal((await f.repo.withCadenceDelivery(current.claim, current.lease, () => assert.fail("suppression must win"))).kind, "manualReview");
  });
  await t.test("a funded onboarding founder qualifies only through the explicit invited call", async () => {
    await f.reset();
    const { m, e } = await f.setup({ member: { onboarding: true, complimentary: true },
      event: { visibility: "invite_only" }, plan: { snapshot: { kind: "foundations_01", track: "founder_test" } } });
    const selfRegistered = await f.member({ onboarding: true, complimentary: true }); await f.consent(selfRegistered);
    await f.roster(selfRegistered, e, { source: "member" });
    const unfunded = await f.member({ onboarding: true }); await f.consent(unfunded); await f.roster(unfunded, e);
    assert.equal(await f.enqueue(), 1);
    assert.equal((await f.state())[0].member_id, m.memberId);
  });
  await t.test("Circle reminders require completed Foundations and an active matching assignment", async () => {
    await f.reset(); const circleId = id(90001);
    await f.db.query("insert into circles(id,status,activated_at,ends_at) values($1,'active',$2,null)", [circleId, ago(2880)]);
    const { m, e } = await f.setup({ event: { visibility: "circle", kind: "circle_meeting", circleId }, plan: { snapshot: { kind: "circle" } } });
    await f.db.query("insert into circle_member_assignments(member_id,circle_id,assigned_at) values($1,$2,$3)", [m.memberId, circleId, ago(2880)]);
    const missingAssignment = await f.member(); await f.consent(missingAssignment); await f.roster(missingAssignment, e);
    const incomplete = await f.member(); await f.consent(incomplete); await f.roster(incomplete, e);
    await f.db.query("insert into circle_member_assignments(member_id,circle_id,assigned_at) values($1,$2,$3)", [incomplete.memberId, circleId, ago(2880)]);
    await f.db.query("update member_lifecycle set foundations_state='in_progress' where member_id=$1", [incomplete.memberId]);
    assert.equal(await f.enqueue(), 1);
    assert.equal((await f.state())[0].member_id, m.memberId);
  });
  await t.test("activation, plan approval, roster enrollment and expiration prevent historical backfill", async () => {
    for (const change of [
      async () => { f.env.MEMBER_EMAIL_CADENCE_ENABLED = "false"; },
      async () => { f.env.MEMBER_EMAIL_CADENCE_ACTIVATED_AT = ago(1); },
      () => f.db.exec("update private.member_email_cadence_plans set activated_at=clock_timestamp()"),
      () => f.db.exec("update experience_registrations set registered_at=clock_timestamp()"),
      () => f.db.exec("insert into experience_registration_events(registration_id,next_status,previous_status,occurred_at) select id,'registered','waitlisted',clock_timestamp() from experience_registrations"),
      () => f.db.exec("update private.member_email_cadence_plans set active=false"),
    ]) {
      await f.reset(); await f.setup(); await change(); assert.equal(await f.enqueue(), 0);
    }
    await f.reset(); await f.setup({ event: { startsAt: ago(-1400), endsAt: ago(-1490) } });
    assert.equal(await f.enqueue(), 0, "a reminder 40 minutes late is not replayed");
  });
  await t.test("local delivery suppression prevents enrollment and is rechecked after preparation", async () => {
    await f.reset(); const { m } = await f.setup();
    await f.db.query("insert into communication_contacts(email_normalized,delivery_state) values($1,'bounced')", [m.email]);
    assert.equal(await f.enqueue(), 0);
    await f.db.exec("update communication_contacts set delivery_state='active'");
    assert.equal(await f.enqueue(), 1); const current = await f.claim();
    await f.repo.withCadenceDelivery(current.claim, current.lease,
      tx => f.repo.freezeCadenceDelivery(tx, current.claim.id, frozenPayload(m.email)));
    await f.db.exec("update communication_contacts set delivery_state='complained'");
    assert.equal((await f.repo.withCadenceDelivery(current.claim, current.lease, () => assert.fail("suppressed delivery"))).kind, "manualReview");
  });
  await t.test("unpublished, rescheduled and linkless calls never enqueue stale approved details", async () => {
    for (const statement of ["update experiences set status='draft'", "update experiences set cancelled_at=clock_timestamp()",
      "update experiences set starts_at=starts_at+interval '1 hour'", "update experiences set version=version+1",
      "delete from integration_entity_links", "update integration_entity_links set livemode=false"]) {
      await f.reset(); await f.setup(); await f.db.exec(statement); assert.equal(await f.enqueue(), 0);
    }
  });
  await t.test("a lease can be recovered after expiry, and stale workers cannot mutate its delivery", async () => {
    await f.reset(); await f.setup(); await f.enqueue();
    const old = await f.claim(); assert.equal(await f.repo.claimCadenceDelivery(randomUUID()), null);
    await f.db.exec("update private.member_email_cadence_deliveries set locked_at=clock_timestamp()-interval '3 minutes'");
    const current = await f.claim(); assert.equal(current.claim.id, old.claim.id); assert.equal(current.claim.attempts, 2);
    assert.equal((await f.repo.withCadenceDelivery(old.claim, old.lease, () => assert.fail("stale action"))).kind, "deferred");
    assert.equal(await f.repo.failCadenceDelivery(old.claim, old.lease, "old_failure", true), "deferred");
    assert.equal((await f.repo.withCadenceDelivery(current.claim, current.lease, async (_tx, delivery) => delivery)).kind, "ok");
  });
  await t.test("payload freezing survives a later transaction failure and retains exact retry bytes", async () => {
    await f.reset(); const { m } = await f.setup(); await f.enqueue(); const current = await f.claim();
    const payload = frozenPayload(m.email);
    await f.repo.withCadenceDelivery(current.claim, current.lease, tx => f.repo.freezeCadenceDelivery(tx, current.claim.id, payload));
    await assert.rejects(f.repo.withCadenceDelivery(current.claim, current.lease, async tx => {
      await f.repo.completeCadenceDelivery(tx, current.claim.id, "mock-accepted"); throw new Error("acknowledgement lost");
    }), /acknowledgement lost/);
    assert.equal(await f.repo.failCadenceDelivery(current.claim, current.lease, "delivery_unavailable", false), "failed");
    const [row] = await f.state(); assert.deepEqual(row.payload, payload); assert.ok(row.first_attempt_at); assert.equal(row.provider_message_id, null);
    await assert.rejects(f.db.query("update private.member_email_cadence_deliveries set payload=$1 where id=$2", [JSON.stringify({ ...payload, subject: "Changed" }), row.id]), /immutable/);
    await assert.rejects(f.db.query("update private.member_email_cadence_deliveries set expected_email='other@example.test' where id=$1", [row.id]), /immutable/);
    await assert.rejects(f.db.query("update private.member_email_cadence_deliveries set first_attempt_at=null where id=$1", [row.id]), /immutable/);
    assert.equal(await f.repo.claimCadenceDelivery(randomUUID()), null, "backoff cannot be skipped");
    await f.db.exec("update private.member_email_cadence_deliveries set available_at=clock_timestamp()-interval '1 second'");
    const retry = await f.claim();
    await f.repo.withCadenceDelivery(retry.claim, retry.lease, async (tx, delivery) => {
      assert.deepEqual(delivery.payload, payload); assert.ok(delivery.firstAttemptAt);
      await f.repo.completeCadenceDelivery(tx, delivery.id, "mock-accepted");
    });
    assert.equal((await f.state())[0].status, "sent"); assert.equal(await f.repo.claimCadenceDelivery(randomUUID()), null);
  });
  await t.test("withdrawal, destination changes, pause and rescheduling cancel fresh deliveries and hold uncertain ones", async () => {
    for (const attempted of [false, true]) for (const change of [
      ({ m }) => f.consent(m, { decision: "withdrawn" }),
      () => f.db.exec("update ruined_members set email_normalized='changed@example.test'"),
      () => f.db.exec("update private.member_email_cadence_plans set active=false"),
      () => f.db.exec("update experiences set version=version+1"),
      () => f.db.exec("update experience_registrations set status='cancelled'"),
      () => f.db.exec("update member_lifecycle set account_state='suspended'"),
    ]) {
      await f.reset(); const member = await f.setup(); await f.enqueue(); const current = await f.claim();
      if (attempted) await f.repo.withCadenceDelivery(current.claim, current.lease,
        tx => f.repo.freezeCadenceDelivery(tx, current.claim.id, frozenPayload(member.m.email)));
      await change(member);
      const outcome = await f.repo.withCadenceDelivery(current.claim, current.lease, () => assert.fail("ineligible dispatch"));
      assert.equal(outcome.kind, attempted ? "manualReview" : "cancelled");
      assert.equal((await f.state())[0].status, attempted ? "manual_review" : "cancelled");
    }
  });
  await t.test("expired unattempted jobs cancel; attempted jobs remain uncertain and are never reclaimed", async () => {
    for (const attempted of [false, true]) {
      await f.reset(); const { m, e, planId } = await f.setup();
      // Seed an already-expired immutable occurrence, as if the scheduler was unavailable until now.
      await f.db.query(`insert into private.member_email_cadence_deliveries
        (plan_id,plan_revision,experience_id,member_id,starts_at,stage,expected_email,expected_consent_id,due_at,expires_at,payload,first_attempt_at)
        values($1,1,$2,$3,$4,'day_before',$5,1,$6,$7,$8,$9)`,
      [planId, e.id, m.memberId, e.startsAt, m.email, ago(40), ago(10), attempted ? JSON.stringify(frozenPayload(m.email)) : null, attempted ? ago(20) : null]);
      assert.equal(await f.repo.claimCadenceDelivery(randomUUID()), null);
      assert.equal((await f.state())[0].status, attempted ? "manual_review" : "cancelled");
    }
  });
  await t.test("client database roles cannot inspect or alter private schedules and delivery snapshots", async () => {
    await f.reset(); await f.setup(); await f.enqueue();
    for (const role of ["anon", "authenticated"]) for (const table of ["plans", "reviews", "deliveries"]) {
      await assert.rejects(f.db.transaction(async tx => {
        await tx.exec(`set local role ${role}`);
        await tx.query(`select * from private.member_email_cadence_${table}`);
      }), /permission denied/);
    }
  });
});

async function cadenceSequence(f, actor, event, options = {}) {
  await f.db.query("insert into platform_role_grants(auth_user_id,role_slug) values($1,'ops_admin')", [actor.authId]);
  const snapshot = { eventId: event.id, kind: options.kind ?? "membership", track: options.track ?? "members",
    templateId: id(880001), templateVersion: "approved-v1", bodyTarget: "copy:body", bindings: {},
    template: { html: "<p>Reviewed design.</p>" }, event, siteUrl: "https://members.example.test" };
  const { rows } = await f.db.query(`insert into private.member_email_cadence_sequences(kind,track,active,snapshot,approved_by)
    values($1,$2,true,$3,$4) returning id`, [snapshot.kind, snapshot.track, JSON.stringify(snapshot), actor.authId]);
  return { id: rows[0].id, snapshot };
}
const inheritedPlans = async f => (await f.db.query("select * from private.member_email_cadence_plans order by experience_id")).rows;
const reconcile = f => f.inheritance.reconcileCadenceInheritance(f.model.getMemberEmailCadenceConfiguration(f.env), Date.now() + 30_000);
async function paidCohortMember(f, schedule, options = {}) {
  const member = await f.member({ onboarding: true }), reservation = randomUUID(), contract = randomUUID();
  const subscription = `sub_${reservation}`, customer = `cus_${reservation}`, invoice = `in_${reservation}`, checkout = `cs_${reservation}`;
  await f.db.query(`update member_registration_access set payment_setup_account_id='acct_fixture',payment_setup_livemode=true,registered_at=$2 where member_id=$1`,
    [member.memberId, options.unregistered ? null : ago(2880)]);
  await f.db.query(`insert into membership_commercial_reservations(id,payer_member_id,kind,status,stripe_subscription_id,billing_schedule,billing_plan)
    values($1,$2,'individual','reserved',$3,$4,'monthly')`, [reservation, member.memberId, subscription, JSON.stringify(schedule)]);
  await f.db.query("insert into membership_commercial_participants values($1,$2,$3)", [reservation, member.memberId, member.personId]);
  await f.db.query("insert into stripe_subscriptions(id,member_id,stripe_status,stripe_customer_id) values($1,$2,'trialing',$3)", [subscription, member.memberId, customer]);
  await f.db.query(`insert into stripe_checkout_attempts values($1,'completed',$2,now(),'acct_fixture',true,$3,$1,$4,$5)`,
    [reservation, member.memberId, subscription, JSON.stringify(schedule), checkout]);
  await f.db.query("insert into stripe_checkout_sessions values($1,'complete','paid',true,$2,$3)", [checkout, member.memberId, subscription]);
  await f.db.query("insert into stripe_membership_commitments values($1,$2,$3,true,$4,$5)", [contract, reservation, member.memberId, JSON.stringify({ billingSchedule: schedule }), customer]);
  await f.db.query("insert into stripe_invoices values($1,$2,$3,$4,'paid','membership',34900,34900,'usd',now())", [invoice, member.memberId, subscription, customer]);
  await f.db.query(`insert into stripe_membership_prepaid_proofs values($1,$2,$3,true,$4,0,null,null,34900,34900,now(),$5,$6,'usd',now())`,
    [reservation, contract, member.memberId, options.refunded ? "full" : "none", invoice, subscription]);
  return { ...member, reservation };
}
async function foundationSequence(f, options = {}) {
  const future = new Date(); future.setUTCMonth(future.getUTCMonth() + 2);
  const cohortMonth = future.toISOString().slice(0, 7);
  const schedule = f.schedules.foundationsBillingScheduleForMonth(cohortMonth, "monthly", "foundations-prepaid-v3");
  const event = await f.event({ title: "Authored call title", kind: "member_event", visibility: "invite_only", registrationMode: "internal",
    startsAt: schedule.callStartsAt[0], endsAt: new Date(Date.parse(schedule.callStartsAt[0]) + 90 * 60_000).toISOString() });
  const actor = await f.member();
  const sequence = await cadenceSequence(f, actor, event, { kind: "foundations_01", ...options });
  const binding = { kind: "foundations_01", track: options.track ?? "members", ...(options.track === "founder_test" ? {} : { cohortMonth }) };
  await f.sql.begin(tx => f.inheritance.saveCadenceEventBinding(tx, actor.authId, event.id, binding, event));
  return { event, actor, sequence, schedule, binding };
}

test("reusable email sequences inherit only reviewed semantics and current authority", async t => {
  const f = await fixture(t);
  await t.test("semantic calls inherit without title matching; explicit exclusions, public calls and external calls do not", async () => {
    await f.reset(); const actor = await f.member();
    const first = await f.event({ title: "Any authored title", registrationMode: "none" });
    const source = await cadenceSequence(f, actor, first);
    const second = await f.event({ title: "A future weekly call", registrationMode: "none" });
    await f.event({ title: "Membership call", kind: "member_event" });
    await f.event({ visibility: "public" }); await f.event({ registrationMode: "external" });
    const excluded = await f.event();
    await f.sql.begin(tx => f.inheritance.saveCadenceEventBinding(tx, actor.authId, excluded.id, { kind: "none", track: "members" }, excluded));
    assert.deepEqual((await f.inheritance.matchingCadenceEvents(f.sql, "membership", "members")).map(e => e.id).sort(), [first.id, second.id].sort());
    assert.deepEqual(await reconcile(f), { plans: 2, enrolled: 0 });
    assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 0 });
    const plans = await inheritedPlans(f);
    assert.ok(plans.every(plan => plan.sequence_id === source.id && plan.sequence_revision === 1 && plan.snapshot.templateVersion === "approved-v1"));
    assert.equal((await f.db.query("select count(*)::int as count from experience_registrations")).rows[0].count, 0);
  });
  await t.test("disabled, future and exhausted-budget inheritance performs no changes", async () => {
    await f.reset(); const actor = await f.member(), event = await f.event(); await cadenceSequence(f, actor, event);
    for (const configuration of [{ enabled: false, ready: true, activatedAt: ago(10) },
      { enabled: true, ready: false, activatedAt: null }, { enabled: true, ready: true, activatedAt: ago(-10) }]) {
      assert.deepEqual(await f.inheritance.reconcileCadenceInheritance(configuration, Date.now() + 30_000), { plans: 0, enrolled: 0 });
    }
    assert.deepEqual(await f.inheritance.reconcileCadenceInheritance(f.model.getMemberEmailCadenceConfiguration(f.env), Date.now() - 1), { plans: 0, enrolled: 0 });
    assert.deepEqual(await inheritedPlans(f), []);
  });
  await t.test("manual overrides and paused children survive every inherited rule refresh", async () => {
    await f.reset(); const actor = await f.member(), first = await f.event(), paused = await f.event();
    const sequence = await cadenceSequence(f, actor, first);
    const manualId = await f.plan(first, actor, { snapshot: { templateVersion: "manual" } });
    await reconcile(f);
    await f.db.query("update private.member_email_cadence_plans set active=false where experience_id=$1", [paused.id]);
    await f.db.query("update private.member_email_cadence_sequences set revision=revision+1,snapshot=jsonb_set(snapshot,'{templateVersion}','\"new design\"') where id=$1", [sequence.id]);
    assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 0 });
    const plans = await inheritedPlans(f);
    assert.equal(plans.find(p => p.id === manualId).snapshot.templateVersion, "manual");
    assert.equal(plans.find(p => p.experience_id === paused.id).active, false);
    assert.equal(plans.find(p => p.experience_id === paused.id).sequence_revision, 1);
  });
  await t.test("resuming a revised rule refreshes unchanged active calls but never accepts event or classification edits", async () => {
    await f.reset(); const actor = await f.member(), unchanged = await f.event(), changed = await f.event(), reclassified = await f.event();
    const sequence = await cadenceSequence(f, actor, unchanged); await reconcile(f);
    await f.db.query("update experiences set title='New call details',version=version+1 where id=$1", [changed.id]);
    await f.sql.begin(tx => f.inheritance.saveCadenceEventBinding(tx, actor.authId, reclassified.id, { kind: "none", track: "members" }, reclassified));
    await f.db.query("update private.member_email_cadence_sequences set active=false,revision=revision+1 where id=$1", [sequence.id]);
    assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 0 });
    await f.db.query("update private.member_email_cadence_sequences set active=true,revision=revision+1,snapshot=jsonb_set(snapshot,'{templateVersion}','\"approved-v3\"') where id=$1", [sequence.id]);
    assert.deepEqual(await reconcile(f), { plans: 1, enrolled: 0 });
    const plans = await inheritedPlans(f);
    assert.equal(plans.find(p => p.experience_id === unchanged.id).snapshot.templateVersion, "approved-v3");
    assert.equal(plans.find(p => p.experience_id === unchanged.id).revision, 2);
    assert.ok(plans.filter(p => p.experience_id !== unchanged.id).every(p => p.sequence_revision === 1));
  });
  await t.test("sequence pauses, revoked approvers and changed bindings fence both fresh and uncertain deliveries", async () => {
    for (const invalidate of [
      sequence => f.db.query("update private.member_email_cadence_sequences set active=false,revision=revision+1 where id=$1", [sequence.id]),
      (_sequence, actor) => f.db.query("update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1 and role_slug='ops_admin'", [actor.authId]),
      (_sequence, actor, event) => f.sql.begin(tx => f.inheritance.saveCadenceEventBinding(tx, actor.authId, event.id, { kind: "none", track: "members" }, event)),
    ]) for (const attempted of [false, true]) {
      await f.reset(); const actor = await f.member(), event = await f.event({ registrationMode: "none" }); await f.consent(actor);
      const sequence = await cadenceSequence(f, actor, event); await reconcile(f);
      await f.db.exec("update private.member_email_cadence_plans set activated_at=clock_timestamp()-interval '2 days'");
      assert.equal(await f.enqueue(), 1); const current = await f.claim();
      if (attempted) await f.repo.withCadenceDelivery(current.claim, current.lease, (tx, delivery) => f.repo.freezeCadenceDelivery(tx, delivery.id, frozenPayload(actor.email)));
      await invalidate(sequence, actor, event);
      assert.equal(await f.enqueue(), 0);
      assert.equal((await f.repo.withCadenceDelivery(current.claim, current.lease, () => assert.fail("stale inherited delivery"))).kind, attempted ? "manualReview" : "cancelled");
      assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 0 });
    }
  });
  await t.test("binding validation rejects title guesses, mismatched accepted times and unauthorized event writers", async () => {
    await f.reset(); const { event, actor, schedule, binding } = await foundationSequence(f);
    assert.deepEqual(f.inheritance.normalizeCadenceEventBinding(binding, event), binding);
    assert.throws(() => f.inheritance.normalizeCadenceEventBinding(binding, { ...event, startsAt: ago(-100) }), /accepted cohort session time/);
    assert.throws(() => f.inheritance.normalizeCadenceEventBinding(binding, { ...event, timeZone: "UTC" }), /accepted cohort session time/);
    assert.throws(() => f.inheritance.normalizeCadenceEventBinding({ ...binding, cohortMonth: "2020-01" }, event), /cohort month/);
    assert.throws(() => f.inheritance.normalizeCadenceEventBinding({ ...binding, kind: "foundations_02" }, event), /accepted cohort session time/);
    assert.throws(() => f.inheritance.normalizeCadenceEventBinding(binding, { ...event, visibility: "all_members" }), /private call/);
    assert.equal(schedule.callStartsAt[0], event.startsAt);
    const member = await f.member();
    await assert.rejects(f.sql.begin(tx => f.inheritance.saveCadenceEventBinding(tx, member.authId, event.id, { kind: "none", track: "members" }, event)), error => error.status === 403);
    await f.sql.begin(tx => f.inheritance.saveCadenceEventBinding(tx, actor.authId, event.id, undefined, event));
    assert.deepEqual(await f.inheritance.readCadenceEventBinding(f.sql, event.id), binding);
  });
  await t.test("only registered paid members on the exact accepted cohort are invited; no preferences or general access are created", async () => {
    await f.reset(); const { event, schedule } = await foundationSequence(f);
    const eligible = await paidCohortMember(f, schedule);
    assert.equal((await f.db.query("select private.ruined_member_paid_reservation($1::uuid) as id", [eligible.memberId])).rows[0].id, eligible.reservation);
    assert.deepEqual(f.schedules.parseFoundationsBillingSchedule(schedule, "monthly"), schedule);
    const cancelled = await paidCohortMember(f, schedule); await f.roster(cancelled, event, { status: "cancelled" });
    const waiting = await paidCohortMember(f, schedule); await f.roster(waiting, event, { status: "waitlisted" });
    await paidCohortMember(f, schedule, { refunded: true }); await paidCohortMember(f, schedule, { unregistered: true });
    const mismatched = await paidCohortMember(f, { ...schedule, callStartsAt: [ago(-100), ...schedule.callStartsAt.slice(1)] });
    const unverified = await paidCohortMember(f, schedule);
    await f.db.query("update person_email_addresses set verification_state='unverified' where person_id=$1", [unverified.personId]);
    const suspended = await paidCohortMember(f, schedule);
    await f.db.query("update member_lifecycle set account_state='suspended' where member_id=$1", [suspended.memberId]);
    await f.member({ onboarding: true, complimentary: true });
    assert.deepEqual(await reconcile(f), { plans: 1, enrolled: 1 });
    assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 0 });
    const rows = (await f.db.query("select member_id,status,source from experience_registrations order by member_id")).rows;
    assert.deepEqual(rows.filter(r => r.status === "registered"), [{ member_id: eligible.memberId, status: "registered", source: "ops" }]);
    assert.equal(rows.find(r => r.member_id === cancelled.memberId).status, "cancelled");
    assert.equal(rows.find(r => r.member_id === waiting.memberId).status, "waitlisted");
    assert.equal(rows.some(r => r.member_id === mismatched.memberId), false);
    assert.equal((await f.db.query("select count(*)::int as count from operator_audit_events")).rows[0].count, 1);
    assert.equal((await f.db.query("select count(*)::int as count from member_consents")).rows[0].count, 0);
    assert.equal((await f.db.query("select standing_state from member_lifecycle where member_id=$1", [eligible.memberId])).rows[0].standing_state, "pre_active");
    assert.deepEqual(f.calendar.map(c => [c.experienceId, c.reason]), [[event.id, "attendees"]]);
    const late = await paidCohortMember(f, schedule);
    assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 1 });
    assert.equal((await f.db.query("select count(*)::int as count from experience_registrations where member_id=$1", [late.memberId])).rows[0].count, 1);
  });
  await t.test("manual approval winning before reconciliation prevents any automatic paid enrollment", async () => {
    await f.reset(); const { event, actor, schedule } = await foundationSequence(f); await paidCohortMember(f, schedule);
    // The isolated engine queues these concurrent callers; the explicit approval owns the event first.
    await Promise.all([f.plan(event, actor, { snapshot: { kind: "foundations_01", templateVersion: "manual override" } }), reconcile(f)]);
    const plans = await inheritedPlans(f);
    assert.equal(plans[0].sequence_id, null); assert.equal(plans[0].snapshot.templateVersion, "manual override");
    assert.equal((await f.db.query("select count(*)::int as count from experience_registrations")).rows[0].count, 0);
    assert.deepEqual(f.calendar, []);
  });
  await t.test("capacity remains create-only, founder tests remain manually rostered, and revoked authority enrolls nobody", async () => {
    await f.reset(); let current = await foundationSequence(f); await paidCohortMember(f, current.schedule); await paidCohortMember(f, current.schedule);
    await f.db.query("update experiences set capacity=1 where id=$1", [current.event.id]);
    assert.deepEqual(await reconcile(f), { plans: 1, enrolled: 1 });
    assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 0 });
    await f.reset(); current = await foundationSequence(f, { track: "founder_test" }); await paidCohortMember(f, current.schedule);
    assert.deepEqual(await reconcile(f), { plans: 1, enrolled: 0 });
    await f.reset(); current = await foundationSequence(f); await paidCohortMember(f, current.schedule);
    await f.db.query("update platform_role_grants set revoked_at=clock_timestamp() where auth_user_id=$1 and role_slug='ops_admin'", [current.actor.authId]);
    assert.deepEqual(await reconcile(f), { plans: 0, enrolled: 0 });
    assert.deepEqual(await inheritedPlans(f), []);
  });
});
