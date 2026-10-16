import { opsJson, opsRepositoryErrorResponse, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { parseExperienceBadgeCredit } from "@/lib/platform/badge-credit-model";
import { updateOpsExperienceBadgeCredit } from "@/lib/platform/ops-experience-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ experienceId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1 || !("badgeCredit" in body)) {
    return opsJson({ error: "A valid badge credit update is required." }, 400);
  }
  const badgeCredit = parseExperienceBadgeCredit(body.badgeCredit);
  if (!badgeCredit) return opsJson({ error: "Choose valid badge credit, stage, and month." }, 400);
  const { experienceId } = await params;
  try {
    const experience = await updateOpsExperienceBadgeCredit({ actorAuthUserId: access.viewer.authUserId, badgeCredit, experienceId });
    return opsJson({ experience });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience badge credit could not be updated", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return opsJson({ error: "Badge credit could not be saved." }, 503);
  }
}
