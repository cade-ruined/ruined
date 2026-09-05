import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  assignCircleToBlock,
  endCircleBlockAssignment,
  OpsRepositoryError,
} from "@/lib/platform/ops-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BlockCircleAssignmentRequestBody = {
  blockId?: unknown;
  circleId?: unknown;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function repositoryErrorResponse(error: OpsRepositoryError) {
  const status =
    error.code === "forbidden"
      ? 403
      : error.code === "not_found"
        ? 404
        : error.code === "conflict"
          ? 409
          : 400;
  return json({ error: error.message }, status);
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return json({ error: "Request origin is not allowed." }, 403);
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return json({ error: "Operator account access is required." }, 401);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }

  const body = (await request.json().catch(() => null)) as
    | BlockCircleAssignmentRequestBody
    | null;
  const blockId = typeof body?.blockId === "string" ? body.blockId : "";
  const circleId = typeof body?.circleId === "string" ? body.circleId : "";

  try {
    const assignment = await assignCircleToBlock({
      actorAuthUserId: viewer.authUserId,
      blockId,
      circleId,
    });
    return json({ assignment }, assignment.created ? 201 : 200);
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations Block assignment could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Block assignment could not be created." }, 503);
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return json({ error: "Request origin is not allowed." }, 403);
  }

  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return json({ error: "Operator account access is required." }, 401);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }

  const body = (await request.json().catch(() => null)) as
    | BlockCircleAssignmentRequestBody
    | null;
  const circleId = typeof body?.circleId === "string" ? body.circleId : "";

  try {
    const assignment = await endCircleBlockAssignment({
      actorAuthUserId: viewer.authUserId,
      circleId,
    });
    return json({ assignment });
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations Block assignment could not be ended", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Block assignment could not be ended." }, 503);
  }
}
