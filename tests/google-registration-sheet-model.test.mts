import assert from "node:assert/strict";
import test from "node:test";

import {
  REGISTRATION_ID_COLUMN_INDEX,
  REGISTRATION_SHEET_HEADERS,
  REGISTRATION_SHEET_TIME_ZONE,
  buildRegistrationSheetRow,
  findRegistrationSheetRowNumber,
  type CanonicalRegistration,
} from "../src/lib/events/registration-sheet-model.ts";

const REGISTRATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_REGISTRATION_ID = "7b4371de-caba-4c66-aeec-62f249762880";

function registration(
  overrides: Partial<CanonicalRegistration> = {},
): CanonicalRegistration {
  return {
    email: "person@example.com",
    eventKey: "byob-02",
    firstName: "Cade",
    id: REGISTRATION_ID,
    instagram: "ruined",
    lastName: "Mangelson",
    registeredAt: new Date("2026-08-24T18:00:00.000Z"),
    registrantName: "Cade Mangelson",
    status: "registered",
    waiverAcceptedAt: new Date("2026-01-15T15:30:00.000Z"),
    waiverVersion: "byob-02-risk-acknowledgment-v3",
    ...overrides,
  };
}

test("the pure row model preserves the exact A:I contract with Mountain wall-time serials", () => {
  assert.equal(REGISTRATION_SHEET_TIME_ZONE, "America/Denver");
  assert.equal(REGISTRATION_ID_COLUMN_INDEX, 8);
  assert.deepEqual([...REGISTRATION_SHEET_HEADERS], [
    "Registered at",
    "First name",
    "Last name",
    "Email",
    "Instagram",
    "Status",
    "Waiver accepted",
    "Waiver version",
    "Registration ID",
  ]);

  const row = buildRegistrationSheetRow(registration());
  assert.equal(row.length, 9);
  assert.ok(Math.abs(row[0] - 46_258.5) < 1e-9, "August UTC input should render as Denver MDT noon");
  assert.deepEqual(row.slice(1, 6), [
    "Cade",
    "Mangelson",
    "person@example.com",
    "ruined",
    "registered",
  ]);
  assert.ok(
    Math.abs(row[6] - 46_037.35416666667) < 1e-9,
    "January UTC input should render as Denver MST 08:30",
  );
  assert.deepEqual(row.slice(7), [
    "byob-02-risk-acknowledgment-v3",
    REGISTRATION_ID,
  ]);
});

test("RAW-safe row projection preserves strings and uses restrained legacy fallbacks", () => {
  const row = buildRegistrationSheetRow(registration({
    firstName: "=1+1",
    instagram: null,
    lastName: null,
  }));
  assert.equal(row[1], "=1+1", "RAW transport—not string mutation—must prevent formula evaluation");
  assert.equal(row[2], "");
  assert.equal(row[4], "");

  const legacy = buildRegistrationSheetRow(registration({
    firstName: null,
    lastName: null,
    registrantName: "Legacy Registrant",
  }));
  assert.equal(legacy[1], "Legacy Registrant");
  assert.equal(legacy[2], "");
});

test("UUID lookup chooses one existing row and never uses email as identity", () => {
  assert.equal(
    findRegistrationSheetRowNumber(
      [[], ["not-an-id"], [REGISTRATION_ID.toUpperCase()]],
      REGISTRATION_ID,
    ),
    4,
  );
  assert.equal(
    findRegistrationSheetRowNumber([[OTHER_REGISTRATION_ID]], REGISTRATION_ID),
    null,
  );
  assert.equal(findRegistrationSheetRowNumber([], REGISTRATION_ID), null);
  assert.throws(
    () => findRegistrationSheetRowNumber(
      [[REGISTRATION_ID], [REGISTRATION_ID.toUpperCase()]],
      REGISTRATION_ID,
    ),
    /duplicate registration ID/i,
  );
});

test("invalid canonical identifiers and timestamps fail closed", () => {
  assert.throws(
    () => buildRegistrationSheetRow(registration({ id: "person@example.com" })),
    /registration ID is invalid/i,
  );
  assert.throws(
    () => buildRegistrationSheetRow(registration({ registeredAt: new Date("invalid") })),
    /timestamp is invalid/i,
  );
  assert.throws(
    () => findRegistrationSheetRowNumber([], "not-a-registration-id"),
    /registration ID is invalid/i,
  );
});
