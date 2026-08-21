import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import {
  BYOB_02_EVENT_KEY,
  BYOB_02_TANK_HREF,
  parseByob02RegistrationInput,
  type Byob02RegistrationSuccess,
} from "@/lib/events/byob-registration-model";
import {
  consumeByobRegistrationRateLimit,
  registerByob02Participant,
} from "@/lib/events/byob-registration-repository";

export const runtime = "nodejs";

const MAX_BODY_LENGTH = 16_384;
const SUCCESS_RESPONSE = {
  ok: true,
  tankHref: BYOB_02_TANK_HREF,
} satisfies Byob02RegistrationSuccess;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function getRequestFingerprint(request: Request): string | null {
  const secret = process.env.COMMUNICATION_RATE_LIMIT_SECRET?.trim();
  if (!secret) return null;

  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "local";
  const address = forwarded.split(",", 1)[0]?.trim() || "local";
  const hourBucket = Math.floor(Date.now() / 3_600_000);

  return createHmac("sha256", secret)
    .update(
      `byob-registration:v1:${BYOB_02_EVENT_KEY}:${hourBucket}:${address}`,
      "utf8",
    )
    .digest("hex");
}

export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) {
    return json({ error: "Forbidden" }, 403);
  }

  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
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
    return json(SUCCESS_RESPONSE);
  }

  const submission = parseByob02RegistrationInput(body);
  if (!submission) {
    return json({ error: "Invalid submission" }, 400);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return json({ error: "Registration is not configured" }, 503);
  }

  const fingerprint = getRequestFingerprint(request);
  if (!fingerprint) {
    return json({ error: "Registration is not configured" }, 503);
  }

  try {
    const allowed = await consumeByobRegistrationRateLimit(fingerprint);
    if (!allowed) {
      return json(
        { error: "Too many requests" },
        429,
        { "Retry-After": "3600" },
      );
    }

    await registerByob02Participant(submission);
    return json(SUCCESS_RESPONSE);
  } catch (error) {
    const details =
      error && typeof error === "object"
        ? {
            code: "code" in error ? String(error.code) : undefined,
            name: "name" in error ? String(error.name) : undefined,
          }
        : undefined;
    console.error("BYOB Nº 02 registration failed.", details);
    return json({ error: "Registration is temporarily unavailable" }, 503);
  }
}
