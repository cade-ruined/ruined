import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const actor = "00000000-0000-4000-8000-000000000099";
const member = "00000000-0000-4000-8000-000000000101";
const otherMember = "00000000-0000-4000-8000-000000000102";

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  // Only the roster's unrelated profile/payment dependencies are simplified.
  // The shipped administrator guard, invitation SQL, selection and serialization run in Postgres.
  await db.exec(`
    create schema private;
    create table platform_users(auth_user_id uuid primary key, status text);
    create table platform_role_grants(auth_user_id uuid, role_slug text, revoked_at timestamptz);
    create table ruined_members(id uuid primary key, person_id uuid, email text, deleted_at timestamptz);
    create table member_registration_access(member_id uuid primary key, registered_at timestamptz,
      profile_activated_at timestamptz, requires_initial_payment boolean default false,
      completion_basis text, version integer default 1, created_at timestamptz default statement_timestamp());
    create table member_registration_pricing_decisions(member_id uuid, decided_at timestamptz,
      monthly_amount_cents integer, annual_amount_cents integer, currency text);
    create table member_lifecycle(member_id uuid, account_state text);
    create table member_onboardings(member_id uuid, profile_completed_at timestamptz);
    create table person_private_profiles(person_id uuid, legal_name text, birth_date date, default_fulfillment_address jsonb);
    create table person_profiles(person_id uuid, display_name text);
    create table member_registration_messages(member_id uuid, kind text, status text);
    create table member_registration_couple_intents(member_id uuid, partner_email_normalized text);
    create table member_referrals(personal_invitation_id uuid unique, referred_member_id uuid);
    create table member_personal_invitations(id uuid primary key, recipient_name text, recipient_email_normalized text,
      inviter_name text, issued_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
      submitted_at timestamptz, accepted_at timestamptz, accepted_member_id uuid,
      email_requested boolean, delivery_status text, sent_at timestamptz, origin text, membership_type text,
      public_token text, delivery_payload jsonb);
    create function private.ruined_registration_founding_pricing_is_current(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_member_has_complimentary_funding(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_member_has_operator_funding(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_registration_legal_complete(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_registration_intake_eligibility_error(date,text) returns text language sql as $$select null::text$$;
    create function private.ruined_member_registration_ready(uuid) returns boolean language sql as $$select false$$;
    create function private.ruined_registration_circle_couple_partner(uuid) returns uuid language sql as $$select null::uuid$$;
  `);
  await db.query("insert into platform_users values ($1,'active');", [actor]);
  await db.query("insert into platform_role_grants values ($1,'ops_admin',null)", [actor]);
  await db.query("insert into ruined_members values ($1,$1,'  Person@Example.Test  ',null)", [member]);
  await db.query("insert into member_registration_access(member_id) values ($1)", [member]);
  await db.query("insert into member_lifecycle values ($1,'pending')", [member]);
  const queries = [];
  const sqlFor = engine => {
    const sql = async (strings, ...values) => {
      const query = strings.reduce((result, part, index) => result + (index ? `$${index}` : "") + part, "");
      queries.push(query);
      // Progress is independently exercised by the full registration suite.
      if (query.includes("where member.id=any(")) return [];
      return (await engine.query(query, values)).rows;
    };
    sql.begin = callback => engine.transaction(tx => callback(sqlFor(tx)));
    return sql;
  };
  const source = readFileSync(new URL("../src/lib/membership/registration-repository.ts", import.meta.url), "utf8");
  const loaded = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = {
    "server-only": {},
    "@/lib/database/server": { getApplicationDatabase: () => sqlFor(db) },
    "@/lib/platform/config": { getPlatformConfiguration: () => ({}) },
    "./registration-routing": { memberRegistrationDestination() { throw Error("Unrelated route read"); } },
  };
  new Function("require", "module", "exports", code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  const invite = async (changes = {}) => {
    const value = {
      id: randomUUID(), recipient_name: "Invitation name", recipient_email_normalized: "person@example.test",
      inviter_name: "Inviter name", issued_at: "2026-01-01T12:00:00Z", expires_at: "2099-01-01T12:00:00Z",
      revoked_at: null, submitted_at: null, accepted_at: null, accepted_member_id: null,
      email_requested: false, delivery_status: "not_requested", sent_at: null, origin: "member", membership_type: "standard",
      public_token: "secret-do-not-return", delivery_payload: { private: "secret-email-body" }, ...changes,
    };
    const names = Object.keys(value);
    await db.query(`insert into member_personal_invitations(${names.join(",")}) values (${names.map((_, index) => `$${index + 1}`).join(",")})`,
      Object.values(value).map(value => value && typeof value === "object" ? JSON.stringify(value) : value));
    return value;
  };
  return { db, queries, invite, read: () => loaded.exports.getOpsMemberRegistrations(actor),
    clear: () => db.exec("truncate member_personal_invitations,member_referrals") };
}

test("registration invitation metadata uses verified attribution and remains administrator-only", async t => {
  const f = await fixture(t);
  await t.test("an accepted invitation survives a changed email and outranks a newer email match", async () => {
    const accepted = await f.invite({ recipient_email_normalized: "old@example.test", accepted_member_id: member,
      accepted_at: "2026-01-02T12:00:00Z", expires_at: "2026-01-03T12:00:00Z", email_requested: true,
      delivery_status: "sent", sent_at: "2026-01-01T12:01:00Z" });
    await f.invite({ issued_at: "2026-02-01T12:00:00Z" });
    const [row] = await f.read();
    assert.equal(row.invitation.id, accepted.id);
    assert.equal(row.invitation.recipientName, "Invitation name");
    assert.equal(row.invitation.inviterName, "Inviter name");
    assert.equal(row.invitation.emailRequested, true);
    assert.equal(row.invitation.deliveryStatus, "sent");
    assert.equal(new Date(row.invitation.acceptedAt).toISOString(), "2026-01-02T12:00:00.000Z");
    assert.deepEqual(Object.keys(row.invitation).sort(), ["id", "recipientName", "recipientEmail", "inviterName", "issuedAt",
      "expiresAt", "revokedAt", "submittedAt", "acceptedAt", "emailRequested", "deliveryStatus", "sentAt", "origin", "membershipType"].sort());
    assert.doesNotMatch(JSON.stringify(row), /secret-do-not-return|secret-email-body|public_token|delivery_payload/);
  });
  await t.test("a bound referral beats an email-only match even before acceptance", async () => {
    await f.clear();
    const bound = await f.invite({ recipient_email_normalized: "old@example.test" });
    await f.db.query("insert into member_referrals values($1,$2)", [bound.id, member]);
    await f.invite({ issued_at: "2026-02-01T12:00:00Z" });
    assert.equal((await f.read())[0].invitation.id, bound.id);
  });
  await t.test("email fallback normalizes the member mailbox and cannot claim another member's accepted or bound invitation", async () => {
    await f.clear();
    await f.invite({ recipient_email_normalized: "xperson@example.test" });
    await f.invite({ accepted_member_id: otherMember, accepted_at: "2026-02-01T12:00:00Z" });
    const boundElsewhere = await f.invite();
    await f.db.query("insert into member_referrals values($1,$2)", [boundElsewhere.id, otherMember]);
    assert.equal((await f.read())[0].invitation, null);
    const exact = await f.invite({ origin: "ruined_direct", inviter_name: "Ruined", delivery_status: "queued", email_requested: true });
    const invitation = (await f.read())[0].invitation;
    assert.equal(invitation.id, exact.id);
    assert.equal(invitation.origin, "ruined_direct");
    assert.equal(invitation.inviterName, "Ruined");
    assert.equal(invitation.acceptedAt, null);
    assert.equal(invitation.deliveryStatus, "queued");
  });
  await t.test("duplicates prefer usable invitations and choose deterministic latest issue and ID", async () => {
    await f.clear();
    await f.invite({ issued_at: "2026-04-01T12:00:00Z", revoked_at: "2026-04-02T12:00:00Z" });
    await f.invite({ issued_at: "2026-03-01T12:00:00Z", expires_at: "2026-03-02T12:00:00Z" });
    await f.invite({ id: "00000000-0000-4000-8000-000000000011", issued_at: "2026-02-01T12:00:00Z" });
    const chosen = await f.invite({ id: "00000000-0000-4000-8000-000000000012", issued_at: "2026-02-01T12:00:00Z", membership_type: "complimentary" });
    await f.invite({ issued_at: "2026-01-01T12:00:00Z" });
    for (let i = 0; i < 2; i++) {
      const rows = await f.read();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].invitation.id, chosen.id);
      assert.equal(rows[0].invitation.membershipType, "complimentary");
    }
  });
  await t.test("a registration with no invitation stays in the roster with null details", async () => {
    await f.clear();
    const [row] = await f.read();
    assert.equal(row.memberId, member);
    assert.equal(row.invitation, null);
    assert.ok(f.queries.every(query => /^\s*select\b/i.test(query)), "Reading invitations must never mutate records or send email");
  });
  await t.test("revoked administrators and inactive identities are rejected before invitation records are read", async () => {
    await f.invite();
    await f.db.query("update platform_role_grants set revoked_at=statement_timestamp() where auth_user_id=$1", [actor]);
    let before = f.queries.length;
    await assert.rejects(f.read, error => error.status === 403);
    assert.equal(f.queries.length, before + 1);
    assert.doesNotMatch(f.queries.at(-1), /member_personal_invitations/);
    await f.db.query("update platform_role_grants set revoked_at=null where auth_user_id=$1", [actor]);
    await f.db.query("update platform_users set status='suspended' where auth_user_id=$1", [actor]);
    before = f.queries.length;
    await assert.rejects(f.read, error => error.status === 403);
    assert.equal(f.queries.length, before + 1);
  });
});
