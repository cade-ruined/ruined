import { opsJson, opsRepositoryErrorResponse, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { recordCommunityAttendance } from "@/lib/events/community-event-repository";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ eventKey: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.registrationId !== "string" || typeof body.attendanceState !== "string" || !(body.expectedEventId === null || typeof body.expectedEventId === "string")) return opsJson({ error: "Select a registration and attendance." }, 400);
  try {
    const { eventKey } = await params;
    return opsJson(await recordCommunityAttendance(access.viewer.authUserId, eventKey, body.registrationId, body.attendanceState, body.expectedEventId));
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Community attendance could not be saved", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return opsJson({ error: "Attendance could not be saved. Please try again." }, 503);
  }
}
