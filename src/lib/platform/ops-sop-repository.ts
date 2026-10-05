import "server-only";

import { randomUUID } from "node:crypto";
import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";
import type {
  OpsSop, OpsSopEditorData, OpsSopInput, OpsSopRevision, OpsSopSnapshot, OpsSopStatus,
} from "@/lib/platform/ops-sop-model";

export type { OpsSopInput } from "@/lib/platform/ops-sop-model";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set<OpsSopStatus>(["draft", "published", "archived"]);

type SopRow = {
  id: string;
  title: string;
  summary: string;
  category: string;
  body_text: string;
  external_url: string | null;
  status: OpsSopStatus;
  revision: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
  updated_by: string | null;
};

function requireUuid(value: string, label: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return value.toLowerCase();
}

function textValue(value: unknown, label: string, maximum: number, minimum = 0) {
  if (typeof value !== "string" || value.includes("\u0000")) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} must be plain text.`);
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} must be between ${minimum} and ${maximum.toLocaleString("en-US")} characters.`);
  }
  return normalized;
}

function validateInput(input: OpsSopInput) {
  const title = textValue(input.title, "Title", 200, 1).replace(/\s+/g, " ");
  const summary = textValue(input.summary, "Summary", 2_000);
  const category = textValue(input.category, "Category", 80).replace(/\s+/g, " ") || "General";
  const bodyText = textValue(input.bodyText, "Procedure", 100_000);
  let externalUrl: string | null = null;
  const candidate = input.externalUrl === null ? "" : textValue(input.externalUrl, "Document link", 2_048);
  if (candidate) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid URL");
      externalUrl = url.toString();
      if (externalUrl.length > 2_048) throw new Error("Invalid URL");
    } catch {
      throw new OpsOperatingRepositoryError("invalid_request", "Document link must be a secure HTTPS URL without sign-in credentials.");
    }
  }
  if (!STATUSES.has(input.status)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose draft, published, or archived.");
  }
  if (input.status === "published" && !bodyText && !externalUrl) {
    throw new OpsOperatingRepositoryError("invalid_request", "Add procedure text or a document link before publishing.");
  }
  if (input.id !== undefined && (!Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision ?? 0) < 1)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Refresh this SOP before saving again.");
  }
  return { title, summary, category, bodyText, externalUrl, status: input.status };
}

function asIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function procedureFromRow(row: SopRow): OpsSop {
  return {
    id: row.id, title: row.title, summary: row.summary, category: row.category,
    bodyText: row.body_text, externalUrl: row.external_url, status: row.status,
    revision: Number(row.revision), createdAt: asIso(row.created_at), updatedAt: asIso(row.updated_at),
    publishedAt: row.published_at ? asIso(row.published_at) : null, updatedBy: row.updated_by,
  };
}

async function requireAccess(tx: postgres.TransactionSql, actorValue: string, requireAdmin = false) {
  const actor = requireUuid(actorValue, "Operator identity");
  // Lock the identity and live grants during mutations so revocation/suspension
  // cannot commit between authorization and the protected write.
  const rows = requireAdmin
    ? await tx<Array<{ role_slug: string }>>`
        select role_grant.role_slug from platform_users platform_user
        join platform_role_grants role_grant on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actor}::uuid and platform_user.status = 'active'
          and role_grant.revoked_at is null and role_grant.role_slug = 'ops_admin'
        for update of platform_user, role_grant
      `
    : await tx<Array<{ role_slug: string }>>`
        select role_grant.role_slug from platform_users platform_user
        join platform_role_grants role_grant on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actor}::uuid and platform_user.status = 'active'
          and role_grant.revoked_at is null and role_grant.role_slug in ('ops_admin', 'guide', 'circle_leader')
      `;
  if (rows.length === 0) {
    throw new OpsOperatingRepositoryError("forbidden", requireAdmin ? "Administrator access is required to manage SOPs." : "Operator access is required.");
  }
  return { actor, canManage: rows.some((row) => row.role_slug === "ops_admin") };
}

export async function getOpsSops(actor: string): Promise<OpsSopSnapshot> {
  return getApplicationDatabase().begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const { canManage } = await requireAccess(tx, actor);
    const rows = await tx<SopRow[]>`
      select * from operator_sops where (${canManage}::boolean or status = 'published')
      order by updated_at desc, title, id
    `;
    return { canManage, procedures: rows.map(procedureFromRow) };
  });
}

export async function getOpsSop(actor: string, idValue: string): Promise<OpsSopEditorData> {
  const id = requireUuid(idValue, "SOP");
  return getApplicationDatabase().begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    const { canManage } = await requireAccess(tx, actor);
    const rows = await tx<SopRow[]>`
      select * from operator_sops
      where id = ${id}::uuid and (${canManage}::boolean or status = 'published')
    `;
    if (!rows[0]) throw new OpsOperatingRepositoryError("not_found", "That SOP could not be found.");
    const historyRows = canManage ? await tx<SopRow[]>`
      select * from operator_sop_revisions where sop_id = ${id}::uuid order by revision desc
    ` : [];
    const history: OpsSopRevision[] = historyRows.map((row) => ({
      revision: Number(row.revision), title: row.title, summary: row.summary, category: row.category,
      bodyText: row.body_text, externalUrl: row.external_url, status: row.status,
      updatedAt: asIso(row.updated_at), updatedBy: row.updated_by,
    }));
    return { canManage, procedure: procedureFromRow(rows[0]), history };
  });
}

export async function saveOpsSop(actorValue: string, input: OpsSopInput): Promise<OpsSop> {
  const values = validateInput(input);
  const id = input.id === undefined ? randomUUID() : requireUuid(input.id, "SOP");
  return getApplicationDatabase().begin(async (tx) => {
    const { actor } = await requireAccess(tx, actorValue, true);
    const nameRows = await tx<Array<{ name: string }>>`
      select coalesce(nullif(btrim(profile.display_name), ''), platform_user.email_normalized) as name
      from platform_users platform_user
      left join user_profiles profile on profile.auth_user_id = platform_user.auth_user_id
      where platform_user.auth_user_id = ${actor}::uuid
    `;
    const updatedBy = nameRows[0]?.name ?? "Operator";
    let before: OpsSop | null = null;
    let rows: SopRow[];
    if (input.id !== undefined) {
      const existing = await tx<SopRow[]>`select * from operator_sops where id = ${id}::uuid for update`;
      if (!existing[0]) throw new OpsOperatingRepositoryError("not_found", "That SOP could not be found.");
      before = procedureFromRow(existing[0]);
      if (before.revision !== input.expectedRevision) {
        throw new OpsOperatingRepositoryError("conflict", "This SOP has changed since you opened it. Reload it before saving your changes.");
      }
      rows = await tx<SopRow[]>`
        update operator_sops set title = ${values.title}, summary = ${values.summary}, category = ${values.category},
          body_text = ${values.bodyText}, external_url = ${values.externalUrl}, status = ${values.status},
          revision = revision + 1, updated_at = statement_timestamp(), updated_by = ${updatedBy}, updated_by_auth_user_id = ${actor}::uuid,
          published_at = case when ${values.status} = 'published' then coalesce(published_at, statement_timestamp()) else published_at end
        where id = ${id}::uuid returning *
      `;
    } else {
      rows = await tx<SopRow[]>`
        insert into operator_sops (id, title, summary, category, body_text, external_url, status,
          updated_by, updated_by_auth_user_id, published_at)
        values (${id}::uuid, ${values.title}, ${values.summary}, ${values.category}, ${values.bodyText}, ${values.externalUrl}, ${values.status},
          ${updatedBy}, ${actor}::uuid, case when ${values.status} = 'published' then statement_timestamp() else null end)
        returning *
      `;
    }
    const procedure = procedureFromRow(rows[0]!);
    await tx`
      insert into operator_audit_events (actor_auth_user_id, action, subject_type, subject_id, before_snapshot, after_snapshot, metadata, dedupe_key)
      values (${actor}::uuid, ${before ? "sop.updated" : "sop.created"}, 'operator_sop', ${id},
        ${before ? tx.json({ revision: before.revision, title: before.title, status: before.status }) : null},
        ${tx.json({ revision: procedure.revision, title: procedure.title, status: procedure.status })}, '{}'::jsonb, ${randomUUID()})
    `;
    return procedure;
  });
}
