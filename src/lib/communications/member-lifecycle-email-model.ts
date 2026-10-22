export const LIFECYCLE_EMAIL_KEYS = ["birthday", "anniversary", "ruined_birthday", "thanksgiving", "christmas", "new_year", "checkin_30", "checkin_90", "checkin_6_month"] as const;
export type LifecycleEmailKey = typeof LIFECYCLE_EMAIL_KEYS[number];
export type LifecycleSettings = Record<string, string>;
export const LIFECYCLE_TITLES: Record<LifecycleEmailKey, string> = {
  birthday: "Member birthday", anniversary: "One-year registration anniversary", ruined_birthday: "RU/NED birthday",
  thanksgiving: "Thanksgiving heads-up", christmas: "Christmas / end-of-year", new_year: "New Year",
  checkin_30: "30-day member check-in", checkin_90: "90-day member check-in", checkin_6_month: "Six-month member check-in",
};
export const LIFECYCLE_SETTINGS = ["reviewUrl", "surveyUrl", "foundationsWorkType", "foundationsWorkLabel", "foundationsWorkPath", "fulfillmentMode", "calendarYear", "closureDetails", "returnDate", "scheduleChanges"] as const;
export function isLifecycleKey(value: unknown): value is LifecycleEmailKey {
  return typeof value === "string" && LIFECYCLE_EMAIL_KEYS.includes(value as LifecycleEmailKey);
}
export function validLifecycleUrl(value: string | undefined): boolean {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password && !/[\[\]{}\s]/.test(value!); } catch { return false; }
}
export function lifecycleMissing(key: LifecycleEmailKey, settings: LifecycleSettings, year: number): string[] {
  if (key === "birthday") return ["Choose the birthday item, shipping and fulfillment rules, and connect verified single-use gift codes before enabling this promise."];
  if (key === "checkin_30") return [
    ...(!validLifecycleUrl(settings.reviewUrl) ? ["Connect the review link."] : []),
    "Finalize review verification and the promised badge before sending.",
  ];
  if (key === "checkin_90") return validLifecycleUrl(settings.surveyUrl) ? [] : ["Connect the finalized short check-in form."];
  if (key === "checkin_6_month") return [
    ...(settings.foundationsWorkType !== "timeline" ? ["Select a saved Foundations work type. Timeline is supported; other artifacts need their storage and access connected first."] : []),
    ...(settings.foundationsWorkLabel !== "created your Timeline" ? ["Confirm the supported Timeline description: created your Timeline."] : []),
    ...(settings.foundationsWorkPath !== "/my/foundations/timeline" ? ["Use the verified member-only Timeline path: /my/foundations/timeline."] : []),
    ...(!["none", "task"].includes(settings.fulfillmentMode) ? ["Decide whether the six-month Artifact requires a fulfillment task."] : []),
  ];
  if (key === "thanksgiving" || key === "christmas") return [
    ...(settings.calendarYear !== String(year) ? [`Approve the ${year} holiday schedule.`] : []),
    ...(!settings.closureDetails?.trim() ? ["Confirm the separate closure / availability periods."] : []),
    ...(!settings.returnDate?.trim() ? ["Confirm the return date."] : []),
    ...(!settings.scheduleChanges?.trim() ? ["Confirm call changes, or explicitly enter None."] : []),
  ];
  return [];
}
export type LifecycleMemberDates = { registeredAt: string | null; firstMembershipCallAt: string | null; birthDate: string | null };
export type LifecycleOccurrence = { key: LifecycleEmailKey; occurrenceKey: string; dueAt: string; expiresAt: string };
export function denverDate(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-");
}
export function localEmailTime(date: string, hour = 15): string {
  const desired = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  let timestamp = desired;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
    const p = (key: string) => parts.find(part => part.type === key)!.value;
    const actual = Date.parse(`${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}Z`);
    if (desired === actual) return new Date(timestamp).toISOString();
    timestamp += desired - actual;
  }
  throw new Error("Invalid local email time");
}
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year, month + months, 0));
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(day, last.getUTCDate()))).toISOString().slice(0, 10);
}
export function holidayClosures(year: number) {
  const weekday = (month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const thanksgiving = 1 + ((4 - weekday(11, 1) + 7) % 7) + 21;
  const memorial = 31 - ((weekday(5, 31) + 6) % 7);
  const labor = 1 + ((1 - weekday(9, 1) + 7) % 7);
  const date = (month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return [
    { title: "Memorial Day", start: date(5, memorial), end: date(5, memorial) },
    { title: "Independence Day", start: date(7, 4), end: date(7, 4) },
    { title: "Labor Day", start: date(9, labor), end: date(9, labor) },
    { title: "Thanksgiving / Black Friday", start: date(11, thanksgiving), end: date(11, thanksgiving + 1) },
    { title: "Christmas", start: date(12, 23), end: date(12, 27) },
    { title: "New Year", start: date(12, 31), end: `${year + 1}-01-01` },
  ];
}
/** Candidate dates only: authorization, activation and dependency checks happen again at dispatch. */
export function lifecycleOccurrences(key: LifecycleEmailKey, dates: LifecycleMemberDates, year: number): LifecycleOccurrence[] {
  let date: string | null = null;
  if (key === "anniversary" && dates.registeredAt) date = addMonths(denverDate(dates.registeredAt), 12);
  else if (key === "birthday" && dates.birthDate) {
    const [, month, day] = dates.birthDate.split("-").map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    date = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  } else if (key === "ruined_birthday") date = `${year}-07-30`;
  else if (key === "new_year") date = `${year}-01-01`;
  else if (key === "christmas") date = `${year}-12-17`;
  else if (key === "thanksgiving") date = addDays(holidayClosures(year).find(item => item.title.startsWith("Thanksgiving"))!.start, -7);
  else if (dates.firstMembershipCallAt && key.startsWith("checkin_")) {
    const anchor = denverDate(dates.firstMembershipCallAt);
    date = key === "checkin_6_month" ? addMonths(anchor, 6) : addDays(anchor, key === "checkin_30" ? 30 : 90);
  }
  if (!date || !date.startsWith(`${year}-`)) return [];
  const dueAt = localEmailTime(date, key === "birthday" ? 10 : 15);
  return [{ key, occurrenceKey: date, dueAt, expiresAt: new Date(Date.parse(dueAt) + 24 * 60 * 60_000).toISOString() }];
}
export function lifecycleOccurrenceIsDue(occurrence: LifecycleOccurrence, input: { now: string; activatedAt: string; enrolledAt: string }) {
  const now = Date.parse(input.now), due = Date.parse(occurrence.dueAt), expires = Date.parse(occurrence.expiresAt);
  const activated = Date.parse(input.activatedAt), enrolled = Date.parse(input.enrolledAt);
  return [now, due, expires, activated, enrolled].every(Number.isFinite) && expires > due && due >= activated && due >= enrolled && now >= due && now < expires;
}
