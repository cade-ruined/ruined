import "server-only";

import { getBillingDatabase } from "@/lib/stripe/database";
import { OpsRepositoryError, requireOpsAdmin, writeOpsAudit } from "@/lib/platform/ops-repository";

export type PendingMemberInvitation = {
  id: string; email: string; memberId: string | null; invitedAt: string; expiresAt: string | null; status: "pending" | "expired";
};
export type PendingMemberInvitationPage = {
  entries: PendingMemberInvitation[]; query: string; page: number; pageCount: number; totalResults: number;
};
type InvitationRow = { id: string; email_normalized: string; member_id: string | null; invited_at: Date; expires_at: Date | null; expired: boolean };
function entry(row: InvitationRow): PendingMemberInvitation {
  return { id: row.id, email: row.email_normalized, memberId: row.member_id, invitedAt: row.invited_at.toISOString(), expiresAt: row.expires_at?.toISOString() ?? null, status: row.expired ? "expired" : "pending" };
}
function invitationId(value: string) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new OpsRepositoryError("invalid_request", "Choose a valid joining allowance.");
}

export async function getPendingMemberInvitations(actorAuthUserId: string, input: { query?: string; page?: number } = {}): Promise<PendingMemberInvitationPage> {
  const query = (input.query ?? "").trim().slice(0, 120).toLowerCase();
  const requestedPage = Number.isSafeInteger(input.page) && (input.page ?? 0) > 0 ? input.page! : 1;
  return getBillingDatabase().begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    const totals = await tx<Array<{ count: number }>>`
      select count(*)::integer as count from passwordless_account_invites
      where intended_user_type = 'member' and accepted_at is null and revoked_at is null
        and (${query} = '' or position(${query} in email_normalized) > 0)
    `;
    const totalResults = totals[0]?.count ?? 0;
    const pageCount = Math.max(1, Math.ceil(totalResults / 25));
    const page = Math.min(requestedPage, pageCount);
    const rows = await tx<InvitationRow[]>`
      select id::text, email_normalized, member_id, invited_at, expires_at,
        (expires_at is not null and expires_at <= statement_timestamp()) as expired
      from passwordless_account_invites
      where intended_user_type = 'member' and accepted_at is null and revoked_at is null
        and (${query} = '' or position(${query} in email_normalized) > 0)
      order by invited_at desc, id desc limit 25 offset ${(page - 1) * 25}
    `;
    return { entries: rows.map(entry), query, page, pageCount, totalResults };
  });
}

export async function getPendingMemberInvitation(actorAuthUserId: string, id: string): Promise<PendingMemberInvitation> {
  invitationId(id);
  return getBillingDatabase().begin(async (tx) => {
    await requireOpsAdmin(tx, actorAuthUserId);
    const rows = await tx<InvitationRow[]>`
      select id::text, email_normalized, member_id, invited_at, expires_at,
        (expires_at is not null and expires_at <= statement_timestamp()) as expired
      from passwordless_account_invites where id = ${id}::bigint and intended_user_type = 'member'
        and accepted_at is null and revoked_at is null
    `;
    if (!rows[0]) throw new OpsRepositoryError("conflict", "This joining allowance was accepted, removed, or replaced. Refresh pending joining.");
    return entry(rows[0]);
  });
}

export async function revokePendingMemberInvitation(input: { actorAuthUserId: string; invitationId: string; email: string }) {
  invitationId(input.invitationId);
  return getBillingDatabase().begin(async (tx) => {
    await requireOpsAdmin(tx, input.actorAuthUserId);
    await tx`select pg_advisory_xact_lock(hashtext(${input.email}), 1)`;
    const revoked = await tx<Array<{ id: string }>>`
      update passwordless_account_invites set revoked_at = statement_timestamp(), revoked_by_auth_user_id = ${input.actorAuthUserId}::uuid
      where id = ${input.invitationId}::bigint and email_normalized = ${input.email} and intended_user_type = 'member'
        and accepted_at is null and revoked_at is null returning id::text
    `;
    if (!revoked[0]) throw new OpsRepositoryError("conflict", "This joining allowance has changed. Refresh pending joining before removing it.");
    await writeOpsAudit(tx, { action: "member_invitation.revoked", actorAuthUserId: input.actorAuthUserId,
      subjectId: input.invitationId, subjectType: "member_invitation", after: { email: input.email, revoked: true } });
    return { email: input.email, revoked: 1 };
  });
}
