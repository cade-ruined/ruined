import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getApplicationDatabase } from "@/lib/database/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PORTRAIT_FILE = new RegExp(`^${FILE_UUID}\\.webp$`, "i");
const PENDING_FILE = new RegExp(`^${FILE_UUID}$`, "i");
const VERIFIED_FILE = new RegExp(`^${FILE_UUID}\\.(webp|mp4|webm)$`, "i");
// Signed upload URLs can remain valid for two hours after account removal.
const FINAL_SWEEP_DELAY_MS = 125 * 60 * 1000;

type StoredObject = { bucket: string; path: string };
type CleanupJob = {
  id: string;
  member_id: string;
  auth_user_ids: string[];
  storage_objects: StoredObject[];
  created_at: Date | string;
  lease_token: string;
};
type ProviderError = { code?: string; status?: number; statusCode?: string | number };
type CleanupClient = {
  storage: { from(bucket: string): {
    list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }): PromiseLike<{ data: { name: string; id: string | null }[] | null; error: ProviderError | null }>;
    remove(paths: string[]): PromiseLike<{ error: ProviderError | null }>;
  } };
  auth: { admin: { deleteUser(id: string, softDelete: boolean): PromiseLike<{ error: ProviderError | null }> } };
};

function cleanupConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) return null;
    return { url, secret };
  } catch { return null; }
}

export function memberDeletionCleanupConfigured() { return cleanupConfiguration() !== null; }

function ownedObject(memberId: string, object: StoredObject) {
  if (!object || typeof object.path !== "string" || !object.path.startsWith(`${memberId}/`)) return false;
  const name = object.path.slice(memberId.length + 1);
  return object.bucket === "member-portraits" ? PORTRAIT_FILE.test(name)
    : object.bucket === "member-journal" && (
      name.startsWith("pending/") ? PENDING_FILE.test(name.slice(8))
        : name.startsWith("verified/") && VERIFIED_FILE.test(name.slice(9))
    );
}

function missingBucket(error: ProviderError) { return error.code === "NoSuchBucket"; }

/** Deletes only a deleted member's explicitly owned paths and Auth identities. */
export async function cleanupMemberProviderData(client: CleanupClient, job: Pick<CleanupJob, "member_id" | "auth_user_ids" | "storage_objects">, deadline = Date.now() + 20_000) {
  if (!job || typeof job !== "object" || typeof job.member_id !== "string" || !UUID.test(job.member_id)
    || !Array.isArray(job.auth_user_ids) || !job.auth_user_ids.every(id => typeof id === "string" && UUID.test(id))
    || !Array.isArray(job.storage_objects) || !job.storage_objects.every(object => ownedObject(job.member_id, object))) {
    throw new Error("Invalid member cleanup ownership.");
  }
  const checkTime = () => { if (Date.now() >= deadline) throw new Error("Member cleanup time budget reached."); };
  // Sweep known owner prefixes, including orphan uploads no longer referenced
  // by a profile. Never enumerate a bucket or another member's directory.
  for (const scope of [
    { bucket: "member-portraits", suffix: "", pattern: PORTRAIT_FILE },
    { bucket: "member-journal", suffix: "/pending", pattern: PENDING_FILE },
    { bucket: "member-journal", suffix: "/verified", pattern: VERIFIED_FILE },
  ]) {
    const store = client.storage.from(scope.bucket);
    const prefix = `${job.member_id}${scope.suffix}`;
    for (;;) {
      checkTime();
      const { data, error } = await store.list(prefix, { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } });
      if (error) {
        if (missingBucket(error) && !job.storage_objects.some(object => object.bucket === scope.bucket)) break;
        throw new Error("Member media cleanup unavailable.");
      }
      if (!data) throw new Error("Member media cleanup returned no listing.");
      if (!data.length) break;
      if (data.some(file => !file.id || !scope.pattern.test(file.name))) throw new Error("Unexpected member media path.");
      checkTime();
      const removed = await store.remove(data.map(file => `${prefix}/${file.name}`));
      if (removed.error) throw new Error("Member media cleanup failed.");
    }
  }
  for (const authUserId of job.auth_user_ids) {
    checkTime();
    const { error } = await client.auth.admin.deleteUser(authUserId, false);
    if (error && error.code !== "user_not_found" && error.status !== 404) throw new Error("Member sign-in cleanup failed.");
  }
}

export async function processMemberDeletionCleanupBatch(requestedLimit = 3, cleanupId: string | null = null) {
  const result = { claimed: 0, completed: 0, deferred: 0, failed: 0 };
  const config = cleanupConfiguration();
  if (!config) return result;
  if (cleanupId !== null && !UUID.test(cleanupId)) throw new Error("Invalid member cleanup id.");
  const client = createClient(config.url, config.secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });
  const sql = getApplicationDatabase();
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(3, Math.trunc(requestedLimit))) : 1;
  const deadline = Date.now() + 22_000;
  for (let index = 0; index < limit && Date.now() < deadline; index += 1) {
    const leaseToken = randomUUID();
    const [job] = await sql<CleanupJob[]>`
      with candidate as (
        select id from private.member_deletion_jobs
        where status <> 'completed' and next_attempt_at <= statement_timestamp()
          and (lease_expires_at is null or lease_expires_at < statement_timestamp())
          and (${cleanupId}::uuid is null or id = ${cleanupId}::uuid)
        order by next_attempt_at, created_at for update skip locked limit 1
      )
      update private.member_deletion_jobs job set status = 'processing', attempt_count = attempt_count + 1,
        lease_token = ${leaseToken}::uuid, lease_expires_at = statement_timestamp() + interval '5 minutes'
      from candidate where job.id = candidate.id
      returning job.id, job.member_id, job.auth_user_ids, job.storage_objects, job.created_at, job.lease_token
    `;
    if (!job) break;
    result.claimed += 1;
    try {
      const [safety] = await sql<{ safe: boolean }[]>`
        select exists (
            select 1 from ruined_members member
            join people person on person.id = member.person_id
            join private.member_deletion_records record on record.member_id = member.id
            where member.id = ${job.member_id}::uuid and member.deleted_at is not null
              and person.status = 'erased' and record.person_id = member.person_id
          )
          and not exists (
            select 1 from platform_users identity
            where identity.auth_user_id = any(${job.auth_user_ids}::uuid[])
              and (identity.status <> 'disabled' or identity.member_id is not null
                or exists (select 1 from platform_role_grants grant_row where grant_row.auth_user_id = identity.auth_user_id
                  and grant_row.role_slug <> 'member'))
          ) as safe
      `;
      if (!safety?.safe) throw new Error("Member cleanup identity changed.");
      await cleanupMemberProviderData(client, job, deadline);
      const finalSweepAt = new Date(new Date(job.created_at).getTime() + FINAL_SWEEP_DELAY_MS);
      const complete = finalSweepAt.getTime() <= Date.now();
      const updated = await sql`
        update private.member_deletion_jobs set status = ${complete ? "completed" : "pending"},
          completed_at = ${complete ? new Date() : null}, next_attempt_at = ${finalSweepAt},
          last_error = null, lease_token = null, lease_expires_at = null
        where id = ${job.id}::uuid and lease_token = ${job.lease_token}::uuid and status = 'processing'
      `;
      if (updated.count !== 1) throw new Error("Member cleanup lease changed.");
      if (complete) result.completed += 1; else result.deferred += 1;
    } catch {
      await sql`
        update private.member_deletion_jobs set status = 'pending', last_error = 'Provider cleanup needs retry.',
          next_attempt_at = statement_timestamp() + interval '5 minutes', lease_token = null, lease_expires_at = null
        where id = ${job.id}::uuid and lease_token = ${job.lease_token}::uuid and status = 'processing'
      `;
      result.failed += 1;
    }
  }
  return result;
}
