import { AdminEmailError } from "./admin-email-model";

export const ADMIN_EMAIL_IMAGE_BUCKET = "admin-email-images";
export const ADMIN_EMAIL_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const ADMIN_EMAIL_IMAGE_MAX_REQUEST_BYTES = ADMIN_EMAIL_IMAGE_MAX_BYTES + 64 * 1024;
export const ADMIN_EMAIL_IMAGE_MAX_PIXELS = 40_000_000;
export const ADMIN_EMAIL_IMAGE_MAX_DIMENSION = 1600;
export const ADMIN_EMAIL_IMAGE_UPLOADS_PER_HOUR = 30;
export const ADMIN_EMAIL_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const MIME_TYPES = new Set(ADMIN_EMAIL_IMAGE_ACCEPT.split(","));

export function validateAdminEmailImageFile(file: File): void {
  if (!(file instanceof File) || !Number.isSafeInteger(file.size) || file.size < 1) throw new AdminEmailError(400, "Choose one photo to upload.");
  if (file.size > ADMIN_EMAIL_IMAGE_MAX_BYTES) throw new AdminEmailError(413, "Choose a photo no larger than 3 MB.");
  if (!MIME_TYPES.has(file.type.toLowerCase())) throw new AdminEmailError(415, "Choose a still JPG, PNG, or WebP photo.");
}

/** Bound actual streamed bytes before parsing, including chunked uploads. */
export async function readAdminEmailImageUpload(request: Request): Promise<File> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) throw new AdminEmailError(415, "Choose a photo using the upload button.");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > ADMIN_EMAIL_IMAGE_MAX_REQUEST_BYTES)) throw new AdminEmailError(413, "Choose a photo no larger than 3 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new AdminEmailError(400, "Choose one photo to upload.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ADMIN_EMAIL_IMAGE_MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new AdminEmailError(413, "Choose a photo no larger than 3 MB.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AdminEmailError) throw error;
    throw new AdminEmailError(400, "That upload could not be read. Choose the photo again.");
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(body, { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw new AdminEmailError(400, "That upload could not be read. Choose the photo again."); }
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some(key => key !== "file")) {
    throw new AdminEmailError(400, "Upload one photo at a time.");
  }
  validateAdminEmailImageFile(file);
  return file;
}
