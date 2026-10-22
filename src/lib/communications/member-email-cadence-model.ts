export const CADENCE_KINDS = ["foundations_01", "foundations_02", "foundations_03", "foundations_04", "membership", "circle"] as const;
export const CADENCE_TRACKS = ["founder_test", "members"] as const;
export const CADENCE_STAGES = ["orientation", "one_week", "two_days", "day_before", "day_of"] as const;

export type CadenceKind = typeof CADENCE_KINDS[number];
export type CadenceTrack = typeof CADENCE_TRACKS[number];
export type CadenceStage = typeof CADENCE_STAGES[number];
export const CADENCE_KIND_LABELS: Record<CadenceKind, string> = {
  foundations_01: "Foundations 01", foundations_02: "Foundations 02", foundations_03: "Foundations 03",
  foundations_04: "Foundations 04", membership: "Membership call", circle: "Circle call",
};
export const CADENCE_TRACK_LABELS: Record<CadenceTrack, string> = { founder_test: "Founder test", members: "Members" };
export const CADENCE_STAGE_LABELS: Record<CadenceStage, string> = {
  orientation: "Foundations orientation", one_week: "One week before", two_days: "Two days before",
  day_before: "24 hours before", day_of: "Day of call",
};
export const MEMBER_EMAIL_CADENCE_WINDOW_MINUTES = 30;

export type CadenceEvent = { id: string; title: string; startsAt: string; endsAt: string; timeZone: string; callType?: string | null; circleName?: string | null };
export type CadenceConfiguration = { enabled: boolean; activatedAt: string | null; ready: boolean };
export type CadenceOccurrence = { stage: CadenceStage; dueAt: string; expiresAt: string };

export function isCadenceKind(value: unknown): value is CadenceKind {
  return typeof value === "string" && CADENCE_KINDS.includes(value as CadenceKind);
}
export function isCadenceTrack(value: unknown): value is CadenceTrack {
  return typeof value === "string" && CADENCE_TRACKS.includes(value as CadenceTrack);
}
export function isCadenceStage(value: unknown): value is CadenceStage {
  return typeof value === "string" && CADENCE_STAGES.includes(value as CadenceStage);
}

/** Activation is deliberately explicit and UTC, matching the existing SMS gate. */
export function getMemberEmailCadenceConfiguration(env: NodeJS.ProcessEnv = process.env): CadenceConfiguration {
  const value = env.MEMBER_EMAIL_CADENCE_ACTIVATED_AT?.trim() ?? "";
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;
  const canonical = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const activatedAt = canonical && canonical.replace(".000Z", "Z") === value.replace(".000Z", "Z") ? canonical : null;
  return { enabled: env.MEMBER_EMAIL_CADENCE_ENABLED?.trim() === "true", activatedAt, ready: activatedAt !== null };
}

type CivilTime = { year: number; month: number; day: number; hour: number; minute: number; second: number };
function civilTime(timestamp: number, timeZone: string): CivilTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}
function civilTimestamp(parts: CivilTime): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}
function inTimeZone(parts: CivilTime, timeZone: string): number | null {
  const desired = civilTimestamp(parts);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const difference = desired - civilTimestamp(civilTime(candidate, timeZone));
    if (difference === 0) return candidate;
    candidate += difference;
  }
  // A nonexistent local clock time is not silently moved across a DST change.
  return civilTimestamp(civilTime(candidate, timeZone)) === desired ? candidate : null;
}
function daysBefore(timestamp: number, days: number, timeZone: string): number | null {
  const parts = civilTime(timestamp, timeZone);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - days));
  return inTimeZone({ ...parts, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }, timeZone);
}

/** Returns scheduled windows only; callers must apply activation, enrollment and current audience eligibility. */
export function cadenceOccurrences(event: CadenceEvent, kind: CadenceKind, track: CadenceTrack): CadenceOccurrence[] {
  const start = Date.parse(event.startsAt), end = Date.parse(event.endsAt);
  if (!isCadenceKind(kind) || !isCadenceTrack(track) || !event.id.trim() || !event.title.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  try {
    civilTime(start, event.timeZone);
    const due: { stage: CadenceStage; at: number | null }[] = [];
    if (kind === "foundations_01") {
      if (track === "members") {
        due.push({ stage: "orientation", at: daysBefore(start, 16, event.timeZone) }, { stage: "one_week", at: daysBefore(start, 7, event.timeZone) });
      } else {
        due.push({ stage: "two_days", at: start - 48 * 60 * 60_000 });
      }
    }
    due.push({ stage: "day_before", at: start - 24 * 60 * 60_000 });
    const morning = kind === "foundations_01" && track === "members";
    const dayOf = morning ? inTimeZone({ ...civilTime(start, "America/Denver"), hour: 8, minute: 0, second: 0 }, "America/Denver") : start - 150 * 60_000;
    due.push({ stage: "day_of", at: dayOf });
    return due.flatMap(({ stage, at }) => at === null || at >= start ? [] : [{
      stage, dueAt: new Date(at).toISOString(), expiresAt: new Date(Math.min(at + MEMBER_EMAIL_CADENCE_WINDOW_MINUTES * 60_000, start)).toISOString(),
    }]);
  } catch {
    return [];
  }
}

/** No late enrollment or backlog replay: expiration and activation are checked at dispatch too. */
export function cadenceOccurrenceIsDue(occurrence: CadenceOccurrence, input: {
  now: string | Date | number; configuration: CadenceConfiguration; enrolledAt?: string | Date;
}): boolean {
  const { configuration } = input;
  if (!configuration.enabled || !configuration.ready || !configuration.activatedAt) return false;
  const now = new Date(input.now).getTime(), due = Date.parse(occurrence.dueAt), expires = Date.parse(occurrence.expiresAt);
  const activated = Date.parse(configuration.activatedAt);
  const enrolled = input.enrolledAt === undefined ? activated : new Date(input.enrolledAt).getTime();
  return [now, due, expires, activated, enrolled].every(Number.isFinite) && expires > due && due >= activated && due >= enrolled && now >= due && now < expires;
}
