import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { opsJson } from "@/lib/platform/ops-api";
import { sendResendEmail } from "@/lib/communications/resend-email-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const body = await readAdminEmailJson(request);
    const result = await sendResendEmail(access.viewer.authUserId, body.reviewId);
    return opsJson(result);
  } catch (error) { return adminEmailErrorResponse(error); }
}
