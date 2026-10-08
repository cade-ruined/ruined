import "server-only";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { AdminEmailError } from "./admin-email-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireUuid(value: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new AdminEmailError(400, "That email record is invalid.");
  return value;
}
/** The route's session check is not authorization. Every read/write checks live grants. */
export async function requireAdminEmailActor(tx: TransactionSql, actor: string, lock = false): Promise<void> {
  requireUuid(actor);
  const rows = lock ? await tx`
    select account.auth_user_id from platform_users account
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id
    where account.auth_user_id=${actor}::uuid and account.status='active'
      and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
    for share of account,grant_row
  ` : await tx`
    select account.auth_user_id from platform_users account
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id
    where account.auth_user_id=${actor}::uuid and account.status='active'
      and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
  `;
  if (!rows.length) throw new AdminEmailError(403, "Email creation and sending require administrator access.");
}
export async function assertAdminEmailAccess(actorAuthUserId: string): Promise<void> {
  await getApplicationDatabase().begin(tx => requireAdminEmailActor(tx, actorAuthUserId));
}
export async function consumeAdminEmailGeneration(actorAuthUserId: string): Promise<boolean> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actorAuthUserId, true);
    const rows = await tx`
      insert into admin_email_generation_limits(actor_auth_user_id,window_started_at,attempts)
      values(${actorAuthUserId}::uuid,date_trunc('hour',clock_timestamp()),1)
      on conflict(actor_auth_user_id,window_started_at) do update
        set attempts=admin_email_generation_limits.attempts+1
        where admin_email_generation_limits.attempts<30 returning attempts
    `;
    return rows.length > 0;
  });
}
