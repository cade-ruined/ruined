import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMBERSHIP_WAITLIST_SHEET_HEADERS,
  buildMembershipWaitlistSheetRow,
  membershipWaitlistSheetRowNumber,
  type CanonicalMembershipWaitlistEntry,
} from "../src/lib/membership/waitlist-sheet-model.ts";

const entry: CanonicalMembershipWaitlistEntry = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  name: "=1+1",
  email: "person@example.test",
  phone: "+1 303 555 0100",
  joinedAt: new Date("2026-09-14T18:00:00Z"),
  sheetRow: "2",
};

test("the waitlist has a six-column RAW projection and no general marketing fields", () => {
  assert.deepEqual([...MEMBERSHIP_WAITLIST_SHEET_HEADERS], [
    "Joined at", "Name", "Email", "Phone", "Status", "Waitlist ID",
  ]);
  assert.deepEqual(buildMembershipWaitlistSheetRow(entry), [
    "2026-09-14T18:00:00.000Z", "=1+1", "person@example.test",
    "+1 303 555 0100", "waiting", entry.id,
  ]);
  assert.equal(buildMembershipWaitlistSheetRow({ ...entry, phone: null })[3], "");
  assert.throws(() => buildMembershipWaitlistSheetRow({ ...entry, id: "invalid" }), /ID is invalid/);
  assert.throws(() => buildMembershipWaitlistSheetRow({ ...entry, joinedAt: new Date("invalid") }), /timestamp is invalid/);
});

test("allocated bigint rows are exact and bounded by the provisioned grid", () => {
  assert.equal(membershipWaitlistSheetRowNumber("2"), 2);
  assert.equal(membershipWaitlistSheetRowNumber(100_000), 100_000);
  for (const invalid of [1, 100_001, 1.5, Number.NaN, Infinity, "", "2e1", "2.0", " 2", "9007199254740993"]) {
    assert.throws(() => membershipWaitlistSheetRowNumber(invalid), /row is invalid/);
  }
});
