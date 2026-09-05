import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { createOpsArtifactAward } from "@/lib/platform/ops-artifact-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AwardBody = {
  acquisitionType?: unknown;
  memberId?: unknown;
  reason?: unknown;
  requestKey?: unknown;
  templateVersionId?: unknown;
};

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as AwardBody | null;
  try {
    const award = await createOpsArtifactAward({
      acquisitionType: typeof body?.acquisitionType === "string" ? body.acquisitionType : "",
      actorAuthUserId: access.viewer.authUserId,
      memberId: typeof body?.memberId === "string" ? body.memberId : "",
      reason: typeof body?.reason === "string" ? body.reason : "",
      requestKey: typeof body?.requestKey === "string" ? body.requestKey : "",
      templateVersionId: typeof body?.templateVersionId === "string" ? body.templateVersionId : "",
    });
    return opsJson({ award }, award.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations Artifact award could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Artifact could not be awarded." }, 503);
  }
}
