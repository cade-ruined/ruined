import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processMembershipPrepayments } from "@/lib/stripe/prepaid-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function processRequest(request: Request) {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const encoder = new TextEncoder(), expectedBytes = encoder.encode(expected), suppliedBytes = encoder.encode(supplied);
  if (!expected || !request.headers.get("authorization")?.startsWith("Bearer ")
    || expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const result = await processMembershipPrepayments(5);
  return NextResponse.json(result, { status: result.ready && !result.failed && !result.manualReview && !result.remainingDue ? 200 : 503,
    headers: { "Cache-Control": "private, no-store" } });
}

export const GET = processRequest;
export const POST = processRequest;
