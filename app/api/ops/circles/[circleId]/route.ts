import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { archiveEmptyCircle, deleteUnusedCircle } from "@/lib/platform/ops-circle-deletion-repository";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ circleId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function retire(request: Request, context: RouteContext, action: "delete" | "archive") {
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator account access is required." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }
  const body = await request.json().catch(() => null);
  if (!body || Array.isArray(body) || typeof body.confirmationName !== "string"
    || !body.confirmationName.trim() || body.confirmationName.length > 80
    || (action === "archive" && body.action !== "archive")) {
    return json({ error: "Type the Circle's current name to confirm the selected action." }, 400);
  }
  try {
    const { circleId } = await context.params;
    const operation = action === "delete" ? deleteUnusedCircle : archiveEmptyCircle;
    const circle = await operation({ actorAuthUserId: viewer.authUserId, circleId, confirmationName: body.confirmationName });
    return json({ circle });
  } catch (error) {
    if (error instanceof OpsRepositoryError) {
      return json({ error: error.message }, error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400);
    }
    console.error("Operations Circle retirement could not be completed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "The Circle could not be changed. Refresh the list before trying again." }, 503);
  }
}

export function DELETE(request: Request, context: RouteContext) {
  return retire(request, context, "delete");
}

export function PATCH(request: Request, context: RouteContext) {
  return retire(request, context, "archive");
}
