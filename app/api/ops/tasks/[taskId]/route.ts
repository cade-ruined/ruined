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
  const body: unknown = await request.json().catch(() => null);
  const { taskId } = await params;

  try {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new OpsOperatingRepositoryError("invalid_request", "Provide a task action and current version.");
    }
    const input = body as Record<string, unknown>;
    if (typeof input.action !== "string" || typeof input.expectedVersion !== "number"
      || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new OpsOperatingRepositoryError("invalid_request", "Provide a task action and current version.");
    }
    const task = await transitionOpsTask({
      action: input.action,
      expectedVersion: input.expectedVersion,
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
