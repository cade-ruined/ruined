import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type MemberArchiveState = {
  archivedAt: string | null;
  version: number;
  memberName: string;
  allowed: boolean;
  restoreAllowed: boolean;
  blockers: string[];
  reason: string | null;
};
export class MemberArchiveError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "MemberArchiveError"; }
}
function requireIds(actorId: string, memberId: string) {
  if (!UUID.test(actorId)) throw new MemberArchiveError(403, "Administrator access is required.");
  if (!UUID.test(memberId)) throw new MemberArchiveError(400, "Choose a valid member record.");
}
function databaseError(error: unknown): never {
  const detail = error as { code?: string; message?: string };
  const statuses: Record<string, number> = { PT400: 400, PT403: 403, PT404: 404, PT409: 409 };
  if (statuses[detail?.code ?? ""]) throw new MemberArchiveError(statuses[detail.code!], detail.message ?? "The member archive could not be updated.");
  throw error;
}
export async function getMemberArchiveState(actorId: string, memberId: string): Promise<MemberArchiveState> {
  requireIds(actorId, memberId);
  try {
    const [row] = await getApplicationDatabase()<{ archive: MemberArchiveState }[]>`
      select private.ruined_member_archive_state(${actorId}::uuid, ${memberId}::uuid) as archive
    `;
    if (!row?.archive) throw new MemberArchiveError(404, "Member not found.");
    return row.archive;
  } catch (error) { databaseError(error); }
}
/** Directory organization only. The database retains every membership and content record. */
export async function setMemberArchive(input: {
  actorId: string; memberId: string; action: "archive" | "restore"; expectedVersion: number; reason: string;
}): Promise<MemberArchiveState> {
  requireIds(input.actorId, input.memberId);
  if (!["archive", "restore"].includes(input.action) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
    || input.expectedVersion > 2147483646 || input.reason.trim().length < 3 || input.reason.trim().length > 1000) {
    throw new MemberArchiveError(400, "Choose archive or restore, and include a reason between 3 and 1,000 characters.");
  }
  try {
    const [row] = await getApplicationDatabase()<{ archive: MemberArchiveState }[]>`
      select private.ruined_set_member_archive(${input.actorId}::uuid, ${input.memberId}::uuid,
        ${input.action}, ${input.expectedVersion}::integer, ${input.reason.trim()}) as archive
    `;
    if (!row?.archive) throw new MemberArchiveError(404, "Member not found.");
    return row.archive;
  } catch (error) { databaseError(error); }
}
