import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  completeMemberFoundationRequirement,
  getMemberTimeline,
  MembershipAccessDeniedError,
  MembershipConflictError,
  MembershipInputError,
  saveMemberTimeline,
  type MemberTimelineInput,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

type TimelineAction =
  | { action: "complete" }
  | { action: "save"; entries: MemberTimelineInput; expectedRevision?: string };

function isTimelineEntry(value: unknown): value is MemberTimelineInput[number] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.id === null || typeof candidate.id === "string") &&
    typeof candidate.year === "number" &&
    typeof candidate.title === "string" &&
    (candidate.details === null || typeof candidate.details === "string") &&
    Object.keys(candidate).every((key) => ["details", "id", "title", "year"].includes(key))
  );
}

function isTimelineAction(value: unknown): value is TimelineAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.action === "complete") {
    return Object.keys(candidate).every((key) => key === "action");
  }
  return (
    candidate.action === "save" &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isTimelineEntry) &&
    (candidate.expectedRevision === undefined || typeof candidate.expectedRevision === "string") &&
    Object.keys(candidate).every((key) => ["action", "entries", "expectedRevision"].includes(key))
  );
}

function errorResponse(error: unknown) {
  if (error instanceof MembershipInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof MembershipConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof MembershipAccessDeniedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  console.error("Ruined Timeline action failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json({ error: "Your Timeline could not be saved." }, { status: 500 });
}

export async function GET() {
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "The Timeline is not connected." }, { status: 503 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in to open your Timeline." }, { status: 401 });
  try {
    const timeline = await getMemberTimeline(viewer.authUserId);
    return NextResponse.json({ timeline }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "The Timeline is not connected." }, { status: 503 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "JSON is required." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 250_000) {
    return NextResponse.json({ error: "That Timeline is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid Timeline action is required." }, { status: 400 });
  }
  if (!isTimelineAction(body)) {
    return NextResponse.json({ error: "That Timeline action is not supported." }, { status: 400 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Passwordless member access is required." }, { status: 401 });
  }
  try {
    if (body.action === "complete") {
      const requirements = await completeMemberFoundationRequirement(
        viewer.authUserId,
        "timeline",
      );
      return NextResponse.json({ requirements }, { headers: { "Cache-Control": "no-store" } });
    }
    const timeline = await saveMemberTimeline(viewer.authUserId, body.entries, body.expectedRevision ?? "");
    return NextResponse.json({ timeline }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
