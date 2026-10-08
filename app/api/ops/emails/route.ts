import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getAdminEmailConfiguration } from "@/lib/communications/admin-email-ai";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { getAdminEmailCenter, saveAdminEmailDraft } from "@/lib/communications/admin-email-repository";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    return opsJson({ ...await getAdminEmailCenter(viewer.authUserId), configuration: getAdminEmailConfiguration() });
  } catch (error) { return adminEmailErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const body = await readAdminEmailJson(request);
    const draft = await saveAdminEmailDraft({
      actorAuthUserId: access.viewer.authUserId,
      draftId: typeof body.draftId === "string" ? body.draftId : undefined,
      expectedVersion: typeof body.expectedVersion === "number" ? body.expectedVersion : undefined,
      subject: typeof body.subject === "string" ? body.subject : "",
      preheader: typeof body.preheader === "string" ? body.preheader : "",
      body: typeof body.body === "string" ? body.body : "",
      purpose: body.purpose as "marketing" | "service",
      audience: body.audience as "individual" | "updates" | "members",
      recipients: body.recipients as string[],
    });
    return opsJson({ draft });
  } catch (error) { return adminEmailErrorResponse(error); }
}
