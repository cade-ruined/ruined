import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  MembershipAccessDeniedError,
  MembershipInputError,
  saveMemberProfile,
  type MemberProfileInput,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

function isDirectory(value: unknown): value is MemberProfileInput["directory"] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.avatarVisible === "boolean" &&
    typeof candidate.bioVisible === "boolean" &&
    typeof candidate.buildingVisible === "boolean" &&
    ["hidden", "circle_visible"].includes(String(candidate.directoryStatus)) &&
    typeof candidate.locationVisible === "boolean" &&
    ["none", "accountability_partner", "circle"].includes(String(candidate.emailScope)) &&
    ["none", "accountability_partner", "circle"].includes(String(candidate.phoneScope)) &&
    Object.keys(candidate).every((key) =>
      [
        "avatarVisible",
        "bioVisible",
        "buildingVisible",
        "directoryStatus",
        "emailScope",
        "locationVisible",
        "phoneScope",
      ].includes(key),
    )
  );
}

function isProfileInput(value: unknown): value is MemberProfileInput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.accessibilityNotes === "string" &&
    typeof candidate.bio === "string" &&
    typeof candidate.buildingNow === "string" &&
    isDirectory(candidate.directory) &&
    typeof candidate.displayName === "string" &&
    typeof candidate.location === "string" &&
    typeof candidate.preferredName === "string" &&
    typeof candidate.timezone === "string" &&
    Object.keys(candidate).every((key) =>
      [
        "accessibilityNotes",
        "bio",
        "buildingNow",
        "directory",
        "displayName",
        "location",
        "preferredName",
        "timezone",
      ].includes(key),
    )
  );
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "Member profiles are not connected." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "JSON is required." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 12_000) {
    return NextResponse.json({ error: "That profile is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid profile is required." }, { status: 400 });
  }
  if (!isProfileInput(body)) {
    return NextResponse.json({ error: "That profile is not valid." }, { status: 400 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless member access is required." }, { status: 401 });
  }
  try {
    const profile = await saveMemberProfile(viewer.authUserId, body);
    return NextResponse.json({ profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MembershipInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof MembershipAccessDeniedError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Member profile could not be saved", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Your profile could not be saved." }, { status: 500 });
  }
}
