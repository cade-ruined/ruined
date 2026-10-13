import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { getCadenceOverview, getCadenceManagementDetail, previewCadence, activateCadence, pauseCadence, pauseCadenceSequence } from "@/lib/communications/member-email-cadence-service";
import { opsJson } from "@/lib/platform/ops-api";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(request:Request) {
  try {
    const viewer=await getCurrentPlatformViewer();
    if (!viewer) return opsJson({error:"Administrator access is required."},401);
    const query=new URL(request.url).searchParams;
    if (query.has("scope") || query.has("id") || query.has("eventId")) {
      return opsJson(await getCadenceManagementDetail(viewer.authUserId,query.get("scope"),query.get("id"),query.get("eventId")));
    }
    return opsJson(await getCadenceOverview(viewer.authUserId));
  } catch(error) {return adminEmailErrorResponse(error);}
}
export async function POST(request:Request) {
  try {
    const access=await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const body=await readAdminEmailJson(request),actor=access.viewer.authUserId;
    if (body.action==="preview") return opsJson(await previewCadence(actor,body.draft));
    if (body.action==="activate") return opsJson(await activateCadence(actor,body.reviewToken));
    if (body.action==="pause") return opsJson(await pauseCadence(actor,body.id,body.revision));
    if (body.action==="pause_sequence") return opsJson(await pauseCadenceSequence(actor,body.id,body.revision));
    throw new AdminEmailError(400,"Choose review, activate, or pause.");
  } catch(error) {return adminEmailErrorResponse(error);}
}
