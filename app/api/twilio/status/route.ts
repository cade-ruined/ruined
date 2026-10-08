import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberSmsConfigurationStatus, MEMBER_SMS_STATUS_PATH } from "@/lib/communications/member-sms-config";
import { applyMemberSmsDeliveryStatus, verifyMemberSmsDeliveryStatus } from "@/lib/communications/member-sms-delivery-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_LENGTH = 65_536;

export async function POST(request: Request) {
  if (!getMemberSmsConfigurationStatus().webhookReady) return new Response("Webhook unavailable", { status: 503 });
  const url = new URL(request.url);
  const attemptId = url.searchParams.get("attempt");
  if (url.pathname !== MEMBER_SMS_STATUS_PATH || !attemptId || url.search !== `?attempt=${attemptId}`) {
    return new Response("Invalid webhook URL", { status: 400 });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return new Response("Unsupported content type", { status: 415 });
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_LENGTH) return new Response("Payload too large", { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_LENGTH) return new Response("Payload too large", { status: 413 });
  let event;
  try { event = verifyMemberSmsDeliveryStatus(rawBody, request.headers.get("x-twilio-signature"), attemptId); }
  catch { return new Response("Invalid signature or sender", { status: 403 }); }
  try {
    const result = await applyMemberSmsDeliveryStatus(getApplicationDatabase(), event);
    if (!result.matched) return new Response("Unknown delivery", { status: 404 });
  } catch {
    return new Response("Webhook processing unavailable", { status: 503 });
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
