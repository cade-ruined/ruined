import {
  opsJson,
  opsRepositoryErrorResponse,
  requireOpsMutationRequest,
} from "@/lib/platform/ops-api";
import {
  appendOpsMemberNote,
  OpsOperatingRepositoryError,
} from "@/lib/platform/ops-operating-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NoteBody = { body?: unknown; category?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = (await request.json().catch(() => null)) as NoteBody | null;
  const { memberId } = await params;

  try {
    const note = await appendOpsMemberNote({
      actorAuthUserId: access.viewer.authUserId,
      body: typeof body?.body === "string" ? body.body : "",
      category: typeof body?.category === "string" ? body.category : "",
      memberId,
    });
    return opsJson({ note }, 201);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
    console.error("Operations member note could not be recorded", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return opsJson({ error: "The note could not be recorded." }, 503);
  }
}
