import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { syncOpsExperienceCalendar } from "@/lib/platform/ops-calendar-repository";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CalendarBody = { intent?: unknown };

function requestKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9:._/-]{15,199}$/.test(value) ? value : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ experienceId: string }> },
) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const idempotencyKey = requestKey(request);
  if (!idempotencyKey) {
    return opsJson({ error: "A valid Idempotency-Key is required." }, 400);
  }

  const body = (await request.json().catch(() => null)) as CalendarBody | null;
  const intent = typeof body?.intent === "string" ? body.intent : "";
  if (!["cancel", "create", "sync"].includes(intent)) {
    return opsJson({ error: "Choose a valid Calendar action." }, 400);
  }
  if (!Object.keys(body ?? {}).every((key) => key === "intent")) {
    return opsJson({ error: "That Calendar action is not valid." }, 400);
  }
  const { experienceId } = await params;

  try {
    const calendar = await syncOpsExperienceCalendar({
      actorAuthUserId: access.viewer.authUserId,
      experienceId,
      intent: intent as "cancel" | "create" | "sync",
      requestKey: idempotencyKey,
    });
    return opsJson({ calendar });
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Experience Calendar sync could not be completed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      intent,
    });
    return opsJson({ error: "Google Calendar could not complete that request. Try again." }, 503);
  }
}
