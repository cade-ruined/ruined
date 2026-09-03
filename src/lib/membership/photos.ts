import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { getApplicationDatabase } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan } from "@/lib/membership/access-policy";
import {
  MemberPhotoError,
  MEMBER_PHOTO_BUCKET,
  MEMBER_PHOTO_MAX_BYTES,
  MEMBER_PHOTO_MAX_EDGE,
  MEMBER_PHOTO_MAX_PIXELS,
  canViewMemberPhoto,
  memberPhotoUrl,
  ownedMemberPhotoPath,
  validateMemberPhotoFile,
} from "@/lib/membership/photo-policy";
import { getMemberCircle, getMemberIdentity } from "@/lib/membership/repository";
import { getOperatorRole } from "@/lib/platform/repository";

function storageConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) return null;
    return { url, secret };
  } catch {
    return null;
  }
}

export function isMemberPhotoStorageConfigured(): boolean {
  return storageConfiguration() !== null;
}

function portraitStore() {
  const config = storageConfiguration();
  if (!config) throw new MemberPhotoError(503, "Photo uploads are temporarily unavailable. You can still save your profile.");
  return createClient(config.url, config.secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
  }).storage.from(MEMBER_PHOTO_BUCKET);
}

async function writableIdentity(authUserId: string) {
  const identity = await getMemberIdentity(authUserId);
  if (!identity || !memberCan(deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt), "profile.write")) {
    throw new MemberPhotoError(403, "This account cannot change its profile photo.");
  }
  return identity;
}

/** Decode actual image bytes, bound pixel count, auto-orient, and discard all metadata. */
export async function normalizeMemberPhoto(file: File): Promise<Buffer> {
  validateMemberPhotoFile(file.size, file.type);
  try {
    const pipeline = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: MEMBER_PHOTO_MAX_PIXELS,
      failOn: "warning",
      animated: false,
    });
    const metadata = await pipeline.metadata();
    const mimeForFormat: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
    if (!metadata.format || mimeForFormat[metadata.format] !== file.type.toLowerCase() || (metadata.pages ?? 1) !== 1) {
      throw new MemberPhotoError(415, "Choose a still JPG, PNG, or WebP photo.");
    }
    const output = await pipeline.rotate().resize({
      width: MEMBER_PHOTO_MAX_EDGE,
      height: MEMBER_PHOTO_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    }).webp({ quality: 86 }).toBuffer();
    if (output.length > MEMBER_PHOTO_MAX_BYTES) {
      throw new MemberPhotoError(413, "That photo is too detailed. Please choose a smaller version.");
    }
    return output;
  } catch (error) {
    if (error instanceof MemberPhotoError) throw error;
    throw new MemberPhotoError(400, "That photo could not be read. Choose a valid JPG, PNG, or WebP image.");
  }
}

async function removeOwnedPhoto(memberId: string, avatarUrl: string | null) {
  const path = ownedMemberPhotoPath(memberId, avatarUrl);
  if (!path) return;
  try {
    const { error } = await portraitStore().remove([path]);
    if (error) console.error("Member photo cleanup failed", { errorType: error.name });
  } catch (error) {
    console.error("Member photo cleanup failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
  }
}

export async function saveMemberPhoto(authUserId: string, file: File): Promise<{ avatarUrl: string }> {
  const identity = await writableIdentity(authUserId);
  const store = portraitStore();
  const photo = await normalizeMemberPhoto(file);
  const fileName = `${randomUUID()}.webp`;
  const avatarUrl = memberPhotoUrl(identity.memberId, fileName);
  if (!avatarUrl) throw new MemberPhotoError(500, "Your photo could not be saved.");
  const path = ownedMemberPhotoPath(identity.memberId, avatarUrl)!;
  const { error } = await store.upload(path, photo, { contentType: "image/webp", upsert: false, cacheControl: "0" });
  if (error) throw new MemberPhotoError(503, "Your photo could not be uploaded. Please try again.");

  let priorUrl: string | null;
  try {
    priorUrl = await getApplicationDatabase().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 41)`;
      const rows = await tx<Array<{ avatar_storage_path: string | null }>>`
        select avatar_storage_path from person_profiles
        where person_id = ${identity.personId}::uuid for update
      `;
      await tx`
        insert into person_profiles (person_id, avatar_storage_path)
        values (${identity.personId}::uuid, ${avatarUrl})
        on conflict (person_id) do update
        set avatar_storage_path = excluded.avatar_storage_path, updated_at = statement_timestamp()
      `;
      return rows[0]?.avatar_storage_path ?? null;
    });
  } catch (error) {
    // A connection failure can hide a successful COMMIT. Never compensate by
    // deleting the upload until a fresh database read establishes its state.
    let currentUrl: string | null;
    try {
      currentUrl = await getApplicationDatabase().begin(async (tx) => {
        // Wait for the uncertain transaction to release the same lock before
        // reading: its COMMIT could still be in flight on another connection.
        await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 41)`;
        const current = await tx<Array<{ avatar_storage_path: string | null }>>`
          select avatar_storage_path from person_profiles
          where person_id = ${identity.personId}::uuid
          limit 1
        `;
        return current[0]?.avatar_storage_path ?? null;
      });
    } catch {
      // Unknown outcome: retain the private object rather than risk a broken
      // committed profile. Its bytes remain inaccessible without authorization.
      throw error;
    }
    if (currentUrl === avatarUrl) return { avatarUrl };
    await removeOwnedPhoto(identity.memberId, avatarUrl);
    throw error;
  }
  await removeOwnedPhoto(identity.memberId, priorUrl);
  return { avatarUrl };
}

export async function deleteMemberPhoto(authUserId: string): Promise<{ avatarUrl: null }> {
  const identity = await writableIdentity(authUserId);
  const priorUrl = await getApplicationDatabase().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${identity.memberId}), 41)`;
    const rows = await tx<Array<{ avatar_storage_path: string | null }>>`
      select avatar_storage_path from person_profiles
      where person_id = ${identity.personId}::uuid for update
    `;
    await tx`
      update person_profiles set avatar_storage_path = null, updated_at = statement_timestamp()
      where person_id = ${identity.personId}::uuid
    `;
    return rows[0]?.avatar_storage_path ?? null;
  });
  await removeOwnedPhoto(identity.memberId, priorUrl);
  return { avatarUrl: null };
}

export async function getAuthorizedMemberPhoto(authUserId: string, memberId: string, fileName: string): Promise<Blob | null> {
  const requestedUrl = memberPhotoUrl(memberId, fileName);
  if (!requestedUrl) return null;
  const rows = await getApplicationDatabase()<Array<{ avatar_storage_path: string | null }>>`
    select profile.avatar_storage_path
    from ruined_members member
    join person_profiles profile on profile.person_id = member.person_id
    where member.id = ${memberId}::uuid
    limit 1
  `;
  const currentUrl = rows[0]?.avatar_storage_path ?? null;
  if (currentUrl !== requestedUrl) return null;
  const identity = await getMemberIdentity(authUserId);
  const access = identity ? deriveMemberAccessPolicy(identity, identity.cancellationEffectiveAt) : null;
  const ownerCanRead = identity?.memberId === memberId && !!access && memberCan(access, "profile.read");
  const isOpsAdmin = !ownerCanRead && await getOperatorRole(authUserId) === "ops_admin";
  const circleCanRead = !!access && memberCan(access, "circle.read");
  const circle = !ownerCanRead && !isOpsAdmin && circleCanRead ? await getMemberCircle(authUserId) : null;
  // getMemberCircle already filters avatars using current directory and privacy preferences.
  if (!canViewMemberPhoto({
    requestedUrl,
    currentUrl,
    ownerCanRead,
    isOpsAdmin,
    circleCanRead,
    activeCircle: circle?.circle?.status === "active",
    visibleCircleAvatarUrls: circle?.members.map((member) => member.avatarUrl) ?? [],
  })) return null;

  const { data, error } = await portraitStore().download(ownedMemberPhotoPath(memberId, requestedUrl)!);
  if (error) {
    if ("statusCode" in error && String(error.statusCode) === "404") return null;
    throw new MemberPhotoError(503, "This photo is temporarily unavailable.");
  }
  return data;
}
