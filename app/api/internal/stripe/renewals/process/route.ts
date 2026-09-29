import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processMembershipRenewalNotices } from "@/lib/stripe/renewal-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function processRequest(request: Request) {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const suppliedBytes = encoder.encode(supplied);
  if (!expected || !request.headers.get("authorization")?.startsWith("Bearer ")
    || suppliedBytes.length !== expectedBytes.length
    || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await processMembershipRenewalNotices(25);
  // A disabled job is inert. Delivery failures and missed windows remain
  // visible to the scheduler/operator instead of returning a false success.
  return NextResponse.json(result, { status: !result.enabled || result.ready && !result.failed && !result.manualReview && !result.deferred && !result.remainingDue ? 200 : 503,
    headers: { "Cache-Control": "private, no-store" } });
}

export const GET = processRequest;
export const POST = processRequest;
