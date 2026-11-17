import { createFoundationsBillingSchedule, FOUNDATIONS_TIME_ZONE } from "./foundations-schedule";

const confirmedMonths = [
  { date: "2026-11", month: "November", year: "2026", topic: "Foundations", note: "Foundations only. Our shared starting point." },
  { date: "2026-12", month: "December", year: "2026", topic: "TIME", note: "Where it goes. What matters. What changes." },
  { date: "2027-01", month: "January", year: "2027", topic: "Reinvention", note: "Who you are becoming. What comes next." },
] as const;

const monthFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: FOUNDATIONS_TIME_ZONE, year: "numeric", month: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: FOUNDATIONS_TIME_ZONE, month: "long", day: "numeric", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: FOUNDATIONS_TIME_ZONE, hour: "numeric", minute: "2-digit" });

/** Public dates share the enrollment schedule; never invent a second cutoff. */
export function publicMembershipSchedule(asOf: string | null) {
  if (!asOf) return null;
  const now = new Date(asOf);
  if (!Number.isFinite(now.getTime())) return null;
  const parts = monthFormatter.formatToParts(now);
  const month = `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
  const foundations = createFoundationsBillingSchedule(now, "monthly");
  const format = (value: string) => ({ iso: value, date: dateFormatter.format(new Date(value)), time: `${timeFormatter.format(new Date(value))} Mountain` });
  return {
    months: confirmedMonths.filter(item => item.date >= month).map(item => ({
      ...item, status: item.date === month ? "In progress" : "Upcoming",
    })),
    foundations: {
      cohortMonth: foundations.cohortMonth,
      start: format(foundations.serviceStartsAt),
      cutoff: format(foundations.cutoffAt),
    },
  };
}

export type PublicMembershipSchedule = ReturnType<typeof publicMembershipSchedule>;
