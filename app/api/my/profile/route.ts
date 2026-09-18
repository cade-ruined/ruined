import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  MembershipAccessDeniedError,
  MembershipInputError,
  MembershipConflictError,
  saveMemberProfile,
  type MemberProfileInput,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { PublicCardError, validateMemberCardInput } from "@/lib/membership/public-card-model";
import { getOwnMemberCard } from "@/lib/membership/public-card-repository";

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
    ["none", "circle"].includes(String(candidate.emailScope)) &&
    ["none", "circle"].includes(String(candidate.phoneScope)) &&
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
  if (candidate.card !== undefined) {
    try { validateMemberCardInput(candidate.card); } catch { return false; }
  }
  return (
    typeof candidate.revision === "string" && /^[0-9a-f]{64}$/.test(candidate.revision) &&
    typeof candidate.websiteUrl === "string" &&
    typeof candidate.accessibilityNotes === "string" &&
    typeof candidate.bio === "string" &&
    typeof candidate.buildingNow === "string" &&
    isDirectory(candidate.directory) &&
    typeof candidate.displayName === "string" &&
    typeof candidate.location === "string" &&
    typeof candidate.memberTag === "string" &&
    typeof candidate.timezone === "string" &&
    Object.keys(candidate).every((key) =>
      [
        "accessibilityNotes",
        "revision",
        "websiteUrl",
        "card",
        "bio",
        "buildingNow",
        "directory",
        "displayName",
        "location",
        "memberTag",
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
  if (Number.isFinite(contentLength) && contentLength > 24_000) {
    return NextResponse.json({ error: "That profile is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing profile");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 24_000) { await reader.cancel(); return NextResponse.json({ error: "That profile is too large." }, { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = JSON.parse(new TextDecoder().decode(bytes));
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
    const card = await getOwnMemberCard(viewer.authUserId).catch(() => null);
    return NextResponse.json({ profile, card }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MembershipConflictError || error instanceof PublicCardError) {
      return NextResponse.json({ error: error.message, ...(error instanceof MembershipConflictError && error.code ? { code: error.code } : {}) }, { status: error instanceof PublicCardError ? error.status : 409 });
    }
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
