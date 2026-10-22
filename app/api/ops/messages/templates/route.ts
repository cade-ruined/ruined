import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { readCommunicationTemplate, updateCommunicationTemplate } from "@/lib/communications/communication-template-service";
import { opsJson } from "@/lib/platform/ops-api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request: Request) {
  try {
    const viewer=await getCurrentPlatformViewer();
    if (!viewer) return opsJson({error:"Administrator access is required."},401);
    return opsJson(await readCommunicationTemplate(viewer.authUserId,new URL(request.url).searchParams.get("key")));
  } catch(error) { return adminEmailErrorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const access=await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    return opsJson(await updateCommunicationTemplate(access.viewer.authUserId,await readAdminEmailJson(request)));
  } catch(error) { return adminEmailErrorResponse(error); }
}
