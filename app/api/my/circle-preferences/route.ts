import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getCirclePreferences, saveCirclePreferences } from "@/lib/platform/circle-placement-repository";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
async function handle(request: Request, write: boolean) {
  if (write && !isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Sign in to save Circle preferences." }, 401);
  try {
    if (!write) return json(await getCirclePreferences(viewer.authUserId));
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON is required." }, 415);
    const body = await request.text();
    if (body.length > 4096) return json({ error: "That request is too large." }, 413);
    return json(await saveCirclePreferences(viewer.authUserId, JSON.parse(body)));
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: "Valid preferences are required." }, 400);
    if (error instanceof OpsRepositoryError) return json({ error: error.message }, error.code === "forbidden" ? 403 : 400);
    return json({ error: "Circle preferences are temporarily unavailable." }, 503);
  }
}
export function GET(request: Request) { return handle(request, false); }
export function PUT(request: Request) { return handle(request, true); }
