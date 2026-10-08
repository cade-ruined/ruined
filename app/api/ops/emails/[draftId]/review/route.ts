import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { previewAdminEmailDraft } from "@/lib/communications/admin-email-repository";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const { draftId } = await context.params;
    const body = await readAdminEmailJson(request);
    const review = await previewAdminEmailDraft({ actorAuthUserId: access.viewer.authUserId, draftId, expectedVersion: body.expectedVersion as number });
    return opsJson({ review });
  } catch (error) { return adminEmailErrorResponse(error); }
}
