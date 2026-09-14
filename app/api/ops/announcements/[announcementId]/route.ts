import { opsJson, opsRepositoryErrorResponse, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { correctOpsAnnouncement, OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)
    || !["edit", "discard", "retract"].includes(body.action)
    || !Object.keys(body).every((key) => ["action", "expectedVersion", "title", "body", "targetKind", "targetId", "reason"].includes(key))
    || typeof body.expectedVersion !== "number"
    || ["title", "body", "targetKind", "reason"].some((key) => body[key] !== undefined && typeof body[key] !== "string")
    || (body.targetId !== undefined && body.targetId !== null && typeof body.targetId !== "string")) {
    return opsJson({ error: "A valid announcement correction is required." }, 400);
  }
  const { announcementId } = await params;
  try {
    const announcement = await correctOpsAnnouncement({ ...body, actorAuthUserId: access.viewer.authUserId, announcementId });
    return opsJson({ announcement });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Announcement correction failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return opsJson({ error: "The announcement could not be changed." }, 503);
  }
}
