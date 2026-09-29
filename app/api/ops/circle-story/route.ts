import { NextResponse } from "next/server";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { saveCircleStory } from "@/lib/platform/circle-placement-repository";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const viewer = await getCurrentPlatformViewer(); if (!viewer) return json({ error: "Operator access is required." }, 401);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON is required." }, 415);
  try {
    const raw = await request.text(); if (raw.length > 12000) return json({ error: "That request is too large." }, 413);
    const body = JSON.parse(raw);
    if (typeof body?.circleId !== "string" || typeof body?.story !== "string") return json({ error: "Choose a Circle and story." }, 400);
    return json({ circle: await saveCircleStory(viewer.authUserId, body.circleId, body.story) });
  } catch (error) { return error instanceof OpsRepositoryError ? json({ error: error.message }, error.code === "forbidden" ? 403 : 400) : json({ error: "The story could not be saved." }, 503); }
}
