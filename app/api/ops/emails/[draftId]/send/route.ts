import { after } from "next/server";
import { adminEmailErrorResponse, readAdminEmailJson, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { getAdminEmailConfiguration } from "@/lib/communications/admin-email-ai";
import { processAdminEmailBatch } from "@/lib/communications/admin-email-delivery";
import { queueAdminEmailDraft } from "@/lib/communications/admin-email-repository";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    if (!getAdminEmailConfiguration().deliveryReady) return opsJson({ error: "Email sending is not configured yet. Your draft is saved." }, 503);
    const { draftId } = await context.params;
    const body = await readAdminEmailJson(request);
    const draft = await queueAdminEmailDraft({ actorAuthUserId: access.viewer.authUserId, draftId,
      expectedVersion: body.expectedVersion as number, recipientHash: body.recipientHash as string, recipientCount: body.recipientCount as number });
    // The durable queue is the source of truth. This starts the first batch promptly;
    // the scheduled worker handles remaining recipients and safe retries.
    after(async () => {
      try { await processAdminEmailBatch(10); } catch { console.error("Admin email batch deferred to scheduled worker"); }
    });
    return opsJson({ draft }, 202);
  } catch (error) { return adminEmailErrorResponse(error); }
}
