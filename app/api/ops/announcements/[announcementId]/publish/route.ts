import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  OpsOperatingRepositoryError,
  publishOpsAnnouncement,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ announcementId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.expectedVersion !== "number" || Object.keys(body).some((key) => key !== "expectedVersion")) {
    return opsJson({ error: "Reload and review the latest announcement before publishing." }, 400);
  }
  const { announcementId } = await params;

  try {
    const announcement = await publishOpsAnnouncement({
      actorAuthUserId: access.viewer.authUserId,
      announcementId,
      expectedVersion: body.expectedVersion,
    });
    return opsJson({ announcement });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations announcement could not be published", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The announcement could not be published." }, 503);
  }
}
