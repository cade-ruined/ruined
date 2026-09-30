import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyMemberSegment, getMemberSegmentConfiguration, listAllSegmentContacts,
  MEMBER_SEGMENT_NAMES, reconcileMemberSegments, readMemberSegmentSource,
} from "../src/lib/communications/member-segment-sync.ts";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const segments = { waiting: "waiting", open: "open" };
const member = (email, overrides = {}) => ({ email, name: "Cherry Hill", account_eligible: true,
  verified_identity: true, profile_complete: true, registration_hold: true, registered: true,
  profile_open: false, registration_ready: true, real_registration: true, real_existing_access: false,
  delivery_eligible: true, ...overrides });

function fixture(initial = []) {
  let sequence = 0;
  const calls = [];
  const contacts = new Map(initial.map(item => [item.id, { first_name: "Cherry", last_name: "Hill",
    unsubscribed: false, topics: { general: "opt_in" }, segments: new Set(), ...item }]));
  const provider = {
    async getSegment(id) { return { id, name: MEMBER_SEGMENT_NAMES[id] }; },
    async listContacts(segmentId, after) {
      const data = [...contacts.values()].filter(contact => contact.segments.has(segmentId));
      const start = after ? data.findIndex(contact => contact.id === after) + 1 : 0;
      return { data: data.slice(start, start + 2), has_more: start + 2 < data.length };
    },
    async getContact(email) { return [...contacts.values()].find(contact => contact.email === email) ?? null; },
    async topicIds() { return ["general", "store"]; },
    async createContact(input) {
      calls.push(["create", input]);
      assert.equal("unsubscribed" in input, false);
      const id = `new-${++sequence}`;
      contacts.set(id, { id, ...input, unsubscribed: false, topics: Object.fromEntries(input.topics.map(topic => [topic.id, topic.subscription])), segments: new Set() });
      return { id };
    },
    async updateName(id, names) {
      calls.push(["name", id, names]);
      assert.deepEqual(Object.keys(names).sort(), ["first_name", "last_name"]);
      Object.assign(contacts.get(id), names);
    },
    async addToSegment(id, segment) { calls.push(["add", id, segment]); contacts.get(id).segments.add(segment); },
    async removeFromSegment(id, segment) { calls.push(["remove", id, segment]); contacts.get(id).segments.delete(segment); },
  };
  return { provider, contacts, calls };
}

test("lifecycle eligibility separates registration, active access and test records", () => {
  assert.equal(classifyMemberSegment(member("member@example.com")), "waiting");
  assert.equal(classifyMemberSegment(member("member@example.com", { profile_open: true })), "open");
  assert.equal(classifyMemberSegment(member("member@example.com", { registration_hold: false, real_existing_access: true })), "open");
  for (const [overrides, reason] of [
    [{ account_eligible: false }, "account_unavailable"],
    [{ verified_identity: false }, "unverified_identity"],
    [{ profile_complete: false }, "profile_incomplete"],
    [{ registered: false }, "registration_incomplete"],
    [{ registration_ready: false }, "registration_incomplete"],
    [{ real_registration: false }, "test_or_unfunded"],
    [{ registration_hold: false, real_existing_access: false }, "test_or_unfunded"],
    [{ delivery_eligible: false }, "delivery_suppressed"],
  ]) assert.equal(classifyMemberSegment(member("member@example.com", overrides)), reason);
});

test("dry run counts only and never mutates contacts or groups", async () => {
  const f = fixture();
  const report = await reconcileMemberSegments({ source: [member("private@example.com")], segments, provider: f.provider });
  assert.equal(report.planned.creates, 1);
  assert.equal(report.planned.additions, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(JSON.stringify(report).includes("private@example.com"), false);
  assert.equal(JSON.stringify(report).includes("Cherry"), false);
});

test("create, activation, removal and repeated reconciliation converge without duplicates", async () => {
  const f = fixture();
  const source = [member("member@example.com")];
  const run = () => reconcileMemberSegments({ source, segments, provider: f.provider, apply: true });
  const first = await run();
  assert.equal(first.applied.creates, 1);
  assert.equal(f.contacts.size, 1);
  const contact = [...f.contacts.values()][0];
  assert.deepEqual([...contact.segments], ["waiting"]);
  assert.deepEqual(contact.topics, { general: "opt_out", store: "opt_out" });
  assert.deepEqual((await run()).applied, { creates: 0, additions: 0, removals: 0, nameUpdates: 0 });
  source[0].profile_open = true;
  const activation = await run();
  assert.equal(activation.applied.removals, 1);
  assert.equal(activation.applied.additions, 1);
  assert.deepEqual([...contact.segments], ["open"]);
  source[0].account_eligible = false;
  assert.equal((await run()).applied.removals, 1);
  assert.equal(contact.segments.size, 0);
  assert.equal(f.contacts.size, 1); // Never deletes provider consent history.
});

test("existing global unsubscribe, all topic preferences and unrelated segments survive", async () => {
  const topics = { general: "opt_out", store: "opt_in" };
  const f = fixture([{ id: "prior", email: "member@example.com", first_name: "Old", last_name: "Name",
    unsubscribed: true, topics, segments: new Set(["general"]) }]);
  const report = await reconcileMemberSegments({ source: [member("member@example.com")], segments, provider: f.provider, apply: true });
  assert.equal(report.providerUnsubscribed, 1);
  assert.equal(f.contacts.get("prior").unsubscribed, true);
  assert.deepEqual(f.contacts.get("prior").topics, topics);
  assert.deepEqual([...f.contacts.get("prior").segments].sort(), ["general", "waiting"]);
  assert.equal(f.calls.some(call => call[0] === "create"), false);
});

test("full pagination removes stale members beyond the first page", async () => {
  const f = fixture(Array.from({ length: 5 }, (_, i) => ({ id: `old-${i}`, email: `old${i}@example.com`, segments: new Set(["waiting"]) })));
  assert.equal((await listAllSegmentContacts(f.provider, "waiting")).length, 5);
  const result = await reconcileMemberSegments({ source: [], provider: f.provider, segments, apply: true });
  assert.equal(result.applied.removals, 5);
  for (const contact of f.contacts.values()) assert.equal(contact.segments.size, 0);
});

test("failed or looping pagination and wrong segment names stop before all mutations", async () => {
  for (const failure of ["repeat", "read", "name"]) {
    const f = fixture([{ id: "old", email: "old@example.com", segments: new Set(["waiting"]) }]);
    if (failure === "repeat") f.provider.listContacts = async () => ({ data: [...f.contacts.values()], has_more: true });
    if (failure === "read") f.provider.listContacts = async () => { throw new Error("failed page"); };
    if (failure === "name") f.provider.getSegment = async id => ({ id, name: "General" });
    await assert.rejects(reconcileMemberSegments({ source: [], provider: f.provider, segments, apply: true }));
    assert.deepEqual(f.calls, []);
  }
});

test("bounded batches defer work then converge on later runs", async () => {
  const f = fixture();
  const source = [member("one@example.com"), member("two@example.com"), member("three@example.com")];
  const run = () => reconcileMemberSegments({ source, provider: f.provider, segments, apply: true, maxNewContacts: 1, maxMutations: 2 });
  assert.equal((await run()).deferred, 2);
  assert.equal((await run()).deferred, 1);
  assert.equal((await run()).deferred, 0);
  assert.equal(f.contacts.size, 3);
  assert.deepEqual((await run()).applied, { creates: 0, additions: 0, removals: 0, nameUpdates: 0 });
});

test("concurrent creation is read back without changing subscription preferences", async () => {
  const f = fixture();
  f.provider.createContact = async input => {
    f.contacts.set("raced", { id: "raced", email: input.email, first_name: "Cherry", last_name: "Hill",
      unsubscribed: true, topics: { general: "opt_out", store: "opt_in" }, segments: new Set(["general"]) });
    throw new Error("already exists");
  };
  await reconcileMemberSegments({ source: [member("member@example.com")], provider: f.provider, segments, apply: true });
  assert.equal(f.contacts.get("raced").unsubscribed, true);
  assert.deepEqual(f.contacts.get("raced").topics, { general: "opt_out", store: "opt_in" });
  assert.deepEqual([...f.contacts.get("raced").segments], ["general", "waiting"]);
});

test("configuration defaults off and rejects reused segment IDs", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const env = { RESEND_API_KEY: "test", DATABASE_URL: "test", RESEND_MEMBER_WAITING_SEGMENT_ID: id, RESEND_MEMBER_PROFILES_OPEN_SEGMENT_ID: id };
  assert.equal(getMemberSegmentConfiguration(env).enabled, false);
  assert.equal(getMemberSegmentConfiguration(env).ready, false);
  env.RESEND_MEMBER_PROFILES_OPEN_SEGMENT_ID = "00000000-0000-4000-8000-000000000002";
  assert.equal(getMemberSegmentConfiguration(env).ready, true);
});

test("database selection verifies current identity and recognizes only live current couple funding", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema private;
      create table ruined_members(id text, person_id text, email_normalized text, deleted_at timestamptz);
      create table people(id text,status text);
      create table member_lifecycle(member_id text,account_state text,administrative_onboarding_state text,
        program_state text,standing_state text,cancellation_effective_at timestamptz,billing_state text);
      create table member_onboardings(member_id text,profile_completed_at timestamptz,state text);
      create table member_registration_access(member_id text,registered_at timestamptz,profile_activated_at timestamptz,
        completion_basis text,payment_setup_livemode boolean);
      create table person_private_profiles(person_id text,legal_name text);
      create table person_profiles(person_id text,display_name text);
      create table person_email_addresses(person_id text,email_normalized text,verification_state text,retired_at timestamptz);
      create table platform_users(person_id text,email_normalized text,status text,member_id text,auth_user_id text);
      create table platform_role_grants(auth_user_id text,role_slug text,revoked_at timestamptz);
      create table stripe_invoices(id text,member_id text,purpose text,stripe_status text,stripe_subscription_id text);
      create table stripe_webhook_events(object_id text,event_type text,livemode boolean,status text);
      create table stripe_subscriptions(id text,member_id text,stripe_status text,cancel_at timestamptz);
      create table membership_commercial_reservations(id text,payer_member_id text,kind text,status text,
        stripe_subscription_id text,created_at timestamptz);
      create table membership_commercial_participants(reservation_id text,member_id text);
      create table membership_enrollment_episodes(reservation_id text,member_id text,ended_at timestamptz);
      create table communication_contacts(email_normalized text,delivery_state text);
      create function private.ruined_member_registration_ready(text) returns boolean language sql as 'select true';
      create function private.ruined_member_has_complimentary_funding(text) returns boolean language sql as 'select false';
      create function private.ruined_member_has_operator_funding(text) returns boolean language sql as 'select false';
      insert into ruined_members values ('a','a','member@example.com',null);
      insert into people values ('a','active');
      insert into member_lifecycle values ('a','active','completed','onboarding','active',null,'pending');
      insert into member_onboardings values ('a',now(),'completed');
      insert into member_registration_access values ('a',now(),null,'saved_card',true);
      insert into person_private_profiles values ('a','Cherry Hill');
      insert into person_email_addresses values ('a','member@example.com','verified',null);
      insert into platform_users values ('a','member@example.com','active','a','a');
      insert into platform_role_grants values ('a','member',null);
    `);
    // Run the actual production shared-billing helpers, changing UUID to text
    // only to keep the small fixture's identifiers readable.
    const migration = await readFile(new URL("../db/migrations/20260929006000_membership_commercial_eligibility.sql", import.meta.url), "utf8");
    for (const name of ["ruined_member_has_couple_funding", "ruined_member_shared_billing_state"]) {
      const definition = migration.match(new RegExp(`create function private\\.${name}\\(target_member_id uuid\\)[\\s\\S]*?\\$\\$;`))?.[0];
      assert.ok(definition);
      await db.exec(definition.replace("target_member_id uuid", "target_member_id text"));
    }
    const sql = async strings => (await db.query(strings.join(""))).rows;
    assert.equal(classifyMemberSegment((await readMemberSegmentSource(sql))[0]), "waiting");
    await db.exec("update member_registration_access set payment_setup_livemode=false");
    assert.equal(classifyMemberSegment((await readMemberSegmentSource(sql))[0]), "test_or_unfunded");
    await db.exec("update person_email_addresses set retired_at=now()");
    assert.equal(classifyMemberSegment((await readMemberSegmentSource(sql))[0]), "unverified_identity");
    await db.exec(`
      update person_email_addresses set retired_at=null;
      update member_lifecycle set billing_state='active' where member_id='a';
      insert into ruined_members values ('b','b','partner@example.com',null);
      insert into people values ('b','active');
      insert into member_lifecycle values ('b','active','completed','onboarding','active',null,'pending');
      insert into member_onboardings values ('b',now(),'completed');
      insert into person_private_profiles values ('b','Partner Name');
      insert into person_email_addresses values ('b','partner@example.com','verified',null);
      insert into platform_users values ('b','partner@example.com','active','b','b');
      insert into platform_role_grants values ('b','member',null);
      insert into stripe_subscriptions values ('shared-subscription','a','active',null);
      insert into membership_commercial_reservations values ('couple','a','couple','activated','shared-subscription',now());
      insert into membership_commercial_participants values ('couple','a'),('couple','b');
      insert into stripe_invoices values ('invoice','a','membership','paid','shared-subscription');
      insert into stripe_webhook_events values ('invoice','invoice.paid',true,'processed');
    `);
    const partner = async () => (await readMemberSegmentSource(sql)).find(row => row.email === "partner@example.com");
    assert.equal(classifyMemberSegment(await partner()), "open", "second adult qualifies through the live payer invoice");
    await db.exec("update stripe_webhook_events set livemode=false");
    assert.equal(classifyMemberSegment(await partner()), "test_or_unfunded", "sandbox payer cannot qualify the second adult");
    await db.exec("update stripe_webhook_events set livemode=true; update stripe_invoices set stripe_subscription_id='unrelated-subscription'");
    assert.equal(classifyMemberSegment(await partner()), "test_or_unfunded", "payer invoice must belong to this shared subscription");
    await db.exec("update stripe_invoices set stripe_subscription_id='shared-subscription'; insert into membership_enrollment_episodes values ('couple','b',now())");
    assert.equal(classifyMemberSegment(await partner()), "test_or_unfunded", "ended shared enrollment cannot retain access");
  } finally { await db.close(); }
});
