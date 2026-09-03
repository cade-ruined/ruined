import { after, NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { processSupportEmailBatch } from "@/lib/support/delivery";
import { SupportError } from "@/lib/support/model";
import {
  createSupportTicket, getSupportTicket, listSupportTickets,
  replySupportTicket, updateSupportTicketStatus,
} from "@/lib/support/repository";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new SupportError(415, "JSON is required.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SupportError(400, "A request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new SupportError(413, "This message is too long.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SupportError(400, "That request could not be read. Please try again.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SupportError(400, "A valid request is required.");
  return body as Record<string, unknown>;
}

export async function handleSupportRequest(request: Request, options: { operator?: boolean; ticketId?: string } = {}) {
  const { operator = false, ticketId } = options;
  try {
    if (getPlatformConfiguration().mode !== "connected") {
      return json({ error: "Support sending is not available in this preview. Email connect@theruinedproject.com for help." }, 503);
    }
    const mutation = request.method !== "GET";
    if (mutation && !isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return json({ error: "Sign in to view or send support requests." }, 401);
    if (!mutation) {
      return ticketId
        ? json({ ticket: await getSupportTicket(viewer, ticketId, operator) })
        : json({ tickets: await listSupportTickets(viewer, operator) });
    }
    const body = await readBody(request);
    if (request.method === "PATCH" && operator && ticketId) {
      const ticket = await updateSupportTicketStatus(viewer, ticketId, { status: body.status, expectedUpdatedAt: body.expectedUpdatedAt });
      return json({ ticket });
    }
    if (request.method !== "POST" || (operator && !ticketId)) return json({ error: "Method not allowed." }, 405);
    const requestKey = request.headers.get("idempotency-key");
    const ticket = ticketId
      ? await replySupportTicket(viewer, ticketId, { message: body.message, requestKey }, operator)
      : await createSupportTicket(viewer, { category: body.category, subject: body.subject, message: body.message, requestKey });
    // Ticket and outbox are committed together. A delivery failure never loses
    // the conversation or asks the member to submit a duplicate ticket.
    after(async () => {
      try { await processSupportEmailBatch(4); }
      catch { console.error("Support notification delivery could not run."); }
    });
    return json({ ticket }, ticketId ? 200 : 201);
  } catch (error) {
    if (error instanceof SupportError) return json({ error: error.message }, error.status);
    console.error("Support request could not be processed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: "Support is temporarily unavailable. Your message has not been confirmed. Try again, or email connect@theruinedproject.com." }, 503);
  }
}
