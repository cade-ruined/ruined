import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  createOpsTask,
  OpsOperatingRepositoryError,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TaskBody = {
  description?: unknown;
  dueAt?: unknown;
  memberId?: unknown;
  priority?: unknown;
  title?: unknown;
};

export async function POST(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as TaskBody | null;

  try {
    const task = await createOpsTask({
      actorAuthUserId: access.viewer.authUserId,
      description: typeof body?.description === "string" ? body.description : "",
      dueAt: typeof body?.dueAt === "string" ? body.dueAt : "",
      memberId: typeof body?.memberId === "string" ? body.memberId : "",
      priority: typeof body?.priority === "string" ? body.priority : "",
      title: typeof body?.title === "string" ? body.title : "",
    });
    return opsJson({ task }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations task could not be created", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The task could not be created." }, 503);
  }
}
