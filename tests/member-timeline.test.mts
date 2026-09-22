import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TIMELINE_EXAMPLES,
  EMPTY_TIMELINE_FORM,
  formatTimelineDate,
  filterTimelineEntries,
  groupTimelineEntries,
  formForTimelineEntry,
  fromMemberTimelineEntries,
  timelineFormIsDirty,
  restoreDeletedTimelineEntry,
  sortTimelineEntries,
  toTimelineSaveEntries,
  type TimelineDraftEntry,
} from "../src/components/membership/timeline-model.ts";

function entry(
  clientKey: string,
  year: number,
  createdOrder: number,
  overrides: Partial<TimelineDraftEntry> = {},
): TimelineDraftEntry {
  return {
    clientKey,
    createdOrder,
    details: "",
    id: `${clientKey}-id`,
    position: createdOrder,
    title: clientKey,
    year,
    ...overrides,
  };
}

test("Timeline events stay chronological with stable same-year ordering", () => {
  const sorted = sortTimelineEntries([
    entry("later", 2025, 1),
    entry("same-year-second", 2019, 3),
    entry("first", 2007, 4),
    entry("same-year-first", 2019, 2),
  ]);

  assert.deepEqual(
    sorted.map(({ clientKey, position }) => ({ clientKey, position })),
    [
      { clientKey: "first", position: 1 },
      { clientKey: "same-year-first", position: 2 },
      { clientKey: "same-year-second", position: 3 },
      { clientKey: "later", position: 4 },
    ],
  );
});

test("the API payload is compact, trimmed, and excludes client-only state", () => {
  const payload = toTimelineSaveEntries([
    entry("moment", 2023, 1, {
      details: "   ",
      id: null,
      title: "  A deliberate rebuild  ",
    }),
  ]);

  assert.deepEqual(payload, [
    {
      details: null,
      id: null,
      month: null,
      title: "A deliberate rebuild",
      year: 2023,
    },
  ]);
});

test("optional months sort within years without turning year-only memories into January", () => {
  const input = [entry("year-only", 2020, 1), entry("december", 2020, 2, { month: 12 }),
    entry("jan-first", 2020, 3, { month: 1 }), entry("jan-second", 2020, 4, { month: 1 }),
    entry("earlier-year", 2019, 5, { month: 12 })];
  const before = structuredClone(input);
  assert.deepEqual(sortTimelineEntries(input).map(e => e.clientKey), ["earlier-year", "jan-first", "jan-second", "december", "year-only"]);
  assert.deepEqual(input, before);
  assert.equal(formatTimelineDate(input[0]!), "2020");
  assert.equal(formatTimelineDate(input[1]!), "Dec 2020");
  assert.equal(formatTimelineDate({ year: 2020, month: 9 }, true), "September 2020");
});

test("reading filters search saved titles, details and dates without changing source entries", () => {
  const input = [
    entry("new-city", 2020, 1, { title: "A New City", month: 9, details: "A patient restart." }),
    entry("new-work", 2021, 2, { title: "New work", month: 2, details: "Room to begin." }),
    entry("year-only", 2020, 3, { title: "A quiet year" }),
  ];
  const original = structuredClone(input);
  const keys = (query: string, year = "") => filterTimelineEntries(input, query, year, "oldest").map(value => value.clientKey);
  assert.deepEqual(keys("  NEW  "), ["new-city", "new-work"]);
  assert.deepEqual(keys("PATIENT"), ["new-city"]);
  assert.deepEqual(keys("September 2020"), ["new-city"]);
  assert.deepEqual(keys("new", "2021"), ["new-work"]);
  assert.deepEqual(keys("", "2020"), ["new-city", "year-only"]);
  assert.deepEqual(keys("new", "2018"), []);
  assert.deepEqual(input, original);
});

test("timeline exports retain exact days while keeping unknown days and months unspecified", () => {
  const entries = [entry("month-only", 2020, 1, { month: 9 }),
    entry("later-day", 2020, 2, { month: 9, day: 21 }),
    entry("year-only", 2020, 3), entry("earlier-day", 2020, 4, { month: 9, day: 3 })];
  assert.deepEqual(sortTimelineEntries(entries).map(value => value.clientKey),
    ["earlier-day", "later-day", "month-only", "year-only"]);
  assert.equal(formatTimelineDate(entries[1]!), "Sep 21, 2020");
  assert.equal(formatTimelineDate(entries[0]!), "Sep 2020");
  assert.equal(formatTimelineDate(entries[2]!), "2020");
});

test("oldest and newest reading orders keep year-only dates last and same-date moments stable", () => {
  const input = [
    entry("unknown-2021", 2021, 1), entry("jan-later", 2021, 5, { month: 1 }),
    entry("december", 2021, 2, { month: 12 }), entry("jan-earlier", 2021, 3, { month: 1 }),
    entry("old-year", 2019, 6), entry("old-month", 2019, 7, { month: 9 }),
  ];
  assert.deepEqual(filterTimelineEntries(input, "", "", "oldest").map(value => value.clientKey), ["old-month", "old-year", "jan-earlier", "jan-later", "december", "unknown-2021"]);
  assert.deepEqual(filterTimelineEntries(input, "", "", "newest").map(value => value.clientKey), ["december", "jan-earlier", "jan-later", "unknown-2021", "old-month", "old-year"]);
});

test("year grouping preserves the reader's chosen order and every individual moment", () => {
  const input = [entry("early", 2019, 1), entry("later-a", 2021, 2, { month: 2 }), entry("later-b", 2021, 3)];
  assert.deepEqual(groupTimelineEntries([]), []);
  for (const order of ["oldest", "newest"] as const) {
    const sorted = filterTimelineEntries(input, "", "", order), before = structuredClone(sorted);
    const groups = groupTimelineEntries(sorted);
    assert.deepEqual(groups.map(group => group.year), order === "oldest" ? [2019, 2021] : [2021, 2019]);
    assert.deepEqual(groups.flatMap(group => group.entries), sorted);
    assert.equal(groups.find(group => group.year === 2021)!.entries.length, 2);
    assert.deepEqual(sorted, before);
  }
});

test("month survives edit, save, load and undo; changing only the month marks the form dirty", () => {
  const saved = entry("saved", 2020, 1, { month: 9 });
  const form = formForTimelineEntry(saved);
  assert.equal(form.month, "9");
  assert.equal(timelineFormIsDirty(form, { ...form, month: "8" }), true);
  assert.equal(timelineFormIsDirty({ ...form, month: "" }, form), true);
  assert.equal(timelineFormIsDirty(EMPTY_TIMELINE_FORM, { ...EMPTY_TIMELINE_FORM }), false);
  const payload = toTimelineSaveEntries([saved])[0]!;
  assert.equal(payload.month, 9);
  const loaded = fromMemberTimelineEntries([{ ...payload, id: "saved-id", position: 1 }])[0]!;
  assert.equal(formForTimelineEntry(loaded).month, "9");
  assert.equal(restoreDeletedTimelineEntry(loaded).month, 9);
  assert.equal(toTimelineSaveEntries([{ ...loaded, month: null }])[0]!.month, null);
  assert.equal(formForTimelineEntry(entry("legacy", 2019, 1)).month, "");
});

test("undo reinserts a soft-deleted event instead of trying to revive its immutable row", () => {
  const removed = entry("removed", 2021, 1);
  const restored = restoreDeletedTimelineEntry(removed);

  assert.equal(restored.clientKey, removed.clientKey);
  assert.equal(restored.id, null);
  assert.equal(removed.id, "removed-id");
});

test("approved examples remain presentation-only and in chronological order", () => {
  assert.deepEqual(
    TIMELINE_EXAMPLES.map(({ id, title, year }) => ({ id, title, year })),
    [
      { id: null, title: "Moved somewhere new", year: 2007 },
      { id: null, title: "Finished school", year: 2014 },
      { id: null, title: "The work changed suddenly", year: 2019 },
      { id: null, title: "Started building differently", year: 2025 },
    ],
  );
});

test("existing Timeline navigation opens the unified Journal profile", async () => {
  const [navigation, home, page, repository] = await Promise.all([
    readFile(new URL("../src/lib/membership/navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/platform/MemberHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/my/foundations/timeline/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/membership/repository.ts", import.meta.url), "utf8"),
  ]);

  assert.match(navigation, /href: "\/my\/foundations\/timeline", label: "My Timeline"/);
  assert.match(home, /"journal","saved","about"/);
  assert.match(page, /redirect\("\/my#timeline"\)/);
  assert.match(repository, /title: "Build My Timeline\."/);
});

test("the timeline retains its private member API and existing downloadable export pipeline", async () => {
  const [component, exportStudio, page, persistence] = await Promise.all([
    readFile(new URL("../src/components/membership/RuinedTimeline.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/membership/TimelineExportStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/my/foundations/timeline/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/membership/timeline-persistence.ts", import.meta.url), "utf8"),
  ]);

  assert.match(persistence, /fetch\("\/api\/my\/timeline"/);
  assert.match(component, /<TimelineExportStudio entries=\{sortedEntries\} examples=\{examples\}/);
  assert.doesNotMatch(component, /InkRoadTimeline|GENERATED VIEW|living timeline/);
  assert.match(exportStudio, /Photo generator/);
  assert.match(exportStudio, /role="radiogroup"/);
  assert.match(exportStudio, /onKeyDown=\{\(event\) => moveBetweenFormats\(event, index\)\}/);
  assert.match(exportStudio, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(exportStudio, /aria-live="polite"/);
  assert.match(exportStudio, /Prepare PNG/);
  assert.match(exportStudio, /`Prepare \$\{pages\.length\} images`/);
  assert.match(exportStudio, /for \(const artworkPage of pages\)/);
  assert.match(exportStudio, /prepared\.map\(\(artwork\) =>/);
  assert.match(exportStudio, /download=\{artwork\.filename\}/);
  assert.match(exportStudio, /Download image/);
  assert.match(exportStudio, /aria-busy=\{preparing\}/);
  assert.match(exportStudio, /aria-atomic="true"/);
  assert.match(exportStudio, /preparedRef\.current !== nextPrepared/);
  assert.doesNotMatch(exportStudio, /html2canvas|dom-to-image|foreignObject/i);
  assert.doesNotMatch(component, /localStorage|sessionStorage|<iframe/i);
  assert.match(page, /redirect\("\/my#timeline"\)/);
});
