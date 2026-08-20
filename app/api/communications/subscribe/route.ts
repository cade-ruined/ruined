import { createHmac } from "node:crypto";

import { after, NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import {
  normalizeCommunicationEmail,
} from "@/lib/communications/model";
import {
  consumeCommunicationSignupRateLimit,
  subscribeToGeneralUpdates,
} from "@/lib/communications/repository";
import { getResendConfigurationStatus } from "@/lib/communications/resend";
import { processResendOutboxBatch } from "@/lib/communications/worker";

export const runtime = "nodejs";

const MAX_BODY_LENGTH = 4_096;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getRequestFingerprint(request: Request): string | null {
  const secret = process.env.COMMUNICATION_RATE_LIMIT_SECRET?.trim();
  if (!secret) return null;

  const forwarded = request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")
    || request.headers.get("x-real-ip")
    || "local";
  const address = forwarded.split(",", 1)[0]?.trim() || "local";
  const hourBucket = Math.floor(Date.now() / 3_600_000);

  return createHmac("sha256", secret)
    .update(`communication-signup:v1:${hourBucket}:${address}`, "utf8")
    .digest("hex");
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "JSON required" }, { status: 415 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Submission too large" }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Body must be an object.");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
  }

  if (typeof body.company === "string" && body.company.trim()) {
    return NextResponse.json({ ok: true });
  }

  const email = typeof body.email === "string"
    ? normalizeCommunicationEmail(body.email)
    : "";
  const consented = body.consent === true;

  if (
    email.length > 254
    || !EMAIL_PATTERN.test(email)
    || !consented
  ) {
    return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json({ error: "Signup is not configured" }, { status: 503 });
  }

  const resend = getResendConfigurationStatus();
  if (!resend.confirmationEmailReady || !resend.contactSyncReady) {
    return NextResponse.json({ error: "Signup is not configured" }, { status: 503 });
  }

  const fingerprint = getRequestFingerprint(request);
  if (!fingerprint) {
    return NextResponse.json({ error: "Signup is not configured" }, { status: 503 });
  }

  try {
    const allowed = await consumeCommunicationSignupRateLimit(fingerprint);
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    await subscribeToGeneralUpdates(email);
    after(async () => {
      try {
        await processResendOutboxBatch(3);
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        console.error("Deferred communication delivery failed.", { name });
      }
    });
    return NextResponse.json({ ok: true, confirmationRequired: true });
  } catch (error) {
    const details = error && typeof error === "object"
      ? { code: "code" in error ? String(error.code) : undefined, name: "name" in error ? String(error.name) : undefined }
      : undefined;
    console.error("Communication signup failed.", details);
    return NextResponse.json({ error: "Signup is temporarily unavailable" }, { status: 503 });
  }
}
