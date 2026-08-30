import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { changeOpsAcademyResourceState } from "@/lib/platform/ops-academy-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StateBody = { action?: unknown; expectedRevision?: unknown };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as StateBody | null;
  const { resourceId } = await params;
  const action = body?.action;
  if (action !== "publish" && action !== "unpublish" && action !== "retire") {
    return opsJson({ error: "Choose a valid Academy state change." }, 400);
  }
  try {
    const resource = await changeOpsAcademyResourceState(access.viewer.authUserId, {
      action,
      expectedRevision: typeof body?.expectedRevision === "number" ? body.expectedRevision : Number.NaN,
      resourceId,
    });
    return opsJson({ resource });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Academy state could not be changed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Academy state could not be changed." }, 503);
  }
}
