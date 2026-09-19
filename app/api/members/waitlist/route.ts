import { createHmac } from "node:crypto";
import { after, NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { parseMembershipWaitlistInput } from "@/lib/membership/waitlist-model";
import { consumeMembershipWaitlistRateLimit, joinMembershipWaitlist } from "@/lib/membership/waitlist-repository";
import { processMembershipWaitlistSheetOutboxBatch } from "@/lib/membership/waitlist-sheet-sync";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 4_096;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

// Bound the streamed body, including requests without Content-Length.
async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Forbidden" }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return json({ error: "JSON required" }, 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return json({ error: "Submission too large" }, 413);
  }
  let body: unknown;
  try {
    const raw = await readBody(request);
    if (raw === null) return json({ error: "Submission too large" }, 413);
    body = JSON.parse(raw) as unknown;
  } catch {
    return json({ error: "Invalid submission" }, 400);
  }
  if (body && typeof body === "object" && "website" in body && typeof body.website === "string" && body.website.trim()) {
    return json({ ok: true });
  }
  if (body && typeof body === "object" && "invitationToken" in body &&
      (typeof body.invitationToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.invitationToken))) {
    return json({ error: "This invitation is no longer available. Ask the member for a new invitation." }, 410);
  }
  const submission = parseMembershipWaitlistInput(body);
  if (!submission) return json({ error: "Enter your name, a valid email, and a valid phone number if provided." }, 400);

  const secret = process.env.COMMUNICATION_RATE_LIMIT_SECRET?.trim();
  if (!secret || !process.env.DATABASE_URL?.trim()) {
    return json({ error: "The waitlist is temporarily unavailable. Please try again shortly." }, 503);
  }
  const address = (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "local").split(",", 1)[0].trim();
  const fingerprint = createHmac("sha256", secret)
    .update(`membership-waitlist:v1:${Math.floor(Date.now() / 3_600_000)}:${address}`)
    .digest("hex");
  try {
    if (!await consumeMembershipWaitlistRateLimit(fingerprint)) {
      return json({ error: "Too many attempts. Please try again in an hour." }, 429, { "Retry-After": "3600" });
    }
    await joinMembershipWaitlist(submission);
    after(async () => {
      try {
        await processMembershipWaitlistSheetOutboxBatch(3);
      } catch {
        console.error("Deferred membership waitlist sync failed.");
      }
    });
    return json({ ok: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P4100") {
      return json({ error: "This invitation is no longer available. Ask the member for a new invitation." }, 410);
    }
    console.error("Membership waitlist submission failed.");
    return json({ error: "The waitlist is temporarily unavailable. Please try again shortly." }, 503);
  }
}
