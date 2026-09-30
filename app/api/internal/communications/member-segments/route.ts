import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberSegmentConfiguration, MemberSegmentSyncError, runMemberSegmentSync } from "@/lib/communications/member-segment-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const expected = encoder.encode(process.env.CRON_SECRET?.trim() ?? "");
  const header = request.headers.get("authorization") ?? "";
  const supplied = encoder.encode(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = getMemberSegmentConfiguration();
  const headers = { "Cache-Control": "private, no-store" };
  if (!config.enabled) return NextResponse.json({ enabled: false, skipped: "disabled" }, { headers });
  if (!config.ready) return NextResponse.json({ enabled: true, ready: false, missing: config.missing }, { status: 503, headers });
  try {
    return NextResponse.json(await runMemberSegmentSync(getApplicationDatabase(), { apply: true }), { headers });
  } catch (error) {
    // No provider response bodies, names, addresses, or source records in logs.
    const code = error instanceof MemberSegmentSyncError ? error.code : "member_segment_sync_failed";
    console.error("Member segment synchronization failed", { code });
    return NextResponse.json({ error: code }, { status: 503, headers });
  }
}

export const POST = GET;
