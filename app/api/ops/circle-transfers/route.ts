import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { OpsRepositoryError, transferMemberToCircle } from "@/lib/platform/ops-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator account access is required." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON is required." }, 415);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const transfer = await transferMemberToCircle({
      actorAuthUserId: viewer.authUserId,
      assignmentId: typeof body?.assignmentId === "string" ? body.assignmentId : "",
      fromCircleId: typeof body?.fromCircleId === "string" ? body.fromCircleId : "",
      memberId: typeof body?.memberId === "string" ? body.memberId : "",
      toCircleId: typeof body?.toCircleId === "string" ? body.toCircleId : "",
    });
    // The transaction queues durable follow-up. Never run a provider or the
    // general workflow worker inline with this member-changing request.
    return json({ transfer }, 201);
  } catch (error) {
    if (error instanceof OpsRepositoryError) {
      return json({ error: error.message }, error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400);
    }
    console.error("Operations Circle transfer could not be saved", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "The transfer could not be confirmed. Refresh the member's Circle before trying again." }, 503);
  }
}
