import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { opsJson } from "@/lib/platform/ops-api";
import { generateResendEmailCopy } from "@/lib/communications/resend-email-ai";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const body = await readAdminEmailJson(request);
    const result = await generateResendEmailCopy(access.viewer.authUserId, body);
    return opsJson({ edits: result });
  } catch (error) { return adminEmailErrorResponse(error); }
}
