import { opsJson, opsRepositoryErrorResponse } from "@/lib/platform/ops-api";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import type { OpsSopInput, OpsSopStatus } from "@/lib/platform/ops-sop-model";

const MAX_REQUEST_BYTES = 512_000;
class SopRequestTooLargeError extends Error {}

export async function readSopInput(request: Request, id?: string): Promise<OpsSopInput> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_REQUEST_BYTES) throw new SopRequestTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) throw new OpsOperatingRepositoryError("invalid_request", "SOP details are required.");
  let body: unknown;
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let size = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new SopRequestTooLargeError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    body = JSON.parse(text + decoder.decode());
  } catch (error) {
    if (error instanceof SopRequestTooLargeError) throw error;
    throw new OpsOperatingRepositoryError("invalid_request", "Valid JSON is required.");
  } finally {
    reader.releaseLock();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OpsOperatingRepositoryError("invalid_request", "SOP details must be a JSON object.");
  }
  const value = body as Record<string, unknown>;
  const strings = ["title", "summary", "category", "bodyText", "status"];
  const allowed = new Set([...strings, "externalUrl", ...(id ? ["expectedRevision"] : [])]);
  if (Object.keys(value).some((key) => !allowed.has(key)) ||
      strings.some((key) => typeof value[key] !== "string") ||
      (value.externalUrl !== null && typeof value.externalUrl !== "string") ||
      !["draft", "published", "archived"].includes(value.status as string) ||
      (id && (typeof value.expectedRevision !== "number" || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1))) {
    throw new OpsOperatingRepositoryError("invalid_request", "Include valid title, summary, category, procedure text, document link, and status fields.");
  }
  return {
    id, expectedRevision: id ? value.expectedRevision as number : undefined,
    title: value.title as string, summary: value.summary as string, category: value.category as string,
    bodyText: value.bodyText as string, externalUrl: value.externalUrl as string | null,
    status: value.status as OpsSopStatus,
  };
}

export function sopErrorResponse(error: unknown) {
  if (error instanceof SopRequestTooLargeError) return opsJson({ error: "This SOP is too large. Shorten the text or link to the full document." }, 413);
  if (error instanceof OpsOperatingRepositoryError) return opsRepositoryErrorResponse(error);
  console.error("SOP request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  return opsJson({ error: "SOPs are temporarily unavailable. Please try again." }, 503);
}
