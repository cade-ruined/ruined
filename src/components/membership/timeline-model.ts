import type { MemberTimelineEntry } from "@/lib/membership/model";

export const TIMELINE_LIMITS = {
  details: 4000,
  maximumYear: 2200,
  minimumYear: 1900,
  title: 200,
} as const;

export const TIMELINE_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function formatTimelineDate(entry: { year: number; month?: number | null; day?: number | null }, longMonth = false): string {
  const month = typeof entry.month === "number" ? TIMELINE_MONTHS[entry.month - 1] : undefined;
  return month ? `${longMonth ? month : month.slice(0, 3)}${entry.day ? ` ${entry.day},` : ""} ${entry.year}` : String(entry.year);
}

export type TimelineReadingOrder = "oldest" | "newest";

export function filterTimelineEntries(entries: TimelineDraftEntry[], query: string, year: string, order: TimelineReadingOrder) {
  const search = query.trim().toLocaleLowerCase();
  const filtered = entries.filter(entry => (!year || String(entry.year) === year)
    && (!search || `${entry.title}\n${entry.details}\n${formatTimelineDate(entry, true)}`.toLocaleLowerCase().includes(search)));
  return filtered.sort((left, right) => (order === "newest" ? right.year - left.year : left.year - right.year)
    || (left.month == null ? 13 : order === "newest" ? 13 - left.month : left.month)
      - (right.month == null ? 13 : order === "newest" ? 13 - right.month : right.month)
    || left.createdOrder - right.createdOrder || left.clientKey.localeCompare(right.clientKey));
}

export function groupTimelineEntries(entries: TimelineDraftEntry[]) {
  const groups: Array<{ year: number; entries: TimelineDraftEntry[] }> = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.year === entry.year) last.entries.push(entry);
    else groups.push({ year: entry.year, entries: [entry] });
  }
  return groups;
}

export type TimelineDraftEntry = {
  clientKey: string;
  createdOrder: number;
  details: string;
  id: string | null;
  month?: number | null;
  day?: number | null;
  position: number;
  title: string;
  year: number;
};

export type TimelineFormValue = {
  details: string;
  month: string;
  title: string;
  year: string;
};

export const EMPTY_TIMELINE_FORM: TimelineFormValue = {
  details: "",
  month: "",
  title: "",
  year: "",
};

export const TIMELINE_EXAMPLES: TimelineDraftEntry[] = [
  {
    clientKey: "example-2007",
    createdOrder: 1,
    details: "A new city. New rooms. No familiar faces.",
    id: null,
    position: 1,
    title: "Moved somewhere new",
    year: 2007,
  },
  {
    clientKey: "example-2014",
    createdOrder: 2,
    details: "The ceremony ended before certainty arrived.",
    id: null,
    position: 2,
    title: "Finished school",
    year: 2014,
  },
  {
    clientKey: "example-2019",
    createdOrder: 3,
    details: "The plan disappeared in a single conversation.",
    id: null,
    position: 3,
    title: "The work changed suddenly",
    year: 2019,
  },
  {
    clientKey: "example-2025",
    createdOrder: 4,
    details: "A quieter process. Fewer borrowed expectations.",
    id: null,
    position: 4,
    title: "Started building differently",
    year: 2025,
  },
];

export function fromMemberTimelineEntries(
  entries: MemberTimelineEntry[],
): TimelineDraftEntry[] {
  return entries.map((entry, index) => ({
    clientKey: entry.id,
    createdOrder: entry.position || index + 1,
    details: entry.details ?? "",
    id: entry.id,
    month: entry.month ?? null,
    position: entry.position || index + 1,
    title: entry.title,
    year: entry.year,
  }));
}

export function sortTimelineEntries(
  entries: TimelineDraftEntry[],
): TimelineDraftEntry[] {
  return [...entries]
    .sort(
      (left, right) =>
        left.year - right.year ||
        (left.month ?? 13) - (right.month ?? 13) ||
        (left.day ?? 32) - (right.day ?? 32) ||
        left.createdOrder - right.createdOrder ||
        left.clientKey.localeCompare(right.clientKey),
    )
    .map((entry, index) => ({ ...entry, position: index + 1 }));
}

export function toTimelineSaveEntries(entries: TimelineDraftEntry[]) {
  return sortTimelineEntries(entries).map((entry) => ({
    details: entry.details.trim() || null,
    id: entry.id,
    month: entry.month ?? null,
    title: entry.title.trim(),
    year: entry.year,
  }));
}

export function formForTimelineEntry(
  entry: TimelineDraftEntry,
): TimelineFormValue {
  return {
    details: entry.details,
    month: entry.month == null ? "" : String(entry.month),
    title: entry.title,
    year: String(entry.year),
  };
}

export function timelineFormIsDirty(
  form: TimelineFormValue,
  baseline: TimelineFormValue,
): boolean {
  return (
    form.year !== baseline.year ||
    form.month !== baseline.month ||
    form.title !== baseline.title ||
    form.details !== baseline.details
  );
}

export function restoreDeletedTimelineEntry(
  entry: TimelineDraftEntry,
): TimelineDraftEntry {
  return {
    ...entry,
    id: null,
  };
}
