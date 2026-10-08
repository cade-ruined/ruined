import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { getApplicationDatabase } from "@/lib/database/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { AdminEmailError } from "./admin-email-model";
import { requireAdminEmailActor } from "./admin-email-repository";
import {
  ADMIN_EMAIL_IMAGE_BUCKET, ADMIN_EMAIL_IMAGE_MAX_BYTES, ADMIN_EMAIL_IMAGE_MAX_DIMENSION,
  ADMIN_EMAIL_IMAGE_MAX_PIXELS, ADMIN_EMAIL_IMAGE_UPLOADS_PER_HOUR, validateAdminEmailImageFile,
} from "./admin-email-image-policy";

type ImageDetails = { width: number; height: number; contentType: "image/jpeg" | "image/png"; bytes: number };
export type AdminEmailUploadedImage = ImageDetails & { url: string };

function storageConfiguration() {
  if (getPlatformConfiguration().mode !== "connected") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) return null;
    return { url: parsed.origin, secret };
  } catch { return null; }
}
export function adminEmailImagesConfigured(): boolean { return storageConfiguration() !== null; }

function reportStorageFailure(operation: "bucket" | "upload", error: unknown) {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = String(details.statusCode ?? details.status ?? "");
  // Provider messages can contain object paths or credentials. Log neither.
  console.error("Admin email image storage failed", { operation, status: /^[1-5][0-9]{2}$/.test(status) ? status : undefined });
}

function animatedPng(bytes: Buffer): boolean {
  // libvips may read only the default image of an APNG. Inspect its animation
  // control chunk as well as Sharp's page count before accepting a still PNG.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) break;
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL" && size >= 8) return bytes.readUInt32BE(offset + 8) > 1;
    offset += size + 12;
  }
  return false;
}

/** Decode bytes, orient the photo, preserve its frame, and strip all metadata. */
export async function normalizeAdminEmailImage(file: File): Promise<ImageDetails & { data: Buffer }> {
  validateAdminEmailImageFile(file);
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const pipeline = sharp(bytes, { limitInputPixels: ADMIN_EMAIL_IMAGE_MAX_PIXELS, failOn: "warning", animated: false });
    const metadata = await pipeline.metadata();
    const mime: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    if (!metadata.format || mime[metadata.format] !== file.type.toLowerCase() || (metadata.pages ?? 1) !== 1
      || (metadata.format === "png" && animatedPng(bytes))) throw new AdminEmailError(415, "Choose a still JPG, PNG, or WebP photo.");
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > ADMIN_EMAIL_IMAGE_MAX_PIXELS) {
      throw new AdminEmailError(413, "Choose a photo with no more than 40 million pixels.");
    }
    const sized = pipeline.rotate().resize({ width: ADMIN_EMAIL_IMAGE_MAX_DIMENSION, height: ADMIN_EMAIL_IMAGE_MAX_DIMENSION,
      fit: "inside", withoutEnlargement: true }).toColourspace("srgb");
    const contentType = metadata.hasAlpha ? "image/png" : "image/jpeg";
    const output = await (metadata.hasAlpha ? sized.png({ compressionLevel: 9 }) : sized.jpeg({ quality: 86 })).toBuffer({ resolveWithObject: true });
    if (output.data.length > ADMIN_EMAIL_IMAGE_MAX_BYTES) throw new AdminEmailError(413, "That photo is too detailed. Choose a smaller version.");
    return { data: output.data, width: output.info.width, height: output.info.height, contentType, bytes: output.data.length };
  } catch (error) {
    if (error instanceof AdminEmailError) throw error;
    throw new AdminEmailError(415, "That photo could not be read. Choose a valid still JPG, PNG, or WebP image.");
  }
}

export async function uploadAdminEmailImage(actorAuthUserId: string, file: File): Promise<AdminEmailUploadedImage> {
  validateAdminEmailImageFile(file);
  const config = storageConfiguration();
  if (!config) throw new AdminEmailError(503, "Email photo uploads are not configured yet.");
  const objectId = randomUUID();
  // Commit the attempt before decoding or calling Storage. Failed uploads must
  // not roll back quota, and this audit intent survives an uncertain upload.
  const allowed = await getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actorAuthUserId, true);
    const rows = await tx`
      insert into admin_email_image_upload_limits(actor_auth_user_id,window_started_at,attempts)
      values(${actorAuthUserId}::uuid,date_trunc('hour',clock_timestamp()),1)
      on conflict(actor_auth_user_id,window_started_at) do update
        set attempts=admin_email_image_upload_limits.attempts+1
        where admin_email_image_upload_limits.attempts<${ADMIN_EMAIL_IMAGE_UPLOADS_PER_HOUR} returning attempts
    `;
    if (!rows.length) return false;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actorAuthUserId}::uuid,'admin_email.image_upload_requested','admin_email_image',${objectId},
      ${JSON.stringify({ inputBytes: file.size, contentType: file.type.toLowerCase() })}::jsonb)`;
    return true;
  });
  if (!allowed) throw new AdminEmailError(429, "You've reached the photo upload limit. Try again next hour.");
  const image = await normalizeAdminEmailImage(file);
  const storage = createClient(config.url, config.secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
  }).storage;
  let bucket;
  try {
    const result = await storage.getBucket(ADMIN_EMAIL_IMAGE_BUCKET);
    if (result.error) throw result.error;
    bucket = result.data;
  } catch (error) {
    reportStorageFailure("bucket", error);
    throw new AdminEmailError(503, "The email image bucket is unavailable. Complete the email photo storage setup before uploading.");
  }
  if (bucket?.public !== true) throw new AdminEmailError(503, "The email image bucket must be public. Have an administrator review its setup; private media buckets are never converted automatically.");
  const objectName = `${objectId}.${image.contentType === "image/png" ? "png" : "jpg"}`;
  const store = storage.from(ADMIN_EMAIL_IMAGE_BUCKET);
  const url = store.getPublicUrl(objectName).data.publicUrl;
  const uploaded = await getApplicationDatabase().begin(async tx => {
    // Keep both live authority rows locked through the only storage mutation.
    await requireAdminEmailActor(tx, actorAuthUserId, true);
    let succeeded = false;
    try {
      const result = await store.upload(objectName, image.data, { contentType: image.contentType, cacheControl: "31536000", upsert: false });
      if (result.error) throw result.error;
      succeeded = true;
    } catch (error) { reportStorageFailure("upload", error); }
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actorAuthUserId}::uuid,${succeeded ? "admin_email.image_uploaded" : "admin_email.image_upload_failed"},'admin_email_image',${objectId},
      ${JSON.stringify({ contentType: image.contentType, width: image.width, height: image.height, bytes: image.bytes })}::jsonb)`;
    return succeeded;
  });
  if (!uploaded) throw new AdminEmailError(503, "The photo could not be uploaded. Keep it open and try again.");
  // Objects are immutable and retained when replaced: sent emails depend on the
  // same public URL. Never compensate an uncertain write by deleting an image.
  return { url, width: image.width, height: image.height, contentType: image.contentType, bytes: image.bytes };
}
