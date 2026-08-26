import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  CircleRequiredForFoundationCompletionError,
  completeMemberFoundations,
  FoundationAccessError,
  FoundationSequenceError,
  FoundationUnavailableError,
  recordMemberFoundationProgress,
  startMemberFoundations,
} from "@/lib/foundations/repository";
import { getPlatformConfiguration } from "@/lib/platform/config";

export const runtime = "nodejs";

type FoundationAction =
  | { action: "complete" }
  | { action: "progress"; momentId: string }
  | { action: "start" };

function isFoundationAction(value: unknown): value is FoundationAction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.action === "start" || candidate.action === "complete") {
    return Object.keys(candidate).every((key) => key === "action");
  }
  return (
    candidate.action === "progress" &&
    typeof candidate.momentId === "string" &&
    candidate.momentId.length > 0 &&
    candidate.momentId.length <= 80 &&
    Object.keys(candidate).every((key) => key === "action" || key === "momentId")
  );
}

function errorResponse(error: unknown) {
  if (error instanceof CircleRequiredForFoundationCompletionError) {
    return NextResponse.json(
      {
        code: "circle_required",
        error: "Join an active Circle before completing Foundations.",
      },
      { status: 409 },
    );
  }
  if (error instanceof FoundationSequenceError) {
    return NextResponse.json(
      { code: "sequence_conflict", error: error.message },
      { status: 409 },
    );
  }
  if (error instanceof FoundationAccessError) {
    return NextResponse.json(
      { code: "access_denied", error: error.message },
      { status: 403 },
    );
  }
  if (error instanceof FoundationUnavailableError) {
    return NextResponse.json(
      { code: "foundations_unavailable", error: error.message },
      { status: 503 },
    );
  }

  console.error("Foundations action failed", {
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    { code: "foundations_error", error: "Foundations is temporarily unavailable." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json(
      { code: "origin_denied", error: "Request origin is not allowed." },
      { status: 403 },
    );
  }

  if (getPlatformConfiguration().mode !== "connected") {
    return NextResponse.json(
      { code: "platform_unavailable", error: "Member progress is not connected." },
      { status: 503 },
    );
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { code: "invalid_content_type", error: "JSON is required." },
      { status: 415 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return NextResponse.json(
      { code: "request_too_large", error: "That Foundations action is too large." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "invalid_request", error: "A valid Foundations action is required." },
      { status: 400 },
    );
  }

  if (!isFoundationAction(body)) {
    return NextResponse.json(
      { code: "invalid_request", error: "That Foundations action is not supported." },
      { status: 400 },
    );
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return NextResponse.json(
      { code: "authentication_required", error: "Passwordless member access is required." },
      { status: 401 },
    );
  }

  try {
    const state =
      body.action === "start"
        ? await startMemberFoundations(viewer)
        : body.action === "progress"
          ? await recordMemberFoundationProgress(viewer, body.momentId)
          : await completeMemberFoundations(viewer);

    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return errorResponse(error);
  }
}
