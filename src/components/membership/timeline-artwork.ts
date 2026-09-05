import type { TimelineDraftEntry } from "@/components/membership/timeline-model";

export type TimelineArtworkFormatId =
  | "carousel"
  | "presentation"
  | "square"
  | "story";

export type TimelineArtworkFormat = {
  dimensions: string;
  eventsPerPage: number;
  height: number;
  id: TimelineArtworkFormatId;
  label: string;
  width: number;
};

export type TimelineArtworkPage = {
  entries: TimelineDraftEntry[];
  index: number;
  total: number;
};

export type TimelineArtworkPoint = {
  x: number;
  y: number;
};

export type TimelineArtworkEventLayout = {
  entry: TimelineDraftEntry;
  index: number;
  labelSide: "above" | "below" | "left" | "right";
  labelWidth: number;
  labelX: number;
  labelY?: number;
  point: TimelineArtworkPoint;
};

export type TimelineArtworkLayout = {
  events: TimelineArtworkEventLayout[];
  flow: "horizontal" | "vertical";
  footerY: number;
  headerY: number;
  height: number;
  inkPoints: TimelineArtworkPoint[];
  landscape: boolean;
  marginX: number;
  pathControls: TimelineArtworkPoint[];
  seed: number;
  width: number;
};

export const TIMELINE_ARTWORK_FORMATS: readonly TimelineArtworkFormat[] = [
  {
    dimensions: "4:5 · 2160 × 2700",
    eventsPerPage: 4,
    height: 2700,
    id: "carousel",
    label: "Carousel",
    width: 2160,
  },
  {
    dimensions: "16:9 · 3840 × 2160",
    eventsPerPage: 6,
    height: 2160,
    id: "presentation",
    label: "Presentation",
    width: 3840,
  },
  {
    dimensions: "1:1 · 2160 × 2160",
    eventsPerPage: 6,
    height: 2160,
    id: "square",
    label: "Square",
    width: 2160,
  },
  {
    dimensions: "9:16 · 2160 × 3840",
    eventsPerPage: 9,
    height: 3840,
    id: "story",
    label: "Story",
    width: 2160,
  },
] as const;

export const DEFAULT_TIMELINE_ARTWORK_FORMAT: TimelineArtworkFormatId = "carousel";

function orderTimelineArtworkEntries(entries: TimelineDraftEntry[]) {
  return [...entries]
    .sort(
      (left, right) =>
        left.year - right.year ||
        left.createdOrder - right.createdOrder ||
        left.clientKey.localeCompare(right.clientKey),
    )
    .map((entry, index) => ({ ...entry, position: index + 1 }));
}

export function getTimelineArtworkFormat(
  id: TimelineArtworkFormatId,
): TimelineArtworkFormat {
  return (
    TIMELINE_ARTWORK_FORMATS.find((format) => format.id === id) ??
    TIMELINE_ARTWORK_FORMATS[0]!
  );
}

export function paginateTimelineArtwork(
  entries: TimelineDraftEntry[],
  format: TimelineArtworkFormat,
): TimelineArtworkPage[] {
  const ordered = orderTimelineArtworkEntries(entries);
  if (!ordered.length) return [];
  const total = Math.ceil(ordered.length / format.eventsPerPage);
  if (format.id !== "carousel") {
    return Array.from({ length: total }, (_, index) => ({
      entries: ordered.slice(
        index * format.eventsPerPage,
        (index + 1) * format.eventsPerPage,
      ),
      index,
      total,
    }));
  }

  const smallerPageSize = Math.floor(ordered.length / total);
  const largerPageCount = ordered.length % total;
  let offset = 0;
  return Array.from({ length: total }, (_, index) => {
    const size = smallerPageSize + (index < largerPageCount ? 1 : 0);
    const page = {
      entries: ordered.slice(offset, offset + size),
      index,
      total,
    };
    offset += size;
    return page;
  });
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function timelineArtworkSeed(
  entries: TimelineDraftEntry[],
  formatId: TimelineArtworkFormatId,
  pageIndex: number,
) {
  return hashText(
    `${formatId}:${pageIndex}:${entries
      .map((entry, index) => `${entry.id ?? entry.clientKey}:${entry.year}:${index}`)
      .join("|")}`,
  );
}

export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildHorizontalCarouselLayout({
  entries,
  format,
  pageIndex,
  sequenceEntries,
}: {
  entries: TimelineDraftEntry[];
  format: TimelineArtworkFormat;
  pageIndex: number;
  sequenceEntries: TimelineDraftEntry[];
}): TimelineArtworkLayout {
  const { height, width } = format;
  const orderedSequence = orderTimelineArtworkEntries(sequenceEntries);
  const sequencePages = paginateTimelineArtwork(orderedSequence, format);
  const seed = timelineArtworkSeed(orderedSequence, format.id, 0);
  const random = seededRandom(seed);
  const marginX = Math.round(width * 0.068);
  const labelWidth = Math.round(width * 0.215);
  const centerY = height * 0.57;
  const amplitude = height * 0.065;
  const firstX = width * 0.15;
  const lastX = width * 0.85;
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const pageOffset = pageIndex * width;

  function roadY(globalX: number) {
    const distance = globalX / width;
    return clamp(
      centerY +
        amplitude *
          (Math.sin(distance * 2.05 + phaseA) * 0.68 +
            Math.sin(distance * 4.35 + phaseB) * 0.32),
      height * 0.49,
      height * 0.65,
    );
  }

  const globalEvents = sequencePages.flatMap((page) =>
    page.entries.map((entry, index) => {
      const progress =
        page.entries.length === 1 ? 0.5 : index / (page.entries.length - 1);
      const localX = firstX + (lastX - firstX) * progress;
      const globalX = page.index * width + localX;
      return {
        entry,
        point: { x: globalX, y: roadY(globalX) },
      };
    }),
  );
  const globalPointByKey = new Map(
    globalEvents.map(({ entry, point }) => [entry.clientKey, point]),
  );

  const events = entries.map((entry, index) => {
    const globalPoint = globalPointByKey.get(entry.clientKey) ?? {
      x: pageOffset + width * 0.5,
      y: roadY(pageOffset + width * 0.5),
    };
    const point = { x: globalPoint.x - pageOffset, y: globalPoint.y };
    const labelSide: "above" | "below" =
      (Math.max(1, entry.position) - 1) % 2 === 0 ? "above" : "below";
    const labelX = clamp(
      point.x - labelWidth / 2,
      marginX,
      width - marginX - labelWidth,
    );
    return {
      entry,
      index,
      labelSide,
      labelWidth,
      labelX,
      labelY: height * (labelSide === "above" ? 0.405 : 0.675),
      point,
    };
  });

  const globalPathControls: TimelineArtworkPoint[] = [
    { x: -width * 0.12, y: roadY(-width * 0.12) },
  ];
  for (const page of sequencePages) {
    const boundaryX = page.index * width;
    globalPathControls.push({ x: boundaryX, y: roadY(boundaryX) });
    for (const entry of page.entries) {
      const point = globalPointByKey.get(entry.clientKey);
      if (point) globalPathControls.push(point);
    }
  }
  const endX = sequencePages.length * width;
  globalPathControls.push(
    { x: endX, y: roadY(endX) },
    { x: endX + width * 0.12, y: roadY(endX + width * 0.12) },
  );

  const pathControls = globalPathControls.map(({ x, y }) => ({
    x: x - pageOffset,
    y,
  }));
  const inkPoints = globalEvents.map(({ point }) => ({
    x: point.x - pageOffset,
    y: point.y,
  }));
  const entryY = roadY(pageOffset);
  const exitY = roadY(pageOffset + width);

  return {
    events,
    flow: "horizontal",
    footerY: exitY,
    headerY: entryY,
    height,
    inkPoints,
    landscape: false,
    marginX,
    pathControls,
    seed,
    width,
  };
}

export function buildTimelineArtworkLayout({
  entries,
  format,
  pageIndex,
  sequenceEntries = entries,
}: {
  entries: TimelineDraftEntry[];
  format: TimelineArtworkFormat;
  pageIndex: number;
  sequenceEntries?: TimelineDraftEntry[];
}): TimelineArtworkLayout {
  if (format.id === "carousel") {
    return buildHorizontalCarouselLayout({
      entries,
      format,
      pageIndex,
      sequenceEntries,
    });
  }

  const { height, width } = format;
  const landscape = width > height;
  const seed = timelineArtworkSeed(entries, format.id, pageIndex);
  const random = seededRandom(seed);
  const marginX = Math.round(width * (landscape ? 0.055 : 0.068));
  const headerY = Math.round(height * (landscape ? 0.205 : 0.165));
  const footerY = Math.round(height * (landscape ? 0.89 : 0.92));
  const span = Math.max(1, footerY - headerY);
  const centerX = width * 0.5;
  const amplitude = width * (landscape ? 0.115 : 0.17);
  const labelWidth = Math.round(width * (landscape ? 0.265 : 0.325));
  const phase = random() * Math.PI * 1.4;

  const events = entries.map((entry, index) => {
    const progress = entries.length === 1 ? 0.5 : (index + 0.5) / entries.length;
    const y = headerY + span * progress;
    const wave = Math.sin(progress * Math.PI * (landscape ? 2.15 : 2.55) + phase);
    const drift = (random() - 0.5) * width * 0.035;
    const x = Math.max(
      width * 0.3,
      Math.min(width * 0.7, centerX + wave * amplitude + drift),
    );
    const labelSide: "left" | "right" = x > centerX ? "left" : "right";
    const labelX = labelSide === "left" ? marginX : width - marginX - labelWidth;
    return {
      entry,
      index,
      labelSide,
      labelWidth,
      labelX,
      point: { x, y },
    };
  });

  const first = events[0]?.point ?? { x: centerX, y: headerY + span * 0.28 };
  const last = events.at(-1)?.point ?? { x: centerX, y: headerY + span * 0.72 };
  const pathControls = [
    {
      x: Math.max(width * 0.32, Math.min(width * 0.68, first.x + (random() - 0.5) * amplitude)),
      y: headerY - height * 0.055,
    },
    ...events.map(({ point }) => point),
    {
      x: Math.max(width * 0.32, Math.min(width * 0.68, last.x + (random() - 0.5) * amplitude)),
      y: footerY + height * 0.035,
    },
  ];

  return {
    events,
    flow: "vertical",
    footerY,
    headerY,
    height,
    inkPoints: events.map(({ point }) => point),
    landscape,
    marginX,
    pathControls,
    seed,
    width,
  };
}

export function timelineArtworkFilename({
  entries,
  examples,
  format,
  page,
}: {
  entries: TimelineDraftEntry[];
  examples: boolean;
  format: TimelineArtworkFormat;
  page: TimelineArtworkPage;
}) {
  const ordered = orderTimelineArtworkEntries(entries);
  const firstYear = ordered[0]?.year;
  const lastYear = ordered.at(-1)?.year;
  const span = firstYear
    ? firstYear === lastYear
      ? String(firstYear)
      : `${firstYear}-${lastYear}`
    : "empty";
  const pageSuffix = page.total > 1 ? `-page-${page.index + 1}-of-${page.total}` : "";
  return `ruined-${examples ? "example-" : ""}timeline-${span}-${format.id}${pageSuffix}.png`;
}
