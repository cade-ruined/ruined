import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  assignMemberToCircle,
  endMemberCircleAssignment,
  OpsRepositoryError,
} from "@/lib/platform/ops-repository";
import { processWorkflowBatch } from "@/lib/workflows/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CircleAssignmentRequestBody = {
  circleId?: unknown;
  memberId?: unknown;
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

  const body = (await request.json().catch(() => null)) as CircleAssignmentRequestBody | null;
  const circleId = typeof body?.circleId === "string" ? body.circleId : "";
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";

  try {
    const assignment = await assignMemberToCircle({
      actorAuthUserId: viewer.authUserId,
      circleId,
      memberId,
    });
    if (assignment.created) {
      try {
        await processWorkflowBatch(6);
      } catch (workflowError) {
        console.error("Circle assignment follow-up could not run", {
          errorType: workflowError instanceof Error ? workflowError.name : "UnknownError",
        });
      }
    }
    return json({ assignment }, assignment.created ? 201 : 200);
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations Circle assignment could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Circle assignment could not be created." }, 503);
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

  const body = (await request.json().catch(() => null)) as CircleAssignmentRequestBody | null;
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";

  try {
    const assignment = await endMemberCircleAssignment({
      actorAuthUserId: viewer.authUserId,
      memberId,
    });
    return json({ assignment });
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations Circle assignment could not be ended", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Circle assignment could not be ended." }, 503);
  }
}
