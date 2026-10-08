import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse } from "@/lib/communications/admin-email-api";
import { opsJson } from "@/lib/platform/ops-api";
import { getResendEmailTemplate } from "@/lib/communications/resend-email-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    const params = await context.params;
    return opsJson({ template: await getResendEmailTemplate(viewer.authUserId, params.id) });
  } catch (error) { return adminEmailErrorResponse(error); }
}
