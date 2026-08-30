import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import type {
  OpsAcademyAudience,
  OpsAcademyAudienceKind,
  OpsAcademyCollection,
  OpsAcademyEditorData,
  OpsAcademyResourceDraft,
  OpsAcademyResourceSummary,
  OpsAcademySnapshot,
  OpsAcademyStatus,
} from "@/lib/platform/ops-academy-model";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTENT_TYPES = new Set(["article", "audio", "download", "link", "pdf", "video"]);
const RESOURCE_STATES = new Set<OpsAcademyStatus>(["draft", "published", "retired", "unpublished"]);

type AcademyAudienceInput = { id?: string | null; kind: OpsAcademyAudienceKind };

export type OpsAcademyResourceInput = {
  audiences: AcademyAudienceInput[];
  bodyText: string;
  captionsUrl: string;
  collectionId: string;
  contentType: string;
  durationLabel: string;
  expectedRevision?: number;
  externalUrl: string;
  featured: boolean;
  position: number;
  presenter: string;
  resourceId?: string;
  slug: string;
  summary: string;
  thumbnailUrl: string;
  title: string;
  videoUrl: string;
};

export type OpsAcademyCollectionInput = {
  collectionId?: string;
  expectedRevision?: number;
  name: string;
  position: number;
  slug: string;
  summary: string;
};

type DraftProjection = {
  audiences: AcademyAudienceInput[];
  collectionId: string | null;
  contentType: string;
  position: number;
  slug: string;
  summary: string | null;
  title: string;
};

type VersionMetadata = {
  academyDraft: DraftProjection;
  captionsUrl: string | null;
  durationLabel: string | null;
  featured: boolean;
  presenter: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
};

type ResourceRow = {
  body_text: string | null;
  collection_id: string | null;
  collection_name: string | null;
  content_type: string;
  current_version: number | string | null;
  current_version_id: string | null;
  external_url: string | null;
  latest_metadata: unknown;
  latest_published_at: Date | string | null;
  latest_version: number | string;
  latest_version_id: string;
  position: number | string;
  published_at: Date | string | null;
  resource_id: string;
  revision: number | string;
  slug: string;
  status: string;
  summary: string | null;
  title: string;
};

function requireUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function optionalUuid(value: string, label: string): string | null {
  const normalized = value.trim();
  return normalized ? requireUuid(normalized, label) : null;
}

function normalizedText(value: string, label: string, minimum: number, maximum: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      `${label} must be between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function optionalText(value: string, label: string, maximum: number): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is too long.`);
  }
  return normalized;
}

function normalizedSlug(value: string, title: string): string {
  const candidate = value.trim() || title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!SLUG_PATTERN.test(candidate) || candidate.length > 160) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "The Academy URL must contain lowercase letters, numbers, and single hyphens.",
    );
  }
  return candidate;
}

function normalizedUrl(
  value: string,
  label: string,
  { allowRelative = false }: { allowRelative?: boolean } = {},
): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  if (allowRelative && candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:") return parsed.toString();
  } catch {
    // The shared error below keeps URL validation details out of the response.
  }
  throw new OpsOperatingRepositoryError("invalid_request", `${label} must be a secure HTTPS URL.`);
}

function positivePosition(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new OpsOperatingRepositoryError("invalid_request", "Position must be between 1 and 10,000.");
  }
  return value;
}

function expectedRevision(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) {
    throw new OpsOperatingRepositoryError("invalid_request", "Refresh this Academy record and try again.");
  }
  return value!;
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return metadataRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function metadataString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataBoolean(record: Record<string, unknown> | null, key: string): boolean {
  return record?.[key] === true;
}

function draftProjection(value: unknown): DraftProjection | null {
  const root = metadataRecord(value);
  const draft = metadataRecord(root?.academyDraft);
  if (!draft) return null;
  const audiences = Array.isArray(draft.audiences)
    ? draft.audiences.flatMap((entry) => {
        const item = metadataRecord(entry);
        const kind = item?.kind;
        if (kind !== "all_members" && kind !== "circle" && kind !== "block") return [];
        return [{
          id: typeof item?.id === "string" ? item.id : null,
          kind,
        } satisfies AcademyAudienceInput];
      })
    : [];
  return {
    audiences,
    collectionId: typeof draft.collectionId === "string" ? draft.collectionId : null,
    contentType: typeof draft.contentType === "string" ? draft.contentType : "article",
    position: typeof draft.position === "number" ? draft.position : 1,
    slug: typeof draft.slug === "string" ? draft.slug : "lesson",
    summary: typeof draft.summary === "string" ? draft.summary : null,
    title: typeof draft.title === "string" ? draft.title : "Untitled lesson",
  };
}

function versionMetadata(value: unknown): VersionMetadata | null {
  const root = metadataRecord(value);
  const draft = draftProjection(value);
  if (!root || !draft) return null;
  return {
    academyDraft: draft,
    captionsUrl: metadataString(root, "captionsUrl"),
    durationLabel: metadataString(root, "durationLabel"),
    featured: metadataBoolean(root, "featured"),
    presenter: metadataString(root, "presenter"),
    thumbnailUrl: metadataString(root, "thumbnailUrl"),
    videoUrl: metadataString(root, "videoUrl"),
  };
}

async function requireAcademyAdmin(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  lock = false,
) {
  const actorAuthUserId = requireUuid(actorAuthUserIdValue, "Operator identity");
  const rows = lock
    ? await tx<Array<{ auth_user_id: string }>>`
        select platform_user.auth_user_id
        from platform_users platform_user
        join platform_role_grants role_grant
          on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null
        limit 1
        for update of platform_user, role_grant
      `
    : await tx<Array<{ auth_user_id: string }>>`
        select platform_user.auth_user_id
        from platform_users platform_user
        join platform_role_grants role_grant
          on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null
        limit 1
      `;
  if (!rows[0]) {
    throw new OpsOperatingRepositoryError("forbidden", "Academy administrator access is required.");
  }
  return actorAuthUserId;
}

async function writeAcademyAudit(
  tx: postgres.TransactionSql,
  input: {
    action: string;
    actorAuthUserId: string;
    after?: postgres.JSONValue;
    before?: postgres.JSONValue;
    subjectId: string;
    subjectType: "learning_collection" | "learning_resource";
  },
) {
  await tx`
    insert into operator_audit_events (
      actor_auth_user_id,
      action,
      subject_type,
      subject_id,
      before_snapshot,
      after_snapshot,
      metadata,
      dedupe_key
    ) values (
      ${input.actorAuthUserId}::uuid,
      ${input.action},
      ${input.subjectType},
      ${input.subjectId},
      ${input.before === undefined ? null : tx.json(input.before)},
      ${input.after === undefined ? null : tx.json(input.after)},
      '{}'::jsonb,
      ${randomUUID()}
    )
  `;
}

function validateResourceInput(input: OpsAcademyResourceInput) {
  const title = normalizedText(input.title, "Title", 2, 200);
  const slug = normalizedSlug(input.slug, title);
  const summary = optionalText(input.summary, "Summary", 2_000);
  const bodyText = optionalText(input.bodyText, "Lesson copy", 100_000);
  const presenter = optionalText(input.presenter, "Presenter", 160);
  const durationLabel = optionalText(input.durationLabel, "Duration", 40);
  const externalUrl = normalizedUrl(input.externalUrl, "Resource URL", { allowRelative: true });
  const thumbnailUrl = normalizedUrl(input.thumbnailUrl, "Thumbnail URL", { allowRelative: true });
  const videoUrl = normalizedUrl(input.videoUrl, "Video URL", { allowRelative: true });
  const captionsUrl = normalizedUrl(input.captionsUrl, "Captions URL", { allowRelative: true });
  const contentType = input.contentType.trim();
  if (!CONTENT_TYPES.has(contentType)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Choose a supported Academy format.");
  }
  const effectiveExternalUrl = externalUrl ?? (contentType === "video" ? videoUrl : null);
  if (!bodyText && !effectiveExternalUrl) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "Add lesson copy or a secure media/resource URL before saving.",
    );
  }
  return {
    audiences: input.audiences,
    bodyText,
    captionsUrl,
    collectionId: optionalUuid(input.collectionId, "Collection"),
    contentType,
    durationLabel,
    effectiveExternalUrl,
    externalUrl,
    featured: input.featured,
    position: positivePosition(input.position),
    presenter,
    slug,
    summary,
    thumbnailUrl,
    title,
    videoUrl,
  };
}

function normalizedAudiences(values: AcademyAudienceInput[], requireOne = false) {
  const normalized = values.map((value) => {
    if (value.kind === "all_members") return { id: null, kind: value.kind } as const;
    if (value.kind !== "circle" && value.kind !== "block") {
      throw new OpsOperatingRepositoryError("invalid_request", "Choose a supported Academy audience.");
    }
    return { id: requireUuid(value.id ?? "", value.kind === "circle" ? "Circle" : "Block"), kind: value.kind };
  });
  const keys = normalized.map((value) => `${value.kind}:${value.id ?? "*"}`);
  if (new Set(keys).size !== keys.length) {
    throw new OpsOperatingRepositoryError("invalid_request", "Each Academy audience can be selected once.");
  }
  if (normalized.some((value) => value.kind === "all_members") && normalized.length > 1) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "All members already includes every Circle and Block.",
    );
  }
  if (requireOne && normalized.length === 0) {
    throw new OpsOperatingRepositoryError("conflict", "Choose an audience before publishing.");
  }
  return normalized;
}

async function validateAudienceReferences(
  tx: postgres.TransactionSql,
  audiences: ReturnType<typeof normalizedAudiences>,
) {
  for (const audience of audiences) {
    if (audience.kind === "all_members") continue;
    const rows = audience.kind === "circle"
      ? await tx<Array<{ id: string }>>`
          select id from circles where id = ${audience.id}::uuid and status <> 'archived' limit 1
        `
      : await tx<Array<{ id: string }>>`
          select id from membership_blocks where id = ${audience.id}::uuid and status <> 'archived' limit 1
        `;
    if (!rows[0]) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        `${audience.kind === "circle" ? "Circle" : "Block"} audience is no longer available.`,
      );
    }
  }
}

async function requireCollection(
  tx: postgres.TransactionSql,
  collectionId: string | null,
  requirePublished = false,
) {
  if (!collectionId) return null;
  const rows = await tx<Array<{ id: string; status: string }>>`
    select id, status from learning_collections where id = ${collectionId}::uuid limit 1
  `;
  const collection = rows[0];
  if (!collection || collection.status === "retired") {
    throw new OpsOperatingRepositoryError("conflict", "That Academy collection is no longer available.");
  }
  if (requirePublished && collection.status !== "published") {
    throw new OpsOperatingRepositoryError("conflict", "Publish the collection before publishing this lesson.");
  }
  return collection;
}

function buildMetadata(
  values: ReturnType<typeof validateResourceInput>,
  audiences: ReturnType<typeof normalizedAudiences>,
): VersionMetadata {
  return {
    academyDraft: {
      audiences,
      collectionId: values.collectionId,
      contentType: values.contentType,
      position: values.position,
      slug: values.slug,
      summary: values.summary,
      title: values.title,
    },
    captionsUrl: values.captionsUrl,
    durationLabel: values.durationLabel,
    featured: values.featured,
    presenter: values.presenter,
    thumbnailUrl: values.thumbnailUrl,
    videoUrl: values.videoUrl,
  };
}

function statusValue(value: string): OpsAcademyStatus {
  return RESOURCE_STATES.has(value as OpsAcademyStatus) ? value as OpsAcademyStatus : "draft";
}

function audienceLabels(
  audiences: AcademyAudienceInput[],
  circles: Map<string, string>,
  blocks: Map<string, string>,
): OpsAcademyAudience[] {
  return audiences.map((audience) => ({
    id: audience.id ?? null,
    kind: audience.kind,
    label: audience.kind === "all_members"
      ? "All active members"
      : audience.kind === "circle"
        ? circles.get(audience.id ?? "") ?? "Circle"
        : blocks.get(audience.id ?? "") ?? "Block",
  }));
}

async function referenceMaps(tx: postgres.TransactionSql) {
  const [circleRows, blockRows, collectionRows] = await Promise.all([
    tx<Array<{ id: string; name: string }>>`
      select id, name from circles where status <> 'archived' order by name
    `,
    tx<Array<{ id: string; name: string }>>`
      select id, name from membership_blocks where status <> 'archived' order by name
    `,
    tx<Array<{ id: string; name: string; status: string }>>`
      select id, name, status from learning_collections where status <> 'retired' order by position, name
    `,
  ]);
  return {
    blockMap: new Map(blockRows.map((row) => [row.id, row.name])),
    blocks: blockRows.map((row) => ({ id: row.id, label: row.name })),
    circleMap: new Map(circleRows.map((row) => [row.id, row.name])),
    circles: circleRows.map((row) => ({ id: row.id, label: row.name })),
    collectionMap: new Map(collectionRows.map((row) => [row.id, row.name])),
    collections: collectionRows.map((row) => ({
      id: row.id,
      label: row.name,
      status: statusValue(row.status),
    })),
  };
}

async function resourceRows(tx: postgres.TransactionSql, resourceId?: string) {
  return tx<Array<ResourceRow>>`
    select
      resource.id as resource_id,
      resource.collection_id,
      collection.name as collection_name,
      resource.slug,
      resource.title,
      resource.summary,
      resource.content_type,
      resource.position,
      resource.status,
      resource.current_version_id,
      resource.published_at,
      resource.revision,
      latest_version.id as latest_version_id,
      latest_version.version as latest_version,
      latest_version.body_text,
      latest_version.external_url,
      latest_version.metadata as latest_metadata,
      latest_version.published_at as latest_published_at,
      current_version.version as current_version
    from learning_resources resource
    join lateral (
      select version_record.*
      from learning_resource_versions version_record
      where version_record.learning_resource_id = resource.id
      order by version_record.version desc
      limit 1
    ) latest_version on true
    left join learning_resource_versions current_version
      on current_version.id = resource.current_version_id
    left join learning_collections collection on collection.id = resource.collection_id
    where (${resourceId ?? null}::uuid is null or resource.id = ${resourceId ?? null}::uuid)
    order by resource.updated_at desc, resource.id
  `;
}

function resourceSummary(
  row: ResourceRow,
  maps: Awaited<ReturnType<typeof referenceMaps>>,
): OpsAcademyResourceSummary {
  const metadata = versionMetadata(row.latest_metadata);
  const draft = metadata?.academyDraft;
  const pending = row.latest_version_id !== row.current_version_id;
  const collectionId = pending ? draft?.collectionId ?? row.collection_id : row.collection_id;
  return {
    audiences: audienceLabels(draft?.audiences ?? [], maps.circleMap, maps.blockMap),
    collectionId,
    collectionName: collectionId ? maps.collectionMap.get(collectionId) ?? row.collection_name : null,
    contentType: pending ? draft?.contentType ?? row.content_type : row.content_type,
    currentVersion: row.current_version === null ? null : Number(row.current_version),
    hasUnpublishedChanges: pending,
    latestVersion: Number(row.latest_version),
    position: pending ? draft?.position ?? Number(row.position) : Number(row.position),
    publishedAt: asIso(row.published_at),
    resourceId: row.resource_id,
    revision: Number(row.revision),
    slug: pending ? draft?.slug ?? row.slug : row.slug,
    status: statusValue(row.status),
    summary: pending ? draft?.summary ?? row.summary : row.summary,
    thumbnailUrl: metadata?.thumbnailUrl ?? null,
    title: pending ? draft?.title ?? row.title : row.title,
  };
}

export async function getOpsAcademySnapshot(actorAuthUserId: string): Promise<OpsAcademySnapshot> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireAcademyAdmin(tx, actorAuthUserId);
    const [collections, rows, maps] = await Promise.all([
      tx<Array<{
        id: string;
        name: string;
        position: number | string;
        published_at: Date | string | null;
        resource_count: number | string;
        revision: number | string;
        slug: string;
        status: string;
        summary: string | null;
      }>>`
        select
          collection.id,
          collection.slug,
          collection.name,
          collection.summary,
          collection.position,
          collection.status,
          collection.published_at,
          collection.revision,
          count(resource.id) as resource_count
        from learning_collections collection
        left join learning_resources resource on resource.collection_id = collection.id
        group by collection.id
        order by collection.position, collection.name
      `,
      resourceRows(tx),
      referenceMaps(tx),
    ]);
    const resources = rows.map((row) => resourceSummary(row, maps));
    const counts: OpsAcademySnapshot["counts"] = {
      draft: 0,
      published: 0,
      retired: 0,
      unpublished: 0,
    };
    resources.forEach((resource) => { counts[resource.status] += 1; });
    return {
      canManage: true,
      collections: collections.map((row): OpsAcademyCollection => ({
        collectionId: row.id,
        name: row.name,
        position: Number(row.position),
        publishedAt: asIso(row.published_at),
        resourceCount: Number(row.resource_count),
        revision: Number(row.revision),
        slug: row.slug,
        status: statusValue(row.status),
        summary: row.summary,
      })),
      counts,
      resources,
    };
  });
}

export async function getOpsAcademyReferenceOptions(actorAuthUserId: string) {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireAcademyAdmin(tx, actorAuthUserId);
    const maps = await referenceMaps(tx);
    return {
      blocks: maps.blocks,
      circles: maps.circles,
      collections: maps.collections,
    };
  });
}

export async function getOpsAcademyEditor(
  actorAuthUserId: string,
  resourceIdValue: string,
): Promise<OpsAcademyEditorData | null> {
  const resourceId = requireUuid(resourceIdValue, "Academy resource");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireAcademyAdmin(tx, actorAuthUserId);
    const [rows, maps] = await Promise.all([resourceRows(tx, resourceId), referenceMaps(tx)]);
    const row = rows[0];
    if (!row) return null;
    const summary = resourceSummary(row, maps);
    const metadata = versionMetadata(row.latest_metadata);
    const resource: OpsAcademyResourceDraft = {
      ...summary,
      bodyText: row.body_text,
      captionsUrl: metadata?.captionsUrl ?? null,
      durationLabel: metadata?.durationLabel ?? null,
      externalUrl: row.external_url,
      featured: metadata?.featured ?? false,
      presenter: metadata?.presenter ?? null,
      videoUrl: metadata?.videoUrl ?? null,
    };
    return {
      canManage: true,
      options: {
        blocks: maps.blocks,
        circles: maps.circles,
        collections: maps.collections,
      },
      resource,
    };
  });
}

export async function saveOpsAcademyResource(
  actorAuthUserIdValue: string,
  input: OpsAcademyResourceInput,
) {
  const values = validateResourceInput(input);
  const audiences = normalizedAudiences(values.audiences);
  const metadata = buildMetadata(values, audiences);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireAcademyAdmin(tx, actorAuthUserIdValue, true);
    await validateAudienceReferences(tx, audiences);
    await requireCollection(tx, values.collectionId);

    if (!input.resourceId) {
      const resourceId = randomUUID();
      try {
        await tx`
          insert into learning_resources (
            id, collection_id, slug, title, summary, content_type, position,
            status, created_by_auth_user_id
          ) values (
            ${resourceId}::uuid,
            ${values.collectionId}::uuid,
            ${values.slug},
            ${values.title},
            ${values.summary},
            ${values.contentType},
            ${values.position},
            'draft',
            ${actorAuthUserId}::uuid
          )
        `;
        await tx`
          insert into learning_resource_versions (
            learning_resource_id, version, body_text, external_url, metadata,
            created_by_auth_user_id
          ) values (
            ${resourceId}::uuid,
            1,
            ${values.bodyText},
            ${values.effectiveExternalUrl},
            ${tx.json(metadata as unknown as postgres.JSONValue)},
            ${actorAuthUserId}::uuid
          )
        `;
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "23505") {
          throw new OpsOperatingRepositoryError("conflict", "That Academy URL is already in use.");
        }
        throw error;
      }
      await writeAcademyAudit(tx, {
        action: "academy.resource_draft_created",
        actorAuthUserId,
        after: { audiences, status: "draft", title: values.title, version: 1 },
        subjectId: resourceId,
        subjectType: "learning_resource",
      });
      return { resourceId, revision: 1, version: 1 };
    }

    const resourceId = requireUuid(input.resourceId, "Academy resource");
    const revision = expectedRevision(input.expectedRevision);
    const rows = await tx<Array<{
      published_at: Date | string | null;
      revision: number | string;
      slug: string;
      status: string;
      title: string;
    }>>`
      select slug, title, status, published_at, revision
      from learning_resources
      where id = ${resourceId}::uuid
      for update
    `;
    const resource = rows[0];
    if (!resource) throw new OpsOperatingRepositoryError("not_found", "Academy resource not found.");
    if (resource.status === "retired") {
      throw new OpsOperatingRepositoryError("conflict", "A retired lesson cannot be edited.");
    }
    if (Number(resource.revision) !== revision) {
      throw new OpsOperatingRepositoryError("conflict", "This lesson changed. Refresh and try again.");
    }
    if (resource.published_at && values.slug !== resource.slug) {
      throw new OpsOperatingRepositoryError("conflict", "A published lesson keeps its original URL.");
    }
    const versionRows = await tx<Array<{ next_version: number | string }>>`
      select coalesce(max(version), 0) + 1 as next_version
      from learning_resource_versions
      where learning_resource_id = ${resourceId}::uuid
    `;
    const version = Number(versionRows[0]?.next_version ?? 1);
    await tx`
      insert into learning_resource_versions (
        learning_resource_id, version, body_text, external_url, metadata,
        created_by_auth_user_id
      ) values (
        ${resourceId}::uuid,
        ${version},
        ${values.bodyText},
        ${values.effectiveExternalUrl},
        ${tx.json(metadata as unknown as postgres.JSONValue)},
        ${actorAuthUserId}::uuid
      )
    `;
    await tx`
      update learning_resources
      set
        collection_id = case when published_at is null then ${values.collectionId}::uuid else collection_id end,
        slug = case when published_at is null then ${values.slug} else slug end,
        title = case when published_at is null then ${values.title} else title end,
        summary = case when published_at is null then ${values.summary} else summary end,
        content_type = case when published_at is null then ${values.contentType} else content_type end,
        position = case when published_at is null then ${values.position} else position end,
        revision = revision + 1,
        updated_at = statement_timestamp()
      where id = ${resourceId}::uuid
    `;
    await writeAcademyAudit(tx, {
      action: "academy.resource_draft_saved",
      actorAuthUserId,
      after: { audiences, title: values.title, version },
      before: { title: resource.title, version: version - 1 },
      subjectId: resourceId,
      subjectType: "learning_resource",
    });
    return { resourceId, revision: revision + 1, version };
  });
}

export async function changeOpsAcademyResourceState(
  actorAuthUserIdValue: string,
  input: {
    action: "publish" | "retire" | "unpublish";
    expectedRevision: number;
    resourceId: string;
  },
) {
  const resourceId = requireUuid(input.resourceId, "Academy resource");
  const revision = expectedRevision(input.expectedRevision);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireAcademyAdmin(tx, actorAuthUserIdValue, true);
    const rows = await tx<Array<{
      current_version_id: string | null;
      published_at: Date | string | null;
      revision: number | string;
      status: string;
      title: string;
    }>>`
      select title, status, current_version_id, published_at, revision
      from learning_resources
      where id = ${resourceId}::uuid
      for update
    `;
    const resource = rows[0];
    if (!resource) throw new OpsOperatingRepositoryError("not_found", "Academy resource not found.");
    if (Number(resource.revision) !== revision) {
      throw new OpsOperatingRepositoryError("conflict", "This lesson changed. Refresh and try again.");
    }
    if (resource.status === "retired") {
      throw new OpsOperatingRepositoryError("conflict", "That lesson is already retired.");
    }

    if (input.action === "unpublish") {
      if (resource.status !== "published") {
        throw new OpsOperatingRepositoryError("conflict", "Only a published lesson can be unpublished.");
      }
      await tx`
        update learning_resources
        set status = 'unpublished', revision = revision + 1, updated_at = statement_timestamp()
        where id = ${resourceId}::uuid
      `;
      await writeAcademyAudit(tx, {
        action: "academy.resource_unpublished",
        actorAuthUserId,
        after: { status: "unpublished" },
        before: { status: resource.status },
        subjectId: resourceId,
        subjectType: "learning_resource",
      });
      return { resourceId, revision: revision + 1, status: "unpublished" as const };
    }

    if (input.action === "retire") {
      if (!resource.published_at) {
        throw new OpsOperatingRepositoryError(
          "conflict",
          "Publish this lesson once before retiring it; drafts remain available for correction.",
        );
      }
      await tx`
        update learning_resources
        set
          status = 'retired',
          retired_at = statement_timestamp(),
          retired_by_auth_user_id = ${actorAuthUserId}::uuid,
          revision = revision + 1,
          updated_at = statement_timestamp()
        where id = ${resourceId}::uuid
      `;
      await writeAcademyAudit(tx, {
        action: "academy.resource_retired",
        actorAuthUserId,
        after: { status: "retired" },
        before: { status: resource.status },
        subjectId: resourceId,
        subjectType: "learning_resource",
      });
      return { resourceId, revision: revision + 1, status: "retired" as const };
    }

    const versionRows = await tx<Array<{
      body_text: string | null;
      external_url: string | null;
      id: string;
      metadata: unknown;
      published_at: Date | string | null;
      storage_bucket: string | null;
      storage_path: string | null;
      version: number | string;
    }>>`
      select id, version, body_text, external_url, storage_bucket, storage_path, metadata, published_at
      from learning_resource_versions
      where learning_resource_id = ${resourceId}::uuid
      order by version desc
      limit 1
      for update
    `;
    const latest = versionRows[0];
    if (!latest) throw new OpsOperatingRepositoryError("conflict", "Save a lesson draft before publishing.");
    const metadata = versionMetadata(latest.metadata);
    if (!metadata) {
      throw new OpsOperatingRepositoryError("conflict", "Save this lesson in the Academy editor before publishing.");
    }
    const audiences = normalizedAudiences(metadata.academyDraft.audiences, true);
    await validateAudienceReferences(tx, audiences);
    await requireCollection(tx, metadata.academyDraft.collectionId, true);

    let publishedVersionId = latest.id;
    let publishedVersion = Number(latest.version);
    if (!latest.published_at || latest.id !== resource.current_version_id) {
      publishedVersion = Number(latest.version) + 1;
      const publishedRows = await tx<Array<{ id: string }>>`
        insert into learning_resource_versions (
          learning_resource_id, version, body_text, external_url, storage_bucket,
          storage_path, metadata, created_by_auth_user_id, published_at
        ) values (
          ${resourceId}::uuid,
          ${publishedVersion},
          ${latest.body_text},
          ${latest.external_url},
          ${latest.storage_bucket},
          ${latest.storage_path},
          ${tx.json(metadata as unknown as postgres.JSONValue)},
          ${actorAuthUserId}::uuid,
          statement_timestamp()
        )
        returning id
      `;
      publishedVersionId = publishedRows[0].id;
    }

    const previousTargets = await tx<Array<{
      audience_type: string;
      block_id: string | null;
      circle_id: string | null;
    }>>`
      select audience_type, circle_id, block_id
      from learning_resource_targets
      where learning_resource_id = ${resourceId}::uuid
      order by audience_type, circle_id, block_id
      for update
    `;
    await tx`delete from learning_resource_targets where learning_resource_id = ${resourceId}::uuid`;
    for (const audience of audiences) {
      await tx`
        insert into learning_resource_targets (
          learning_resource_id, audience_type, circle_id, block_id,
          created_by_auth_user_id
        ) values (
          ${resourceId}::uuid,
          ${audience.kind},
          ${audience.kind === "circle" ? audience.id : null}::uuid,
          ${audience.kind === "block" ? audience.id : null}::uuid,
          ${actorAuthUserId}::uuid
        )
      `;
    }
    const draft = metadata.academyDraft;
    await tx`
      update learning_resources
      set
        collection_id = ${draft.collectionId}::uuid,
        slug = ${draft.slug},
        title = ${draft.title},
        summary = ${draft.summary},
        content_type = ${draft.contentType},
        position = ${draft.position},
        status = 'published',
        current_version_id = ${publishedVersionId}::uuid,
        published_at = coalesce(published_at, statement_timestamp()),
        revision = revision + 1,
        updated_at = statement_timestamp()
      where id = ${resourceId}::uuid
    `;
    await writeAcademyAudit(tx, {
      action: "academy.resource_published",
      actorAuthUserId,
      after: { audiences, status: "published", title: draft.title, version: publishedVersion },
      before: {
        audiences: previousTargets.map((target) => ({
          id: target.circle_id ?? target.block_id,
          kind: target.audience_type,
        })),
        status: resource.status,
        title: resource.title,
      },
      subjectId: resourceId,
      subjectType: "learning_resource",
    });
    return { resourceId, revision: revision + 1, status: "published" as const, version: publishedVersion };
  });
}

export async function saveOpsAcademyCollection(
  actorAuthUserIdValue: string,
  input: OpsAcademyCollectionInput,
) {
  const name = normalizedText(input.name, "Collection name", 2, 160);
  const slug = normalizedSlug(input.slug, name);
  const summary = optionalText(input.summary, "Collection summary", 2_000);
  const position = positivePosition(input.position);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireAcademyAdmin(tx, actorAuthUserIdValue, true);
    if (!input.collectionId) {
      const collectionId = randomUUID();
      try {
        await tx`
          insert into learning_collections (
            id, slug, name, summary, position, status, created_by_auth_user_id
          ) values (
            ${collectionId}::uuid, ${slug}, ${name}, ${summary}, ${position}, 'draft',
            ${actorAuthUserId}::uuid
          )
        `;
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "23505") {
          throw new OpsOperatingRepositoryError("conflict", "That collection URL is already in use.");
        }
        throw error;
      }
      await writeAcademyAudit(tx, {
        action: "academy.collection_created",
        actorAuthUserId,
        after: { name, position, status: "draft" },
        subjectId: collectionId,
        subjectType: "learning_collection",
      });
      return { collectionId, revision: 1, status: "draft" as const };
    }

    const collectionId = requireUuid(input.collectionId, "Academy collection");
    const revision = expectedRevision(input.expectedRevision);
    const rows = await tx<Array<{
      name: string;
      published_at: Date | string | null;
      revision: number | string;
      slug: string;
      status: string;
    }>>`
      select slug, name, status, published_at, revision
      from learning_collections where id = ${collectionId}::uuid for update
    `;
    const collection = rows[0];
    if (!collection) throw new OpsOperatingRepositoryError("not_found", "Academy collection not found.");
    if (collection.status === "retired") {
      throw new OpsOperatingRepositoryError("conflict", "A retired collection cannot be edited.");
    }
    if (Number(collection.revision) !== revision) {
      throw new OpsOperatingRepositoryError("conflict", "This collection changed. Refresh and try again.");
    }
    if (collection.published_at && slug !== collection.slug) {
      throw new OpsOperatingRepositoryError("conflict", "A published collection keeps its original URL.");
    }
    await tx`
      update learning_collections
      set
        slug = ${slug}, name = ${name}, summary = ${summary}, position = ${position},
        revision = revision + 1, updated_at = statement_timestamp()
      where id = ${collectionId}::uuid
    `;
    await writeAcademyAudit(tx, {
      action: "academy.collection_updated",
      actorAuthUserId,
      after: { name, position },
      before: { name: collection.name },
      subjectId: collectionId,
      subjectType: "learning_collection",
    });
    return { collectionId, revision: revision + 1, status: statusValue(collection.status) };
  });
}

export async function changeOpsAcademyCollectionState(
  actorAuthUserIdValue: string,
  input: {
    action: "publish" | "retire" | "unpublish";
    collectionId: string;
    expectedRevision: number;
  },
) {
  const collectionId = requireUuid(input.collectionId, "Academy collection");
  const revision = expectedRevision(input.expectedRevision);
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireAcademyAdmin(tx, actorAuthUserIdValue, true);
    const rows = await tx<Array<{
      published_at: Date | string | null;
      revision: number | string;
      status: string;
    }>>`
      select status, published_at, revision
      from learning_collections where id = ${collectionId}::uuid for update
    `;
    const collection = rows[0];
    if (!collection) throw new OpsOperatingRepositoryError("not_found", "Academy collection not found.");
    if (Number(collection.revision) !== revision) {
      throw new OpsOperatingRepositoryError("conflict", "This collection changed. Refresh and try again.");
    }
    if (collection.status === "retired") {
      throw new OpsOperatingRepositoryError("conflict", "That collection is already retired.");
    }

    if (input.action !== "publish") {
      if (!collection.published_at) {
        throw new OpsOperatingRepositoryError("conflict", "Publish this collection before removing it from the Academy.");
      }
      const publishedRows = await tx<Array<{ id: string }>>`
        select id from learning_resources
        where collection_id = ${collectionId}::uuid and status = 'published'
        limit 1
      `;
      if (publishedRows[0]) {
        throw new OpsOperatingRepositoryError(
          "conflict",
          "Move or unpublish the collection's live lessons first.",
        );
      }
    }

    const nextStatus = input.action === "publish"
      ? "published"
      : input.action === "unpublish"
        ? "unpublished"
        : "retired";
    await tx`
      update learning_collections
      set
        status = ${nextStatus},
        published_at = case when ${nextStatus} = 'published' then coalesce(published_at, statement_timestamp()) else published_at end,
        retired_at = case when ${nextStatus} = 'retired' then statement_timestamp() else retired_at end,
        retired_by_auth_user_id = case when ${nextStatus} = 'retired' then ${actorAuthUserId}::uuid else retired_by_auth_user_id end,
        revision = revision + 1,
        updated_at = statement_timestamp()
      where id = ${collectionId}::uuid
    `;
    await writeAcademyAudit(tx, {
      action: `academy.collection_${input.action}`,
      actorAuthUserId,
      after: { status: nextStatus },
      before: { status: collection.status },
      subjectId: collectionId,
      subjectType: "learning_collection",
    });
    return { collectionId, revision: revision + 1, status: nextStatus };
  });
}
