import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { deleteMemberRecord, getMemberDeletionEligibility, MemberDeletionError } from "@/lib/platform/member-deletion-repository";
import { processMemberDeletionCleanupBatch } from "@/lib/platform/member-deletion-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ memberId: string }> };

function failure(error: unknown) {
  if (error instanceof MemberDeletionError) return opsJson({ error: error.message }, error.status);
  console.error("Member deletion request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "Member deletion is temporarily unavailable. Refresh the record before trying again." }, 503);
}

export async function GET(_request: Request, context: Context) {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
  try {
    return opsJson({ deletion: await getMemberDeletionEligibility(viewer.authUserId, (await context.params).memberId) });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !["confirmationEmail", "expectedLifecycleVersion", "reason"].includes(key))) {
    return opsJson({ error: "Choose a reason and type the member’s email to confirm." }, 400);
  }
  let cleanupId: string;
  try {
    const result = await deleteMemberRecord({
      actorId: access.viewer.authUserId,
      memberId: (await context.params).memberId,
      confirmationEmail: typeof body.confirmationEmail === "string" ? body.confirmationEmail : "",
      expectedLifecycleVersion: typeof body.expectedLifecycleVersion === "number" ? body.expectedLifecycleVersion : Number.NaN,
      reason: typeof body.reason === "string" ? body.reason : "",
    });
    cleanupId = result.cleanupId;
  } catch (error) { return failure(error); }

  // The member is already deleted and sign-in is disabled. Provider cleanup is
  // durable and retryable; a provider outage must never invite another delete.
  try { await processMemberDeletionCleanupBatch(1, cleanupId); }
  catch (error) { console.error("Member deletion cleanup deferred", { errorType: error instanceof Error ? error.name : "UnknownError" }); }
  return opsJson({ deleted: true, cleanupPending: true });
}
