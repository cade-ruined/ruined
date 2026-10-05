/** The accepted calendar is immutable; later cutoff changes never move an accepted cohort. */
export const FOUNDATIONS_BILLING_SCHEDULE_VERSION = "foundations-prepaid-v1" as const;
export const FOUNDATIONS_TIME_ZONE = "America/Denver" as const;
export type FoundationsBillingSchedule = {
  version: typeof FOUNDATIONS_BILLING_SCHEDULE_VERSION;
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
export function foundationsBillingScheduleForMonth(cohortMonth: string, plan: BillingPlan): FoundationsBillingSchedule {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cohortMonth) || cohortMonth < MINIMUM_COHORT || cohortMonth > "9998-12") throw new RangeError("Invalid Foundations cohort month.");
  if (plan !== "monthly" && plan !== "annual") throw new RangeError("Invalid membership billing plan.");
  const [year, month] = cohortMonth.split("-").map(Number);
  const firstThursday = 1 + (4 - new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 7) % 7;
  const days = cohortMonth === "2026-11" ? [5, 12, 19, 30] : cohortMonth === "2026-12" ? [3, 10, 17, 30] : [0, 1, 2, 3].map(week => firstThursday + week * 7);
  const callStartsAt = days.map(day => denverCall(year, month, day)) as FoundationsBillingSchedule["callStartsAt"];
  const serviceStartsAt = callStartsAt[0];
  const nextChargeAt = anniversary(serviceStartsAt, plan === "monthly" ? 1 : 12);
  return {
    version: FOUNDATIONS_BILLING_SCHEDULE_VERSION, cohortMonth, timeZone: FOUNDATIONS_TIME_ZONE,
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
  if (now.getTime() >= Date.parse(schedule.cutoffAt)) {
    const [year, cohortMonth] = schedule.cohortMonth.split("-").map(Number);
    const next = new Date(Date.UTC(year, cohortMonth, 1));
    schedule = foundationsBillingScheduleForMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`, plan);
  }
  return schedule;
}
/** Validate a stored snapshot in full, independently of whether its cutoff has since passed. */
export function parseFoundationsBillingSchedule(value: unknown, plan: BillingPlan): FoundationsBillingSchedule | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.cohortMonth !== "string") return null;
  try {
    const expected = foundationsBillingScheduleForMonth(input.cohortMonth, plan);
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
