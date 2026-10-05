import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OPPORTUNITY_CALLS,
  googleCalendarUrl,
} from "../src/data/opportunity-calls.ts";

const expectedCalls = [
  {
    id: "2026-10-06",
    dates: "20261007T000000Z/20261007T010000Z",
    meetUrl: "https://meet.google.com/ekx-qtsb-nqt",
  },
  {
    id: "2026-10-13",
    dates: "20261014T000000Z/20261014T010000Z",
    meetUrl: "https://meet.google.com/top-uaii-ofh",
  },
];

function calendarTimestamp(value: string): number {
  assert.match(value, /^\d{8}T\d{6}Z$/);
  return Date.parse(value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z",
  ));
}

test("opportunity calls retain the requested dates, Meet links, and Denver hours", () => {
  assert.equal(OPPORTUNITY_CALLS.length, expectedCalls.length);
  const denverTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  OPPORTUNITY_CALLS.forEach((call, index) => {
    const expected = expectedCalls[index];
    assert.equal(call.id, expected.id);
    assert.equal(call.meetUrl, expected.meetUrl);
    assert.equal(denverTime.format(new Date(call.startsAt)), `${call.dateLabel} at 6:00 PM`);
    assert.equal(denverTime.format(new Date(call.endsAt)), `${call.dateLabel} at 7:00 PM`);
    assert.equal(Date.parse(call.endsAt) - Date.parse(call.startsAt), 60 * 60 * 1000);
  });
});

test("Google event templates preserve UTC date rollover and the correct joining link", () => {
  OPPORTUNITY_CALLS.forEach((call, index) => {
    const url = new URL(googleCalendarUrl(call));
    assert.equal(url.origin, "https://calendar.google.com");
    assert.equal(url.pathname, "/calendar/r/eventedit");
    assert.equal(url.searchParams.get("action"), "TEMPLATE");
    assert.equal(url.searchParams.get("text"), "Ruined Opportunity Call");
    assert.equal(url.searchParams.get("dates"), expectedCalls[index].dates);
    assert.equal(url.searchParams.get("stz"), "America/Denver");
    assert.equal(url.searchParams.get("etz"), "America/Denver");
    assert.equal(url.searchParams.get("location"), expectedCalls[index].meetUrl);
    assert.ok(url.searchParams.get("details")?.includes(expectedCalls[index].meetUrl));
  });
});

test("downloadable calendar events match their call and use portable iCalendar syntax", async () => {
  const uids = new Set<string>();

  for (const call of OPPORTUNITY_CALLS) {
    const content = await readFile(new URL(`../public${call.calendarFile}`, import.meta.url), "utf8");
    assert.ok(content.endsWith("\r\n"), "calendar ends with CRLF");
    assert.doesNotMatch(content.replaceAll("\r\n", ""), /[\r\n]/, "only CRLF line endings");
    for (const line of content.split("\r\n")) {
      assert.ok(Buffer.byteLength(line, "utf8") <= 75, "lines are folded at 75 octets");
    }

    const lines = content.replace(/\r\n[ \t]/g, "").trimEnd().split("\r\n");
    assert.equal(lines[0], "BEGIN:VCALENDAR");
    assert.equal(lines.at(-1), "END:VCALENDAR");
    assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 1);
    assert.equal(lines.filter((line) => line === "END:VEVENT").length, 1);
    const fields = new Map(lines.map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));

    assert.equal(fields.get("VERSION"), "2.0");
    assert.ok(fields.get("PRODID"));
    assert.equal(fields.get("SUMMARY"), "Ruined Opportunity Call");
    assert.equal(calendarTimestamp(fields.get("DTSTART") ?? ""), Date.parse(call.startsAt));
    assert.equal(calendarTimestamp(fields.get("DTEND") ?? ""), Date.parse(call.endsAt));
    assert.ok(Number.isFinite(calendarTimestamp(fields.get("DTSTAMP") ?? "")));
    assert.equal(fields.get("LOCATION"), call.meetUrl);
    assert.equal(fields.get("URL"), call.meetUrl);
    assert.ok(fields.get("DESCRIPTION")?.includes(call.meetUrl));
    assert.equal(fields.has("ORGANIZER"), false);
    assert.equal(fields.has("ATTENDEE"), false);
    const uid = fields.get("UID");
    assert.ok(uid);
    assert.ok(!uids.has(uid), "each separate call has a distinct UID");
    uids.add(uid);
  }
});
