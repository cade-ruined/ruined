import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { reconcileRegistrationOperatorWork } from "@/lib/platform/registration-work-repository";
import { processWorkQueueDigestBatch } from "@/lib/platform/work-queue-digest-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const encoder = new TextEncoder();
  const a = encoder.encode(expected), b = encoder.encode(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV !== "production"
    || process.env.PLATFORM_MODE === "preview" || getPlatformConfiguration().mode !== "connected") {
    return json({ enabled: false, skipped: "Production connected platform required" });
  }
  try {
    // Keep the queue current before creating the email snapshot. A failed
    // reconciliation must not send an inaccurate all-clear summary.
    const registrationWork = process.env.OPERATOR_REGISTRATION_WORK_ENABLED === "true"
      ? await reconcileRegistrationOperatorWork()
      : { enabled: false };
    const digest = await processWorkQueueDigestBatch(5);
    return json({ registrationWork, digest }, !digest.enabled || digest.ready ? 200 : 503);
  } catch (error) {
    console.error("Operator work summary could not be processed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "Operator work summary is temporarily unavailable." }, 503);
  }
}

export const POST = GET;
