export type MembershipAddressSuggestion = {
  id: string;
  mainText: string;
  secondaryText: string;
};

export type MembershipResolvedAddress = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  countryCode: string;
  postalCode: string;
  region: string;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nestedText(value: unknown): string {
  return cleanString(asRecord(value)?.text);
}

export function parseGoogleAddressSuggestions(
  value: unknown,
): MembershipAddressSuggestion[] {
  const suggestions = asRecord(value)?.suggestions;
  if (!Array.isArray(suggestions)) return [];

  const parsed: MembershipAddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const suggestion of suggestions) {
    const prediction = asRecord(asRecord(suggestion)?.placePrediction);
    if (!prediction) continue;
    const id = cleanString(prediction.placeId);
    const formatting = asRecord(prediction.structuredFormat);
    const fullText = nestedText(prediction.text);
    const mainText = nestedText(formatting?.mainText) || fullText;
    const secondaryText = nestedText(formatting?.secondaryText);
    if (!id || !mainText || seen.has(id)) continue;
    seen.add(id);
    parsed.push({ id, mainText, secondaryText });
    if (parsed.length === 5) break;
  }
  return parsed;
}

type GoogleAddressComponent = {
  longText: string;
  shortText: string;
  types: string[];
};

function parseAddressComponents(value: unknown): GoogleAddressComponent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const component = asRecord(entry);
    if (!component || !Array.isArray(component.types)) return [];
    const types = component.types.filter(
      (type): type is string => typeof type === "string",
    );
    if (!types.length) return [];
    return [{
      longText: cleanString(component.longText),
      shortText: cleanString(component.shortText),
      types,
    }];
  });
}

export function resolvedAddressFromGooglePlace(
  value: unknown,
): MembershipResolvedAddress | null {
  const place = asRecord(value);
  if (!place) return null;
  const postalAddress = asRecord(place.postalAddress);
  const components = parseAddressComponents(place.addressComponents);
  const component = (type: string, short = false) => {
    const match = components.find((entry) => entry.types.includes(type));
    return match ? (short ? match.shortText || match.longText : match.longText || match.shortText) : "";
  };

  const addressLines = Array.isArray(postalAddress?.addressLines)
    ? postalAddress.addressLines.filter(
        (line): line is string => typeof line === "string" && Boolean(line.trim()),
      )
    : [];
  const streetNumber = component("street_number");
  const route = component("route");
  const addressLine1 =
    cleanString(addressLines[0]) ||
    [streetNumber, route].filter(Boolean).join(" ").trim();
  const addressLine2 =
    addressLines.slice(1).map((line) => line.trim()).filter(Boolean).join(", ") ||
    component("subpremise");
  const city =
    cleanString(postalAddress?.locality) ||
    component("locality") ||
    component("postal_town") ||
    component("sublocality_level_1") ||
    component("administrative_area_level_2");
  const region =
    cleanString(postalAddress?.administrativeArea) ||
    component("administrative_area_level_1", true) ||
    component("administrative_area_level_2", true);
  const postalCode =
    cleanString(postalAddress?.postalCode) ||
    [component("postal_code"), component("postal_code_suffix")]
      .filter(Boolean)
      .join("-");
  const rawCountryCode = (
    cleanString(postalAddress?.regionCode) || component("country", true)
  ).toUpperCase();
  const countryCode = rawCountryCode === "UK" ? "GB" : rawCountryCode;

  if (!addressLine1 || !/^[A-Z]{2}$/.test(countryCode)) return null;
  return { addressLine1, addressLine2, city, countryCode, postalCode, region };
}

export function googlePlacesRegionCode(countryCode: string): string {
  return countryCode.toUpperCase() === "GB" ? "uk" : countryCode.toLowerCase();
}
