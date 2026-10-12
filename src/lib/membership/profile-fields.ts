/** IANA timezone values supported by the runtime, shared with the profile selector. */
export const MEMBER_TIMEZONES = ["UTC", ...Intl.supportedValuesOf("timeZone")];

export function normalizeMemberTimezone(value: string): string | null {
  const timezone = value.trim();
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
