/** Keep the accepted offer intact; enrollment can separately carry a late payment forward. */
export const FOUNDATIONS_BILLING_SCHEDULE_VERSION = "foundations-prepaid-v3" as const;
export type FoundationsBillingScheduleVersion = "foundations-prepaid-v1" | "foundations-prepaid-v2" | typeof FOUNDATIONS_BILLING_SCHEDULE_VERSION;
export const FOUNDATIONS_TIME_ZONE = "America/Denver" as const;
export type FoundationsBillingSchedule = {
  version: FoundationsBillingScheduleVersion;
  cohortMonth: string;
  timeZone: typeof FOUNDATIONS_TIME_ZONE;
  callStartsAt: [string, string, string, string];
  cutoffAt: string;
  serviceStartsAt: string;
  prepaidThrough: string;
  nextChargeAt: string;
  initialTermEndsAt: string;
};
type BillingPlan = "monthly" | "annual";
const MINIMUM_COHORT = "2026-11";
const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: FOUNDATIONS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function parts(date: Date) {
  return Object.fromEntries(dateParts.formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
}
function denverCall(year: number, month: number, day: number): string {
  const local = Date.UTC(year, month - 1, day, 15);
  let instant = local;
  // Resolve a civil 3 p.m. to its actual offset, including calls spanning a DST change.
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = parts(new Date(instant));
    const delta = local - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant += delta;
    if (delta === 0) return new Date(instant).toISOString();
  }
  throw new RangeError("Unable to resolve Foundations call time.");
}
// Match membershipCommitmentAnniversary without importing its server-only crypto dependency.
function anniversary(startsAt: string, months: number): string {
  const original = new Date(startsAt);
  const result = new Date(original);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(original.getUTCDate(), finalDay));
  return result.toISOString();
}
export function isFoundationsBillingScheduleVersion(value: unknown): value is FoundationsBillingScheduleVersion {
  return value === "foundations-prepaid-v1" || value === "foundations-prepaid-v2" || value === FOUNDATIONS_BILLING_SCHEDULE_VERSION;
}
export function foundationsBillingScheduleForMonth(
  cohortMonth: string,
  plan: BillingPlan,
  version: FoundationsBillingScheduleVersion = FOUNDATIONS_BILLING_SCHEDULE_VERSION,
): FoundationsBillingSchedule {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cohortMonth) || cohortMonth < MINIMUM_COHORT || cohortMonth > "9998-12") throw new RangeError("Invalid Foundations cohort month.");
  if (plan !== "monthly" && plan !== "annual") throw new RangeError("Invalid membership billing plan.");
  if (!isFoundationsBillingScheduleVersion(version)) throw new RangeError("Invalid Foundations schedule version.");
  const [year, month] = cohortMonth.split("-").map(Number);
  const firstThursday = 1 + (4 - new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 7) % 7;
  // Preserve accepted v1/v2 calendars exactly. New v3 quotes move the final
  // December call to December 30 to avoid New Year's Eve; billing anchors stay fixed.
  const days = cohortMonth === "2026-11" ? [5, 12, 19, 30] : cohortMonth === "2026-12" ? [3, 10, 17, version === "foundations-prepaid-v2" ? 31 : 30] : [0, 1, 2, 3].map(week => firstThursday + week * 7);
  const callStartsAt = days.map(day => denverCall(year, month, day)) as FoundationsBillingSchedule["callStartsAt"];
  const serviceStartsAt = callStartsAt[0];
  const nextChargeAt = anniversary(serviceStartsAt, plan === "monthly" ? 1 : 12);
  return {
    version, cohortMonth, timeZone: FOUNDATIONS_TIME_ZONE,
    callStartsAt, cutoffAt: new Date(Date.parse(serviceStartsAt) - 24 * 60 * 60 * 1000).toISOString(),
    serviceStartsAt, prepaidThrough: nextChargeAt, nextChargeAt,
    initialTermEndsAt: anniversary(serviceStartsAt, 12),
  };
}
export function createFoundationsBillingSchedule(now: Date, plan: BillingPlan): FoundationsBillingSchedule {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new RangeError("Invalid Foundations scheduling time.");
  const local = parts(now);
  const month = `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}`;
  let schedule = foundationsBillingScheduleForMonth(month < MINIMUM_COHORT ? MINIMUM_COHORT : month, plan);
  // When the first call is on the 1st, its cutoff falls in the previous month.
  // Check the next group as well instead of stopping after one month advance.
  while (now.getTime() >= Date.parse(schedule.cutoffAt)) {
    const [year, cohortMonth] = schedule.cohortMonth.split("-").map(Number);
    const next = new Date(Date.UTC(year, cohortMonth, 1));
    schedule = foundationsBillingScheduleForMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`, plan);
  }
  return schedule;
}
/** Resolve from the completion time, never from the time a webhook or worker runs.
 * Before the cutoff, preserve even an older accepted holiday calendar exactly.
 * At or after it, carry the payment to the next eligible month without changing
 * the original offer or moving an explicitly later accepted cohort backwards. */
export function resolveFoundationsEnrollmentSchedule(
  accepted: FoundationsBillingSchedule,
  completedAt: Date,
  plan: BillingPlan,
): FoundationsBillingSchedule {
  const original = parseFoundationsBillingSchedule(accepted, plan);
  if (!original) throw new RangeError("Invalid accepted Foundations schedule.");
  if (!(completedAt instanceof Date) || !Number.isFinite(completedAt.getTime())) throw new RangeError("Invalid Foundations completion time.");
  if (completedAt.getTime() < Date.parse(original.cutoffAt)) return original;
  const next = createFoundationsBillingSchedule(completedAt, plan);
  if (next.cohortMonth <= original.cohortMonth) throw new RangeError("Foundations rollover must move to a later group.");
  return next;
}
/** Validate a stored snapshot in full, independently of whether its cutoff has since passed. */
export function parseFoundationsBillingSchedule(value: unknown, plan: BillingPlan): FoundationsBillingSchedule | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.cohortMonth !== "string" || !isFoundationsBillingScheduleVersion(input.version)) return null;
  try {
    const expected = foundationsBillingScheduleForMonth(input.cohortMonth, plan, input.version);
    if (Object.keys(input).length !== Object.keys(expected).length) return null;
    for (const key of Object.keys(expected) as Array<keyof FoundationsBillingSchedule>) {
      if (key === "callStartsAt") {
        if (!Array.isArray(input[key]) || input[key].length !== 4 || input[key].some((call, i) => call !== expected[key][i])) return null;
      } else if (input[key] !== expected[key]) return null;
    }
    return expected;
  } catch {
    return null;
  }
}
