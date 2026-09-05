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
  await request.json().catch(() => null);
  const { announcementId } = await params;

  try {
    const announcement = await publishOpsAnnouncement({
      actorAuthUserId: access.viewer.authUserId,
      announcementId,
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
