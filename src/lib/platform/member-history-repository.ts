import "server-only";

import type postgres from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;

export class MemberHistoryRepositoryError extends Error {
  constructor(readonly status: 400 | 403, message: string) {
    super(message);
    this.name = "MemberHistoryRepositoryError";
  }
}

export type HistoricalMember = {
  memberId: string;
  displayName: string;
  memberTag: string | null;
  memberNumber: number | null;
  joinedAt: string | null;
  deletedAt: string;
  reason: string;
};

export type HistoricalMemberDirectoryPage = {
  members: HistoricalMember[];
  query: string;
  page: number;
  pageCount: number;
  pageSize: number;
  totalResults: number;
};

export type HistoricalMemberRecord = HistoricalMember & {
  deletedByAuthUserId: string;
  deletedByName: string;
  cleanupStatus: "pending" | "processing" | "completed" | null;
  accountState: string | null;
  billingState: string | null;
  standingState: string | null;
  membershipHistory: Array<{
    id: string;
    dimension: string;
    previousState: string | null;
    nextState: string;
    source: string;
    occurredAt: string;
    actorAuthUserId: string | null;
    actorName: string;
  }>;
  auditHistory: Array<{
    id: string;
    action: string;
    occurredAt: string;
    actorAuthUserId: string | null;
    actorName: string;
  }>;
};

type HistoricalRow = {
  member_id: string;
  display_name: string;
  member_tag: string | null;
  member_number: number | null;
  joined_at: Date | string | null;
  deleted_at: Date | string;
  reason: string;
};

function memberFrom(row: HistoricalRow): HistoricalMember {
  return {
    memberId: row.member_id,
    displayName: row.display_name,
    memberTag: row.member_tag,
    memberNumber: row.member_number,
    joinedAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
    deletedAt: new Date(row.deleted_at).toISOString(),
    reason: row.reason,
  };
}

async function requireHistoricalAccess(tx: postgres.TransactionSql, actorAuthUserId: string) {
  const [actor] = await tx<Array<{ auth_user_id: string }>>`
    select account.auth_user_id
    from platform_users account
    join platform_role_grants role_grant on role_grant.auth_user_id = account.auth_user_id
    where account.auth_user_id = ${actorAuthUserId}::uuid
      and account.status = 'active'
      and role_grant.role_slug = 'ops_admin'
      and role_grant.revoked_at is null
    limit 1
  `;
  if (!actor) throw new MemberHistoryRepositoryError(403, "Administrator access is required to view historical members.");
}

function requireActorId(actorAuthUserId: string) {
  if (!UUID.test(actorAuthUserId)) throw new MemberHistoryRepositoryError(403, "Administrator access is required to view historical members.");
}

/** Historical accounts have their own count and never join private profile or contact storage. */
export async function getHistoricalMemberDirectory(actorAuthUserId: string, input: {
  query?: string;
  page?: number;
} = {}): Promise<HistoricalMemberDirectoryPage> {
  requireActorId(actorAuthUserId);
  const query = (input.query ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const numberMatch = /^(?:no\.\s*)?(\d+)$/i.exec(query);
  const requestedNumber = numberMatch ? Number(numberMatch[1]) : NaN;
  const memberNumber = Number.isSafeInteger(requestedNumber) && requestedNumber >= 0 && requestedNumber <= 2147483647 ? requestedNumber : null;
  const requestedPage = Number.isSafeInteger(input.page) && (input.page ?? 0) > 0 ? input.page! : 1;
  return getApplicationDatabase().begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireHistoricalAccess(tx, actorAuthUserId);
    const [count] = await tx<Array<{ total: number }>>`
      select count(*)::integer as total
      from private.member_deletion_records history
      join ruined_members member on member.id = history.member_id
      where member.deleted_at is not null and (
        ${query} = ''
        or strpos(lower(history.display_name), lower(${query})) > 0
        or strpos(lower('@' || coalesce(history.member_tag, '')), lower(${query})) > 0
        or history.member_number = ${memberNumber}::integer
      )
    `;
    const totalResults = count?.total ?? 0;
    const pageCount = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const rows = await tx<Array<HistoricalRow>>`
      select history.member_id, history.display_name, history.member_tag, history.member_number,
        history.joined_at, history.deleted_at, history.reason
      from private.member_deletion_records history
      join ruined_members member on member.id = history.member_id
      where member.deleted_at is not null and (
        ${query} = ''
        or strpos(lower(history.display_name), lower(${query})) > 0
        or strpos(lower('@' || coalesce(history.member_tag, '')), lower(${query})) > 0
        or history.member_number = ${memberNumber}::integer
      )
      order by history.deleted_at desc, history.member_id
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}
    `;
    return { members: rows.map(memberFrom), query, page, pageCount, pageSize: PAGE_SIZE, totalResults };
  });
}

export async function getHistoricalMemberRecord(actorAuthUserId: string, memberId: string): Promise<HistoricalMemberRecord | null> {
  requireActorId(actorAuthUserId);
  if (!UUID.test(memberId)) return null;
  return getApplicationDatabase().begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireHistoricalAccess(tx, actorAuthUserId);
    const [row] = await tx<Array<HistoricalRow & {
      actor_auth_user_id: string;
      actor_name: string;
      cleanup_status: "pending" | "processing" | "completed" | null;
      account_state: string | null;
      billing_state: string | null;
      standing_state: string | null;
    }>>`
      select history.member_id, history.display_name, history.member_tag, history.member_number,
        history.joined_at, history.deleted_at, history.reason, history.actor_auth_user_id,
        lifecycle.account_state, lifecycle.billing_state, lifecycle.standing_state,
        coalesce(nullif(btrim(actor_profile.display_name), ''), nullif(btrim(actor_profile.preferred_name), ''), 'Administrator') as actor_name,
        cleanup.status as cleanup_status
      from private.member_deletion_records history
      join ruined_members member on member.id = history.member_id and member.deleted_at is not null
      left join member_lifecycle lifecycle on lifecycle.member_id = history.member_id
      left join platform_users actor on actor.auth_user_id = history.actor_auth_user_id
      left join person_profiles actor_profile on actor_profile.person_id = actor.person_id
      left join lateral (
        select job.status from private.member_deletion_jobs job
        where job.member_id = history.member_id order by job.created_at desc, job.id desc limit 1
      ) cleanup on true
      where history.member_id = ${memberId}::uuid
      limit 1
    `;
    if (!row) return null;
    const membership = await tx<Array<{
      id: string;
      dimension: string;
      previous_state: string | null;
      next_state: string;
      source: string;
      occurred_at: Date | string;
      actor_auth_user_id: string | null;
      actor_name: string;
    }>>`
      select history.id::text, history.dimension, history.previous_state, history.next_state, history.source,
        history.occurred_at, history.actor_auth_user_id,
        coalesce(nullif(btrim(actor_profile.display_name), ''), nullif(btrim(actor_profile.preferred_name), ''),
          case when history.actor_auth_user_id is null then 'System' when history.source = 'member' then 'Former member' else 'Administrator' end) as actor_name
      from member_state_history history
      left join platform_users actor on actor.auth_user_id = history.actor_auth_user_id
      left join person_profiles actor_profile on actor_profile.person_id = actor.person_id
      where history.member_id = ${memberId}::uuid
      order by history.occurred_at desc, history.id desc
      limit 50
    `;
    const audit = await tx<Array<{
      id: string;
      action: string;
      occurred_at: Date | string;
      actor_auth_user_id: string | null;
      actor_name: string;
    }>>`
      select history.id::text, history.action, history.occurred_at, history.actor_auth_user_id,
        coalesce(nullif(btrim(actor_profile.display_name), ''), nullif(btrim(actor_profile.preferred_name), ''),
          case when history.actor_auth_user_id is null then 'System' else 'Administrator' end) as actor_name
      from operator_audit_events history
      left join platform_users actor on actor.auth_user_id = history.actor_auth_user_id
      left join person_profiles actor_profile on actor_profile.person_id = actor.person_id
      where history.member_id = ${memberId}::uuid
        or (history.subject_type = 'member' and history.subject_id = ${memberId})
      order by history.occurred_at desc, history.id desc
      limit 50
    `;
    return {
      ...memberFrom(row),
      deletedByAuthUserId: row.actor_auth_user_id,
      deletedByName: row.actor_name,
      cleanupStatus: row.cleanup_status,
      accountState: row.account_state,
      billingState: row.billing_state,
      standingState: row.standing_state,
      membershipHistory: membership.map((entry) => ({
        id: entry.id, dimension: entry.dimension, previousState: entry.previous_state,
        nextState: entry.next_state, source: entry.source, occurredAt: new Date(entry.occurred_at).toISOString(),
        actorAuthUserId: entry.actor_auth_user_id, actorName: entry.actor_name,
      })),
      auditHistory: audit.map((entry) => ({
        id: entry.id, action: entry.action, occurredAt: new Date(entry.occurred_at).toISOString(), actorAuthUserId: entry.actor_auth_user_id, actorName: entry.actor_name,
      })),
    };
  });
}
