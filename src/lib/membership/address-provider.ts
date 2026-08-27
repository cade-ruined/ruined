import "server-only";

import {
  googlePlacesRegionCode,
  parseGoogleAddressSuggestions,
  resolvedAddressFromGooglePlace,
  type MembershipAddressSuggestion,
  type MembershipResolvedAddress,
} from "@/lib/membership/address-lookup";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const AUTOCOMPLETE_FIELD_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
].join(",");

export class AddressProviderError extends Error {
  constructor(message = "Address lookup is temporarily unavailable.") {
    super(message);
    this.name = "AddressProviderError";
  }
}

function apiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

export function isAddressLookupConfigured(): boolean {
  return Boolean(apiKey());
}

async function googleResponse(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new AddressProviderError("Address lookup is not connected.");
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        ...init.headers,
        "X-Goog-Api-Key": key,
      },
      signal: AbortSignal.timeout(4_000),
    });
  } catch {
    throw new AddressProviderError();
  }
  if (!response.ok) {
    console.error("Google Places request failed", { status: response.status });
    throw new AddressProviderError();
  }
  try {
    return await response.json();
  } catch {
    throw new AddressProviderError();
  }
}

export async function findAddressSuggestions({
  input,
  regionCode,
  sessionToken,
}: {
  input: string;
  regionCode: string | null;
  sessionToken: string;
}): Promise<MembershipAddressSuggestion[]> {
  const payload = await googleResponse(AUTOCOMPLETE_URL, {
    body: JSON.stringify({
      includeQueryPredictions: false,
      input,
      ...(regionCode
        ? {
            includedRegionCodes: [googlePlacesRegionCode(regionCode)],
            regionCode: googlePlacesRegionCode(regionCode),
          }
        : {}),
      sessionToken,
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
    },
    method: "POST",
  });
  return parseGoogleAddressSuggestions(payload);
}

export async function resolveAddressSuggestion({
  placeId,
  sessionToken,
}: {
  placeId: string;
  sessionToken: string;
}): Promise<MembershipResolvedAddress | null> {
  const url = new URL(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
  );
  url.searchParams.set("sessionToken", sessionToken);
  const payload = await googleResponse(url.toString(), {
    headers: {
      "Content-Type": "application/json",
      "X-Goog-FieldMask": "postalAddress,addressComponents",
    },
    method: "GET",
  });
  return resolvedAddressFromGooglePlace(payload);
}
