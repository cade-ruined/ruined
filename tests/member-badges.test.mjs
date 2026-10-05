import { prepaidFixtureDependencies } from "./helpers/prepaid-policy-fixture.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { loadPGliteForSchemaChecks } from "../scripts/check-support-schema.mjs";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const migration = await read("db/migrations/20260929000000_member_badges.sql");
const cohortMigration = await read("db/migrations/20260929010000_early_cohort_badges.sql");
const operatorMigration = await read("db/migrations/20260914181653_operator_complimentary_membership.sql");
const complimentaryMigration = await read("db/migrations/20260925000000_complimentary_member_invitations.sql");
async function load(path, deps = {}) {
  deps = { ...prepaidFixtureDependencies, ...deps };
  const output = ts.transpileModule(await read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(name => {
    assert.ok(Object.hasOwn(deps, name), `Unexpected dependency ${name}`); return deps[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
const tiers = await load("src/lib/membership/member-number.ts");
const model = await load("src/lib/membership/badge-model.ts", { "./member-number": tiers });
const facts = {
  memberNumber: 1, activatedAt: "2026-09-01T12:00:00Z", membershipActive: true,
  verifiedEmail: "member@example.test", waitlistEmail: "member@example.test",
  waitlistedAt: "2026-08-01T12:00:00Z",
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function wrap(engine) {
  const sql = async (strings, ...values) => (await engine.query(
    strings.reduce((query, part, index) => query + (index ? `$${index}` : "") + part, ""), values,
  )).rows;
  sql.begin = callback => engine.transaction(tx => callback(wrap(tx)));
  return sql;
}
function sqlFunction(source, name) {
  const start = source.indexOf(`create or replace function private.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}

async function fixture(t, migrate = true) {
  const PGlite = await loadPGliteForSchemaChecks(), db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create schema private;
    create table people(id uuid primary key,status text default 'active');
    create table ruined_members(id uuid primary key,person_id uuid,email_normalized text,deleted_at timestamptz,member_number integer);
    create table private.member_number_assignments(member_number integer primary key,member_id uuid unique,activated_at timestamptz not null);
    create table person_email_addresses(person_id uuid,email_normalized text primary key,verification_state text default 'verified',retired_at timestamptz);
    create table membership_waitlist(id uuid primary key default gen_random_uuid(),name text,email_normalized text unique,phone text,created_at timestamptz default statement_timestamp());
    create table integration_outbox(destination text,event_type text,aggregate_type text,aggregate_id text,dedupe_key text unique,payload jsonb,created_at timestamptz default now());
    create table stripe_invoices(id text primary key,member_id uuid,purpose text,stripe_status text,amount_paid bigint);
    create table stripe_webhook_events(event_id text primary key,event_type text,object_id text,livemode boolean,status text,stripe_created bigint);
    create table platform_users(auth_user_id uuid primary key,member_id uuid,person_id uuid,status text);
    create table platform_role_grants(auth_user_id uuid,role_slug text,revoked_at timestamptz);
    create table member_lifecycle(member_id uuid primary key,account_state text,administrative_onboarding_state text,
      billing_state text,program_state text,standing_state text,cancellation_effective_at timestamptz,access_started_at timestamptz);
    create table member_complimentary_grants(member_id uuid,starts_at timestamptz,ends_at timestamptz,revoked_at timestamptz);
  `);
  // Exercise the real canonical entitlement functions, including grant expiry,
  // revoked roles and complimentary funding. Never replace them with a boolean.
  await db.exec(sqlFunction(operatorMigration, "ruined_member_has_operator_funding"));
  await db.exec(sqlFunction(complimentaryMigration, "ruined_member_has_complimentary_funding"));
  await db.exec(sqlFunction(complimentaryMigration, "ruined_member_can_share_invitation"));
  if (migrate) { await db.exec(migration); await db.exec(cohortMigration); }
  const sql = wrap(db);
  const repository = await load("src/lib/membership/badge-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => sql }, "./badge-model": model,
  });
  async function assign(n, number = n, activatedAt = facts.activatedAt) {
    await db.query("insert into private.member_number_assignments(member_number,member_id,activated_at) values($1,$2,$3)", [number,id(n),activatedAt]);
    await db.query("update ruined_members set member_number=$1 where id=$2", [number,id(n)]);
  }
  async function member(n, options = {}) {
    const email = `member-${n}@example.test`, funding = options.funding ?? "paid";
    await db.query("insert into people(id) values($1)", [id(n)]);
    await db.query("insert into ruined_members(id,person_id,email_normalized) values($1,$1,$2)", [id(n), email]);
    await db.query("insert into person_email_addresses(person_id,email_normalized,verification_state) values($1,$2,$3)", [id(n), options.verified === false ? `other-${email}` : email, options.unverified ? "unverified" : "verified"]);
    await db.query("insert into membership_waitlist(id,name,email_normalized,created_at) values($1,'Member',$2,$3)", [id(n), email, options.waited ?? facts.waitlistedAt]);
    if (migrate && options.waitlist !== false) await db.query("update membership_waitlist set joined_waitlist_at=created_at where id=$1", [id(n)]);
    if (options.outbox) await db.query("insert into integration_outbox(destination,event_type,aggregate_type,aggregate_id,dedupe_key,created_at) values('google','membership_waitlist.sheet_sync_requested','membership_waitlist',$1,$2,$3)", [id(n), `google:membership-waitlist:${id(n)}:created:v1`, options.waited ?? facts.waitlistedAt]);
    await db.query("insert into platform_users values($1,$1,$1,$2)", [id(n), options.accountStatus ?? "active"]);
    await db.query("insert into platform_role_grants values($1,'member',$2)", [id(n), options.revokedRole ? "2026-08-01" : null]);
    if (funding === "operator") await db.query("insert into platform_role_grants values($1,'ops_admin',null)", [id(n)]);
    await db.query("insert into member_lifecycle values($1,'active',$2,$3,'onboarding','active',null,$4)",
      [id(n), options.completed === false ? "in_progress" : "completed", funding === "paid" ? "active" : "pending", facts.activatedAt]);
    if (funding === "complimentary") await db.query("insert into member_complimentary_grants values($1,$2,$3,$4)",
      [id(n), options.startsAt ?? "2026-08-01", options.endsAt ?? null, options.revokedGrant ? "2026-09-01" : null]);
    if (options.number !== null) await assign(n, options.number ?? n, options.activatedAt ?? facts.activatedAt);
  }
  async function pay(n, options = {}) {
    const invoice = `invoice-${n}${options.suffix ?? ""}`, event = `event-${n}${options.suffix ?? ""}`;
    const paidAt = options.paidAt ?? facts.activatedAt;
    await db.query("insert into stripe_invoices(id,member_id,purpose,stripe_status,amount_paid) values($1,$2,$3,$4,$5)",
      [invoice, id(n), options.purpose ?? "membership", options.invoiceStatus ?? "paid", options.amount ?? 49900]);
    if (migrate) await db.query("update stripe_invoices set paid_at=$1 where id=$2", [paidAt, invoice]);
    await db.query("insert into stripe_webhook_events values($1,$2,$3,$4,$5,$6)", [event, options.type ?? "invoice.paid", invoice, options.live ?? true, options.status ?? "processed", Date.parse(paidAt) / 1000]);
    return event;
  }
  const award = event => sql.begin(tx => repository.reconcileMemberBadgesForStripeEvent(tx, event));
  const reconcile = n => sql.begin(tx => repository.reconcileMemberBadges(tx, id(n)));
  return { db, sql, member, assign, pay, award, reconcile, ...repository };
}

test("I Was Here requires an activated Founders or Originals membership after a genuine matching waitlist signup", () => {
  const result = model.evaluateMembershipBadges(facts);
  assert.deepEqual(result, [{ key: "early-supporter", label: "I Was Here", description: "Joined the waitlist, then activated a Founders or Originals membership.", earnedAt: "2026-09-01T12:00:00.000Z" }]);
  assert.deepEqual(model.evaluateMembershipBadges({ ...facts, verifiedEmail: " MEMBER@EXAMPLE.TEST " }), result);
  for (const change of [
    { memberNumber: null }, { memberNumber: undefined }, { memberNumber: -1 }, { memberNumber: 1.5 },
    { memberNumber: NaN }, { memberNumber: Infinity }, { memberNumber: 51 }, { memberNumber: 101 }, { memberNumber: 201 },
    { activatedAt: null }, { activatedAt: "invalid" }, { membershipActive: false }, { membershipActive: undefined },
    { verifiedEmail: null }, { verifiedEmail: "other@example.test" }, { waitlistEmail: null },
    { waitlistedAt: null }, { waitlistedAt: facts.activatedAt }, { waitlistedAt: "2026-10-01" }, { waitlistedAt: "invalid" },
  ]) assert.deepEqual(model.evaluateMembershipBadges({ ...facts, ...change }), [], JSON.stringify(change));
  for (const memberNumber of [0, 1, 4, 5, 6, 50]) assert.equal(model.evaluateMembershipBadges({ ...facts, memberNumber }).length, 1);
});

test("paid and current complimentary activation earn once, with no private evidence in the owner view", async t => {
  const f = await fixture(t);
  for (const [n, funding] of [[1,"paid"], [2,"complimentary"], [3,"operator"]]) {
    await f.member(n, { funding });
    assert.deepEqual(await f.getMemberBadges(id(n)), model.evaluateMembershipBadges(facts));
    await f.reconcile(n); await f.reconcile(n);
    assert.equal((await f.db.query("select count(*) from member_badge_awards where member_id=$1", [id(n)])).rows[0].count, 1);
  }
  await f.db.query("update ruined_members set deleted_at=now() where id=$1", [id(1)]);
  assert.deepEqual(await f.getMemberBadges(id(1)), []);
});

test("pending unpaid, incomplete, revoked and not-yet-active membership cannot earn", async t => {
  const f = await fixture(t);
  const cases = [
    { funding: "none" }, { completed: false }, { number: null }, { waitlist: false },
    { verified: false }, { unverified: true }, { accountStatus: "suspended" }, { revokedRole: true },
    { funding: "complimentary", revokedGrant: true }, { funding: "complimentary", startsAt: "2099-01-01" },
    { funding: "complimentary", endsAt: "2020-01-01" }, { waited: "2026-09-10" },
  ];
  for (const [index, options] of cases.entries()) {
    const n = index + 1; await f.member(n, options); await f.reconcile(n);
    assert.deepEqual(await f.getMemberBadges(id(n)), [], JSON.stringify(options));
  }
  // A paid event alone cannot manufacture active access for an unpaid profile.
  await f.award(await f.pay(1));
  assert.deepEqual(await f.getMemberBadges(id(1)), []);
});

test("cohort activation awards atomically at assignment and retains earned history after access ends", async t => {
  const f = await fixture(t); await f.member(1, { number: null, funding: "complimentary" });
  await f.reconcile(1); assert.deepEqual(await f.getMemberBadges(id(1)), []);
  await assert.rejects(f.db.transaction(async tx => {
    await tx.query("insert into private.member_number_assignments values(0,$1,'2026-09-02T12:00:00Z')", [id(1)]);
    await tx.query("update ruined_members set member_number=0 where id=$1", [id(1)]);
    assert.equal((await tx.query("select count(*) from member_badge_awards")).rows[0].count, 1);
    throw Error("Activation failed");
  }), /Activation failed/);
  assert.deepEqual(await f.getMemberBadges(id(1)), []);
  await f.assign(1, 0, "2026-09-02T12:00:00Z");
  const awarded = await f.getMemberBadges(id(1));
  assert.equal(awarded[0].earnedAt, "2026-09-02T12:00:00.000Z");
  await f.db.query("update member_complimentary_grants set revoked_at=now() where member_id=$1", [id(1)]);
  await f.reconcile(1); assert.deepEqual(await f.getMemberBadges(id(1)), awarded);
});

test("funding and lifecycle changes trigger reconciliation without waiting for an invoice", async t => {
  const f = await fixture(t);
  await f.member(1, { funding: "none" });
  assert.deepEqual(await f.getMemberBadges(id(1)), []);
  await f.db.query("insert into member_complimentary_grants values($1,'2026-08-01',null,null)", [id(1)]);
  assert.equal((await f.getMemberBadges(id(1))).length, 1);
  await f.member(2, { funding: "none" });
  await f.db.query("update member_lifecycle set billing_state='active' where member_id=$1", [id(2)]);
  assert.equal((await f.getMemberBadges(id(2))).length, 1);
  await f.member(3, { funding: "none" });
  await f.db.query("insert into platform_role_grants values($1,'ops_admin',null)", [id(3)]);
  assert.equal((await f.getMemberBadges(id(3))).length, 1);
});

test("server reconciliation is transactional and retry-safe", async t => {
  const f = await fixture(t); await f.member(1); await f.db.exec("delete from member_badge_awards");
  await assert.rejects(f.sql.begin(async tx => { await f.reconcileMemberBadges(tx, id(1)); throw Error("Retry"); }), /Retry/);
  assert.deepEqual(await f.getMemberBadges(id(1)), []);
  await f.reconcile(1); await f.reconcile(1);
  assert.equal((await f.getMemberBadges(id(1))).length, 1);
});

test("cohort boundaries and the assignment ledger are required even for active memberships", async t => {
  const f = await fixture(t);
  for (const [n, number] of [[1,0], [2,5], [3,6], [4,50], [5,51], [6,100], [7,201]]) {
    await f.member(n, { number }); await f.reconcile(n);
    assert.equal((await f.getMemberBadges(id(n))).length, number <= 50 ? 1 : 0, String(number));
  }
  await f.member(9, { number: null });
  await f.db.query("update ruined_members set member_number=9 where id=$1", [id(9)]);
  await f.reconcile(9); assert.deepEqual(await f.getMemberBadges(id(9)), []);
});

test("fresh migrations award only active eligible early cohorts, never historical unpaid or incomplete accounts", async t => {
  const f = await fixture(t, false);
  await f.member(1, { number: 0, outbox: true }); await f.pay(1);
  await f.member(2, { number: 50, outbox: true, funding: "complimentary" });
  const ineligible = [
    { number: 51 }, { funding: "none" }, { completed: false },
    { accountStatus: "suspended" }, { revokedRole: true }, { unverified: true },
    { outbox: false }, { number: null }, { waited: "2026-09-02" },
    { funding: "complimentary", revokedGrant: true },
    { funding: "complimentary", endsAt: "2020-01-01" },
  ];
  for (const [index, options] of ineligible.entries()) {
    const n = index + 3;
    await f.member(n, { outbox: true, ...options }); await f.pay(n);
  }
  await f.member(20, { outbox: true }); await f.pay(20);
  await f.db.query("update member_lifecycle set standing_state='canceled' where member_id=$1", [id(20)]);
  await f.member(21, { outbox: true }); await f.pay(21);
  await f.db.query("update member_lifecycle set billing_state='past_due' where member_id=$1", [id(21)]);
  await f.member(22, { outbox: true, number: null }); await f.pay(22);
  await f.db.query("update ruined_members set member_number=22 where id=$1", [id(22)]);
  await f.db.exec(migration);
  assert.equal((await f.db.query("select count(*) from member_badge_awards")).rows[0].count, 0,
    "The schema migration defers awards to the current entitlement and cohort rule");
  await f.db.exec(cohortMigration); await f.db.exec(cohortMigration);
  assert.deepEqual((await f.db.query("select member_id from member_badge_awards order by member_id")).rows.map(row => row.member_id), [id(1), id(2)]);
  assert.equal((await f.getMemberBadges(id(1)))[0].earnedAt, "2026-09-01T12:00:00.000Z");
  assert.equal((await f.getMemberBadges(id(2)))[0].earnedAt, "2026-09-01T12:00:00.000Z");
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await f.db.query("select has_function_privilege($1,'private.ruined_reconcile_early_cohort_badge(uuid)','EXECUTE') as allowed", [role])).rows[0].allowed, false);
    assert.equal((await f.db.query("select has_table_privilege($1,'member_badge_awards','SELECT,INSERT,UPDATE,DELETE') as allowed", [role])).rows[0].allowed, false);
  }
});

test("updated cohort backfill preserves existing awards and permanent numbers even after funding ends", async t => {
  const f = await fixture(t, false);
  await f.member(1, { number: 0, outbox: true });
  await f.member(2, { number: 50, outbox: true, funding: "none" });
  await f.member(3, { number: 51, outbox: true });
  await f.db.exec(migration);
  for (const n of [1, 2, 3]) await f.db.query(`
    insert into member_badge_awards(member_id,badge_key,earned_at,source_event_id,source_invoice_id,rule_version)
    values($1,'early-supporter','2026-08-20T12:00:00Z',$2,$3,1)
  `, [id(n), `historical-event-${n}`, `historical-invoice-${n}`]);
  const oldAwards = (await f.db.query("select * from member_badge_awards order by member_id")).rows;
  const oldNumbers = (await f.db.query("select * from private.member_number_assignments order by member_number")).rows;
  await f.db.exec(cohortMigration); await f.db.exec(cohortMigration);
  assert.deepEqual((await f.db.query("select * from member_badge_awards order by member_id")).rows, oldAwards);
  assert.deepEqual((await f.db.query("select * from private.member_number_assignments order by member_number")).rows, oldNumbers);
  assert.equal((await f.getMemberBadges(id(1)))[0].earnedAt, "2026-08-20T12:00:00.000Z");
  assert.equal((await f.getMemberBadges(id(2)))[0].earnedAt, "2026-08-20T12:00:00.000Z");
  assert.deepEqual(await f.getMemberBadges(id(3)), [], "Later-cohort legacy awards remain stored but do not display this exclusive badge");
});

test("actual waitlist submissions mark source once without accepting invitation attribution as a signup", async t => {
  const f = await fixture(t); await f.member(1, { waitlist: false });
  const { joinMembershipWaitlist } = await load("src/lib/membership/waitlist-repository.ts", { "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => f.sql } });
  await joinMembershipWaitlist({ name: "Replacement", emailNormalized: "member-1@example.test", phone: null });
  const first = (await f.db.query("select * from membership_waitlist where id=$1", [id(1)])).rows[0];
  assert.ok(first.joined_waitlist_at); assert.equal(first.name, "Member");
  await joinMembershipWaitlist({ name: "Replacement", emailNormalized: "member-1@example.test", phone: null });
  assert.deepEqual((await f.db.query("select * from membership_waitlist where id=$1", [id(1)])).rows[0], first);
});

test("the deployed legacy public waitlist writer stamps new submissions through its trusted outbox event", async t => {
  const f = await fixture(t);
  const legacy = await load("tests/helpers/legacy-public-waitlist-repository.ts", {
    "server-only": {}, "@/lib/database/server": { getApplicationDatabase: () => f.sql },
  });
  const submission = { name: "Public Member", emailNormalized: "legacy-public@example.test", phone: null };
  await legacy.joinMembershipWaitlist(submission);
  const first = (await f.db.query("select * from membership_waitlist where email_normalized=$1", [submission.emailNormalized])).rows[0];
  assert.ok(first.joined_waitlist_at, "The old deployed writer need not know the new column");
  assert.ok(new Date(first.joined_waitlist_at) >= new Date(first.created_at));
  await legacy.joinMembershipWaitlist({ ...submission, name: "Untrusted replacement" });
  assert.deepEqual((await f.db.query("select * from membership_waitlist where email_normalized=$1", [submission.emailNormalized])).rows[0], first);
  assert.equal((await f.db.query("select count(*) from integration_outbox")).rows[0].count, 1);
  await f.member(1, { waitlist: false });
  assert.equal((await f.db.query("select joined_waitlist_at from membership_waitlist where id=$1", [id(1)])).rows[0].joined_waitlist_at, null,
    "Invitation attribution without a real submission event is not waitlist evidence");
  for (const [index, change] of [
    { destination: "stripe" }, { eventType: "unrelated" }, { aggregateType: "unrelated" }, { dedupe: "untrusted" },
  ].entries()) await f.db.query(`
    insert into integration_outbox(destination,event_type,aggregate_type,aggregate_id,dedupe_key)
    values($1,$2,$3,$4,$5)
  `, [change.destination ?? "google", change.eventType ?? "membership_waitlist.sheet_sync_requested",
    change.aggregateType ?? "membership_waitlist", id(1), change.dedupe ?? `not-canonical-${index}`]);
  assert.equal((await f.db.query("select joined_waitlist_at from membership_waitlist where id=$1", [id(1)])).rows[0].joined_waitlist_at, null);
  await f.db.query(`insert into integration_outbox(destination,event_type,aggregate_type,aggregate_id,dedupe_key,created_at)
    values('google','membership_waitlist.sheet_sync_requested','membership_waitlist',$1,$2,'2026-09-10T00:00:00Z')`,
    [id(1), `google:membership-waitlist:${id(1)}:created:v1`]);
  assert.equal(new Date((await f.db.query("select joined_waitlist_at from membership_waitlist where id=$1", [id(1)])).rows[0].joined_waitlist_at).toISOString(), "2026-09-10T00:00:00.000Z");
  await f.reconcile(1);
  assert.deepEqual(await f.getMemberBadges(id(1)), [], "A submission after activation cannot be backdated to an earlier attribution row");
});

test("historical signup evidence uses its first outbox time and ignores attribution-only rows", async t => {
  const f = await fixture(t, false);
  await f.member(1, { outbox: true });
  await f.member(2, { outbox: true });
  await f.db.query("update integration_outbox set created_at='2026-09-10T00:00:00Z' where aggregate_id=$1", [id(2)]);
  await f.member(3);
  await f.db.exec(migration); await f.db.exec(cohortMigration);
  assert.equal((await f.getMemberBadges(id(1))).length, 1);
  assert.deepEqual(await f.getMemberBadges(id(2)), []);
  assert.deepEqual(await f.getMemberBadges(id(3)), []);
  assert.equal(new Date((await f.db.query("select joined_waitlist_at from membership_waitlist where id=$1", [id(2)])).rows[0].joined_waitlist_at).toISOString(), "2026-09-10T00:00:00.000Z");
});

test("profile reads tolerate only an absent badge table, not other database errors", async () => {
  for (const [error, empty] of [
    [{ code: "42P01", message: 'relation "member_badge_awards" does not exist' }, true],
    [{ code: "42P01", message: 'relation "ruined_members" does not exist' }, false],
    [{ code: "08006", message: "connection failed" }, false],
  ]) {
    const repository = await load("src/lib/membership/badge-repository.ts", { "server-only": {}, "./badge-model": model,
      "@/lib/database/server": { getApplicationDatabase: () => async () => { throw error; } } });
    if (empty) assert.deepEqual(await repository.getMemberBadges(id(1)), []);
    else await assert.rejects(repository.getMemberBadges(id(1)), value => value === error);
  }
});

test("the real paid-invoice webhook persists its payment timestamp and awards atomically, including safe replay", async t => {
  const f = await fixture(t); await f.member(1);
  await f.db.exec("delete from member_badge_awards");
  await f.db.exec(`
    alter table stripe_invoices add stripe_customer_id text, add stripe_subscription_id text,
      add billing_reason text, add amount_due bigint, add currency text, add last_event_created bigint,
      add updated_at timestamptz;
    alter table stripe_webhook_events add attempts integer default 1, add last_error text,
      add processed_at timestamptz, add updated_at timestamptz;
  `);
  const state = await load("src/lib/stripe/membership-state.ts");
  const pricing = await load("src/lib/membership/pricing.ts");
  const pricePolicy = await load("src/lib/stripe/price-policy.ts", { "@/lib/membership/pricing": pricing });
  const billing = await load("src/lib/stripe/billing-repository.ts", { "server-only": {},
    "@/lib/membership/pricing": pricing,
    "@/lib/membership/commercial-repository": { lockCommercialMembershipReservation: () => { throw new Error("Legacy invoice must not reserve a new offer"); } },
    "@/lib/stripe/database": { getBillingDatabase: () => f.sql }, "@/lib/stripe/membership-state": state });
  const subscription = { id: "subscription-1", customer: "customer-1", status: "active", livemode: true,
    metadata: {}, automatic_tax: { enabled: false, disabled_reason: null },
    items: { has_more: false, data: [{ id: "si_legacy", quantity: 1, price: { id: "membership-price", livemode: true,
      type: "recurring", currency: "usd", unit_amount: 49900, recurring: { interval: "month", interval_count: 1 } } }] } };
  const processor = await load("src/lib/stripe/webhook.ts", { "server-only": {},
    "@/lib/membership/badge-repository": f,
    "@/lib/membership/pricing": pricing,
    "@/lib/stripe/price-policy": pricePolicy,
    "@/lib/stripe/billing-repository": { ...billing,
      findMemberBySubscription: async () => ({ id: id(1), membershipState: "pending", stripeCustomerId: "customer-1" }),
      upsertSubscription: async () => {}, updateMemberBillingState: async () => {}, recordWebhookFailure: async () => {},
    },
    "@/lib/stripe/database": { getBillingDatabase: () => f.sql },
    "@/lib/stripe/membership-state": state,
    "@/lib/stripe/server": { getStripe: () => ({ subscriptions: { retrieve: async () => subscription } }),
      getMembershipPriceConfiguration: () => ({ legacy: "membership-price", livemode: true }), isStripeTaxEnabled: () => false },
  });
  const paidSeconds = Date.parse(facts.activatedAt) / 1000;
  const event = { id: "verified-event-1", type: "invoice.paid", livemode: true, created: paidSeconds + 20,
    data: { object: { id: "verified-invoice-1", customer: "customer-1", customer_email: "member-1@example.test",
      parent: { subscription_details: { subscription: "subscription-1", metadata: { ruined_context: "membership" } } },
      status: "paid", livemode: true, amount_paid: 49900, amount_due: 49900, amount_remaining: 0, currency: "usd",
      lines: { has_more: false, data: [{ livemode: true, currency: "usd", quantity: 1, subtotal: 49900,
        pricing: { price_details: { price: "membership-price" } }, parent: { type: "subscription_item_details",
          subscription_item_details: { subscription: "subscription-1", subscription_item: "si_legacy", proration: false } } }] },
      billing_reason: "subscription_create",
      status_transitions: { paid_at: paidSeconds } } } };
  assert.deepEqual(await processor.processStripeWebhookEvent(event), { duplicate: false, handled: true });
  assert.deepEqual(await f.getMemberBadges(id(1)), model.evaluateMembershipBadges(facts));
  assert.equal((await f.db.query("select status from stripe_webhook_events where event_id=$1", [event.id])).rows[0].status, "processed");
  // An explicit replay can reconcile historical eligible evidence without replaying billing side effects.
  await f.db.exec("delete from member_badge_awards");
  assert.deepEqual(await processor.processStripeWebhookEvent(event), { duplicate: true, handled: true });
  assert.equal((await f.getMemberBadges(id(1))).length, 1);
  // A stale invoice failure cannot erase the confirmed paid timestamp or badge.
  await billing.upsertInvoice(f.sql, { id: "verified-invoice-1", memberId: id(1), customerId: "customer-1",
    subscriptionId: "subscription-1", purpose: "membership", status: "open", amountDue: 49900, amountPaid: 0,
    currency: "usd", billingReason: "subscription_create", eventCreated: paidSeconds - 1, paidAt: null });
  const invoice = (await f.db.query("select stripe_status,paid_at from stripe_invoices where id='verified-invoice-1'")).rows[0];
  assert.equal(invoice.stripe_status, "paid"); assert.equal(new Date(invoice.paid_at).toISOString(), "2026-09-01T12:00:00.000Z");
});
