import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  OpsOperatingRepositoryError,
  setOpsGoogleCommunicationLink,
  type OpsGoogleCommunicationEntityType,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GoogleCommunicationBody = {
  entityId?: unknown;
  entityType?: unknown;
  url?: unknown;
};

function communicationEntityType(value: unknown): OpsGoogleCommunicationEntityType | null {
  return value === "circle" || value === "experience" ? value : null;
}

async function mutate(
  request: Request,
  intent: "clear" | "set",
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as GoogleCommunicationBody | null;
  const entityType = communicationEntityType(body?.entityType);
  if (!entityType || typeof body?.entityId !== "string") {
    return opsJson({ error: "Choose a valid Circle or Experience." }, 400);
  }
  if (intent === "set" && typeof body.url !== "string") {
    return opsJson({ error: "A Google link is required." }, 400);
  }

  try {
    const communication = await setOpsGoogleCommunicationLink({
      actorAuthUserId: access.viewer.authUserId,
      entityId: body.entityId,
      entityType,
      url: intent === "set" ? String(body.url) : null,
    });
    return opsJson({ communication });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Google communication link could not be changed", {
      entityType,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The Google communication link could not be changed." }, 503);
  }
}

export async function PUT(request: Request) {
  return mutate(request, "set");
}

export async function DELETE(request: Request) {
  return mutate(request, "clear");
}
