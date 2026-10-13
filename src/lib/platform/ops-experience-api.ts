import type {
  OpsExperienceCreateAndPublishInput,
  OpsExperienceDraftInput,
} from "@/lib/platform/ops-experience-model";

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

function emailCadenceValue(value: unknown): OpsExperienceDraftInput["emailCadence"] | null {
  if (!isRecord(value) || !Object.keys(value).every(key => ["kind", "track", "cohortMonth"].includes(key))
    || typeof value.kind !== "string" || !["none", "foundations_01", "foundations_02", "foundations_03", "foundations_04", "membership", "circle"].includes(value.kind)
    || typeof value.track !== "string" || !["founder_test", "members"].includes(value.track)
    || (value.cohortMonth !== undefined && (typeof value.cohortMonth !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.cohortMonth)))) return null;
  return { kind: value.kind as NonNullable<OpsExperienceDraftInput["emailCadence"]>["kind"],
    track: value.track as NonNullable<OpsExperienceDraftInput["emailCadence"]>["track"],
    ...(value.cohortMonth === undefined ? {} : { cohortMonth: value.cohortMonth as string }) };
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
    "emailCadence",
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
  const emailCadence = value.emailCadence === undefined ? undefined : emailCadenceValue(value.emailCadence);
  if (emailCadence === null) return null;

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
    ...(emailCadence === undefined ? {} : { emailCadence }),
  };
}

export function parseOpsExperienceCreateAndPublish(
  value: unknown,
): OpsExperienceCreateAndPublishInput | null {
  if (!isRecord(value) || value.intent !== "create_and_publish"
    || typeof value.meetingUrl !== "string" || typeof value.requestId !== "string") {
    return null;
  }
  const meetingUrl = value.meetingUrl;
  const requestId = value.requestId;
  const fields = { ...value };
  delete fields.intent;
  delete fields.meetingUrl;
  delete fields.requestId;
  const draft = parseOpsExperienceDraft(fields);
  return draft ? { ...draft, meetingUrl, requestId } : null;
}
