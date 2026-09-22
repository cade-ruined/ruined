import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  completeMemberFoundationRequirement,
  deleteMemberTimelineEntry,
  getMemberTimeline,
  MembershipAccessDeniedError,
  MembershipConflictError,
  MembershipInputError,
  saveMemberTimeline,
  upsertMemberTimelineEntry,
  type MemberTimelineInput,
} from "@/lib/membership/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

type TimelineAction =
  | { action: "complete" }
  | { action: "upsert"; entry: MemberTimelineInput[number]; expectedRevision?: string }
  | { action: "delete"; id: string; expectedRevision?: string }
  | { action: "save"; entries: MemberTimelineInput; expectedRevision?: string };

function isTimelineEntry(value: unknown): value is MemberTimelineInput[number] {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.id === null || typeof candidate.id === "string") &&
    typeof candidate.year === "number" &&
    (candidate.month === undefined || candidate.month === null
      || (typeof candidate.month === "number" && Number.isInteger(candidate.month) && candidate.month >= 1 && candidate.month <= 12)) &&
    typeof candidate.title === "string" &&
    (candidate.details === null || typeof candidate.details === "string") &&
    Object.keys(candidate).every((key) => ["details", "id", "month", "title", "year"].includes(key))
  );
}

function isTimelineAction(value: unknown): value is TimelineAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.action === "complete") {
    return Object.keys(candidate).every((key) => key === "action");
  }
  if (candidate.expectedRevision !== undefined && typeof candidate.expectedRevision !== "string") return false;
  if (candidate.action === "upsert") {
    return isTimelineEntry(candidate.entry)
      && Object.keys(candidate).every(key => ["action", "entry", "expectedRevision"].includes(key));
  }
  if (candidate.action === "delete") {
    return typeof candidate.id === "string"
      && Object.keys(candidate).every(key => ["action", "id", "expectedRevision"].includes(key));
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

export async function GET(request: Request) {
  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json({ error: "The Timeline is not connected." }, { status: 503 });
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in to open your Timeline." }, { status: 401 });
  const expectedOwner = request.headers.get("x-ruined-session-owner");
  if (expectedOwner && expectedOwner !== viewer.authUserId) {
    return NextResponse.json({ error: "The signed-in account changed. Reload before using your Timeline." }, {
      status: 409, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }
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
  const declaredLength = request.headers.get("content-length");
  const contentLength = Number(declaredLength ?? "0");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(contentLength) || contentLength > 250_000)) {
    return NextResponse.json({ error: "That Timeline is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing Timeline body");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 250_000) {
          await reader.cancel();
          return NextResponse.json({ error: "That Timeline request is too large. Save one moment at a time." }, { status: 413 });
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
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
  const expectedOwner = request.headers.get("x-ruined-session-owner");
  if (expectedOwner && expectedOwner !== viewer.authUserId) {
    return NextResponse.json({ error: "The signed-in account changed. Reload before using your Timeline." }, {
      status: 409, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }
  try {
    if (body.action === "complete") {
      const requirements = await completeMemberFoundationRequirement(
        viewer.authUserId,
        "timeline",
      );
      return NextResponse.json({ requirements }, { headers: { "Cache-Control": "no-store" } });
    }
    const revision = body.expectedRevision ?? "";
    const timeline = body.action === "upsert"
      ? await upsertMemberTimelineEntry(viewer.authUserId, body.entry, revision)
      : body.action === "delete"
        ? await deleteMemberTimelineEntry(viewer.authUserId, body.id, revision)
        : await saveMemberTimeline(viewer.authUserId, body.entries, revision);
    return NextResponse.json({ timeline }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
