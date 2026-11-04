import { getCurrentPlatformViewer } from "@/lib/auth/session";
import { opsJson, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { getMemberSmsTemplates, previewMemberSmsTemplate, saveMemberSmsTemplate } from "@/lib/communications/member-sms-template-service";
import { MemberSmsTemplateError } from "@/lib/communications/member-sms-template-model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  if (error instanceof MemberSmsTemplateError) return opsJson({ error: error.message }, error.status);
  console.error("Text templates unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "Text templates could not be confirmed. Refresh the saved version before trying again." }, 503);
}
async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > 8192) throw new MemberSmsTemplateError(413, "That template request is too large.");
  const reader = request.body?.getReader(); if (!reader) throw new MemberSmsTemplateError(400, "Choose a template action.");
  const decoder = new TextDecoder(); let bytes = 0, text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new MemberSmsTemplateError(413, "That template request is too large."); }
      text += decoder.decode(value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid object");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof MemberSmsTemplateError) throw error;
    throw new MemberSmsTemplateError(400, "That template request is invalid.");
  } finally { reader.releaseLock(); }
}
export async function GET() {
  try {
    const viewer = await getCurrentPlatformViewer();
    if (!viewer) return opsJson({ error: "Administrator access is required." }, 401);
    return opsJson(await getMemberSmsTemplates(viewer.authUserId));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const access = await requireOpsMutationRequest(request); if (access.response) return access.response;
    const { action, ...value } = await readJson(request);
    if (action === "preview") return opsJson(await previewMemberSmsTemplate(access.viewer.authUserId, value));
    if (action === "save") return opsJson(await saveMemberSmsTemplate(access.viewer.authUserId, value));
    throw new MemberSmsTemplateError(400, "Choose preview or save.");
  } catch (error) { return failure(error); }
}
