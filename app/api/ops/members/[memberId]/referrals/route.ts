import { NextResponse } from "next/server";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getOpsMemberReferrals } from "@/lib/platform/ops-member-referrals-repository";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
export async function GET(_request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return NextResponse.json({ error: "Operator account access is required." }, { status: 401, headers });
  try { return NextResponse.json(await getOpsMemberReferrals(viewer.authUserId, (await params).memberId), { headers }); }
  catch (error) {
    if (error instanceof OpsRepositoryError) return NextResponse.json({ error: error.message }, {
      status: error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : 400, headers,
    });
    console.error("Member referrals could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Member referrals are temporarily unavailable." }, { status: 503, headers });
  }
}
