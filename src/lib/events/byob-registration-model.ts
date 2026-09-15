export const BYOB_02_EVENT_KEY = "byob-02" as const;

export const BYOB_02_WAIVER_VERSION =
  "byob-02-risk-acknowledgment-v3" as const;

export const BYOB_02_WAIVER_TITLE =
  "Participation release and risk acknowledgment" as const;

export const BYOB_02_WAIVER_BODY =
  "BYOB Nº 02 is a voluntary outdoor gathering involving strenuous movement, cold or open water, steep or uneven terrain, changing weather, equipment, transportation or carpooling, other participants, and risks of injury, illness, death, or property loss. I confirm that I am able to participate safely, will use equipment responsibly, and will stop when needed. I knowingly and voluntarily assume the inherent and other risks of my participation. To the fullest extent permitted by Utah law, I release and covenant not to sue The Ruined Project LLC; the United States of America, acting through the U.S. Department of Agriculture, Forest Service, including the Uinta-Wasatch-Cache National Forest and Pleasant Grove Ranger District; and North Utah County Water Conservancy District, together with their respective officials, members, managers, officers, directors, employees, agents, volunteers, contractors, successors, and assigns, for claims arising from my participation, including claims based on ordinary negligence. This release does not apply to gross negligence or reckless, willful, or wanton misconduct. Carpooling is voluntary and privately arranged; drivers and passengers are responsible for lawful operation, insurance, seat belts, and vehicle safety, and the released parties do not select or control drivers or vehicles. I confirm that I am at least 18 years old and am registering and accepting this acknowledgment only for myself." as const;

export const BYOB_02_WAIVER_SHA256 =
  "da7a7bdc16508e8159ae431517c14e724de2f6a2388d3eb32482dc56c61006bd" as const;

export const BYOB_02_TANK_HREF = "/store/byob-tank" as const;

export const BYOB_03_EVENT_KEY = "byob-03" as const;
export const BYOB_03_WAIVER_VERSION = "byob-03-risk-acknowledgment-v1" as const;
export const BYOB_03_WAIVER_TITLE = BYOB_02_WAIVER_TITLE;
// Preserve the approved wording exactly; only the named gathering changes.
export const BYOB_03_WAIVER_BODY = BYOB_02_WAIVER_BODY.replace("BYOB Nº 02", "BYOB Nº 03");
export const BYOB_03_WAIVER_SHA256 = "8f13e06c3fc769d6b5cd437d81beb689775154360cb6ca71d62abb1bcc1987f6" as const;

export type ByobEventKey = typeof BYOB_02_EVENT_KEY | typeof BYOB_03_EVENT_KEY;
export type ByobRegistrationConfig = Readonly<{
  eventKey: ByobEventKey;
  title: string;
  registrationPath: string;
  apiPath: string;
  waiverTitle: string;
  waiverBody: string;
  waiverVersion: string;
  waiverSha256: string;
  syncToSheet: boolean;
  showTankOffer: boolean;
}>;

export const BYOB_02_REGISTRATION: ByobRegistrationConfig = Object.freeze({
  eventKey: BYOB_02_EVENT_KEY, title: "BYOB Nº 02",
  registrationPath: "/community/byob-02/register", apiPath: "/api/events/byob-02/register",
  waiverTitle: BYOB_02_WAIVER_TITLE, waiverBody: BYOB_02_WAIVER_BODY,
  waiverVersion: BYOB_02_WAIVER_VERSION, waiverSha256: BYOB_02_WAIVER_SHA256,
  syncToSheet: true, showTankOffer: true,
});
export const BYOB_03_REGISTRATION: ByobRegistrationConfig = Object.freeze({
  eventKey: BYOB_03_EVENT_KEY, title: "BYOB Nº 03",
  registrationPath: "/community/byob-03/register", apiPath: "/api/events/byob-03/register",
  waiverTitle: BYOB_03_WAIVER_TITLE, waiverBody: BYOB_03_WAIVER_BODY,
  waiverVersion: BYOB_03_WAIVER_VERSION, waiverSha256: BYOB_03_WAIVER_SHA256,
  syncToSheet: true, showTankOffer: false,
});

export function getByobRegistrationConfig(eventKey: string): ByobRegistrationConfig | null {
  if (eventKey === BYOB_02_EVENT_KEY) return BYOB_02_REGISTRATION;
  if (eventKey === BYOB_03_EVENT_KEY) return BYOB_03_REGISTRATION;
  return null;
}

export type Byob02RegistrationRequest = Readonly<{
  company?: string;
  email: string;
  firstName: string;
  instagramHandle?: string;
  lastName: string;
  waiverAccepted: boolean;
  waiverVersion: typeof BYOB_02_WAIVER_VERSION;
}>;

export type Byob02RegistrationSubmission = Readonly<{
  emailNormalized: string;
  instagramHandle: string | null;
  registrantFirstName: string;
  registrantLastName: string;
  registrantName: string;
  waiverVersion: typeof BYOB_02_WAIVER_VERSION;
}>;

export type ByobRegistrationSubmission = Omit<Byob02RegistrationSubmission, "waiverVersion"> & Readonly<{ waiverVersion: string }>;

export type Byob02RegistrationSuccess = Readonly<{
  ok: true;
  tankHref: typeof BYOB_02_TANK_HREF;
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INSTAGRAM_HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function normalizeName(value: unknown, maximumLength = 120): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/\s+/gu, " ");
  const length = characterLength(normalized);
  return length >= 1 && length <= maximumLength ? normalized : null;
}

function normalizeInstagramHandle(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase().replace(/^@/, "");
  if (!normalized) return null;
  return INSTAGRAM_HANDLE_PATTERN.test(normalized) ? normalized : undefined;
}

export function parseByob02RegistrationInput(
  value: unknown,
): Byob02RegistrationSubmission | null {
  return parseByobRegistrationInput(value, BYOB_02_REGISTRATION) as Byob02RegistrationSubmission | null;
}

export function parseByobRegistrationInput(
  value: unknown,
  config: ByobRegistrationConfig,
): ByobRegistrationSubmission | null {
  if (!isRecord(value)) return null;
  if ("bringingGuests" in value || "guestNames" in value) return null;

  const registrantFirstName = normalizeName(value.firstName, 80);
  const registrantLastName = normalizeName(value.lastName, 80);
  const registrantName =
    registrantFirstName && registrantLastName
      ? `${registrantFirstName} ${registrantLastName}`
      : null;
  const emailNormalized =
    typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const instagramHandle = normalizeInstagramHandle(value.instagramHandle);

  if (
    !registrantFirstName ||
    !registrantLastName ||
    !registrantName ||
    characterLength(registrantName) > 120 ||
    emailNormalized.length > 254 ||
    !EMAIL_PATTERN.test(emailNormalized) ||
    instagramHandle === undefined ||
    value.waiverAccepted !== true ||
    value.waiverVersion !== config.waiverVersion
  ) {
    return null;
  }

  return {
    emailNormalized,
    instagramHandle,
    registrantFirstName,
    registrantLastName,
    registrantName,
    waiverVersion: config.waiverVersion,
  };
}
