import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { getMemberSmsOperationsOverview, MemberSmsOperationsError } from "@/lib/communications/member-sms-operations";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "cursor") || params.getAll("cursor").length > 1) {
      return opsJson({ error: "Choose a valid text-message history page." }, 400);
    }
    return opsJson(await getMemberSmsOperationsOverview(viewer.authUserId, { cursor: params.get("cursor") }));
  } catch (error) {
    if (error instanceof MemberSmsOperationsError) return opsJson({ error: error.message }, error.status);
    console.error("Text message records unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return opsJson({ error: "Text message records could not be loaded. Try again; no settings or messages were changed." }, 503);
  }
}
