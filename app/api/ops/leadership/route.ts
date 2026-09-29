import { NextResponse } from "next/server";
import { isTrustedPlatformOrigin } from "@/lib/auth/request";
import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { executeLeadershipCommand, getLeadershipDirectory } from "@/lib/platform/leadership-repository";
import { OpsRepositoryError } from "@/lib/platform/ops-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  if (error instanceof OpsRepositoryError) return json({ error: error.message }, { forbidden: 403, invalid_request: 400, not_found: 404, conflict: 409 }[error.code]);
  console.error("Leadership request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return json({ error: "Leadership records are unavailable. Refresh and try again." }, 503);
}
export async function GET() {
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator sign-in is required." }, 401);
  try { return json({ directory: await getLeadershipDirectory(viewer.authUserId) }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isTrustedPlatformOrigin(request)) return json({ error: "Request origin is not allowed." }, 403);
  const viewer = await getCurrentPlatformViewer();
  if (!viewer) return json({ error: "Operator sign-in is required." }, 401);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "JSON is required." }, 415);
  const body: unknown = await request.json().catch(() => null);
  try { return json(await executeLeadershipCommand(viewer.authUserId, body)); } catch (error) { return failure(error); }
}
