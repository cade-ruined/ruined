import { opsJson, opsRepositoryErrorResponse, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { bindLegacyExperienceCalendar } from "@/lib/platform/ops-calendar-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ experienceId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.livemode !== "boolean" || Object.keys(body).some((key) => key !== "livemode")) {
    return opsJson({ error: "Explicitly choose the Calendar delivery mode." }, 400);
  }
  try {
    const { experienceId } = await params;
    const calendar = await bindLegacyExperienceCalendar({ actorAuthUserId: access.viewer.authUserId, experienceId, livemode: body.livemode });
    return opsJson({ calendar });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    return opsJson({ error: "Google could not verify that existing invitation. Nothing was bound or sent." }, 503);
  }
}
