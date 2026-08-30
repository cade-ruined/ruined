import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { transitionOpsExperience } from "@/lib/platform/ops-experience-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LifecycleBody = { intent?: unknown; reason?: unknown };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as LifecycleBody | null;
  const intent = typeof body?.intent === "string" ? body.intent : "";
  if (!["archive", "cancel", "complete", "publish"].includes(intent)) {
    return opsJson({ error: "Choose a valid Experience action." }, 400);
  }
  if (!Object.keys(body ?? {}).every((key) => key === "intent" || key === "reason")) {
    return opsJson({ error: "That Experience action is not valid." }, 400);
  }
  const { experienceId } = await params;

  try {
    const experience = await transitionOpsExperience({
      actorAuthUserId: access.viewer.authUserId,
      experienceId,
      intent: intent as "archive" | "cancel" | "complete" | "publish",
      reason: typeof body?.reason === "string" ? body.reason : "",
    });
    return opsJson({ experience });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience lifecycle could not be changed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Experience state could not be changed." }, 503);
  }
}
