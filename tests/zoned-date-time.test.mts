import assert from "node:assert/strict";
import test from "node:test";

import {
  zonedDateTimeLocalToIso,
  zonedDateTimeLocalValue,
} from "../src/lib/datetime/zoned-date-time.ts";

test("Experience wall times round-trip in the selected IANA timezone", () => {
  assert.equal(
    zonedDateTimeLocalToIso("2026-09-03T18:30", "America/Denver"),
    "2026-09-04T00:30:00.000Z",
  );
  assert.equal(
    zonedDateTimeLocalValue("2026-09-04T00:30:00.000Z", "America/Denver"),
    "2026-09-03T18:30",
  );
});

test("the same wall clock resolves differently for an operator in another zone", () => {
  assert.equal(
    zonedDateTimeLocalToIso("2026-09-03T18:30", "America/New_York"),
    "2026-09-03T22:30:00.000Z",
  );
});

test("nonexistent daylight-saving wall times and invalid zones fail closed", () => {
  assert.throws(
    () => zonedDateTimeLocalToIso("2026-03-08T02:30", "America/Denver"),
    /does not exist/,
  );
  assert.throws(
    () => zonedDateTimeLocalToIso("2026-09-03T18:30", "Mountain/Invalid"),
    /valid IANA timezone/,
  );
});
