/** Familiar choices backed by IANA zones so daylight saving stays automatic. */
const MEMBER_TIMEZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Los_Angeles": "Pacific",
  "America/Anchorage": "Alaska",
  "Pacific/Honolulu": "Hawaii",
  "America/Phoenix": "Arizona (Mountain Standard)",
  UTC: "UTC",
};

export const MEMBER_TIMEZONES = Object.keys(MEMBER_TIMEZONE_LABELS);

export function memberTimezoneLabel(timezone: string): string {
  if (MEMBER_TIMEZONE_LABELS[timezone]) return MEMBER_TIMEZONE_LABELS[timezone];
  // Keep a member's existing zone selectable without changing its saved value.
  try {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date("2026-01-01T00:00:00Z")).find(part => part.type === "timeZoneName")?.value;
    return `${label ?? timezone} (current)`;
  } catch {
    return `${timezone} (current)`;
  }
}

export function normalizeMemberTimezone(value: string): string | null {
  const timezone = value.trim();
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
