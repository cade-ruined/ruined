import parsePhoneNumber, {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  type CountryCode,
} from "libphonenumber-js/min";
import englishCountries from "i18n-iso-countries/langs/en.json" with { type: "json" };

export type PhoneCountryOption = {
  callingCode: string;
  code: CountryCode;
  name: string;
};

export type ShippingCountryOption = {
  code: string;
  name: string;
};

const countryNames = englishCountries.countries as Record<string, string | string[]>;
const preferredCountryNames: Record<string, string> = {
  AC: "Ascension Island",
  AE: "United Arab Emirates",
  AX: "Åland Islands",
  CD: "Democratic Republic of the Congo",
  CG: "Republic of the Congo",
  CI: "Côte d'Ivoire",
  CN: "China",
  CZ: "Czechia",
  GB: "United Kingdom",
  GM: "The Gambia",
  IR: "Iran",
  KR: "South Korea",
  MK: "North Macedonia",
  NL: "Netherlands",
  PN: "Pitcairn Islands",
  PS: "Palestine",
  RU: "Russia",
  TA: "Tristan da Cunha",
  TR: "Türkiye",
  TW: "Taiwan",
  TZ: "Tanzania",
  US: "United States",
};

function countryName(code: string): string {
  const preferred = preferredCountryNames[code];
  if (preferred) return preferred;
  const translated = countryNames[code];
  if (Array.isArray(translated)) return translated[0] ?? code;
  return translated ?? code;
}

function parseStrictPhone(value: string, defaultCountry?: CountryCode) {
  return parsePhoneNumber(value, { defaultCountry, extract: false });
}

export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = getCountries()
  .map((code) => ({
    callingCode: `+${getCountryCallingCode(code)}`,
    code,
    name: countryName(code),
  }))
  .sort((left, right) => {
    if (left.code === "US") return -1;
    if (right.code === "US") return 1;
    return left.name.localeCompare(right.name, "en");
  });

export const SHIPPING_COUNTRY_OPTIONS: ShippingCountryOption[] = Object.keys(countryNames)
  .map((code) => ({ code, name: countryName(code) }))
  .sort((left, right) => {
    if (left.code === "US") return -1;
    if (right.code === "US") return 1;
    return left.name.localeCompare(right.name, "en");
  });

const shippingCountryCodes = new Set(SHIPPING_COUNTRY_OPTIONS.map(({ code }) => code));

export function supportedPhoneCountry(value: string | null | undefined): CountryCode | null {
  const candidate = value?.trim().toUpperCase() ?? "";
  return isSupportedCountry(candidate) ? candidate : null;
}

export function supportedShippingCountry(value: string | null | undefined): string | null {
  const candidate = value?.trim().toUpperCase() ?? "";
  return shippingCountryCodes.has(candidate) ? candidate : null;
}

export function phoneCountryFromProfile(
  mobile: string | null | undefined,
  addressCountry: string | null | undefined,
): CountryCode {
  const parsed = mobile?.trim().startsWith("+")
    ? parseStrictPhone(mobile.trim())
    : undefined;
  return parsed?.country ?? supportedPhoneCountry(addressCountry) ?? "US";
}

export function phoneInputFromProfile(
  mobile: string | null | undefined,
  country: CountryCode,
): string {
  if (!mobile?.trim()) return "";
  const parsed = parseStrictPhone(mobile.trim(), country);
  if (!parsed) return mobile.trim();
  return parsed.country === country ? parsed.formatNational() : parsed.formatInternational();
}

export function formatPhoneInput(value: string, country: CountryCode): string {
  const clean = value.trimStart();
  if (!clean) return "";
  const formatter = new AsYouType(clean.startsWith("+") ? undefined : country);
  return formatter.input(clean);
}

export function phoneCountryFromInput(value: string, fallback: CountryCode): CountryCode {
  const clean = value.trim();
  if (!clean.startsWith("+")) return fallback;
  const formatter = new AsYouType();
  formatter.input(clean);
  return formatter.getCountry() ?? fallback;
}

export function phoneInputForCountry(
  value: string,
  currentCountry: CountryCode,
  nextCountry: CountryCode,
): string {
  const clean = value.trim();
  if (!clean) return "";
  const parsed = parseStrictPhone(clean, clean.startsWith("+") ? undefined : currentCountry);
  const nationalNumber = parsed?.nationalNumber ?? clean.replace(/\D/g, "");
  return formatPhoneInput(String(nationalNumber), nextCountry);
}

export function mobileToE164(value: string, country: CountryCode): string | null {
  const clean = value.trim();
  if (!clean) return null;
  const parsed = parseStrictPhone(clean, clean.startsWith("+") ? undefined : country);
  return parsed?.isPossible() && !parsed.ext ? String(parsed.number) : null;
}
