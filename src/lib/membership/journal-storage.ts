import "server-only";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { JournalError, journalFilePolicy } from "./journal-model";

export const JOURNAL_BUCKET = "member-journal";
export function journalStorageConfigured() { return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)); }
export function journalStore() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) throw new JournalError(503, "Media uploads are temporarily unavailable. You can still write a text entry.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new JournalError(503, "Media uploads are temporarily unavailable.");
  return createClient(url, secret, { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }, global: { fetch: (input,init) => fetch(input,{...init,signal:AbortSignal.timeout(45_000)}) } }).storage.from(JOURNAL_BUCKET);
}

/** Decode images and strip metadata. Videos must match their container signature. */
export async function validateJournalMedia(bytes: Buffer, mime: string) {
  const kind = journalFilePolicy(mime, bytes.length);
  if (kind === "images") {
    try {
      const image = sharp(bytes,{limitInputPixels:40_000_000,failOn:"warning",animated:false});
      const metadata = await image.metadata();
      const formats:Record<string,string> = {jpeg:"image/jpeg",png:"image/png",webp:"image/webp"};
      if (!metadata.format || formats[metadata.format] !== mime || (metadata.pages ?? 1) !== 1) throw new Error("Invalid image");
      const data = await image.rotate().resize({width:2400,height:2400,fit:"inside",withoutEnlargement:true}).webp({quality:88}).toBuffer();
      journalFilePolicy("image/webp",data.length);
      return {data,mimeType:"image/webp",extension:"webp"};
    } catch { throw new JournalError(415,"That image could not be read. Choose a still JPG, PNG, or WebP."); }
  }
  const mp4 = bytes.length >= 24 && bytes.toString("ascii",4,8) === "ftyp" && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length;
  const webm = bytes.length >= 32 && bytes.readUInt32BE(0) === 0x1a45dfa3 && bytes.subarray(0,4096).includes(Buffer.from("webm"));
  if ((mime === "video/mp4" && !mp4) || (mime === "video/webm" && !webm)) throw new JournalError(415,"That video could not be read. Choose MP4 or WebM.");
  return {data:bytes,mimeType:mime,extension:mime === "video/mp4" ? "mp4" : "webm"};
}
