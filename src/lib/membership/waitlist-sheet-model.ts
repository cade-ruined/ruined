export const MEMBERSHIP_WAITLIST_SHEET_TAB = "Waitlist";
export const MEMBERSHIP_WAITLIST_SHEET_HEADERS = [
  "Joined at",
  "Name",
  "Email",
  "Phone",
  "Status",
  "Waitlist ID",
] as const;

// The provisioned tab has 100,000 rows. Fail safely before its grid boundary;
// increase capacity and this limit together if the waitlist grows beyond it.
export const MEMBERSHIP_WAITLIST_SHEET_MAX_ROW = 100_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CanonicalMembershipWaitlistEntry = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  joinedAt: Date;
  sheetRow: number | string;
};

export type MembershipWaitlistSheetRow = [
  joinedAt: string,
  name: string,
  email: string,
  phone: string,
  status: "waiting",
  waitlistId: string,
];

export function isMembershipWaitlistId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function membershipWaitlistSheetRowNumber(value: number | string): number {
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw new Error("Membership waitlist sheet row is invalid.");
  }
  const row = Number(value);
  if (!Number.isSafeInteger(row) || row < 2 || row > MEMBERSHIP_WAITLIST_SHEET_MAX_ROW) {
    throw new Error("Membership waitlist sheet row is invalid.");
  }
  return row;
}

export function buildMembershipWaitlistSheetRow(
  entry: CanonicalMembershipWaitlistEntry,
): MembershipWaitlistSheetRow {
  if (!isMembershipWaitlistId(entry.id)) {
    throw new Error("Membership waitlist ID is invalid.");
  }
  if (!(entry.joinedAt instanceof Date) || Number.isNaN(entry.joinedAt.getTime())) {
    throw new Error("Membership waitlist timestamp is invalid.");
  }
  return [
    entry.joinedAt.toISOString(),
    entry.name,
    entry.email,
    entry.phone ?? "",
    "waiting",
    entry.id,
  ];
}
