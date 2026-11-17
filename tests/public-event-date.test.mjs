import assert from "node:assert/strict";
import test from "node:test";
import { publicEventDateHasPassed, resolvePublicEventDate } from "../src/lib/events/public-event-date.ts";

const event = {
  id: "byob-04", title: "BYOB Nº 04", eyebrow: "Monthly gathering",
  date: "14 November 2026", dateTime: "2026-11-14T16:00:00Z", time: "9:00 AM MST",
  timezone: "America/Denver", location: "Details to come", admission: "",
  summary: "Bring Your Own (Bell or bodyweight). Location and registration details coming soon.",
  status: "Upcoming", registration: { href: "/community/byob-04/register", label: "Register", status: "Open" },
};

test("Mountain events stay on their event day until local midnight, not UTC midnight", () => {
  assert.equal(publicEventDateHasPassed(event, new Date("2026-11-15T06:59:59Z")), false);
  assert.equal(publicEventDateHasPassed(event, new Date("2026-11-15T07:00:00Z")), true);
  const summer = { ...event, dateTime: "2027-07-09T15:00:00Z" };
  assert.equal(publicEventDateHasPassed(summer, new Date("2027-07-10T05:59:59Z")), false);
  assert.equal(publicEventDateHasPassed(summer, new Date("2027-07-10T06:00:00Z")), true);
});

test("date-only listings retain their announced date even when their instant is UTC midnight", () => {
  const dateOnly = { ...event, dateOnly: true, dateTime: "2026-11-14T00:00:00Z" };
  assert.equal(publicEventDateHasPassed(dateOnly, new Date("2026-11-14T20:00:00Z")), false);
  assert.equal(publicEventDateHasPassed(dateOnly, new Date("2026-11-15T07:00:00Z")), true);
});

test("past events close registration and remove placeholder promises without changing source data", () => {
  const original = structuredClone(event);
  const resolved = resolvePublicEventDate(Object.freeze(event), new Date("2026-11-17T18:00:00Z"));
  assert.equal(resolved.status, "Ended");
  assert.equal(resolved.registration.status, "Closed");
  assert.equal(resolved.location, "");
  assert.equal(resolved.summary, "Bring Your Own (Bell or bodyweight).");
  assert.equal(resolved.dateTime, event.dateTime);
  assert.equal(resolved.time, "9:00 AM MST");
  assert.deepEqual(event, original);
});

test("operator-ended events never reopen, while future events preserve approved details", () => {
  const before = new Date("2026-11-01T18:00:00Z");
  assert.equal(resolvePublicEventDate({ ...event, status: "Ended" }, before).status, "Ended");
  assert.equal(resolvePublicEventDate({ ...event, status: "Ended" }, before).registration.status, "Closed");
  assert.equal(resolvePublicEventDate(event, before), event);
  const knownVenue = { ...event, location: "Tibble Fork Reservoir", summary: "A gathering in the mountains." };
  assert.equal(resolvePublicEventDate(knownVenue, new Date("2026-11-17T18:00:00Z")).location, knownVenue.location);
  assert.equal(resolvePublicEventDate(knownVenue, new Date("2026-11-17T18:00:00Z")).summary, knownVenue.summary);
});
