import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { getMemberLifecycleEmailOverview, updateMemberLifecycleEmail } from "@/lib/communications/member-lifecycle-email-service";
import { isLifecycleKey } from "@/lib/communications/member-lifecycle-email-model";
import { opsJson } from "@/lib/platform/ops-api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const viewer=await getCurrentPlatformViewer();
    if (!viewer) return opsJson({error:"Administrator access is required."},401);
    const key=new URL(request.url).searchParams.get("key");
    if (key!==null && !isLifecycleKey(key)) throw new AdminEmailError(400,"Choose a recurring message.");
    const result=await getMemberLifecycleEmailOverview(viewer.authUserId,key ?? undefined);
    return opsJson(key ? result.items[0] ?? {error:"Recurring messages need setup."} : result,key && !result.items.length ? 503 : 200);
  } catch(error) { return adminEmailErrorResponse(error); }
}
export async function PATCH(request:Request) {
  try {
    const access=await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const result=await updateMemberLifecycleEmail(access.viewer.authUserId,await readAdminEmailJson(request));
    return opsJson(result.items[0]);
  } catch(error) { return adminEmailErrorResponse(error); }
}
