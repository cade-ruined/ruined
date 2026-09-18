import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import { memberDeletionCleanupConfigured } from "@/lib/platform/member-deletion-cleanup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MemberDeletionEligibility = {
  allowed: boolean;
  blockers: string[];
  confirmationEmail: string;
  memberName: string;
  lifecycleVersion: number;
};

export class MemberDeletionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MemberDeletionError";
  }
}

function requireIds(actorId: string, memberId: string) {
  if (!UUID.test(actorId) || !UUID.test(memberId)) {
    throw new MemberDeletionError(400, "The member record is invalid.");
  }
}

const BLOCKERS: Record<string, string> = {
  account_not_closed: "Close this member’s account under Record a state correction before deleting it.",
  self_deletion: "You cannot delete your own member account.",
  operator_identity: "Operator accounts and their access history cannot be deleted here.",
  shared_identity: "This person’s identity is shared with other records and cannot be deleted here.",
  stripe_not_terminal: "Cancel any open Stripe subscription or Checkout session before deleting this account.",
  already_deleted: "This account has already been deleted. Its historical member record is retained.",
  active_circle: "Remove this member from their current Circle before deleting the account.",
  active_experience: "Cancel this member’s upcoming event registrations before deleting the account.",
  active_fulfillment: "Resolve this member’s open artifact or fulfillment work before deleting the account.",
  linked_communications: "Remove this member from the communications contact list before deleting the account.",
  pending_workflows: "Resolve this member’s pending work before deleting the account.",
  protected_storage: "Some uploaded content cannot be safely identified as belonging only to this member.",
};

function blockerMessage(value: string) {
  return BLOCKERS[value] ?? (value.startsWith("linked_history:")
    ? "Resolve this member’s open activity or shared records before deleting the account."
    : "This account needs further review before it can be permanently deleted.");
}

function databaseError(error: unknown): never {
  const detail = error as { code?: string; message?: string };
  const statuses: Record<string, number> = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 };
  const status = statuses[detail?.code ?? ""];
  if (status) throw new MemberDeletionError(status, detail.message ?? "The member could not be deleted.");
  throw error;
}

export async function getMemberDeletionEligibility(actorId: string, memberId: string): Promise<MemberDeletionEligibility> {
  requireIds(actorId, memberId);
  const sql = getApplicationDatabase();
  try {
    const [row] = await sql<{ deletion: MemberDeletionEligibility }[]>`
      select private.ruined_member_deletion_eligibility(${actorId}::uuid, ${memberId}::uuid) as deletion
    `;
    if (!row?.deletion) throw new MemberDeletionError(404, "Member not found.");
    const deletion = { ...row.deletion, blockers: [...new Set(row.deletion.blockers.map(blockerMessage))] };
    if (!memberDeletionCleanupConfigured()) {
      return { ...deletion, allowed: false, blockers: [...deletion.blockers, "Account deletion is temporarily unavailable. Please try again later."] };
    }
    return deletion;
  } catch (error) { databaseError(error); }
}

export async function deleteMemberRecord(input: {
  actorId: string;
  memberId: string;
  confirmationEmail: string;
  expectedLifecycleVersion: number;
  reason: string;
}): Promise<{ deleted: true; cleanupId: string }> {
  requireIds(input.actorId, input.memberId);
  if (!Number.isSafeInteger(input.expectedLifecycleVersion) || input.expectedLifecycleVersion < 1
    || !["test_account", "duplicate_account", "account_removal", "member_request"].includes(input.reason)
    || input.confirmationEmail.length > 254 || !input.confirmationEmail.trim()) {
    throw new MemberDeletionError(400, "Choose a reason and type the member’s email to confirm.");
  }
  if (!memberDeletionCleanupConfigured()) {
    throw new MemberDeletionError(503, "Account deletion is temporarily unavailable. Nothing has been deleted.");
  }
  const sql = getApplicationDatabase();
  try {
    const [row] = await sql<{ deletion: { deleted: true; cleanupId: string } }[]>`
      select private.ruined_delete_member(
        ${input.actorId}::uuid, ${input.memberId}::uuid, ${input.expectedLifecycleVersion}::bigint,
        ${input.confirmationEmail.trim().toLowerCase()}, ${input.reason}
      ) as deletion
    `;
    if (!row?.deletion?.deleted || !UUID.test(row.deletion.cleanupId)) throw new Error("Member deletion returned an invalid result.");
    return row.deletion;
  } catch (error) { databaseError(error); }
}
