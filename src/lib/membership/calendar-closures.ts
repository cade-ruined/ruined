import { holidayClosures } from "@/lib/communications/member-lifecycle-email-model";

/** Informational all-day dates, never bookable Experiences or invitation jobs. */
export type CalendarClosure = {
  id: string;
  title: string;
  startDate: string;
  endDateExclusive: string;
  allDay: true;
  timeZone: "America/Denver";
};

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// Approved remaining 2026 dates and the 2027 calendar. The final New Year
// period includes January 1, 2028; later years need their own schedule review.
export const RUINED_CALENDAR_CLOSURES: CalendarClosure[] = [2026, 2027]
  .flatMap(holidayClosures)
  .filter((period) => period.start >= "2026-11-17")
  .map((period) => ({
    id: `closure-${period.start}`,
    title: period.title,
    startDate: period.start,
    endDateExclusive: shiftDate(period.end, 1),
    allDay: true,
    timeZone: "America/Denver",
  }));

export function closuresInDateRange(startDate: string, endDateExclusive: string): CalendarClosure[] {
  return RUINED_CALENDAR_CLOSURES.filter((closure) => closure.startDate < endDateExclusive
    && closure.endDateExclusive > startDate);
}

export function closureLastDate(closure: CalendarClosure): string {
  return shiftDate(closure.endDateExclusive, -1);
}

export function closureDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })
    .format(new Date(`${date}T12:00:00Z`));
}
