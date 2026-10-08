import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberSmsConfigurationStatus, MEMBER_SMS_INBOUND_PATH } from "@/lib/communications/member-sms-config";
import { applyMemberSmsInbound } from "@/lib/communications/member-sms-repository";
import { verifyMemberSmsInbound } from "@/lib/communications/member-sms-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_LENGTH = 65_536;

export async function POST(request: Request) {
  // Inbound withdrawals stay enabled even while outbound sending is disabled.
  if (!getMemberSmsConfigurationStatus().webhookReady) return new Response("Webhook unavailable", { status: 503 });
  const url = new URL(request.url);
  if (url.pathname !== MEMBER_SMS_INBOUND_PATH || url.search) return new Response("Invalid webhook URL", { status: 400 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return new Response("Unsupported content type", { status: 415 });
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_LENGTH) return new Response("Payload too large", { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_LENGTH) return new Response("Payload too large", { status: 413 });
  let inbound;
  try { inbound = verifyMemberSmsInbound(rawBody, request.headers.get("x-twilio-signature")); }
  catch { return new Response("Invalid signature or sender", { status: 403 }); }
  try {
    await applyMemberSmsInbound(getApplicationDatabase(), inbound);
  } catch {
    // Generic text only: never log auth headers, token, raw body, or phone.
    return new Response("Webhook processing unavailable", { status: 503 });
  }
  // Advanced Opt-Out owns STOP/START/HELP confirmations. A second <Message>
  // here would duplicate its response and could generate additional charges.
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
