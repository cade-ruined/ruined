import type { MemberTimelineEntry } from "@/lib/membership/model";

export const TIMELINE_LIMITS = {
  details: 800,
  maximumYear: 2100,
  minimumYear: 1900,
  title: 90,
} as const;

export const TIMELINE_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function formatTimelineDate(entry: { year: number; month?: number | null }, longMonth = false): string {
  const month = typeof entry.month === "number" ? TIMELINE_MONTHS[entry.month - 1] : undefined;
  return month ? `${longMonth ? month : month.slice(0, 3)} ${entry.year}` : String(entry.year);
}

export type TimelineDraftEntry = {
  clientKey: string;
  createdOrder: number;
  details: string;
  id: string | null;
  month?: number | null;
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
