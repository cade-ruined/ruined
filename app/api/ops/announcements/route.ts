import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  createOpsAnnouncement,
  OpsOperatingRepositoryError,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnnouncementBody = { body?: unknown; targetId?: unknown; targetKind?: unknown; title?: unknown };

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as AnnouncementBody | null;

  try {
    const announcement = await createOpsAnnouncement({
      actorAuthUserId: access.viewer.authUserId,
      body: typeof body?.body === "string" ? body.body : "",
      targetId: typeof body?.targetId === "string" ? body.targetId : null,
      targetKind: typeof body?.targetKind === "string" ? body.targetKind : "",
      title: typeof body?.title === "string" ? body.title : "",
    });
    return opsJson({ announcement }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations announcement draft could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The announcement draft could not be created." }, 503);
  }
}
