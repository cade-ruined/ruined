/** One printed deadline, in Ruined's home time zone, for every recipient. */
export function memberInvitationDeadline(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric",
    minute: "2-digit", hour12: true, timeZoneName: "short",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? "";
  return `${part("month").toUpperCase()}. ${part("day")} ${part("hour")}:${part("minute")}${part("dayPeriod")} ${part("timeZoneName")}`;
}

export function memberInvitationExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  return !Number.isFinite(deadline) || deadline <= now;
}
