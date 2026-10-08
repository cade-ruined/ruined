import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse } from "@/lib/communications/admin-email-api";
import { opsJson } from "@/lib/platform/ops-api";
import { getResendEmailOverview, getResendEmailHistory } from "@/lib/communications/resend-email-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    const query = new URL(request.url).searchParams;
    return opsJson(query.has("collection") ? await getResendEmailHistory(viewer.authUserId, query.get("collection")!, query.get("after") ?? undefined)
      : await getResendEmailOverview(viewer.authUserId));
  } catch (error) { return adminEmailErrorResponse(error); }
}
