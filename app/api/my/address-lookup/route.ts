import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  AddressProviderError,
  findAddressSuggestions,
  isAddressLookupConfigured,
  resolveAddressSuggestion,
} from "@/lib/membership/address-provider";
import type {
  MembershipAddressSuggestion,
  MembershipResolvedAddress,
} from "@/lib/membership/address-lookup";
import { supportedShippingCountry } from "@/lib/membership/phone";
import {
  getMemberOnboarding,
  MembershipAccessDeniedError,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

const SESSION_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACE_ID = /^[A-Za-z0-9_-]{8,255}$/;
const PREVIEW_PLACE_ID = "preview-ruined-alpine";
const PREVIEW_SUGGESTION: MembershipAddressSuggestion = {
  id: PREVIEW_PLACE_ID,
  mainText: "395 S Main Street",
  secondaryText: "Alpine, UT 84004, United States",
};
const PREVIEW_ADDRESS: MembershipResolvedAddress = {
  addressLine1: "395 S Main Street",
  addressLine2: "",
  city: "Alpine",
  countryCode: "US",
  postalCode: "84004",
  region: "UT",
};

type LookupRequest =
  | {
      action: "suggest";
      input: string;
      regionCode: string | null;
      sessionToken: string;
    }
  | {
      action: "resolve";
      placeId: string;
      sessionToken: string;
    };

type RateWindow = { count: number; startedAt: number };
const rateWindows = new Map<string, RateWindow>();

function pruneLookupRateLimits(now: number) {
  if (rateWindows.size < 500) return;
  for (const [storedKey, window] of rateWindows) {
    if (now - window.startedAt >= 60_000) rateWindows.delete(storedKey);
  }
  if (rateWindows.size < 500) return;
  const oldestKeys = [...rateWindows.entries()]
    .sort((left, right) => left[1].startedAt - right[1].startedAt)
    .slice(0, rateWindows.size - 400)
    .map(([storedKey]) => storedKey);
  for (const storedKey of oldestKeys) rateWindows.delete(storedKey);
}

function consumeLookupRateLimit(
  viewerId: string,
  action: LookupRequest["action"],
): boolean {
  const now = Date.now();
  const key = `${viewerId}:${action}`;
  const limit = action === "suggest" ? 30 : 6;
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(key, { count: 1, startedAt: now });
    pruneLookupRateLimits(now);
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  pruneLookupRateLimits(now);
  return true;
}

function isLookupRequest(value: unknown): value is LookupRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.action === "suggest" &&
    typeof candidate.input === "string" &&
    (candidate.regionCode === null || typeof candidate.regionCode === "string") &&
    typeof candidate.sessionToken === "string"
  ) {
    return Object.keys(candidate).every((key) =>
      ["action", "input", "regionCode", "sessionToken"].includes(key),
    );
  }
  if (
    candidate.action === "resolve" &&
    typeof candidate.placeId === "string" &&
    typeof candidate.sessionToken === "string"
  ) {
    return Object.keys(candidate).every((key) =>
      ["action", "placeId", "sessionToken"].includes(key),
    );
  }
  return false;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return json({ error: "Request origin is not allowed." }, 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 3_000) {
    return json({ error: "That request is too large." }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: "A valid address lookup request is required." }, 400);
  }
  if (rawBody.length > 3_000) {
    return json({ error: "That request is too large." }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "A valid address lookup request is required." }, 400);
  }
  if (!isLookupRequest(body) || !SESSION_TOKEN.test(body.sessionToken)) {
    return json({ error: "That address lookup request is not supported." }, 400);
  }

  const configuration = getPlatformConfiguration();
  const preview = configuration.mode === "preview";
  if (!preview && configuration.mode !== "connected") {
    return json({ error: "Address lookup is unavailable. Enter your address manually." }, 503);
  }
  if (!preview) {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) {
      return json({ error: "Passwordless member access is required." }, 401);
    }
    try {
      const onboarding = await getMemberOnboarding(viewer.authUserId);
      if (!onboarding) {
        return json({ error: "Ruined Membership access is required." }, 403);
      }
    } catch (error) {
      if (error instanceof MembershipAccessDeniedError) {
        return json({ error: "Ruined Membership access is required." }, 403);
      }
      console.error("Member address lookup access check failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return json({ error: "Address lookup is unavailable. Enter your address manually." }, 503);
    }
    if (!consumeLookupRateLimit(viewer.authUserId, body.action)) {
      return NextResponse.json(
        { error: "Too many address searches. Wait a minute, then try again." },
        {
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": "60",
          },
          status: 429,
        },
      );
    }
    if (!isAddressLookupConfigured()) {
      return json({ error: "Address lookup is not connected. Enter your address manually." }, 503);
    }
  }

  try {
    if (body.action === "suggest") {
      const input = body.input.trim().replace(/\s+/g, " ");
      if (input.length < 3 || input.length > 180) {
        return json({ error: "Type at least three characters to find an address." }, 400);
      }
      const regionCode = body.regionCode
        ? supportedShippingCountry(body.regionCode)
        : null;
      if (body.regionCode && !regionCode) {
        return json({ error: "Choose a recognized country." }, 400);
      }
      const suggestions = preview
        ? [PREVIEW_SUGGESTION]
        : await findAddressSuggestions({
            input,
            regionCode,
            sessionToken: body.sessionToken,
          });
      return json({ suggestions });
    }

    const placeId = body.placeId.trim();
    if (
      (!preview && !PLACE_ID.test(placeId)) ||
      (preview && placeId !== PREVIEW_PLACE_ID)
    ) {
      return json({ error: "Choose an address from the search results." }, 400);
    }
    const address = preview
      ? PREVIEW_ADDRESS
      : await resolveAddressSuggestion({
          placeId,
          sessionToken: body.sessionToken,
        });
    if (!address) {
      return json(
        { error: "That result did not include a complete street address. Enter it manually." },
        422,
      );
    }
    return json({ address });
  } catch (error) {
    if (!(error instanceof AddressProviderError)) {
      console.error("Member address lookup failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return json({ error: "Address lookup is unavailable. Enter your address manually." }, 503);
  }
}
