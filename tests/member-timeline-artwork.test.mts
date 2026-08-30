import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TIMELINE_ARTWORK_FORMATS,
  buildTimelineArtworkLayout,
  paginateTimelineArtwork,
  timelineArtworkFilename,
  timelineArtworkSeed,
} from "../src/components/membership/timeline-artwork.ts";
import type { TimelineDraftEntry } from "../src/components/membership/timeline-model.ts";

function entry(index: number, overrides: Partial<TimelineDraftEntry> = {}): TimelineDraftEntry {
  return {
    clientKey: `moment-${index}`,
    createdOrder: index,
    details: `Detail for moment ${index}.`,
    id: null,
    position: index,
    title: `Moment ${index}`,
    year: 1970 + index,
    ...overrides,
  };
}

test("Timeline artwork formats use exact high-resolution social and presentation dimensions", () => {
  assert.deepEqual(
    TIMELINE_ARTWORK_FORMATS.map(({ height, id, width }) => ({ height, id, width })),
    [
      { height: 2700, id: "carousel", width: 2160 },
      { height: 2160, id: "presentation", width: 3840 },
      { height: 2160, id: "square", width: 2160 },
      { height: 3840, id: "story", width: 2160 },
    ],
  );
});

test("fixed artwork frames paginate a fifty-event life without dropping or duplicating moments", () => {
  const entries = Array.from({ length: 50 }, (_, index) => entry(index + 1));
  for (const format of TIMELINE_ARTWORK_FORMATS) {
    const pages = paginateTimelineArtwork(entries.toReversed(), format);
    assert.equal(pages.length, Math.ceil(entries.length / format.eventsPerPage));
    assert.deepEqual(
      pages.flatMap((page) => page.entries.map(({ clientKey }) => clientKey)),
      entries.map(({ clientKey }) => clientKey),
    );
    assert.ok(pages.every((page) => page.entries.length <= format.eventsPerPage));
  }
});

test("carousel pages form one horizontal edge-connected Timeline", () => {
  const format = TIMELINE_ARTWORK_FORMATS[0]!;
  const entries = Array.from({ length: 9 }, (_, index) => entry(index + 1));
  const pages = paginateTimelineArtwork(entries, format);

  assert.equal(format.eventsPerPage, 4);
  assert.equal(pages.length, 3);

  const layouts = pages.map((page) =>
    buildTimelineArtworkLayout({
      entries: page.entries,
      format,
      pageIndex: page.index,
      sequenceEntries: entries,
    }),
  );

  for (const layout of layouts) {
    assert.equal(layout.flow, "horizontal");
    assert.ok(
      layout.events.every(
        ({ labelSide }) => labelSide === "above" || labelSide === "below",
      ),
    );
    const entry = layout.pathControls.find(({ x }) => x === 0);
    const exit = layout.pathControls.find(({ x }) => x === format.width);
    assert.deepEqual(entry, { x: 0, y: layout.headerY });
    assert.deepEqual(exit, { x: format.width, y: layout.footerY });
    assert.equal(layout.seed, layouts[0]!.seed);
    const sameLanePairs = layout.events.flatMap((event, eventIndex) =>
      layout.events
        .slice(eventIndex + 1)
        .filter(({ labelSide }) => labelSide === event.labelSide)
        .map((other) => [event, other] as const),
    );
    for (const [left, right] of sameLanePairs) {
      assert.ok(
        left.labelX + left.labelWidth <= right.labelX ||
          right.labelX + right.labelWidth <= left.labelX,
      );
    }
  }

  for (let index = 0; index < layouts.length - 1; index += 1) {
    assert.equal(layouts[index]!.footerY, layouts[index + 1]!.headerY);
    assert.deepEqual(
      layouts[index]!.pathControls.map(({ x, y }) => ({
        x: x - format.width,
        y,
      })),
      layouts[index + 1]!.pathControls,
    );
    assert.deepEqual(
      layouts[index]!.inkPoints.map(({ x, y }) => ({
        x: x - format.width,
        y,
      })),
      layouts[index + 1]!.inkPoints,
    );
  }
});

test("carousel pagination balances the final slides instead of leaving an orphan", () => {
  const format = TIMELINE_ARTWORK_FORMATS[0]!;
  const pageSizes = (count: number) =>
    paginateTimelineArtwork(
      Array.from({ length: count }, (_, index) => entry(index + 1)),
      format,
    ).map(({ entries }) => entries.length);

  assert.deepEqual(pageSizes(5), [3, 2]);
  assert.deepEqual(pageSizes(9), [3, 3, 3]);
  assert.deepEqual(pageSizes(10), [4, 3, 3]);
});

test("ink geometry is deterministic and copy edits do not redraw the road", () => {
  const format = TIMELINE_ARTWORK_FORMATS[0]!;
  const entries = [entry(1), entry(2), entry(3)];
  const copyEdited = entries.map((moment, index) =>
    index === 1 ? { ...moment, details: "Rewritten detail.", title: "A better title" } : moment,
  );
  const moved = entries.map((moment, index) =>
    index === 1 ? { ...moment, year: moment.year + 2 } : moment,
  );

  assert.equal(
    timelineArtworkSeed(entries, format.id, 0),
    timelineArtworkSeed(copyEdited, format.id, 0),
  );
  assert.notEqual(
    timelineArtworkSeed(entries, format.id, 0),
    timelineArtworkSeed(moved, format.id, 0),
  );
  assert.deepEqual(
    buildTimelineArtworkLayout({ entries, format, pageIndex: 0 }),
    buildTimelineArtworkLayout({ entries, format, pageIndex: 0 }),
  );
});

test("artwork labels and ink controls stay inside the safe composition", () => {
  for (const format of TIMELINE_ARTWORK_FORMATS) {
    const entries = Array.from({ length: format.eventsPerPage }, (_, index) => entry(index + 1));
    const layout = buildTimelineArtworkLayout({ entries, format, pageIndex: 0 });
    assert.equal(
      layout.flow,
      format.id === "carousel" ? "horizontal" : "vertical",
    );
    for (const event of layout.events) {
      assert.ok(event.labelX >= layout.marginX);
      assert.ok(event.labelX + event.labelWidth <= format.width - layout.marginX);
      assert.ok(
        event.point.x >=
          format.width * (format.id === "carousel" ? 0.14 : 0.3),
      );
      assert.ok(
        event.point.x <=
          format.width * (format.id === "carousel" ? 0.86 : 0.7),
      );
      assert.ok(event.point.y > 0 && event.point.y < format.height);
    }
    assert.ok(layout.pathControls.every(({ y }) => y > 0 && y < format.height));
    if (format.id !== "carousel") {
      assert.ok(
        layout.pathControls.every(({ x }) => x > 0 && x < format.width),
      );
    }
  }
});

test("artwork filenames identify format, time span, and sequence page", () => {
  const entries = Array.from({ length: 8 }, (_, index) => entry(index + 1));
  const format = TIMELINE_ARTWORK_FORMATS[0]!;
  const pages = paginateTimelineArtwork(entries, format);
  assert.equal(
    timelineArtworkFilename({ entries, examples: false, format, page: pages[1]! }),
    "ruined-timeline-1971-1978-carousel-page-2-of-2.png",
  );
});

test("the supplied paper is preserved exactly as the Timeline texture", async () => {
  const paper = await readFile(new URL("../public/textures/ruined-timeline-paper.png", import.meta.url));
  assert.equal(
    createHash("sha256").update(paper).digest("hex"),
    "342f4389858b6d66dd1a9aef280e42741727879c151f74cfcc1d99c2329aeff8",
  );
});
