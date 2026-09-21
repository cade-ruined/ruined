import { MEMBER_PHOTO_MAX_BYTES } from "./photo-policy";

export const MEMBER_PHOTO_SOURCE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
export const MEMBER_PHOTO_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export type MemberPhotoCrop = { zoom: number; x: number; y: number };
export const DEFAULT_MEMBER_PHOTO_CROP: MemberPhotoCrop = { zoom: 1, x: 0, y: 0 };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function validateMemberPhotoSelection(file: Pick<File, "size" | "type" | "name">) {
  const supported = MEMBER_PHOTO_SOURCE_ACCEPT.split(",").includes(file.type.toLowerCase())
    || (!file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name));
  if (!supported) throw new Error("Choose a JPG, PNG, WebP, or HEIC photo.");
  if (file.size < 1 || file.size > MEMBER_PHOTO_SOURCE_MAX_BYTES) throw new Error("Choose a photo under 20 MB.");
}

export function memberPhotoCropRect(width: number, height: number, crop: MemberPhotoCrop) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > 64_000_000) {
    throw new Error("Choose a photo with no more than 64 megapixels.");
  }
  const side = Math.min(width, height) / clamp(crop.zoom, 1, 3);
  return { x: (width - side) * (clamp(crop.x, -1, 1) + 1) / 2, y: (height - side) * (clamp(crop.y, -1, 1) + 1) / 2, side };
}

/** Drag distances are fractions of the visible square, keeping preview and export aligned. */
export function panMemberPhotoCrop(width: number, height: number, crop: MemberPhotoCrop, dx: number, dy: number): MemberPhotoCrop {
  const { side } = memberPhotoCropRect(width, height, crop);
  return { zoom: crop.zoom,
    x: width === side ? 0 : clamp(crop.x - dx * side * 2 / (width - side), -1, 1),
    y: height === side ? 0 : clamp(crop.y - dy * side * 2 / (height - side), -1, 1),
  };
}

/** Browser decoding applies photo orientation before natural dimensions and canvas cropping. */
export function decodeMemberPhoto(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let finished = false;
    const timer = setTimeout(() => fail(new Error("That photo took too long to open. Choose it again.")), 15_000);
    function cleanup() { clearTimeout(timer); signal.removeEventListener("abort", abort); image.onload = null; image.onerror = null; }
    function fail(error: Error) { if (finished) return; finished = true; cleanup(); image.src = ""; reject(error); }
    function abort() { fail(new DOMException("Photo selection cancelled", "AbortError")); }
    function complete() {
      if (finished) return;
      try { memberPhotoCropRect(image.naturalWidth, image.naturalHeight, DEFAULT_MEMBER_PHOTO_CROP); }
      catch (error) { fail(error instanceof Error ? error : new Error("That photo could not be opened.")); return; }
      finished = true; cleanup(); resolve(image);
    }
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    const unreadable = () => fail(new Error("This browser could not open that photo. Export it as JPG, PNG, or WebP and try again."));
    image.onerror = unreadable;
    if (typeof image.decode !== "function") image.onload = complete;
    image.src = url;
    if (typeof image.decode === "function") void image.decode().then(complete, unreadable);
  });
}

export async function exportMemberPhotoCrop(image: HTMLImageElement, crop: MemberPhotoCrop): Promise<File> {
  const { x, y, side } = memberPhotoCropRect(image.naturalWidth, image.naturalHeight, crop);
  const canvas = document.createElement("canvas");
  const edge = Math.max(1, Math.min(1024, Math.floor(side)));
  canvas.width = edge; canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare this photo. Try another browser.");
  context.fillStyle = "#e5e0d5";
  context.fillRect(0, 0, edge, edge);
  context.drawImage(image, x, y, side, side, 0, 0, edge, edge);
  for (const quality of [0.92, 0.82, 0.7]) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Your photo could not be prepared. Try again.")), 15_000);
      try {
        canvas.toBlob(value => { clearTimeout(timer); if (value) resolve(value); else reject(new Error("Your photo could not be prepared. Try again.")); }, "image/jpeg", quality);
      } catch (error) { clearTimeout(timer); reject(error); }
    });
    if (blob.size > 0 && blob.size <= MEMBER_PHOTO_MAX_BYTES && ["image/jpeg", "image/png"].includes(blob.type)) {
      return new File([blob], blob.type === "image/jpeg" ? "profile-photo.jpg" : "profile-photo.png", { type: blob.type });
    }
  }
  throw new Error("This photo is still too large to save. Try another photo.");
}
