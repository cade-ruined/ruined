import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  OpsOperatingRepositoryError,
  retryOpsWorkflowAction,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ workflowActionId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  await request.json().catch(() => null);
  const { workflowActionId } = await params;

  try {
    const action = await retryOpsWorkflowAction({
      actorAuthUserId: access.viewer.authUserId,
      workflowActionId,
    });
    return opsJson({ action });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations workflow retry could not be queued", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The retry could not be queued." }, 503);
  }
}
