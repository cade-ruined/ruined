import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { processResendOutboxBatch } from "@/lib/communications/worker";

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

  const result = await processResendOutboxBatch(25);
  if (!result.ready) {
    return NextResponse.json(
      { error: "Communications worker is not configured", missing: result.missing },
      { status: 503 },
    );
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  return processRequest(request);
}
