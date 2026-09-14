import { opsJson, opsRepositoryErrorResponse, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { saveCommunityEvent } from "@/lib/events/community-event-repository";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !Object.hasOwn(body, "expectedVersion")) return opsJson({ error: "Event details are required." }, 400);
  try {
    const event = await saveCommunityEvent(access.viewer.authUserId, body.event, body.expectedVersion);
    return opsJson({ event });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Community event could not be saved", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return opsJson({ error: "The event could not be saved. Try again after the connection returns." }, 503);
  }
}
