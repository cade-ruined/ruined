import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  assignResourceToCircle,
  endCircleResourceAssignment,
  OpsRepositoryError,
} from "@/lib/platform/ops-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CircleResourceBody = {
  assignmentId?: unknown;
  circleId?: unknown;
  isPinned?: unknown;
  resourceId?: unknown;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

function repositoryErrorResponse(error: OpsRepositoryError) {
  const status = error.code === "forbidden"
    ? 403
    : error.code === "not_found"
      ? 404
      : error.code === "conflict"
        ? 409
        : 400;
  return json({ error: error.message }, status);
}

async function mutationContext(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return { response: json({ error: "Request origin is not allowed." }, 403) } as const;
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) {
    return { response: json({ error: "Operator account access is required." }, 401) } as const;
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { response: json({ error: "JSON is required." }, 415) } as const;
  }
  return { viewer } as const;
}

export async function POST(request: Request) {
  const context = await mutationContext(request);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as CircleResourceBody | null;
  try {
    const assignment = await assignResourceToCircle({
      actorAuthUserId: context.viewer.authUserId,
      circleId: typeof body?.circleId === "string" ? body.circleId : "",
      isPinned: body?.isPinned === true,
      resourceId: typeof body?.resourceId === "string" ? body.resourceId : "",
    });
    return json({ assignment }, assignment.created ? 201 : 200);
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);
    console.error("Operations Circle resource could not be assigned", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Circle resource could not be assigned." }, 503);
  }
}

export async function PATCH(request: Request) {
  const context = await mutationContext(request);
  if ("response" in context) return context.response;
  const body = (await request.json().catch(() => null)) as CircleResourceBody | null;
  try {
    const assignment = await endCircleResourceAssignment({
      actorAuthUserId: context.viewer.authUserId,
      assignmentId: typeof body?.assignmentId === "string" ? body.assignmentId : "",
    });
    return json({ assignment });
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);
    console.error("Operations Circle resource could not be ended", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Circle resource could not be ended." }, 503);
  }
}
