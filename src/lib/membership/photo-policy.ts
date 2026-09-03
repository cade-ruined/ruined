export const MEMBER_PHOTO_BUCKET = "member-portraits";
export const MEMBER_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const MEMBER_PHOTO_MAX_BODY_BYTES = MEMBER_PHOTO_MAX_BYTES + 64 * 1024;
export const MEMBER_PHOTO_MAX_PIXELS = 40_000_000;
export const MEMBER_PHOTO_MAX_EDGE = 1600;
export const MEMBER_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
export const MEMBER_PHOTO_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const MEMBER_ID_PATTERN = new RegExp(`^${UUID}$`);
const FILE_NAME_PATTERN = new RegExp(`^${UUID}\\.webp$`);
const MIME_TYPES = new Set(MEMBER_PHOTO_ACCEPT.split(","));

export class MemberPhotoError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MemberPhotoError";
    this.status = status;
  }
}

export function memberPhotoUrl(memberId: string, fileName: string): string | null {
  if (!MEMBER_ID_PATTERN.test(memberId) || !FILE_NAME_PATTERN.test(fileName)) return null;
  return `/api/member-photos/${memberId}/${fileName}`;
}

/** Only our exact, owner-scoped object format is ever eligible for deletion. */
export function ownedMemberPhotoPath(memberId: string, avatarUrl: string | null): string | null {
  if (!avatarUrl || !MEMBER_ID_PATTERN.test(memberId)) return null;
  const prefix = `/api/member-photos/${memberId}/`;
  if (!avatarUrl.startsWith(prefix)) return null;
  const fileName = avatarUrl.slice(prefix.length);
  return FILE_NAME_PATTERN.test(fileName) ? `${memberId}/${fileName}` : null;
}

export function validateMemberPhotoFile(size: number, mimeType: string): void {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new MemberPhotoError(400, "Choose a photo to upload.");
  }
  if (size > MEMBER_PHOTO_MAX_BYTES) {
    throw new MemberPhotoError(413, "Choose a photo smaller than 3 MB.");
  }
  if (!MIME_TYPES.has(mimeType.toLowerCase())) {
    throw new MemberPhotoError(415, "Choose a JPG, PNG, or WebP photo.");
  }
}

export function canViewMemberPhoto(input: {
  requestedUrl: string;
  currentUrl: string | null;
  ownerCanRead: boolean;
  isOpsAdmin: boolean;
  circleCanRead: boolean;
  activeCircle: boolean;
  visibleCircleAvatarUrls: readonly (string | null)[];
}): boolean {
  if (input.requestedUrl !== input.currentUrl) return false;
  if (input.ownerCanRead || input.isOpsAdmin) return true;
  return input.circleCanRead && input.activeCircle
    && input.visibleCircleAvatarUrls.includes(input.requestedUrl);
}

/** Bound the stream before invoking the multipart parser, including chunked bodies. */
export async function readMemberPhotoFile(request: Request): Promise<File> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    throw new MemberPhotoError(415, "Choose a photo to upload.");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MEMBER_PHOTO_MAX_BODY_BYTES)) {
    throw new MemberPhotoError(413, "Choose a photo smaller than 3 MB.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MemberPhotoError(400, "Choose a photo to upload.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MEMBER_PHOTO_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new MemberPhotoError(413, "Choose a photo smaller than 3 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new MemberPhotoError(400, "That upload could not be read. Choose your photo again.");
  }
  const photo = form.get("photo");
  if (!(photo instanceof File) || form.getAll("photo").length !== 1 || [...form.keys()].some((key) => key !== "photo")) {
    throw new MemberPhotoError(400, "Upload one photo at a time.");
  }
  validateMemberPhotoFile(photo.size, photo.type);
  return photo;
}
