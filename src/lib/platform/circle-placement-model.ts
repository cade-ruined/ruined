export const CIRCLE_TARGET = 10;
export const CIRCLE_NORMAL_MAXIMUM = 12;
export const CIRCLE_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const CIRCLE_PERIODS = [
  { key: "morning", label: "Morning · 9–12", start: 9, end: 12 },
  { key: "afternoon", label: "Afternoon · 1–5", start: 13, end: 17 },
  { key: "evening", label: "Evening · 6–10", start: 18, end: 22 },
] as const;
export type CirclePreferences = { timezone: string; availability: string[]; preferredConnectionId: string | null };
export type CirclePreferencesView = { preferences: CirclePreferences; connections: Array<{ memberId: string; name: string }> };
export type CircleRecommendation = { circleId: string; name: string; activeMembers: number; score: number; reasons: string[]; exceptionRequired: boolean };

export function validateCirclePreferences(input: unknown): CirclePreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose your Circle preferences.");
  const item = input as Record<string, unknown>;
  if (typeof item.timezone !== "string" || item.timezone.length > 100 || !item.timezone.trim()) throw new Error("Choose a valid time zone.");
  try { new Intl.DateTimeFormat("en", { timeZone: item.timezone }).format(); } catch { throw new Error("Choose a valid time zone."); }
  if (!Array.isArray(item.availability) || item.availability.length > 21 || item.availability.some(slot => typeof slot !== "string" || !/^[0-6]:(morning|afternoon|evening)$/.test(slot))) throw new Error("Choose valid weekly availability.");
  if (item.preferredConnectionId !== null && (typeof item.preferredConnectionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.preferredConnectionId))) throw new Error("Choose a connection from your invitation history.");
  return { timezone: item.timezone, availability: [...new Set(item.availability as string[])].sort(), preferredConnectionId: item.preferredConnectionId as string | null };
}

// Weekly quarter-hour buckets preserve half/quarter-hour time zones. Offset is
// evaluated at the review date; recommendations are advisory, never scheduling.
function weeklyUtcSlots(preferences: CirclePreferences, now: Date): Set<number> {
  if (!preferences.timezone) return new Set();
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-US", { timeZone: preferences.timezone, timeZoneName: "longOffset" }).formatToParts(now); } catch { return new Set(); }
  const offset = parts.find(part => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  const offsetQuarters = match ? (Number(match[2]) * 60 + Number(match[3])) / 15 * (match[1] === "+" ? 1 : -1) : 0;
  const result = new Set<number>();
  for (const slot of preferences.availability) {
    const [day, key] = slot.split(":"); const period = CIRCLE_PERIODS.find(item => item.key === key);
    if (!period) continue;
    for (let quarter = period.start * 4; quarter < period.end * 4; quarter++) result.add((Number(day) * 96 + quarter - offsetQuarters + 672) % 672);
  }
  return result;
}

export function scoreCirclePlacement(member: CirclePreferences, circles: Array<{ circleId: string; name: string; activeMembers: number; connectionPresent: boolean; participantPreferences: CirclePreferences[]; incomingSeats?: number }>, now = new Date(), couple?: { memberCircleId: string | null; partnerCircleId: string | null }): CircleRecommendation[] {
  const wanted = weeklyUtcSlots(member, now);
  // An unplaced partner joins the existing Circle. Established pairs may move
  // together; the write path checks both members and capacity atomically.
  const requiredCircleId = couple && !couple.memberCircleId ? couple.partnerCircleId : null;
  return circles.filter(circle => !requiredCircleId || circle.circleId === requiredCircleId).map(circle => {
    const reasons: string[] = []; let score = 0;
    const incomingSeats = circle.incomingSeats ?? (couple ? Number(couple.memberCircleId !== circle.circleId) + Number(couple.partnerCircleId !== circle.circleId) : 1);
    const exceptionRequired = circle.activeMembers + incomingSeats > CIRCLE_NORMAL_MAXIMUM;
    if (couple) reasons.push(circle.circleId === couple.partnerCircleId ? "Your partner is in this Circle; shared memberships stay together" : "Both partners are placed together");
    if (exceptionRequired) { score -= 30; reasons.push(`Adding ${incomingSeats === 1 ? "a person" : "both partners"} needs Administrator exception review`); }
    else if (circle.activeMembers < CIRCLE_TARGET) { score += 30; reasons.push("Below the target of 10 people"); }
    else if (circle.activeMembers < CIRCLE_NORMAL_MAXIMUM) { score += 10; reasons.push("Within the normal 8–12 range"); }

    if (circle.connectionPresent) { score += 25; reasons.push("A preferred connection or inviter is here; placement is not guaranteed"); }
    let overlapCount = 0; let knownAvailability = 0;
    for (const person of circle.participantPreferences) {
      const slots = weeklyUtcSlots(person, now);
      if (slots.size) knownAvailability++;
      if ([...slots].some(slot => wanted.has(slot))) overlapCount++;
    }
    if (!wanted.size) reasons.push("Member has not provided weekly availability");
    else if (!knownAvailability) reasons.push("Circle availability is not yet recorded");
    else { const proportion = overlapCount / knownAvailability; score += Math.round(proportion * 30); reasons.push(`Availability overlaps with ${overlapCount} of ${knownAvailability} people who shared it (current time-zone offsets)`); }
    if (member.timezone && circle.participantPreferences.some(person => person.timezone === member.timezone)) { score += 5; reasons.push("Shared time zone"); }
    return { circleId: circle.circleId, name: circle.name, activeMembers: circle.activeMembers, score, reasons, exceptionRequired };
  }).sort((a, b) => b.score - a.score || a.activeMembers - b.activeMembers || a.name.localeCompare(b.name));
}
