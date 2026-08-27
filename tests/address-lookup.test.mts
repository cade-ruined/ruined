import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  googlePlacesRegionCode,
  parseGoogleAddressSuggestions,
  resolvedAddressFromGooglePlace,
} from "../src/lib/membership/address-lookup.ts";

const [providerSource, routeSource] = await Promise.all([
  readFile(
    new URL("../src/lib/membership/address-provider.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/api/my/address-lookup/route.ts", import.meta.url),
    "utf8",
  ),
]);

function googleSuggestion(id: string, mainText: string, secondaryText = "") {
  return {
    placePrediction: {
      placeId: id,
      structuredFormat: {
        mainText: { text: mainText },
        secondaryText: { text: secondaryText },
      },
      text: { text: [mainText, secondaryText].filter(Boolean).join(", ") },
    },
  };
}

test("Google suggestion parsing trims, deduplicates, bounds, and filters provider data", () => {
  const suggestions = parseGoogleAddressSuggestions({
    suggestions: [
      googleSuggestion("  place-1  ", "  395 S Main Street  ", "  Alpine, UT  "),
      {
        placePrediction: {
          placeId: "place-2",
          text: { text: "10 Downing Street, London" },
        },
      },
      googleSuggestion("place-1", "Duplicate must not replace the first"),
      { placePrediction: { placeId: "missing-label" } },
      googleSuggestion("place-3", "1 Infinite Loop", "Cupertino, CA"),
      googleSuggestion("place-4", "1600 Amphitheatre Parkway", "Mountain View, CA"),
      googleSuggestion("place-5", "One Apple Park Way", "Cupertino, CA"),
      googleSuggestion("place-6", "Excluded sixth result", "Elsewhere"),
      { queryPrediction: { text: { text: "not a place prediction" } } },
    ],
  });

  assert.deepEqual(suggestions, [
    { id: "place-1", mainText: "395 S Main Street", secondaryText: "Alpine, UT" },
    { id: "place-2", mainText: "10 Downing Street, London", secondaryText: "" },
    { id: "place-3", mainText: "1 Infinite Loop", secondaryText: "Cupertino, CA" },
    {
      id: "place-4",
      mainText: "1600 Amphitheatre Parkway",
      secondaryText: "Mountain View, CA",
    },
    { id: "place-5", mainText: "One Apple Park Way", secondaryText: "Cupertino, CA" },
  ]);
  assert.deepEqual(parseGoogleAddressSuggestions(null), []);
  assert.deepEqual(parseGoogleAddressSuggestions({ suggestions: {} }), []);
});

test("resolved addresses preserve Google's postal line order and normalize UK country codes", () => {
  assert.deepEqual(
    resolvedAddressFromGooglePlace({
      addressComponents: [],
      postalAddress: {
        addressLines: ["  10 Downing Street  ", "Flat 2"],
        administrativeArea: "England",
        locality: "London",
        postalCode: "SW1A 2AA",
        regionCode: "UK",
      },
    }),
    {
      addressLine1: "10 Downing Street",
      addressLine2: "Flat 2",
      city: "London",
      countryCode: "GB",
      postalCode: "SW1A 2AA",
      region: "England",
    },
  );

  assert.deepEqual(
    resolvedAddressFromGooglePlace({
      postalAddress: {
        addressLines: ["千代田1-1", "皇居"],
        administrativeArea: "東京都",
        locality: "千代田区",
        postalCode: "100-8111",
        regionCode: "JP",
      },
    }),
    {
      addressLine1: "千代田1-1",
      addressLine2: "皇居",
      city: "千代田区",
      countryCode: "JP",
      postalCode: "100-8111",
      region: "東京都",
    },
  );
});

test("resolved addresses fall back to typed components without inventing missing fields", () => {
  const component = (
    type: string,
    longText: string,
    shortText = longText,
  ) => ({ longText, shortText, types: [type] });

  assert.deepEqual(
    resolvedAddressFromGooglePlace({
      addressComponents: [
        component("street_number", "395"),
        component("route", "S Main Street", "S Main St"),
        component("subpremise", "Studio 4B"),
        component("locality", "Alpine"),
        component("administrative_area_level_1", "Utah", "UT"),
        component("postal_code", "84004"),
        component("postal_code_suffix", "1234"),
        component("country", "United States", "US"),
      ],
    }),
    {
      addressLine1: "395 S Main Street",
      addressLine2: "Studio 4B",
      city: "Alpine",
      countryCode: "US",
      postalCode: "84004-1234",
      region: "UT",
    },
  );

  assert.deepEqual(
    resolvedAddressFromGooglePlace({
      postalAddress: { addressLines: ["Rural Route 4"], regionCode: "CA" },
    }),
    {
      addressLine1: "Rural Route 4",
      addressLine2: "",
      city: "",
      countryCode: "CA",
      postalCode: "",
      region: "",
    },
  );
  assert.equal(
    resolvedAddressFromGooglePlace({ postalAddress: { regionCode: "US" } }),
    null,
  );
  assert.equal(
    resolvedAddressFromGooglePlace({
      postalAddress: { addressLines: ["Address"], regionCode: "USA" },
    }),
    null,
  );
  assert.equal(resolvedAddressFromGooglePlace([]), null);
});

test("Google region bias uses Google's UK code without changing stored ISO codes", () => {
  assert.equal(googlePlacesRegionCode("GB"), "uk");
  assert.equal(googlePlacesRegionCode("gb"), "uk");
  assert.equal(googlePlacesRegionCode("US"), "us");
  assert.equal(googlePlacesRegionCode("JP"), "jp");
});

test("Places provider keeps its credential server-side and calls only fixed Google endpoints", () => {
  assert.match(providerSource, /^import "server-only";/);
  assert.match(providerSource, /process\.env\.GOOGLE_PLACES_API_KEY/);
  assert.doesNotMatch(providerSource, /NEXT_PUBLIC_[A-Z0-9_]*GOOGLE/);
  assert.match(
    providerSource,
    /https:\/\/places\.googleapis\.com\/v1\/places:autocomplete/,
  );
  assert.match(
    providerSource,
    /https:\/\/places\.googleapis\.com\/v1\/places\/\$\{encodeURIComponent\(placeId\)\}/,
  );
  assert.match(providerSource, /"X-Goog-Api-Key": key/);
  assert.match(providerSource, /cache: "no-store"/);
  assert.match(providerSource, /AbortSignal\.timeout\(4_000\)/);
  assert.match(providerSource, /url\.searchParams\.set\("sessionToken", sessionToken\)/);
  assert.doesNotMatch(providerSource, /[?&]key=/i);
  assert.doesNotMatch(
    providerSource,
    /searchParams\.set\(["'](?:key|apiKey)["']/i,
  );
});

test("Places provider requests only the prediction and address fields the form consumes", () => {
  for (const field of [
    "suggestions.placePrediction.placeId",
    "suggestions.placePrediction.text.text",
    "suggestions.placePrediction.structuredFormat.mainText.text",
    "suggestions.placePrediction.structuredFormat.secondaryText.text",
  ]) {
    assert.match(providerSource, new RegExp(field.replaceAll(".", "\\.")));
  }
  assert.match(providerSource, /"X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK/);
  assert.match(
    providerSource,
    /"X-Goog-FieldMask": "postalAddress,addressComponents"/,
  );
  assert.doesNotMatch(providerSource, /"X-Goog-FieldMask": "\*"/);
  assert.doesNotMatch(providerSource, /displayName/);
  assert.match(providerSource, /return parseGoogleAddressSuggestions\(payload\)/);
  assert.match(providerSource, /return resolvedAddressFromGooglePlace\(payload\)/);
  assert.match(
    providerSource,
    /console\.error\("Google Places request failed", \{ status: response\.status \}\)/,
  );
  for (const sensitive of ["input", "placeId", "sessionToken", "payload"]) {
    assert.doesNotMatch(
      providerSource,
      new RegExp(`console\\.error\\([^;]*\\b${sensitive}\\b`, "s"),
    );
  }
});

test("member address proxy is same-origin, authenticated, bounded, throttled, and non-cacheable", () => {
  assert.match(routeSource, /export async function POST\(request: Request\)/);
  assert.doesNotMatch(routeSource, /export async function GET/);
  assert.match(routeSource, /isTrustedPlatformOrigin\(request\)/);
  assert.match(routeSource, /getCurrentPlatformViewer\(\)/);
  assert.match(routeSource, /getMemberOnboarding\(viewer\.authUserId\)/);
  assert.match(routeSource, /request\.text\(\)/);
  assert.match(routeSource, /rawBody\.length > 3_000/);
  assert.match(routeSource, /Object\.keys\(candidate\)\.every/);
  assert.match(routeSource, /SESSION_TOKEN\.test\(body\.sessionToken\)/);
  assert.match(routeSource, /const limit = action === "suggest" \? 30 : 6/);
  assert.match(routeSource, /"Retry-After": "60"/);
  assert.match(routeSource, /"Cache-Control": "private, no-store"/);
  assert.match(routeSource, /isAddressLookupConfigured\(\)/);
  assert.match(routeSource, /supportedShippingCountry\(body\.regionCode\)/);
  assert.doesNotMatch(routeSource, /process\.env\.GOOGLE_PLACES_API_KEY/);
  assert.doesNotMatch(routeSource, /NEXT_PUBLIC_[A-Z0-9_]*GOOGLE/);

  const originCheck = routeSource.indexOf("isTrustedPlatformOrigin(request)");
  const bodyRead = routeSource.indexOf("await request.text()");
  const viewerCheck = routeSource.indexOf("await getCurrentPlatformViewer()");
  const providerCall = routeSource.indexOf("await findAddressSuggestions({");
  assert.ok(originCheck >= 0 && originCheck < bodyRead);
  assert.ok(bodyRead < viewerCheck);
  assert.ok(viewerCheck < providerCall);

  for (const sensitive of ["rawBody", "body.input", "body.placeId", "body.sessionToken"]) {
    assert.doesNotMatch(
      routeSource,
      new RegExp(`console\\.error\\([^;]*${sensitive.replace(".", "\\.")}`, "s"),
    );
  }
  assert.match(
    routeSource,
    /Address lookup is unavailable\. Enter your address manually\./,
  );
});
