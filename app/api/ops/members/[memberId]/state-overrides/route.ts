import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  OpsOperatingRepositoryError,
  recordOpsMemberStateOverride,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OverrideBody = {
  dimension?: unknown;
  expectedLifecycleVersion?: unknown;
  nextState?: unknown;
  reason?: unknown;
  reasonCode?: unknown;
};

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as OverrideBody | null;
  const { memberId } = await params;

  try {
    const override = await recordOpsMemberStateOverride({
      actorAuthUserId: access.viewer.authUserId,
      dimension: typeof body?.dimension === "string" ? body.dimension : "",
      expectedLifecycleVersion: typeof body?.expectedLifecycleVersion === "number"
        ? body.expectedLifecycleVersion
        : Number.NaN,
      memberId,
      nextState: typeof body?.nextState === "string" ? body.nextState : "",
      reason: typeof body?.reason === "string" ? body.reason : "",
      reasonCode: typeof body?.reasonCode === "string" ? body.reasonCode : "",
    });
    return opsJson({ override }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations member state correction could not be recorded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The state correction could not be recorded." }, 503);
  }
}
