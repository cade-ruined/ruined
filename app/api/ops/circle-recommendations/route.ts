import { NextResponse } from "next/server";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getCircleRecommendations } from "@/lib/platform/circle-placement-repository";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
export async function GET(request: Request) {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator access is required." }, 401);
  try { return json({ recommendations: await getCircleRecommendations(viewer.authUserId, new URL(request.url).searchParams.get("memberId") ?? "") }); }
  catch (error) { return error instanceof OpsRepositoryError ? json({ error: error.message }, error.code === "forbidden" ? 403 : error.code === "not_found" ? 404 : 400) : json({ error: "Recommendations are temporarily unavailable." }, 503); }
}
