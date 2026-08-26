import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  assignOpsAccountabilityPartner,
  OpsOperatingRepositoryError,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountabilityBody = { circleId?: unknown; memberId?: unknown; partnerMemberId?: unknown };

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as AccountabilityBody | null;

  try {
    const assignment = await assignOpsAccountabilityPartner({
      actorAuthUserId: access.viewer.authUserId,
      circleId: typeof body?.circleId === "string" ? body.circleId : "",
      memberId: typeof body?.memberId === "string" ? body.memberId : "",
      partnerMemberId: typeof body?.partnerMemberId === "string" ? body.partnerMemberId : "",
    });
    return opsJson({ assignment }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations accountability pairing could not be recorded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The accountability pairing could not be recorded." }, 503);
  }
}
