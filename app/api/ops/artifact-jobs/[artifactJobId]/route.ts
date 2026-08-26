import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  OpsOperatingRepositoryError,
  transitionOpsArtifactJob,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArtifactBody = { nextState?: unknown; reason?: unknown };

export async function PATCH(request: Request, { params }: { params: Promise<{ artifactJobId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as ArtifactBody | null;
  const { artifactJobId } = await params;

  try {
    const artifact = await transitionOpsArtifactJob({
      actorAuthUserId: access.viewer.authUserId,
      artifactJobId,
      nextState: typeof body?.nextState === "string" ? body.nextState : "",
      reason: typeof body?.reason === "string" ? body.reason : "",
    });
    return opsJson({ artifact });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations Artifact work could not be updated", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Artifact work could not be updated." }, 503);
  }
}
