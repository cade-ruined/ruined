import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { parseOpsExperienceDraft } from "@/lib/platform/ops-experience-api";
import { updateOpsExperience } from "@/lib/platform/ops-experience-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const draft = parseOpsExperienceDraft(await request.json().catch(() => null));
  if (!draft) return opsJson({ error: "A valid Experience update is required." }, 400);
  const { experienceId } = await params;

  try {
    const experience = await updateOpsExperience({
      actorAuthUserId: access.viewer.authUserId,
      draft,
      experienceId,
    });
    return opsJson({ experience });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience could not be updated", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Experience could not be updated." }, 503);
  }
}
