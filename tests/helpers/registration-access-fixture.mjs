import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Existing-member fixtures intentionally predate registration holds. Dedicated
// registration suites exercise enrollment, completion, redirects and delivery.
export const existingMemberRegistration = Object.freeze({
  enrollNewMemberRegistration: async () => {},
  completeMemberRegistration: async () => null,
  getMemberRegistrationDestination: async () => null,
});

// Historical intake fixtures have neither registration terms nor reminder
// choices. Dedicated consent suites exercise real ledger writes and policy
// checks; these boundaries reject accidental opt-ins in legacy scenarios.
export const existingMemberIntakeDependencies = Object.freeze({
  "./registration-legal": {
    recordRegistrationLegalAcknowledgment: async (_tx, _memberId, _actor, acknowledgment) => {
      assert.equal(acknowledgment, undefined, "Legacy intake must not invent legal acceptance");
    },
  },
  "./member-communication-preferences": {
    getMemberCommunicationPreferences: async () => ({ email: null, sms: null, smsPhone: null, revision: "legacy-fixture" }),
    saveMemberCommunicationPreferences: async (_tx, _member, preferences) => {
      assert.equal(preferences, undefined, "Legacy intake must not invent reminder choices");
    },
  },
});

export async function installRegistrationProfileReleaseFunction(db) {
  // Execute the shipped predicate against an empty hold table so unrelated
  // legacy fixtures retain access without replacing an authorization check.
  await db.exec(`create table if not exists public.member_registration_access (
    member_id uuid primary key, profile_activated_at timestamptz
  );`);
  const migration = await readFile(new URL("../../db/migrations/20260930140000_member_registration_access.sql", import.meta.url), "utf8");
  const start = migration.indexOf("create function private.ruined_member_profile_released(");
  const end = migration.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, "Missing shipped registration profile-release predicate");
  await db.exec(migration.slice(start, end + 3).replace("create function", "create or replace function"));
}

export async function installLegacyPaidActivationFunction(db) {
  // These partial-schema fixtures contain no registration evidence. Keep the
  // new-registration branch closed while executing the shipped activation
  // predicate for existing members; full migration suites test ready holds.
  await db.exec(`alter table public.member_registration_access add column if not exists registered_at timestamptz;
    create function private.ruined_member_registration_ready(uuid) returns boolean
      language sql stable as $$ select false $$;`);
  const migration = await readFile(new URL("../../db/migrations/20261005190000_membership_first_charge.sql", import.meta.url), "utf8");
  const start = migration.indexOf("create function private.ruined_member_paid_activation_ready(");
  const end = migration.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, "Missing shipped paid-activation predicate");
  await db.exec(migration.slice(start, end + 3));
}
