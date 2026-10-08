export type OpportunityCall = {
  readonly id: string;
  readonly dateLabel: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly meetUrl: string;
  readonly calendarFile: string;
};

export const OPPORTUNITY_CALLS = [
  {
    id: "2026-10-13",
    dateLabel: "Tuesday, October 13",
    startsAt: "2026-10-13T18:00:00-06:00",
    endsAt: "2026-10-13T19:00:00-06:00",
    meetUrl: "https://meet.google.com/top-uaii-ofh",
    calendarFile: "/calendar/ruined-opportunity-call-2026-10-13.ics",
  },
] as const satisfies readonly OpportunityCall[];

/** Opens an unsaved event using Google's documented event-template endpoint.
 * https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events#provide_a_link_for_users_to_add_the_event
 */
export function googleCalendarUrl(call: OpportunityCall): string {
  const calendarDate = (value: string) =>
    new Date(value).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Ruined Opportunity Call",
    dates: `${calendarDate(call.startsAt)}/${calendarDate(call.endsAt)}`,
    stz: "America/Denver",
    etz: "America/Denver",
    details: `Join the Ruined Opportunity Call on Google Meet: ${call.meetUrl}`,
    location: call.meetUrl,
  });

  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
}
