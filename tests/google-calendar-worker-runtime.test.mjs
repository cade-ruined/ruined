import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import postgres from "postgres";
import { Parameter, types } from "../node_modules/postgres/src/types.js";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(await source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "server-only") return {};
    if (name === "node:crypto") return crypto;
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected import ${name}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}
class RepositoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
class ApiError extends Error { constructor(status) { super("Provider failure"); this.status = status; } }

test("durable Calendar reconciliation uses real PostgreSQL and mocked providers only", async (t) => {
  const PGlite = await loadPGliteForSchemaChecks();
  const db = new PGlite();
  const driver = postgres({ host: "127.0.0.1", prepare: false }); // Parameter helpers only; never connected.
  const event = crypto.randomUUID(), actor = crypto.randomUUID(), person = crypto.randomUUID();
  let transactionDepth = 0, failFinalize = false, providerHook = null;
  let mode = false;
  const configuration = { ready: true, organizerEmail: "operator@example.test", calendarId: "primary" };
  const remote = new Map(), calls = [];
  function bridge(engine) {
    class Query {
      constructor(strings, values) { this.strings = strings; this.values = values; }
      compile(params) {
        let text = this.strings[0];
        this.values.forEach((value, i) => {
          if (value instanceof Query) text += value.compile(params);
          else {
            params.push(value instanceof Parameter ? types.json.serialize(value.value) : value instanceof Date ? value.toISOString() : value);
            text += `$${params.length}`;
          }
          text += this.strings[i + 1];
        });
        return text;
      }
      then(resolve, reject) {
        const params = [], query = this.compile(params);
        if (failFinalize && query.includes("select audit_event.actor_auth_user_id, sync_request.status")) {
          failFinalize = false; return Promise.reject(new Error("Database unavailable after provider acceptance")).then(resolve, reject);
        }
        return engine.query(query, params).then((result) => result.rows).then(resolve, reject);
      }
    }
    const sql = (strings, ...values) => new Query(strings, values);
    sql.json = driver.json;
    sql.begin = (fn) => engine.transaction(async (tx) => {
      transactionDepth += 1;
      try { return await fn(bridge(tx)); } finally { transactionDepth -= 1; }
    });
    return sql;
  }
  const model = await load("src/lib/google/calendar-model.ts");
  const providerResult = (id) => ({ eventId: id, organizerVerified: true, organizerEmail: configuration.organizerEmail,
    meetReady: true, meetUrl: "https://meet.google.com/abc-defg-hij", conferenceStatus: "success", conferenceId: "abc-defg-hij",
    etag: '"etag"', htmlUrl: "https://calendar.google.com/event/test", iCalUid: "test", status: "confirmed" });
  async function provider(action, input) {
    assert.equal(transactionDepth, 0, "Provider calls must occur outside database transactions");
    calls.push(action);
    const id = typeof input === "string" ? input : input.eventId ?? model.googleCalendarEventIdForRequestKey(input.requestKey);
    if (action === "cancel") remote.delete(id);
    else if (action !== "verify") remote.set(id, { ...input, result: providerResult(id) });
    if (providerHook) { const hook = providerHook; providerHook = null; await hook(); }
    if (action === "verify" && !remote.has(id)) throw new ApiError(404);
    return remote.get(id)?.result ?? providerResult(id);
  }
  const api = {
    getGoogleCalendarConfigurationStatus: () => configuration,
    GoogleCalendarApiError: ApiError, GoogleCalendarConflictError: class extends Error {},
    createGoogleCalendarEvent: (input) => provider("create", input),
    updateGoogleCalendarEvent: (input) => provider("update", input),
    cancelGoogleCalendarEvent: (input) => provider("cancel", input),
    getRuinedOwnedGoogleCalendarEventResult: (input) => provider("verify", input),
  };
  const repo = await load("src/lib/platform/ops-calendar-repository.ts", {
    "@/lib/database/server": { getApplicationDatabase: () => bridge(db) }, "@/lib/google/calendar": api,
    "@/lib/google/calendar-model": model, "@/lib/google/communications": { googleCommunicationLivemode: () => mode },
    "@/lib/platform/ops-operating-repository": { OpsOperatingRepositoryError: RepositoryError }, "@/lib/site": { SITE_URL: "https://example.test" },
    "@/lib/platform/experience-member-access": { memberEligibleForExperience: async () => true },
  });
  const worker = await load("src/lib/google/calendar-worker.ts", { "@/lib/google/calendar": api,
    "@/lib/google/communications": { googleCommunicationLivemode: () => mode }, "@/lib/platform/ops-calendar-repository": repo });
  const mark = (reason = "experience") => bridge(db).begin((tx) => repo.markOpsExperienceCalendarPending(tx, { actorAuthUserId: actor, experienceId: event, reason }));
  const link = async () => (await db.query("select * from experience_calendar_links where experience_id=$1", [event])).rows[0];
  const run = () => worker.processCalendarReconciliationBatch(1);
  const bind = (livemode = false) => repo.bindLegacyExperienceCalendar({ actorAuthUserId: actor, experienceId: event, livemode });
  async function reset(createLink = true) {
    await db.exec("truncate people,platform_users,experiences,operator_audit_events restart identity cascade");
    mode = false; configuration.ready = true; configuration.organizerEmail = "operator@example.test";
    calls.length = 0; remote.clear(); providerHook = null; failFinalize = false;
    await db.query("insert into platform_users values ($1,null,'active')", [actor]);
    await db.query("insert into platform_role_grants values ($1,'ops_admin',null)", [actor]);
    await db.query("insert into experiences (id,title,status,starts_at,ends_at,visibility) values ($1,'Original','published',now()+interval '1 day',now()+interval '2 days','public')", [event]);
    if (createLink) await mark("publish");
  }
  async function expireLease() {
    // Fixture-only time travel. Production immutable request guards stay enabled
    // during every repository call; no real database is used.
    await db.exec("alter table experience_calendar_sync_requests disable trigger user");
    await db.exec("update experience_calendar_sync_requests set created_at=now()-interval '1 hour',last_attempt_at=now()-interval '11 minutes'");
    await db.exec("alter table experience_calendar_sync_requests enable trigger user");
    await db.exec("update experience_calendar_links set next_reconcile_at=now(),version=version+1,updated_at=now()");
  }
  async function makeLegacy() {
    await db.exec("alter table experience_calendar_links disable trigger user");
    await db.exec("update experience_calendar_links set livemode=null");
    await db.exec("alter table experience_calendar_links enable trigger user");
  }
  try {
    await db.exec(`create role anon; create role authenticated; create schema private;
      create table people(id uuid primary key,status text);
      create table ruined_members(id uuid primary key,person_id uuid references people(id),unique(id,person_id));
      create table platform_users(auth_user_id uuid primary key,person_id uuid,status text);
      create table platform_role_grants(auth_user_id uuid references platform_users(auth_user_id),role_slug text,revoked_at timestamptz);
      create table member_lifecycle(member_id uuid,account_state text,billing_state text,administrative_onboarding_state text,standing_state text,cancellation_effective_at timestamptz);
      create table person_profiles(person_id uuid,preferred_name text,display_name text);
      create table person_email_addresses(person_id uuid,email_normalized text,is_primary boolean,retired_at timestamptz,verification_state text);
      create table circle_member_assignments(member_id uuid,circle_id uuid,ended_at timestamptz);
      create table block_circle_assignments(circle_id uuid,block_id uuid,ended_at timestamptz);
      create table circle_staff_assignments(auth_user_id uuid,circle_id uuid,role_slug text,ended_at timestamptz);
      create table experiences(id uuid primary key,title text,details text,summary text,starts_at timestamptz,ends_at timestamptz,
        timezone text default 'America/Denver',location_label text,visibility text,circle_id uuid,block_id uuid,status text,version bigint default 1,cancelled_at timestamptz);
      create table experience_registrations(id uuid primary key,experience_id uuid references experiences(id),person_id uuid references people(id),member_id uuid,status text);
      create table operator_audit_events(id bigserial primary key,actor_auth_user_id uuid references platform_users(auth_user_id),action text,
        subject_type text,subject_id text,request_id text,after_snapshot jsonb,metadata jsonb,dedupe_key text unique);
      create table integration_entity_links(provider text,local_entity_type text,local_entity_id text,external_entity_type text,external_entity_id text,livemode boolean,metadata jsonb,updated_at timestamptz,
        unique(provider,local_entity_type,local_entity_id,external_entity_type,livemode));
      create function ruined_reject_append_only_mutation() returns trigger language plpgsql as $$begin raise exception 'append only'; end;$$;
    `);
    for (const migration of ["20260829_operator_google_calendar_sync", "20260829_operator_google_calendar_sync_hardening", "20260829_operator_google_calendar_meet_url_constraint", "20260904225258_calendar_durable_reconciliation"]) {
      await db.exec(await source(`db/migrations/${migration}.sql`));
    }
    await t.test("publish persists a first invite; worker succeeds without any browser request and does not resend", async () => {
      await reset(); assert.equal((await link()).status, "pending_create");
      assert.equal((await run()).processed, 1); assert.equal((await link()).status, "active");
      assert.equal((await run()).processed, 0); assert.deepEqual(calls, ["create"]);
    });
    await t.test("ordinary edits never create a first invitation for an unlinked published event", async () => {
      for (const past of [false, true]) {
        await reset(false);
        if (past) await db.exec("update experiences set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'");
        await mark("experience"); await mark("attendees");
        assert.equal(await link(), undefined); assert.equal((await run()).processed, 0); assert.deepEqual(calls, []);
      }
    });
    await t.test("only an explicit ready, mode-bound publish of an unelapsed event queues first delivery", async () => {
      await reset(false); configuration.ready = false; await mark("publish"); assert.equal(await link(), undefined);
      configuration.ready = true; mode = null; await mark("publish"); assert.equal(await link(), undefined);
      mode = false; await db.exec("update experiences set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'");
      await mark("publish"); assert.equal(await link(), undefined); assert.deepEqual(calls, []);
      await db.exec("update experiences set starts_at=now()+interval '1 day',ends_at=now()+interval '2 days'");
      await mark("publish"); assert.equal((await link()).status, "pending_create"); assert.equal((await run()).processed, 1);
    });
    await t.test("elapsed pending creates pause visibly with no claim/retry loop; explicit operator delivery remains available", async () => {
      await reset();
      const cachedCandidate = (await repo.getPendingCalendarReconciliations(1))[0];
      await db.exec("update experiences set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'");
      for (let i = 0; i < 3; i += 1) assert.equal((await run()).claimed, 0);
      await assert.rejects(() => repo.reconcilePendingExperienceCalendar(cachedCandidate), RepositoryError);
      assert.equal((await link()).status, "pending_create"); assert.deepEqual(calls, []);
      assert.equal((await db.query("select count(*)::int as n from experience_calendar_sync_requests")).rows[0].n, 0);
      const state = await bridge(db).begin((tx) => repo.getOpsExperienceCalendarStateForTx(tx, event));
      assert.equal(state.automaticDeliveryPaused, true); assert.match(state.lastError, /event has ended/);
      await repo.syncOpsExperienceCalendar({ actorAuthUserId: actor, experienceId: event, intent: "create", requestKey: crypto.randomUUID() });
      assert.deepEqual(calls, ["create"]);
    });
    await t.test("elapsed updates do not send automatically, but cancellations still recover", async () => {
      await reset(); await run();
      await db.exec("update experiences set title='Historical correction',starts_at=now()-interval '2 days',ends_at=now()-interval '1 day',version=version+1");
      await mark("experience"); assert.equal((await run()).claimed, 0); assert.deepEqual(calls, ["create"]);
      await db.exec("update experiences set status='cancelled',cancelled_at=now(),version=version+1"); await mark("cancel");
      assert.equal((await run()).processed, 1); assert.deepEqual(calls, ["create", "cancel"]); assert.equal((await link()).status, "cancelled");
    });
    await t.test("delayed member registration reconciliation cannot bypass the elapsed-event boundary", async () => {
      await reset(); await run();
      const personId = crypto.randomUUID(); const memberId = crypto.randomUUID(); const registrationId = crypto.randomUUID();
      await db.query("insert into people values ($1,'active')", [personId]);
      await db.query("insert into ruined_members values ($1,$2)", [memberId, personId]);
      await db.query("update platform_users set person_id=$1 where auth_user_id=$2", [personId, actor]);
      await db.query("insert into platform_role_grants values ($1,'member',null)", [actor]);
      await db.query("insert into member_lifecycle (member_id,account_state,billing_state,standing_state) values ($1,'active','active','active')", [memberId]);
      await db.query("insert into experience_registrations values ($1,$2,$3,$4,'registered')", [registrationId, event, personId, memberId]);
      await db.exec("update experiences set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'"); await mark("attendees");
      await assert.rejects(() => repo.syncMemberExperienceCalendar({ actorAuthUserId: actor, experienceId: event,
        expectedRegistrationStatus: "registered", requestKey: crypto.randomUUID() }), /event has ended/);
      assert.deepEqual(calls, ["create"]); assert.equal((await link()).status, "pending_update");
    });
    await t.test("mode/organizer mismatch and unbound legacy links send nothing", async () => {
      await reset(); mode = true; assert.equal((await run()).processed, 0);
      mode = null; assert.equal((await run()).ready, false);
      mode = false; configuration.organizerEmail = "other@example.test"; assert.equal((await run()).processed, 0);
      configuration.organizerEmail = "operator@example.test"; await makeLegacy(); assert.equal((await run()).processed, 0);
      assert.deepEqual(calls, []);
    });
    await t.test("provider failure persists backoff and a later retry uses the existing create identity", async () => {
      await reset(); providerHook = () => { throw new ApiError(503); };
      assert.equal((await run()).failed, 1); assert.equal((await link()).status, "failed");
      assert.ok(new Date((await link()).next_reconcile_at).getTime() > Date.now());
      assert.equal((await run()).processed, 0);
      await db.exec("update experience_calendar_links set next_reconcile_at=now(),version=version+1,updated_at=now()");
      assert.equal((await run()).processed, 1); assert.equal(remote.size, 1);
      assert.equal([...remote.values()][0].recoverExisting, true);
    });
    await t.test("a lost finalize keeps its lease, blocks another worker, and recovers after expiration", async () => {
      await reset(); providerHook = () => { failFinalize = true; };
      assert.equal((await run()).failed, 1);
      assert.equal((await db.query("select status from experience_calendar_sync_requests")).rows[0].status, "processing");
      assert.equal((await run()).processed, 0);
      await expireLease(); assert.equal((await run()).processed, 1);
      assert.equal((await db.query("select count(*)::int as n from experience_calendar_sync_requests")).rows[0].n, 1);
      assert.equal(remote.size, 1);
    });
    await t.test("changed revisions supersede interrupted snapshots and reconcile the latest audience", async () => {
      await reset(); providerHook = () => { failFinalize = true; }; await run();
      await db.query("insert into people values ($1,'active')", [person]);
      await db.query("insert into person_email_addresses values ($1,'member@example.test',true,null,'verified')", [person]);
      await db.query("insert into experience_registrations values ($1,$2,$3,null,'registered')", [crypto.randomUUID(),event,person]);
      await db.exec("update experiences set title='Updated',version=version+1"); await mark("attendees"); await expireLease();
      assert.equal((await run()).processed, 1);
      const latest = [...remote.values()][0]; assert.equal(latest.summary, "Updated"); assert.equal(latest.attendees.length, 1);
      assert.equal(latest.recoverExisting, true); assert.equal((await link()).status, "active");
      assert.equal((await db.query("select count(*)::int as n from experience_calendar_sync_requests where status='superseded'")).rows[0].n, 1);
    });
    await t.test("cancel then archive before first send never creates an invitation", async () => {
      await reset(); await db.exec("update experiences set status='cancelled',cancelled_at=now(),version=version+1"); await mark("cancel");
      await db.exec("update experiences set status='archived',version=version+1");
      assert.equal((await run()).processed, 1); assert.equal((await link()).status, "cancelled"); assert.deepEqual(calls, ["cancel"]);
    });
    await t.test("cancellation supersedes an ambiguous create without re-inviting its stale audience", async () => {
      await reset(); providerHook = () => { failFinalize = true; }; await run();
      await db.exec("update experiences set status='cancelled',cancelled_at=now(),version=version+1"); await mark("cancel"); await expireLease();
      assert.equal((await run()).processed, 1); assert.deepEqual(calls, ["create", "cancel"]);
      assert.equal((await link()).status, "cancelled"); assert.equal(remote.size, 0);
    });
    await t.test("manual recovery also supersedes an interrupted outdated snapshot", async () => {
      await reset(); providerHook = () => { failFinalize = true; }; await run();
      await db.exec("update experiences set title='Manual latest',version=version+1"); await mark(); await expireLease();
      await repo.syncOpsExperienceCalendar({ actorAuthUserId: actor, experienceId: event, intent: "create", requestKey: crypto.randomUUID() });
      assert.equal([...remote.values()][0].summary, "Manual latest");
      assert.equal((await db.query("select count(*)::int as n from experience_calendar_sync_requests where status='superseded'")).rows[0].n, 1);
    });
    await t.test("revision changes during provider HTTP remain pending, not falsely synchronized", async () => {
      await reset(); providerHook = async () => { await db.exec("update experiences set title='Later',version=version+1"); await mark(); };
      await run(); assert.equal((await link()).status, "pending_update");
      await run(); assert.equal((await link()).status, "active"); assert.equal([...remote.values()][0].summary, "Later");
    });
    await t.test("legacy binding is admin-only and read-only, and pauses until explicit sync", async () => {
      await reset(); await run(); await makeLegacy(); calls.length = 0;
      await assert.rejects(() => bind(true), RepositoryError);
      await db.exec("update platform_role_grants set role_slug='guide'"); await assert.rejects(() => bind(), RepositoryError); assert.deepEqual(calls, []);
      await db.exec("update platform_role_grants set role_slug='ops_admin'");
      await bind(); assert.deepEqual(calls, ["verify"]); assert.equal((await link()).livemode, false);
      assert.equal((await run()).processed, 0);
      await assert.rejects(() => db.exec("update experience_calendar_links set livemode=true,version=version+1,updated_at=now()"));
      await repo.syncOpsExperienceCalendar({ actorAuthUserId: actor, experienceId: event, intent: "sync", requestKey: crypto.randomUUID() });
      assert.deepEqual(calls, ["verify", "update"]);
    });
    await t.test("a bound archived cancellation remains explicitly deliverable", async () => {
      await reset(); await run();
      await db.exec("update experiences set status='cancelled',cancelled_at=now(),version=version+1"); await mark("cancel");
      await db.exec("update experiences set status='archived',version=version+1"); await makeLegacy();
      const calendar = await bind(); assert.equal(calendar.canSendCancellation, true);
      assert.equal((await run()).processed, 0);
      await repo.syncOpsExperienceCalendar({ actorAuthUserId: actor, experienceId: event, intent: "cancel", requestKey: crypto.randomUUID() });
      assert.equal((await link()).status, "cancelled"); assert.deepEqual(calls, ["create", "verify", "cancel"]);
    });
    await t.test("binding fails closed on missing provider event or operator revocation during GET", async () => {
      await reset(); await run(); await makeLegacy(); remote.clear(); await assert.rejects(() => bind(), ApiError); assert.equal((await link()).livemode, null);
      await reset(); await run(); await makeLegacy(); providerHook = () => db.exec("update platform_role_grants set revoked_at=now()");
      await assert.rejects(() => bind(), RepositoryError); assert.equal((await link()).livemode, null);
    });
  } finally { await db.close(); await driver.end(); }
});

test("Calendar worker route requires a timing-safe bearer secret and processes one item", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "calendar-test-only-secret";
  let count = 0, ready = true, fail = false;
  const route = await load("app/api/internal/integrations/google-calendar/process/route.ts", {
    "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
    "@/lib/google/calendar-worker": { processCalendarReconciliationBatch: async (limit) => {
      count += 1; assert.equal(limit, 1); if (fail) throw new Error("private detail"); return { ready, processed: 0 };
    } },
  });
  try {
    for (const authorization of [null, "Bearer wrong", "calendar-test-only-secret", "Basic calendar-test-only-secret"]) {
      const response = await route.POST(new Request("https://example.test/process", { method: "POST", headers: authorization ? { authorization } : {} }));
      assert.equal(response.status, 401);
    }
    assert.equal(count, 0);
    const request = () => new Request("https://example.test/process", { headers: { authorization: "Bearer calendar-test-only-secret" } });
    assert.equal((await route.GET(request())).status, 200); assert.equal(count, 1);
    ready = false; assert.equal((await route.POST(request())).status, 503);
    fail = true; const response = await route.GET(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private detail/);
    delete process.env.CRON_SECRET; assert.equal((await route.GET(request())).status, 401);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});
