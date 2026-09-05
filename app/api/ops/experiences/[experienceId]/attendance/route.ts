import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { recordOpsExperienceAttendance } from "@/lib/platform/ops-experience-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AttendanceBody = { eventType?: unknown; reason?: unknown; registrationId?: unknown };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as AttendanceBody | null;
  if (
    typeof body?.registrationId !== "string" ||
    typeof body?.eventType !== "string" ||
    !Object.keys(body).every((key) => (
      key === "eventType" || key === "reason" || key === "registrationId"
    ))
  ) {
    return opsJson({ error: "A valid attendance action is required." }, 400);
  }
  const { experienceId } = await params;

  try {
    const attendance = await recordOpsExperienceAttendance({
      actorAuthUserId: access.viewer.authUserId,
      eventType: body.eventType,
      experienceId,
      reason: typeof body.reason === "string" ? body.reason : "",
      registrationId: body.registrationId,
    });
    return opsJson({ attendance });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience attendance could not be recorded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The attendance mark could not be saved." }, 503);
  }
}
