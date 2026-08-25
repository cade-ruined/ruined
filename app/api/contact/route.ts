import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import {
  isContactDeliveryConfigured,
  sendContactSubmission,
} from "@/lib/communications/resend";

export const runtime = "nodejs";

const CONTACT_DELIVERY_TIMEOUT_MS = 10_000;
const MAX_BODY_LENGTH = 8_192;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBMISSION_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function withDeliveryTimeout<T>(work: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Contact delivery timed out.")),
          CONTACT_DELIVERY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return json({ error: "Forbidden" }, 403);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON required" }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_LENGTH) {
    return json({ error: "Submission too large" }, 413);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_LENGTH) {
    return json({ error: "Submission too large" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return json({ error: "Invalid submission" }, 400);
  }

  if (!isRecord(body)) {
    return json({ error: "Invalid submission" }, 400);
  }

  if (typeof body.company === "string" && body.company.trim()) {
    return json({ ok: true });
  }

  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName.replace(/\s+/g, " ");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const suppliedSubmissionId =
    typeof body.submissionId === "string" ? body.submissionId.trim() : "";

  if (
    !name ||
    rawName.length > 100 ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    message.length < 20 ||
    message.length > 4_000
  ) {
    return json({ error: "Invalid submission" }, 400);
  }

  if (!isContactDeliveryConfigured()) {
    return json({ error: "Contact delivery is not configured" }, 503);
  }

  const submissionId = SUBMISSION_ID_PATTERN.test(suppliedSubmissionId)
    ? suppliedSubmissionId
    : randomUUID();

  try {
    await withDeliveryTimeout(sendContactSubmission({
      name,
      email,
      message,
      idempotencyKey: `contact-${submissionId}`,
    }));
    return json({ ok: true });
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error("Contact delivery failed.", { name });
    return json({ error: "Contact delivery is temporarily unavailable" }, 503);
  }
}
