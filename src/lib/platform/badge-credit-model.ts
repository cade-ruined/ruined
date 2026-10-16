export type ExperienceBadgeCredit =
  | { track: "none"; stage: null; month: null }
  | { track: "in_person"; stage: null; month: null }
  | { track: "membership"; stage: "see" | "face" | "cut" | "grow"; month: string }
  | { track: "circle"; stage: "why" | "implementation"; month: string };

type BadgeCreditContext = {
  kind: string;
  circleId: string | null;
  locationLabel: string | null;
  meetingUrl?: string | null;
};

export const NO_BADGE_CREDIT: ExperienceBadgeCredit = { track: "none", stage: null, month: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Badge credit is explicit operator data. Titles, invitations and call links are never evidence. */
export function parseExperienceBadgeCredit(value: unknown): ExperienceBadgeCredit | null {
  if (!isRecord(value) || Object.keys(value).length !== 3
    || !Object.keys(value).every((key) => ["track", "stage", "month"].includes(key))) return null;
  if (value.track === "none" || value.track === "in_person") {
    return value.stage === null && value.month === null ? { track: value.track, stage: null, month: null } : null;
  }
  if (typeof value.stage !== "string" || typeof value.month !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value.month)) return null;
  if (value.track === "membership" && ["see", "face", "cut", "grow"].includes(value.stage)) {
    return { track: "membership", stage: value.stage as "see" | "face" | "cut" | "grow", month: value.month };
  }
  if (value.track === "circle" && ["why", "implementation"].includes(value.stage)) {
    return { track: "circle", stage: value.stage as "why" | "implementation", month: value.month };
  }
  return null;
}

export function experienceBadgeCreditError(credit: ExperienceBadgeCredit, context: BadgeCreditContext): string | null {
  if (credit.track === "membership" && (context.kind !== "weekly_call" || context.circleId)) {
    return "Membership badge credit requires the Weekly call type without a Circle audience.";
  }
  if (credit.track === "circle" && (context.kind !== "circle_meeting" || !context.circleId)) {
    return "Circle badge credit requires a Circle meeting and a Circle audience.";
  }
  if (credit.track === "in_person") {
    if (!["public_event", "member_event", "retreat"].includes(context.kind)) {
      return "In-person badge credit requires a Member event, Public event, or Retreat.";
    }
    const location = context.locationLabel?.trim() ?? "";
    if (!location || /^(https?:\/\/|online\b|virtual\b|remote\b|google meet\b|zoom\b|teams\b)/i.test(location) || context.meetingUrl) {
      return "In-person badge credit requires a physical location and no online meeting link.";
    }
  }
  return null;
}

export function readExperienceBadgeCredit(metadata: unknown): ExperienceBadgeCredit {
  return isRecord(metadata) ? parseExperienceBadgeCredit(metadata.badge_credit) ?? NO_BADGE_CREDIT : NO_BADGE_CREDIT;
}

/** Omitted credit preserves existing metadata, including unknown future keys. */
export function withExperienceBadgeCredit(metadata: unknown, credit: ExperienceBadgeCredit | undefined): Record<string, unknown> {
  const existing = isRecord(metadata) ? metadata : {};
  return credit === undefined ? { ...existing } : { ...existing, badge_credit: credit };
}

export function experienceBadgeCreditLabel(credit: ExperienceBadgeCredit = NO_BADGE_CREDIT): string {
  if (credit.track === "none") return "No badge credit";
  if (credit.track === "in_person") return "In-person event";
  const stage = credit.stage === "implementation" ? "Implementation" : credit.stage[0].toUpperCase() + credit.stage.slice(1);
  return `${credit.track === "membership" ? "Membership" : "Circle"} · ${stage} · ${credit.month}`;
}
