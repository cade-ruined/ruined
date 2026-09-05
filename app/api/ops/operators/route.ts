import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import {
  createOrReissueOperatorInvitation,
  OpsAccessRepositoryError,
  removeOperatorAccess,
  revokeOperatorInvitation,
  type OperatorAccessRole,
} from "@/lib/platform/ops-access-repository";
import {
  PasswordlessDeliveryError,
  sendInvitedOperatorAccessCode,
} from "@/lib/supabase/passwordless-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  circleIds?: unknown;
  displayName?: unknown;
  email?: unknown;
  role?: unknown;
};

type RemoveBody = {
  authUserId?: unknown;
  email?: unknown;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function repositoryError(error: OpsAccessRepositoryError) {
  const status = error.code === "forbidden"
    ? 403
    : error.code === "not_found"
      ? 404
      : error.code === "conflict"
        ? 409
        : 400;
  return json({ error: error.message }, status);
}

function isOperatorRole(value: unknown): value is OperatorAccessRole {
  return value === "ops_admin" || value === "circle_leader" || value === "guide";
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return json({ error: "Request origin is not allowed." }, 403);
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator account access is required." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  const circleIds = Array.isArray(body?.circleIds)
    ? body.circleIds.filter((value): value is string => typeof value === "string")
    : [];
  const role = isOperatorRole(body?.role) ? body.role : null;
  if (!role) return json({ error: "Choose an operator responsibility." }, 400);

  try {
    const invitation = await createOrReissueOperatorInvitation({
      actorAuthUserId: viewer.authUserId,
      circleIds,
      displayName: typeof body?.displayName === "string" ? body.displayName : "",
      email: typeof body?.email === "string" ? body.email : "",
      role,
    });

    try {
      await sendInvitedOperatorAccessCode(invitation.entry.email);
      return json({ delivery: "sent", invitation }, invitation.reissued ? 200 : 201);
    } catch (error) {
      if (error instanceof PasswordlessDeliveryError) {
        console.warn("Operator invitation was recorded but its access code was not delivered", {
          errorCode: error.code,
        });
        return json({ delivery: "not_sent", invitation }, 202);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof OpsAccessRepositoryError) return repositoryError(error);
    console.error("Operator invitation could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The operator invitation could not be created." }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return json({ error: "Request origin is not allowed." }, 403);
  }
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator account access is required." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON is required." }, 415);
  }

  const body = (await request.json().catch(() => null)) as RemoveBody | null;
  const authUserId = typeof body?.authUserId === "string" ? body.authUserId : "";
  const email = typeof body?.email === "string" ? body.email : "";

  try {
    if (authUserId) {
      return json({ removal: await removeOperatorAccess({
        actorAuthUserId: viewer.authUserId,
        targetAuthUserId: authUserId,
      }) });
    }
    return json({ revocation: await revokeOperatorInvitation({
      actorAuthUserId: viewer.authUserId,
      email,
    }) });
  } catch (error) {
    if (error instanceof OpsAccessRepositoryError) return repositoryError(error);
    console.error("Operator access could not be removed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "Operator access could not be removed." }, 503);
  }
}
