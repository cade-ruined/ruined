export const REGISTRATION_SHEET_TAB = "Registrants";
export const REGISTRATION_SHEET_HEADERS = [
  "Registered at",
  "First name",
  "Last name",
  "Email",
  "Instagram",
  "Status",
  "Waiver accepted",
  "Waiver version",
  "Registration ID",
] as const;

export const REGISTRATION_ID_COLUMN_INDEX = 8;
export const REGISTRATION_SHEET_TIME_ZONE = "America/Denver";

const GOOGLE_SHEETS_UNIX_EPOCH_OFFSET_DAYS = 25_569;
const MILLISECONDS_PER_DAY = 86_400_000;
const mountainTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  numberingSystem: "latn",
  second: "2-digit",
  timeZone: REGISTRATION_SHEET_TIME_ZONE,
  year: "numeric",
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CanonicalRegistration = {
  email: string;
  eventKey: string;
  firstName: string | null;
  id: string;
  instagram: string | null;
  lastName: string | null;
  registeredAt: Date;
  registrantName: string;
  status: "registered" | "cancelled";
  waiverAcceptedAt: Date;
  waiverVersion: string;
};

export type RegistrationSheetRow = [
  registeredAt: number,
  firstName: string,
  lastName: string,
  email: string,
  instagram: string,
  status: string,
  waiverAcceptedAt: number,
  waiverVersion: string,
  registrationId: string,
];

function asMountainTimeGoogleSerial(value: Date): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Canonical registration timestamp is invalid.");
  }

  const parts = new Map(
    mountainTimeFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const hour = parts.get("hour");
  const minute = parts.get("minute");
  const second = parts.get("second");
  if ([year, month, day, hour, minute, second].some((part) => !Number.isInteger(part))) {
    throw new Error("Canonical registration timestamp is invalid.");
  }

  const mountainWallTime = Date.UTC(
    year!,
    month! - 1,
    day!,
    hour!,
    minute!,
    second!,
  );
  return mountainWallTime / MILLISECONDS_PER_DAY + GOOGLE_SHEETS_UNIX_EPOCH_OFFSET_DAYS;
}

export function isRegistrationId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function buildRegistrationSheetRow(
  record: CanonicalRegistration,
): RegistrationSheetRow {
  if (!isRegistrationId(record.id)) {
    throw new Error("Canonical registration ID is invalid.");
  }

  return [
    asMountainTimeGoogleSerial(record.registeredAt),
    record.firstName || record.registrantName,
    record.lastName || "",
    record.email,
    record.instagram || "",
    record.status,
    asMountainTimeGoogleSerial(record.waiverAcceptedAt),
    record.waiverVersion,
    record.id,
  ];
}

export function findRegistrationSheetRowNumber(
  idRows: ReadonlyArray<ReadonlyArray<unknown>>,
  registrationId: string,
): number | null {
  if (!isRegistrationId(registrationId)) {
    throw new Error("Canonical registration ID is invalid.");
  }

  const normalizedId = registrationId.toLowerCase();
  const matchingRows: number[] = [];
  idRows.forEach((row, index) => {
    const cell = row[0];
    if (
      typeof cell === "string"
      && isRegistrationId(cell.trim())
      && cell.trim().toLowerCase() === normalizedId
    ) {
      matchingRows.push(index + 2);
    }
  });

  if (matchingRows.length > 1) {
    throw new Error("Google registration sheet contains a duplicate registration ID.");
  }
  return matchingRows[0] ?? null;
}
