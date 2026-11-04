import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { getMemberArchiveState, setMemberArchive, MemberArchiveError } from "@/lib/platform/member-archive-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ memberId: string }> };
function failure(error: unknown) {
  if (error instanceof MemberArchiveError) return opsJson({ error: error.message }, error.status);
  console.error("Member archive request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "Member archive is temporarily unavailable. Refresh the record before trying again." }, 503);
}
export async function GET(_request: Request, context: Context) {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
  try { return opsJson({ archive: await getMemberArchiveState(viewer.authUserId, (await context.params).memberId) }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !["action", "expectedVersion", "reason"].includes(key))
    || (body.action !== "archive" && body.action !== "restore")
    || typeof body.reason !== "string" || typeof body.expectedVersion !== "number") {
    return opsJson({ error: "Choose archive or restore and include a reason." }, 400);
  }
  try {
    return opsJson({ archive: await setMemberArchive({ actorId: access.viewer.authUserId,
      memberId: (await context.params).memberId, action: body.action, reason: body.reason, expectedVersion: body.expectedVersion }) });
  } catch (error) { return failure(error); }
}
