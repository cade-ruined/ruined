import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { processWorkflowBatch } from "@/lib/workflows/worker";
import { processMemberDeletionCleanupBatch } from "@/lib/platform/member-deletion-cleanup";
import { cleanupWithdrawnMemberPaymentMethods } from "@/lib/stripe/payment-method-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const deadline = Date.now() + 50_000;
  const deletionCleanup = await processMemberDeletionCleanupBatch(3, null, deadline).catch((error) => {
    console.error("Member deletion cleanup deferred", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return { failed: 1 };
  });
  // Also recover withdrawals and account suspensions that have no deletion job.
  const paymentMethodCleanup = Date.now() < deadline
    ? await cleanupWithdrawnMemberPaymentMethods({ limit: 3, deadline: Math.min(deadline, Date.now() + 12_000) }).catch((error) => {
      console.error("Payment-method cleanup deferred", { errorType: error instanceof Error ? error.name : "UnknownError" });
      return { processed: 0, pending: 1 };
    })
    : { processed: 0, pending: 1 };
  const result = await processWorkflowBatch(50, deadline);
  return NextResponse.json({ ...result, deletionCleanup, paymentMethodCleanup }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  return processRequest(request);
}
