import assert from "node:assert/strict";
import test from "node:test";
import { scoreCirclePlacement, validateCirclePreferences } from "../src/lib/platform/circle-placement-model.ts";
const preferences = { timezone: "America/Denver", availability: ["1:evening"], preferredConnectionId: null };
const now = new Date("2026-09-29T12:00:00Z");
test("preferences validate real time zones, bounded weekly windows and private connection identifiers", () => {
  assert.deepEqual(validateCirclePreferences({ ...preferences, availability: ["1:evening", "1:evening"] }).availability, ["1:evening"]);
  for (const input of [null, [], { ...preferences, timezone: "Mountainish" }, { ...preferences, availability: ["9:evening"] }, { ...preferences, availability: ["1:whenever"] }, { ...preferences, preferredConnectionId: "somebody@example.com" }]) assert.throws(() => validateCirclePreferences(input));
});
test("availability comparison respects date crossing and current time-zone offsets, without private profile inference", () => {
  const results = scoreCirclePlacement(preferences, [
    { circleId: "local", name: "Local", activeMembers: 8, connectionPresent: false, participantPreferences: [preferences] },
    { circleId: "remote", name: "Remote", activeMembers: 8, connectionPresent: false, participantPreferences: [{ timezone: "UTC", availability: ["2:morning"], preferredConnectionId: null }] },
    { circleId: "empty", name: "Unknown", activeMembers: 8, connectionPresent: false, participantPreferences: [] },
  ], now);
  assert.equal(results[0].circleId, "local");
  assert.match(results[0].reasons.join(" "), /overlaps with 1 of 1/);
  assert.match(results.find(item => item.circleId === "remote")!.reasons.join(" "), /overlaps with 0 of 1/);
  assert.match(results.find(item => item.circleId === "empty")!.reasons.join(" "), /not yet recorded/);
});
test("target 10 is soft, 12 needs review for the next arrival, connections never auto-assign", () => {
  const results = scoreCirclePlacement(preferences, [10, 11, 12, 15].map(count => ({ circleId: String(count), name: `Circle ${count}`, activeMembers: count, connectionPresent: true, participantPreferences: [] })), now);
  assert.equal(results.find(item => item.activeMembers === 11)!.exceptionRequired, false);
  assert.equal(results.find(item => item.activeMembers === 12)!.exceptionRequired, true);
  assert.equal(results.find(item => item.activeMembers === 15)!.exceptionRequired, true);
  assert.match(results[0].reasons.join(" "), /not guaranteed/);
  assert.equal(results.length, 4, "large Circles remain candidates for human review");
});
test("legacy invalid or absent timezones never fail the recommendation directory", () => {
  assert.doesNotThrow(() => scoreCirclePlacement({ ...preferences, timezone: "unknown" }, [{ circleId: "one", name: "One", activeMembers: 4, connectionPresent: false, participantPreferences: [{ ...preferences, timezone: "invalid" }] }]));
});
