import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { parseOpsExperienceDraft } from "@/lib/platform/ops-experience-api";
import { createOpsExperience } from "@/lib/platform/ops-experience-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const draft = parseOpsExperienceDraft(await request.json().catch(() => null));
  if (!draft) return opsJson({ error: "A valid Experience draft is required." }, 400);

  try {
    const experience = await createOpsExperience({
      actorAuthUserId: access.viewer.authUserId,
      draft,
    });
    return opsJson({ experience }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience draft could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Experience draft could not be created." }, 503);
  }
}
