import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { setOpsExperienceRegistration } from "@/lib/platform/ops-experience-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RegistrationBody = {
  action?: unknown;
  memberId?: unknown;
  reason?: unknown;
  registrationId?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as RegistrationBody | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!["cancel", "promote", "register", "waitlist"].includes(action)) {
    return opsJson({ error: "Choose a valid roster action." }, 400);
  }
  if (!Object.keys(body ?? {}).every((key) => (
    key === "action" || key === "memberId" || key === "reason" || key === "registrationId"
  ))) {
    return opsJson({ error: "That roster action is not valid." }, 400);
  }
  const { experienceId } = await params;

  try {
    const registration = await setOpsExperienceRegistration({
      action: action as "cancel" | "promote" | "register" | "waitlist",
      actorAuthUserId: access.viewer.authUserId,
      experienceId,
      memberId: typeof body?.memberId === "string" ? body.memberId : null,
      reason: typeof body?.reason === "string" ? body.reason : "",
      registrationId: typeof body?.registrationId === "string" ? body.registrationId : null,
    });
    return opsJson({ registration });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience roster could not be changed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Experience roster could not be changed." }, 503);
  }
}
