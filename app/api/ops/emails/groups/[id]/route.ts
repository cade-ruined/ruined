import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse } from "@/lib/communications/admin-email-api";
import { getEmailGroup } from "@/lib/communications/email-group-repository";
import { opsJson } from "@/lib/platform/ops-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    return opsJson(await getEmailGroup(viewer.authUserId, (await context.params).id));
  } catch (error) { return adminEmailErrorResponse(error); }
}
