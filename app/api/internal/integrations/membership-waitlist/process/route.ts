import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { processMembershipWaitlistSheetOutboxBatch } from "@/lib/membership/waitlist-sheet-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim() : "";
  if (!expected || !supplied) return false;
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const suppliedBytes = encoder.encode(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}

async function processRequest(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { headers, status: 401 });
  }
  try {
    const worker = await processMembershipWaitlistSheetOutboxBatch(25);
    if (!worker.ready) {
      return NextResponse.json(
        { error: "Membership waitlist sheet worker is not configured", missing: worker.missing },
        { headers, status: 503 },
      );
    }
    return NextResponse.json(worker, {
      headers,
      status: worker.failed > 0 || worker.deadLetter > 0 ? 503 : 200,
    });
  } catch {
    console.error("Membership waitlist sheet sync failed");
    return NextResponse.json(
      { error: "Membership waitlist sheet sync failed" },
      { headers, status: 503 },
    );
  }
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  return processRequest(request);
}
