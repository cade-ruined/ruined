import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  activateCircle,
  createCircle,
  OpsRepositoryError,
} from "@/lib/platform/ops-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CircleRequestBody = {
  name?: unknown;
};

type CircleActivationRequestBody = {
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

  const body = (await request.json().catch(() => null)) as CircleRequestBody | null;
  const name = typeof body?.name === "string" ? body.name : "";

  try {
    const circle = await createCircle({ actorAuthUserId: viewer.authUserId, name });
    return json({ circle }, 201);
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations Circle could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Circle could not be created." }, 503);
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

  const body = (await request.json().catch(() => null)) as CircleActivationRequestBody | null;
  const circleId = typeof body?.circleId === "string" ? body.circleId : "";

  try {
    const circle = await activateCircle({
      actorAuthUserId: viewer.authUserId,
      circleId,
    });
    return json({ circle });
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations Circle could not be activated", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The Circle could not be activated." }, 503);
  }
}
