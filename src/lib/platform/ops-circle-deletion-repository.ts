import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { OpsRepositoryError, type OpsBlockStatus } from "@/lib/platform/ops-repository";
import { getBillingDatabase } from "@/lib/stripe/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CircleRow = {
  id: string;
  name: string;
  status: "forming" | "active" | "completed" | "archived";
  starts_at: Date | null;
  ends_at: Date | null;
  activated_at: Date | null;
  activated_by_auth_user_id: string | null;
};

export type OpsCircleRetirementResult = {
  id: string;
  name: string;
  outcome: "deleted" | "archived";
  blockId: string | null;
  blockStatus: OpsBlockStatus | null;
  blockArchived: boolean;
};

type CircleRetirementInput = {
  actorAuthUserId: string;
  circleId: string;
  confirmationName: string;
};

async function lockCircleForAdmin(tx: postgres.TransactionSql, input: CircleRetirementInput): Promise<CircleRow> {
  const admins = await tx<Array<{ auth_user_id: string }>>`
    select platform_user.auth_user_id
    from platform_users platform_user
    join platform_role_grants grant_row on grant_row.auth_user_id = platform_user.auth_user_id
    where platform_user.auth_user_id = ${input.actorAuthUserId}::uuid
      and platform_user.status = 'active'
      and grant_row.role_slug = 'ops_admin'
      and grant_row.revoked_at is null
    limit 1
    for update of platform_user, grant_row
  `;
  if (!admins[0]) throw new OpsRepositoryError("forbidden", "Operations administrator access is required.");
  if (!UUID_PATTERN.test(input.circleId)) throw new OpsRepositoryError("invalid_request", "Choose a valid Circle.");

  // Assignment/transfer writers and their database guards lock this same row.
  // Do not take member/assignment locks after it: those writers use member first.
  const circles = await tx<CircleRow[]>`
    select id, name, status, starts_at, ends_at, activated_at, activated_by_auth_user_id
    from circles where id = ${input.circleId}::uuid for update
  `;
  const circle = circles[0];
  if (!circle) throw new OpsRepositoryError("not_found", "That Circle could not be found. Refresh the Circle list.");
  if (input.confirmationName.trim() !== circle.name) {
    throw new OpsRepositoryError("invalid_request", "Type the Circle's current name exactly to confirm.");
  }
  const occupied = await tx<Array<{ occupied: boolean }>>`
    select exists (
      select 1 from circle_member_assignments
      where circle_id = ${circle.id}::uuid and ended_at is null
    ) as occupied
  `;
  if (occupied[0]?.occupied) {
    throw new OpsRepositoryError("conflict", "Move every member to another Circle before archiving or deleting this Circle.");
  }
  return circle;
}

async function recordRetirement(tx: postgres.TransactionSql, actorAuthUserId: string, circle: CircleRow, result: OpsCircleRetirementResult) {
  const before = { ...circle,
    starts_at: circle.starts_at?.toISOString() ?? null,
    ends_at: circle.ends_at?.toISOString() ?? null,
    activated_at: circle.activated_at?.toISOString() ?? null,
  };
  await tx`
    insert into operator_audit_events (
      actor_auth_user_id, action, subject_type, subject_id, before_snapshot, after_snapshot, metadata, dedupe_key
    ) values (
      ${actorAuthUserId}::uuid, ${`circle.${result.outcome}`}, 'circle', ${circle.id},
      ${tx.json(before)}, ${tx.json(result)}, '{}'::jsonb, ${randomUUID()}
    )
  `;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function hasCircleHistory(tx: postgres.TransactionSql, circleId: string): Promise<boolean> {
  // Discover every FK, not just the dependencies visible on the Circle card.
  // This includes ended assignments, staff, resources, events, Academy targets,
  // announcements, invitations and future FK-backed features. No cascade runs.
  const references = await tx<Array<{ schema_name: string; table_name: string; column_name: string; supported: boolean }>>`
    select namespace.nspname as schema_name, relation.relname as table_name,
      attribute.attname as column_name,
      (cardinality(constraint_row.conkey) = 1 and cardinality(constraint_row.confkey) = 1
        and referenced_attribute.attname = 'id') as supported
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attnum = constraint_row.conkey[1]
    join pg_attribute referenced_attribute on referenced_attribute.attrelid = constraint_row.confrelid
      and referenced_attribute.attnum = constraint_row.confkey[1]
    where constraint_row.contype = 'f' and constraint_row.confrelid = 'public.circles'::regclass
  `;
  if (references.some((reference) => !reference.supported)) return true;
  if (references.length) {
    // Only catalog identifiers enter the statement; the requested ID is bound.
    const probes = references.map((reference) => `select 1 from ${quoteIdentifier(reference.schema_name)}.${quoteIdentifier(reference.table_name)} where ${quoteIdentifier(reference.column_name)} = $1::uuid`);
    const rows = await tx.unsafe<Array<{ used: boolean }>>(`select exists (${probes.join(" union all ")}) as used`, [circleId]);
    if (rows[0]?.used) return true;
  }

  // These ledgers use polymorphic IDs/JSON rather than FKs. Conservatively keep
  // the Circle if any evidence mentions it, even when a visible roster is empty.
  const evidence = await tx<Array<{ used: boolean }>>`
    select (
      exists (select 1 from operator_audit_events
        where subject_id = ${circleId}
          or before_snapshot::text like ${`%${circleId}%`}
          or after_snapshot::text like ${`%${circleId}%`}
          or metadata::text like ${`%${circleId}%`})
      or exists (select 1 from integration_outbox
        where aggregate_id = ${circleId} or payload::text like ${`%${circleId}%`})
      or exists (select 1 from integration_entity_links
        where local_entity_id = ${circleId} or metadata::text like ${`%${circleId}%`})
    ) as used
  `;
  return evidence[0]?.used === true;
}

export async function deleteUnusedCircle(input: CircleRetirementInput): Promise<OpsCircleRetirementResult> {
  const sql = getBillingDatabase();
  try {
    return await sql.begin(async (tx) => {
      const circle = await lockCircleForAdmin(tx, input);
      if (circle.status !== "forming" || circle.activated_at || circle.activated_by_auth_user_id || await hasCircleHistory(tx, circle.id)) {
        throw new OpsRepositoryError("conflict", "This Circle has been used or has linked records. Choose Archive Circle to keep its history.");
      }
      const deleted = await tx<Array<{ id: string }>>`delete from circles where id = ${circle.id}::uuid returning id`;
      if (!deleted[0]) throw new OpsRepositoryError("conflict", "The Circle changed. Refresh before deleting it.");
      const result: OpsCircleRetirementResult = { id: circle.id, name: circle.name, outcome: "deleted", blockId: null, blockStatus: null, blockArchived: false };
      await recordRetirement(tx, input.actorAuthUserId, circle, result);
      return result;
    });
  } catch (error) {
    if (["23503", "23001"].includes((error as { code?: string }).code ?? "")) {
      throw new OpsRepositoryError("conflict", "This Circle gained a linked record. Refresh and choose Archive Circle to keep its history.");
    }
    throw error;
  }
}

export async function archiveEmptyCircle(input: CircleRetirementInput): Promise<OpsCircleRetirementResult> {
  const sql = getBillingDatabase();
  try {
    return await sql.begin(async (tx) => {
      const circle = await lockCircleForAdmin(tx, input);
      const futureStart = await tx<Array<{ future_start: boolean }>>`
        select starts_at > statement_timestamp() as future_start from circles where id = ${circle.id}::uuid
      `;
      if (circle.status === "forming" && futureStart[0]?.future_start) {
        throw new OpsRepositoryError("conflict", "This Circle has a future start date. Review that scheduled start before archiving; its existing dates cannot be rewritten here.");
      }
      const blocks = await tx<Array<{ id: string; status: OpsBlockStatus }>>`
        select block.id, block.status from membership_blocks block
        join block_circle_assignments assignment on assignment.block_id = block.id
          and assignment.circle_id = ${circle.id}::uuid and assignment.ended_at is null
        for update of block
      `;
      const block = blocks[0];
      if (circle.status !== "archived") {
        // The existing status trigger reconciles a parent Block. Keep completed
        // end times and all activation proof, assignments and external events.
        await tx`
          update circles set status = 'archived',
            ends_at = case when status = 'completed' then ends_at else statement_timestamp() end,
            updated_at = statement_timestamp()
          where id = ${circle.id}::uuid
        `;
      }
      const finalBlocks = block ? await tx<Array<{ status: OpsBlockStatus }>>`
        select status from membership_blocks where id = ${block.id}::uuid
      ` : [];
      const blockStatus = finalBlocks[0]?.status ?? null;
      const result: OpsCircleRetirementResult = {
        id: circle.id, name: circle.name, outcome: "archived",
        blockId: block?.id ?? null, blockStatus,
        blockArchived: block?.status === "active" && blockStatus === "archived",
      };
      if (circle.status !== "archived") await recordRetirement(tx, input.actorAuthUserId, circle, result);
      return result;
    });
  } catch (error) {
    if ((error as { code?: string; message?: string }).code === "23514"
      && (error as Error).message.includes("A forming Circle may only remain forming or become active")) {
      throw new OpsRepositoryError("conflict", "Archiving a forming Circle needs the Circle retirement database update. An administrator must apply it before you retry.");
    }
    throw error;
  }
}
