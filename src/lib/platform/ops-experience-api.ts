import type { OpsExperienceDraftInput } from "@/lib/platform/ops-experience-model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : typeof value === "string"
      ? value
      : null;
}

export function parseOpsExperienceDraft(
  value: unknown,
): OpsExperienceDraftInput | null {
  if (!isRecord(value)) return null;
  const allowed = new Set([
    "blockId",
    "capacity",
    "circleId",
    "details",
    "endsAt",
    "externalRegistrationUrl",
    "kind",
    "locationLabel",
    "registrationClosesAt",
    "registrationMode",
    "registrationOpensAt",
    "startsAt",
    "summary",
    "timezone",
    "title",
    "visibility",
    "waitlistEnabled",
  ]);
  if (!Object.keys(value).every((key) => allowed.has(key))) return null;

  const capacity = value.capacity === null || value.capacity === ""
    ? null
    : typeof value.capacity === "number"
      ? value.capacity
      : null;
  if (value.capacity !== null && value.capacity !== "" && typeof value.capacity !== "number") {
    return null;
  }
  if (typeof value.waitlistEnabled !== "boolean") return null;

  return {
    blockId: nullableString(value.blockId),
    capacity,
    circleId: nullableString(value.circleId),
    details: stringValue(value.details),
    endsAt: nullableString(value.endsAt),
    externalRegistrationUrl: nullableString(value.externalRegistrationUrl),
    kind: stringValue(value.kind),
    locationLabel: stringValue(value.locationLabel),
    registrationClosesAt: nullableString(value.registrationClosesAt),
    registrationMode: stringValue(value.registrationMode) as OpsExperienceDraftInput["registrationMode"],
    registrationOpensAt: nullableString(value.registrationOpensAt),
    startsAt: stringValue(value.startsAt),
    summary: stringValue(value.summary),
    timezone: stringValue(value.timezone),
    title: stringValue(value.title),
    visibility: stringValue(value.visibility) as OpsExperienceDraftInput["visibility"],
    waitlistEnabled: value.waitlistEnabled,
  };
}
