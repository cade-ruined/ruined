import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { getEmailGroupCampaigns, saveEmailGroupCampaign, reviewEmailGroupCampaign, queueEmailGroupCampaign } from "@/lib/communications/email-group-campaign-service";
import { opsJson } from "@/lib/platform/ops-api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request) {
  try {
    const viewer=await getCurrentPlatformViewer();if(!viewer) return opsJson({error:"Administrator access is required."},401);
    return opsJson(await getEmailGroupCampaigns(viewer.authUserId,new URL(request.url).searchParams.get("id")));
  } catch(error) {return adminEmailErrorResponse(error);}
}
export async function POST(request:Request) {
  try {
    const access=await requireAdminEmailMutation(request);if("response" in access) return access.response;
    const body=await readAdminEmailJson(request),actor=access.viewer.authUserId;
    if(body.action==="save") return opsJson(await saveEmailGroupCampaign(actor,body.draft));
    if(body.action==="review") return opsJson(await reviewEmailGroupCampaign(actor,body.id,body.revision));
    if(body.action==="send") return opsJson(await queueEmailGroupCampaign(actor,body.reviewId));
    throw new AdminEmailError(400,"Choose save, review, or queue.");
  } catch(error) {return adminEmailErrorResponse(error);}
}
