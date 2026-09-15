import "server-only";

import { createHmac } from "node:crypto";

import { after, NextResponse } from "next/server";

import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import {
  getByobRegistrationConfig,
  type ByobRegistrationConfig,
  BYOB_02_TANK_HREF,
  parseByobRegistrationInput,
} from "@/lib/events/byob-registration-model";
import {
  consumeByobRegistrationRateLimit,
  registerByobParticipant,
} from "@/lib/events/byob-registration-repository";
import { processRegistrationSheetOutboxBatch } from "@/lib/events/registration-sheet-sync";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

const MAX_BODY_LENGTH = 16_384;

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

function getRequestFingerprint(request: Request, config: ByobRegistrationConfig): string | null {
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
      `byob-registration:v1:${config.eventKey}:${hourBucket}:${address}`,
      "utf8",
    )
    .digest("hex");
}

export async function handleByobRegistration(request: Request, config: ByobRegistrationConfig) {
  if (getByobRegistrationConfig(config.eventKey) !== config) return json({ error: "Registration is not configured" }, 503);
  const SUCCESS_RESPONSE = config.showTankOffer ? { ok: true, tankHref: BYOB_02_TANK_HREF } : { ok: true };
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

  const submission = parseByobRegistrationInput(body, config);
  if (!submission) {
    return json({ error: "Invalid submission" }, 400);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return json({ error: "Registration is not configured" }, 503);
  }

  const fingerprint = getRequestFingerprint(request, config);
  if (!fingerprint) {
    return json({ error: "Registration is not configured" }, 503);
  }

  try {
    const allowed = await consumeByobRegistrationRateLimit(fingerprint, config.eventKey);
    if (!allowed) {
      return json(
        { error: "Too many requests" },
        429,
        { "Retry-After": "3600" },
      );
    }

    await registerByobParticipant(submission, config);
    if (config.syncToSheet) after(async () => {
      try {
        await processRegistrationSheetOutboxBatch(3);
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        console.error("Deferred registration sheet sync failed.", { name });
      }
    });
    return json(SUCCESS_RESPONSE);
  } catch (error) {
    if (error instanceof OpsOperatingRepositoryError && error.code === "conflict") {
      return json({ error: error.message }, 409);
    }
    const details =
      error && typeof error === "object"
        ? {
            code: "code" in error ? String(error.code) : undefined,
            name: "name" in error ? String(error.name) : undefined,
          }
        : undefined;
    console.error(`${config.title} registration failed.`, details);
    return json({ error: "Registration is temporarily unavailable" }, 503);
  }
}
