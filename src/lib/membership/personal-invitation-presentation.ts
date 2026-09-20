/** A date chosen by the administrator lasts through that day in their local timezone. */
export function complimentaryEndOfLocalDay(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (!Number.isFinite(end.getTime()) || end.getFullYear() !== year || end.getMonth() !== month - 1 || end.getDate() !== day) return null;
  return end.toISOString();
}

export function complimentaryMembershipDeadline(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: "America/Denver",
  }).format(new Date(value));
}
