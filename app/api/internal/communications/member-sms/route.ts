import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runMemberSmsAutomation } from "@/lib/communications/member-sms-automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: Request) {
  const expected = new TextEncoder().encode(process.env.CRON_SECRET?.trim() ?? "");
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = new TextEncoder().encode(authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "");
  const headers = { "Cache-Control": "private, no-store" };
  if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  try {
    const result = await runMemberSmsAutomation();
    return NextResponse.json(result, { status: result.skipped === "unconfigured" ? 503 : 200, headers });
  } catch {
    return NextResponse.json({ error: "member_sms_automation_failed" }, { status: 503, headers });
  }
}
