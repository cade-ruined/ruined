import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse } from "@/lib/communications/admin-email-api";
import { searchEmailGroupPeople } from "@/lib/communications/email-group-repository";
import { opsJson } from "@/lib/platform/ops-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    return opsJson(await searchEmailGroupPeople(viewer.authUserId, new URL(request.url).searchParams.get("q") ?? ""));
  } catch (error) { return adminEmailErrorResponse(error); }
}
