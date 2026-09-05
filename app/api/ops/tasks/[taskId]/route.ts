import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  OpsOperatingRepositoryError,
  transitionOpsTask,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const { taskId } = await params;

  try {
    const task = await transitionOpsTask({
      action: typeof body?.action === "string" ? body.action : "",
      actorAuthUserId: access.viewer.authUserId,
      taskId,
    });
    return opsJson({ task });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations task could not be updated", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The task could not be updated." }, 503);
  }
}
