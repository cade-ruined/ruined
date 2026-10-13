import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { adminEmailErrorResponse, requireAdminEmailMutation } from "@/lib/communications/admin-email-api";
import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { archiveEmailGroup, listEmailGroups, listEmailGroupRuleOptions, previewEmailGroup, saveEmailGroup } from "@/lib/communications/email-group-repository";
import { opsJson } from "@/lib/platform/ops-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const BODY_LIMIT = 750_000;
/** Selected local identities can exceed the ordinary email-copy request limit. Bound actual streamed bytes. */
async function readGroupRequest(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > BODY_LIMIT) throw new AdminEmailError(413, "The group selection is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AdminEmailError(400, "Group details are required.");
  let bytes = 0, text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > BODY_LIMIT) { await reader.cancel(); throw new AdminEmailError(413, "The group selection is too large."); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AdminEmailError) throw error;
    throw new AdminEmailError(400, "The group request is invalid.");
  } finally { reader.releaseLock(); }
}
export async function GET(request: Request) {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const groups = await listEmailGroups(viewer.authUserId, { includeArchived });
    const ruleOptions = await listEmailGroupRuleOptions(viewer.authUserId);
    return opsJson({ groups, ruleOptions });
  } catch (error) { return adminEmailErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireAdminEmailMutation(request);
    if ("response" in access) return access.response;
    const body = await readGroupRequest(request), actor = access.viewer.authUserId;
    if (body.action === "save") return opsJson(await saveEmailGroup(actor, body.group));
    if (body.action === "preview") return opsJson(await previewEmailGroup(actor, body.group));
    if (body.action === "archive") return opsJson(await archiveEmailGroup(actor, body.id, body.revision, body.archived));
    throw new AdminEmailError(400, "Choose save, preview, archive, or restore.");
  } catch (error) { return adminEmailErrorResponse(error); }
}
