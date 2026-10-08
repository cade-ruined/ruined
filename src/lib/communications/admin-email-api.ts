import "server-only";

import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { AdminEmailAIError } from "@/lib/communications/admin-email-ai";
import { assertAdminEmailAccess } from "@/lib/communications/admin-email-repository";
import { opsJson, opsRepositoryErrorResponse, requireOpsMutationRequest } from "@/lib/platform/ops-api";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

export function adminEmailErrorResponse(error: unknown) {
  if (error instanceof AdminEmailError) return opsJson({ error: error.message }, error.status);
  if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
  if (error instanceof AdminEmailAIError) return opsJson({ error: error.message }, error.status);
  console.error("Admin email operation failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "The email workspace is temporarily unavailable. Your saved drafts have not been discarded." }, 503);
}

/** Bound the bytes actually read, including requests without Content-Length. */
export async function readAdminEmailJson(request: Request): Promise<Record<string, unknown>> {
  const limit = 64_000;
  if (Number(request.headers.get("content-length")) > limit) throw new AdminEmailAIError("The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AdminEmailAIError("An email request is required.", 400);
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new AdminEmailAIError("The request is too large.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AdminEmailAIError) throw error;
    throw new AdminEmailAIError("The email request is invalid.", 400);
  } finally { reader.releaseLock(); }
}

export async function requireAdminEmailMutation(request: Request) {
  const access = await requireOpsMutationRequest(request);
  if ("response" in access) return access;
  await assertAdminEmailAccess(access.viewer.authUserId);
  return access;
}
