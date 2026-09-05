import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processCalendarReconciliationBatch } from "@/lib/google/calendar-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One provider reconciliation per invocation, not an unbounded queue drain.
// The durable ten-minute request lease exceeds this execution window.
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || !supplied || !request.headers.get("authorization")?.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(expected), b = encoder.encode(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function processRequest(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const result = await processCalendarReconciliationBatch(1);
    return NextResponse.json(result, { status: result.ready ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ error: "Calendar worker unavailable" }, { status: 503, headers });
  }
}
export const GET = processRequest;
export const POST = processRequest;
