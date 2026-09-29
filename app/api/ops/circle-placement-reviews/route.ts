import { NextResponse } from "next/server";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { declineCirclePlacementReview, getCirclePlacementReviews, requestCirclePlacementReview } from "@/lib/platform/circle-placement-repository";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
async function handle(request: Request, write: boolean) {
  if (write && !isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator access is required." }, 401);
  try {
    if (!write) return json({ reviews: await getCirclePlacementReviews(viewer.authUserId) });
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON is required." }, 415);
    const raw = await request.text(); if (raw.length > 4096) return json({ error: "That request is too large." }, 413);
    const body = JSON.parse(raw);
    if (body?.action === "decline") return json({ review: await declineCirclePlacementReview(viewer.authUserId, typeof body.reviewId === "string" ? body.reviewId : "") });
    return json({ review: await requestCirclePlacementReview(viewer.authUserId, { memberId: typeof body?.memberId === "string" ? body.memberId : "", circleId: typeof body?.circleId === "string" ? body.circleId : "", reason: typeof body?.reason === "string" ? body.reason : "" }) }, 201);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Valid JSON is required." }, 400);
    return error instanceof OpsRepositoryError ? json({ error: error.message }, error.code === "forbidden" ? 403 : error.code === "conflict" ? 409 : 400) : json({ error: "The exception review could not be saved." }, 503);
  }
}
export function GET(request: Request) { return handle(request, false); }
export function POST(request: Request) { return handle(request, true); }
