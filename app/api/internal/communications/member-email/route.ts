import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processMemberEmailCadenceBatch } from "@/lib/communications/member-email-cadence-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const encoder = new TextEncoder();
  const a = encoder.encode(expected), b = encoder.encode(supplied);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await processMemberEmailCadenceBatch();
  return NextResponse.json(result, { status: result.ready || !result.enabled ? 200 : 503,
    headers: { "Cache-Control": "private, no-store" } });
}

export const POST = GET;
