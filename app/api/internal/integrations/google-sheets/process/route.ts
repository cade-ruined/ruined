import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  processRegistrationSheetOutboxBatch,
  reconcileRegistrationSheet,
} from "@/lib/events/registration-sheet-sync";

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

  try {
    const worker = await processRegistrationSheetOutboxBatch(8);
    if (!worker.ready) {
      return NextResponse.json(
        {
          error: "Registration sheet worker is not configured",
          missing: worker.missing,
        },
        {
          headers: { "Cache-Control": "private, no-store" },
          status: 503,
        },
      );
    }

    const reconciliation = await reconcileRegistrationSheet();
    return NextResponse.json(
      { ...worker, reconciliation },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const errorName = error instanceof Error && error.name
      ? error.name
      : "Error";
    console.error("Registration sheet sync failed", { errorName });
    return NextResponse.json(
      { error: "Registration sheet sync failed" },
      {
        headers: { "Cache-Control": "private, no-store" },
        status: 503,
      },
    );
  }
}

export async function GET(request: Request) {
  return processRequest(request);
}

export async function POST(request: Request) {
  return processRequest(request);
}
