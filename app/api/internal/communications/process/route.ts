import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { processResendOutboxBatch } from "@/lib/communications/worker";
import { processSupportEmailBatch } from "@/lib/support/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!expected || !supplied) return false;

  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const suppliedBytes = encoder.encode(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

async function processRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The support queue is transactional: marketing configuration must not block it.
  // Keep a failure in either independent queue from preventing the other worker.
  const [communicationsOutcome, supportOutcome] = await Promise.allSettled([
    processResendOutboxBatch(25),
    processSupportEmailBatch(10),
  ]);
  const result = communicationsOutcome.status === "fulfilled"
    ? communicationsOutcome.value
    : { ready: false, missing: ["communications database unavailable"] };
  const support = supportOutcome.status === "fulfilled"
    ? supportOutcome.value
    : { ready: false, missing: ["support worker unavailable"] };
  if (!result.ready && !support.ready) {
    return NextResponse.json(
      { error: "Email workers are not ready", missing: result.missing, support },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return NextResponse.json({ ...result, support }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  return processRequest(request);
}
