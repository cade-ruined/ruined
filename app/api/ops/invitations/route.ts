import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  createOrReissueMemberInvitation,
  OpsRepositoryError,
  revokeLiveMemberInvitations,
} from "@/lib/platform/ops-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InvitationRequestBody = {
  email?: unknown;
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

  const body = (await request.json().catch(() => null)) as InvitationRequestBody | null;
  const email = typeof body?.email === "string" ? body.email : "";

  try {
    const invitation = await createOrReissueMemberInvitation({
      actorAuthUserId: viewer.authUserId,
      email,
    });
    return json({ invitation }, invitation.reissued ? 200 : 201);
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations invitation could not be recorded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The invitation could not be recorded." }, 503);
  }
}

export async function DELETE(request: Request) {
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

  const body = (await request.json().catch(() => null)) as InvitationRequestBody | null;
  const email = typeof body?.email === "string" ? body.email : "";

  try {
    const revocation = await revokeLiveMemberInvitations({
      actorAuthUserId: viewer.authUserId,
      email,
    });
    return json({ revocation });
  } catch (error) {
    if (error instanceof OpsRepositoryError) return repositoryErrorResponse(error);

    console.error("Operations invitation could not be revoked", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The invitation could not be revoked." }, 503);
  }
}
