import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TIMELINE_EXAMPLES,
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
      title: "A deliberate rebuild",
      year: 2023,
    },
  ]);
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

test("the production port uses the member API, accessible controls, and no iframe or local storage", async () => {
  const [component, exportStudio, page, repository, timelineStyles, persistence] = await Promise.all([
    readFile(new URL("../src/components/membership/RuinedTimeline.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/membership/TimelineExportStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/my/foundations/timeline/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/membership/repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/membership/ruined-timeline.module.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/membership/timeline-persistence.ts", import.meta.url), "utf8"),
  ]);

  assert.match(persistence, /fetch\("\/api\/my\/timeline"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /aria-describedby=\{errorField/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /event\.key === "Escape" && !pending/);
  assert.equal((component.match(/readOnly=\{Boolean\(pending\) \|\| \(!writable && !preview\)\}/g) ?? []).length, 3,
    "All draft fields must freeze during a pending save so its response cannot discard newer typing");
  assert.match(component, /7000/);
  assert.match(component, /<TimelineExportStudio entries=\{sortedEntries\} examples=\{examples\}/);
  assert.match(component, /Add an event/);
  assert.match(component, /Your events/);
  assert.match(component, /aria-controls=\{listContentId\}/);
  assert.match(component, /aria-expanded=\{listExpanded\}/);
  assert.match(component, /hidden=\{!listExpanded\}/);
  assert.match(component, /Collapse list/);
  assert.match(component, /Expand list/);
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
  assert.match(timelineStyles, /\.app\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?\}/);
  assert.match(timelineStyles, /\.indexItem\s*\{[\s\S]*?background: transparent;[\s\S]*?\}/);
  assert.match(timelineStyles, /\.exportStudio\s*\{[\s\S]*?background: transparent;[\s\S]*?\}/);
  assert.match(timelineStyles, /\.exportRail\s*\{[\s\S]*?background: transparent;[\s\S]*?\}/);
  assert.match(page, /preview=\{context\.state === "preview"\}/);
  assert.match(repository, /order by entry\.entry_year, entry\.position, entry\.created_at, entry\.id/);
});
