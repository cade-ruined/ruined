import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import { sendOpsNotification } from "@/lib/platform/ops-notification-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NotificationBody = {
  actionLabel?: unknown;
  actionUrl?: unknown;
  body?: unknown;
  notificationType?: unknown;
  targetId?: unknown;
  targetType?: unknown;
  title?: unknown;
};

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as NotificationBody | null;
  try {
    const dispatch = await sendOpsNotification({
      actionLabel: typeof body?.actionLabel === "string" ? body.actionLabel : null,
      actionUrl: typeof body?.actionUrl === "string" ? body.actionUrl : null,
      actorAuthUserId: access.viewer.authUserId,
      body: typeof body?.body === "string" ? body.body : "",
      notificationType: typeof body?.notificationType === "string" ? body.notificationType : "",
      requestKey: request.headers.get("idempotency-key") ?? "",
      targetId: typeof body?.targetId === "string" ? body.targetId : null,
      targetType: typeof body?.targetType === "string" ? body.targetType : "",
      title: typeof body?.title === "string" ? body.title : "",
    });
    return opsJson({ dispatch }, dispatch.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations notification could not be sent", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The notification could not be sent." }, 503);
  }
}
