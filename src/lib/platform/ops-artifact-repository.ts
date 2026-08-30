import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import {
  canTransitionArtifactShipment,
  matchesArtifactAwardRequest,
} from "@/lib/platform/artifact-invariants";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHOPIFY_PRODUCT_GID_PATTERN = /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/;
const SHIPMENT_STATES = new Set([
  "label_created",
  "in_transit",
  "delivered",
  "exception",
  "returned",
  "cancelled",
]);

export type OpsArtifactTemplateRecord = {
  bindingVerified: boolean;
  description: string | null;
  livemode: boolean | null;
  name: string;
  productGid: string | null;
  productHandle: string | null;
  status: string;
  templateId: string;
  templateSlug: string;
  version: number | null;
  versionId: string | null;
  versionStatus: string | null;
};

export type OpsArtifactMemberOption = {
  memberId: string;
  name: string;
};

export type OpsArtifactShipmentRecord = {
  artifactJobId: string;
  carrier: string;
  createdAt: string;
  memberName: string;
  serviceLevel: string | null;
  shipmentId: string;
  status: string;
  trackingNumber: string;
  trackingUrl: string | null;
  updatedAt: string;
  version: number;
};

export type OpsArtifactControlData = {
  members: OpsArtifactMemberOption[];
  shipments: OpsArtifactShipmentRecord[];
  templates: OpsArtifactTemplateRecord[];
};

function requireUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function requireText(value: string, label: string, minimum: number, maximum: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      `${label} must be between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function optionalText(value: string | null | undefined, maximum: number): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maximum) {
    throw new OpsOperatingRepositoryError("invalid_request", `That value must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

async function requireArtifactAdmin(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  lock = false,
): Promise<string> {
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
      `;
  if (!rows[0]) {
    throw new OpsOperatingRepositoryError("forbidden", "Artifact administration requires operations access.");
  }
  return actorAuthUserId;
}

async function writeArtifactAudit(
  tx: postgres.TransactionSql,
  input: {
    action: string;
    actorAuthUserId: string;
    after?: postgres.JSONValue;
    before?: postgres.JSONValue;
    memberId?: string | null;
    reason?: string | null;
    subjectId: string;
    subjectType: string;
  },
) {
  await tx`
    insert into operator_audit_events (
      actor_auth_user_id,
      action,
      subject_type,
      subject_id,
      member_id,
      reason,
      before_snapshot,
      after_snapshot,
      metadata,
      dedupe_key
    ) values (
      ${input.actorAuthUserId}::uuid,
      ${input.action},
      ${input.subjectType},
      ${input.subjectId},
      ${input.memberId ?? null}::uuid,
      ${input.reason ?? null},
      ${input.before === undefined ? null : tx.json(input.before)},
      ${input.after === undefined ? null : tx.json(input.after)},
      ${tx.json({})},
      ${randomUUID()}
    )
  `;
}

export async function getOpsArtifactControlData(
  actorAuthUserId: string,
): Promise<OpsArtifactControlData> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireArtifactAdmin(tx, actorAuthUserId);
    const [templateRows, memberRows, shipmentRows] = await Promise.all([
      tx<Array<{
        description: string | null;
        binding_verified: boolean;
        livemode: boolean | null;
        name: string;
        product_gid: string | null;
        product_handle: string | null;
        status: string;
        template_id: string;
        template_slug: string;
        version: number | string | null;
        version_id: string | null;
        version_status: string | null;
      }>>`
        select
          template.id as template_id,
          template.template_slug,
          template.name,
          template.description,
          template.status,
          version_record.id as version_id,
          version_record.version,
          version_record.status as version_status,
          version_record.production_specification #>> '{shopify,product_gid}' as product_gid,
          version_record.production_specification #>> '{shopify,product_handle}' as product_handle,
          version_record.shopify_livemode as livemode,
          (link.id is not null) as binding_verified
        from artifact_templates template
        left join lateral (
          select version.*
          from artifact_template_versions version
          where version.artifact_template_id = template.id
          order by
            case version.status when 'published' then 0 when 'draft' then 1 else 2 end,
            version.version desc
          limit 1
        ) version_record on true
        left join lateral (
          select binding.*
          from integration_entity_links binding
          where binding.provider = 'shopify'
            and binding.local_entity_type = 'artifact_template'
            and binding.local_entity_id = template.id::text
            and binding.external_entity_type = 'product'
            and binding.livemode = version_record.shopify_livemode
            and binding.external_entity_id
              = version_record.production_specification #>> '{shopify,product_gid}'
            and binding.metadata ->> 'artifact_template_version_id' = version_record.id::text
            and binding.metadata ->> 'product_handle'
              = version_record.production_specification #>> '{shopify,product_handle}'
          order by binding.updated_at desc
          limit 1
        ) link on true
        order by template.status, template.name
      `,
      tx<Array<{ member_id: string; member_name: string }>>`
        select
          member.id as member_id,
          coalesce(profile.preferred_name, profile.display_name, private_profile.legal_name, 'Member') as member_name
        from ruined_members member
        join member_lifecycle lifecycle on lifecycle.member_id = member.id
        left join person_profiles profile on profile.person_id = member.person_id
        left join person_private_profiles private_profile on private_profile.person_id = member.person_id
        where lifecycle.account_state = 'active'
          and lifecycle.standing_state in ('active', 'pre_active', 'paused')
        order by member_name, member.id
      `,
      tx<Array<{
        artifact_job_id: string;
        carrier: string;
        created_at: Date | string;
        member_name: string;
        service_level: string | null;
        shipment_id: string;
        status: string;
        tracking_number: string;
        tracking_url: string | null;
        updated_at: Date | string;
        version: number | string;
      }>>`
        select
          shipment.id as shipment_id,
          shipment.artifact_job_id,
          shipment.carrier,
          shipment.service_level,
          shipment.tracking_number,
          shipment.tracking_url,
          shipment.status,
          shipment.created_at,
          shipment.updated_at,
          shipment.version,
          coalesce(profile.preferred_name, profile.display_name, 'Member') as member_name
        from artifact_fulfillment_shipments shipment
        join artifact_jobs job on job.id = shipment.artifact_job_id
        join ruined_members member on member.id = job.member_id
        left join person_profiles profile on profile.person_id = member.person_id
        order by shipment.updated_at desc
        limit 200
      `,
    ]);

    return {
      members: memberRows.map((row) => ({ memberId: row.member_id, name: row.member_name })),
      shipments: shipmentRows.map((row) => ({
        artifactJobId: row.artifact_job_id,
        carrier: row.carrier,
        createdAt: asIso(row.created_at),
        memberName: row.member_name,
        serviceLevel: row.service_level,
        shipmentId: row.shipment_id,
        status: row.status,
        trackingNumber: row.tracking_number,
        trackingUrl: row.tracking_url,
        updatedAt: asIso(row.updated_at),
        version: Number(row.version),
      })),
      templates: templateRows.map((row) => ({
        bindingVerified: row.binding_verified,
        description: row.description,
        livemode: row.livemode,
        name: row.name,
        productGid: row.product_gid,
        productHandle: row.product_handle,
        status: row.status,
        templateId: row.template_id,
        templateSlug: row.template_slug,
        version: row.version === null ? null : Number(row.version),
        versionId: row.version_id,
        versionStatus: row.version_status,
      })),
    };
  });
}

export async function createOpsArtifactTemplate(input: {
  actorAuthUserId: string;
  description?: string | null;
  livemode: boolean;
  name: string;
  productGid: string;
  productHandle: string;
  slug: string;
}) {
  const name = requireText(input.name, "Template name", 2, 200);
  const slug = input.slug.trim().toLowerCase();
  const description = optionalText(input.description, 2000);
  const productGid = input.productGid.trim();
  const productHandle = input.productHandle.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug) || slug.length > 120) {
    throw new OpsOperatingRepositoryError("invalid_request", "Template slug must use lowercase words separated by hyphens.");
  }
  if (!SHOPIFY_PRODUCT_GID_PATTERN.test(productGid)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Shopify Product GID is invalid.");
  }
  if (!SLUG_PATTERN.test(productHandle) || productHandle.length > 255) {
    throw new OpsOperatingRepositoryError("invalid_request", "Shopify handle is invalid.");
  }

  const templateId = randomUUID();
  const versionId = randomUUID();
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireArtifactAdmin(tx, input.actorAuthUserId, true);
    const conflict = await tx<Array<{ id: string }>>`
      select id from artifact_templates where template_slug = ${slug} for update
    `;
    if (conflict[0]) {
      throw new OpsOperatingRepositoryError("conflict", "An Artifact template already uses that slug.");
    }
    const externalConflict = await tx<Array<{ local_entity_id: string }>>`
      select local_entity_id
      from integration_entity_links
      where provider = 'shopify'
        and external_entity_type = 'product'
        and external_entity_id = ${productGid}
        and livemode = ${input.livemode}
      for update
    `;
    if (externalConflict[0]) {
      throw new OpsOperatingRepositoryError("conflict", "That Shopify product is already bound to another record.");
    }

    await tx`
      insert into artifact_templates (id, template_slug, name, description, status)
      values (${templateId}::uuid, ${slug}, ${name}, ${description}, 'active')
    `;
    await tx`
      insert into artifact_template_versions (
        id,
        artifact_template_id,
        version,
        name,
        input_schema,
        production_specification,
        fulfillment_configuration,
        shopify_livemode,
        status,
        published_at
      ) values (
        ${versionId}::uuid,
        ${templateId}::uuid,
        1,
        ${`${name} / v1`},
        ${tx.json({})},
        ${tx.json({ shopify: { product_gid: productGid, product_handle: productHandle } })},
        ${tx.json({ source: "shopify_product" })},
        ${input.livemode},
        'published',
        statement_timestamp()
      )
    `;
    await tx`
      insert into integration_entity_links (
        provider,
        local_entity_type,
        local_entity_id,
        external_entity_type,
        external_entity_id,
        livemode,
        metadata
      ) values (
        'shopify',
        'artifact_template',
        ${templateId},
        'product',
        ${productGid},
        ${input.livemode},
        ${tx.json({ artifact_template_version_id: versionId, product_handle: productHandle })}
      )
    `;
    await writeArtifactAudit(tx, {
      action: "artifact.template_created",
      actorAuthUserId,
      after: { livemode: input.livemode, name, productGid, productHandle, slug, version: 1 },
      subjectId: templateId,
      subjectType: "artifact_template",
    });
    return { templateId, versionId };
  });
}

export async function bindOpsArtifactTemplate(input: {
  actorAuthUserId: string;
  livemode: boolean;
  productGid: string;
  productHandle: string;
  templateId: string;
}) {
  const templateId = requireUuid(input.templateId, "Artifact template");
  const productGid = input.productGid.trim();
  const productHandle = input.productHandle.trim().toLowerCase();
  if (!SHOPIFY_PRODUCT_GID_PATTERN.test(productGid) || !SLUG_PATTERN.test(productHandle)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Shopify product binding is invalid.");
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireArtifactAdmin(tx, input.actorAuthUserId, true);
    const rows = await tx<Array<{
        fulfillment_configuration: postgres.JSONValue;
      input_schema: postgres.JSONValue;
      name: string;
      production_specification: postgres.JSONValue;
      version: number | string;
      version_id: string;
    }>>`
      select
        version.id as version_id,
        version.version,
        version.name,
        version.input_schema,
        version.production_specification,
        version.fulfillment_configuration
      from artifact_templates template
      join artifact_template_versions version on version.artifact_template_id = template.id
      where template.id = ${templateId}::uuid
      order by version.version desc
      limit 1
      for update of template, version
    `;
    const current = rows[0];
    if (!current) throw new OpsOperatingRepositoryError("not_found", "Artifact template not found.");

    const externalConflict = await tx<Array<{ local_entity_id: string }>>`
      select local_entity_id
      from integration_entity_links
      where provider = 'shopify'
        and external_entity_type = 'product'
        and external_entity_id = ${productGid}
        and livemode = ${input.livemode}
        and local_entity_id <> ${templateId}
      for update
    `;
    if (externalConflict[0]) {
      throw new OpsOperatingRepositoryError("conflict", "That Shopify product is already bound to another record.");
    }

    const version = Number(current.version) + 1;
    const versionId = randomUUID();
    const versionName = `${current.name.replace(/\s\/\sv\d+$/, "")} / v${version}`;
    const specification = typeof current.production_specification === "object" && current.production_specification !== null
      ? { ...current.production_specification, shopify: { product_gid: productGid, product_handle: productHandle } }
      : { shopify: { product_gid: productGid, product_handle: productHandle } };
    await tx`
      update artifact_template_versions
      set status = 'retired', retired_at = statement_timestamp(), updated_at = statement_timestamp()
      where artifact_template_id = ${templateId}::uuid and status = 'published'
    `;
    await tx`
      insert into artifact_template_versions (
        id,
        artifact_template_id,
        version,
        name,
        input_schema,
        production_specification,
      fulfillment_configuration,
      shopify_livemode,
      status,
        published_at
      ) values (
        ${versionId}::uuid,
        ${templateId}::uuid,
        ${version},
        ${versionName},
        ${tx.json(current.input_schema)},
        ${tx.json(specification)},
        ${tx.json(current.fulfillment_configuration)},
        ${input.livemode},
        'published',
        statement_timestamp()
      )
    `;
    await tx`
      insert into integration_entity_links (
        provider,
        local_entity_type,
        local_entity_id,
        external_entity_type,
        external_entity_id,
        livemode,
        metadata
      ) values (
        'shopify',
        'artifact_template',
        ${templateId},
        'product',
        ${productGid},
        ${input.livemode},
        ${tx.json({ artifact_template_version_id: versionId, product_handle: productHandle })}
      )
      on conflict (provider, local_entity_type, local_entity_id, external_entity_type, livemode)
      do update set
        external_entity_id = excluded.external_entity_id,
        metadata = excluded.metadata,
        updated_at = statement_timestamp()
    `;
    await writeArtifactAudit(tx, {
      action: "artifact.shopify_binding_updated",
      actorAuthUserId,
      after: { livemode: input.livemode, productGid, productHandle, version },
      before: { version: Number(current.version) },
      subjectId: templateId,
      subjectType: "artifact_template",
    });
    return { templateId, version, versionId };
  });
}

export async function createOpsArtifactAward(input: {
  acquisitionType: string;
  actorAuthUserId: string;
  memberId: string;
  reason: string;
  requestKey: string;
  templateVersionId: string;
}) {
  const memberId = requireUuid(input.memberId, "Member");
  const templateVersionId = requireUuid(input.templateVersionId, "Artifact template version");
  const requestKey = requireUuid(input.requestKey, "Request key");
  const reason = requireText(input.reason, "Award reason", 3, 2000);
  if (!new Set(["earned", "gifted", "purchased"]).has(input.acquisitionType)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Acquisition type is invalid.");
  }
  const awardId = randomUUID();
  const jobId = randomUUID();
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireArtifactAdmin(tx, input.actorAuthUserId, true);
    const memberRows = await tx<Array<{
      address: postgres.JSONValue | null;
      artifact_state: string;
      person_id: string;
    }>>`
      select
        member.person_id,
        private_profile.default_fulfillment_address as address,
        lifecycle.artifact_state
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      left join person_private_profiles private_profile on private_profile.person_id = member.person_id
      where member.id = ${memberId}::uuid
        and lifecycle.account_state = 'active'
      for update of member, lifecycle
    `;
    const member = memberRows[0];
    if (!member) throw new OpsOperatingRepositoryError("not_found", "Active member not found.");
    const versionRows = await tx<Array<{ name: string }>>`
      select template.name
      from artifact_template_versions version
      join artifact_templates template on template.id = version.artifact_template_id
      join integration_entity_links binding
        on binding.provider = 'shopify'
       and binding.local_entity_type = 'artifact_template'
       and binding.local_entity_id = template.id::text
       and binding.external_entity_type = 'product'
       and binding.external_entity_id = version.production_specification #>> '{shopify,product_gid}'
       and binding.livemode = true
       and binding.metadata ->> 'artifact_template_version_id' = version.id::text
       and binding.metadata ->> 'product_handle'
         = version.production_specification #>> '{shopify,product_handle}'
      where version.id = ${templateVersionId}::uuid
        and version.status = 'published'
        and version.shopify_livemode = true
        and template.status = 'active'
      for update of version, template
    `;
    const template = versionRows[0];
    if (!template) throw new OpsOperatingRepositoryError("not_found", "Published Artifact template not found.");

    const insertedAwards = await tx<Array<{ id: string }>>`
      insert into artifact_awards (
        id,
        member_id,
        person_id,
        artifact_template_version_id,
        award_name,
        acquisition_type,
        award_reason,
        status,
        awarded_by_auth_user_id,
        operator_request_key,
        dedupe_key,
        evidence
      ) values (
        ${awardId}::uuid,
        ${memberId}::uuid,
        ${member.person_id}::uuid,
        ${templateVersionId}::uuid,
        ${template.name},
        ${input.acquisitionType},
        ${reason},
        'awarded',
        ${actorAuthUserId}::uuid,
        ${requestKey}::uuid,
        ${`ops-artifact-award:${requestKey}`},
        ${tx.json({ source: "operator" })}
      )
      on conflict (operator_request_key) where operator_request_key is not null
      do nothing
      returning id
    `;
    if (!insertedAwards[0]) {
      const existingRows = await tx<Array<{
        acquisition_type: string;
        artifact_template_version_id: string;
        award_id: string;
        award_reason: string | null;
        job_id: string | null;
        member_id: string;
      }>>`
        select
          award.id as award_id,
          award.member_id,
          award.artifact_template_version_id,
          award.acquisition_type,
          award.award_reason,
          job.id as job_id
        from artifact_awards award
        left join artifact_jobs job on job.artifact_award_id = award.id
        where award.operator_request_key = ${requestKey}::uuid
        for update of award
      `;
      const existing = existingRows[0];
      if (!existing?.job_id) {
        throw new OpsOperatingRepositoryError("conflict", "That award request is still being completed. Try again.");
      }
      if (!matchesArtifactAwardRequest(
        {
          acquisitionType: existing.acquisition_type,
          memberId: existing.member_id,
          reason: existing.award_reason ?? "",
          templateVersionId: existing.artifact_template_version_id,
        },
        { acquisitionType: input.acquisitionType, memberId, reason, templateVersionId },
      )) {
        throw new OpsOperatingRepositoryError("conflict", "That request key was already used for a different Artifact award.");
      }
      return { awardId: existing.award_id, jobId: existing.job_id, replayed: true };
    }
    await tx`
      insert into artifact_award_events (
        artifact_award_id,
        event_type,
        next_status,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${awardId}::uuid,
        'awarded',
        'awarded',
        ${actorAuthUserId}::uuid,
        ${tx.json({ reason })},
        ${`ops-artifact-award-event:${awardId}`}
      )
    `;
    await tx`
      insert into artifact_jobs (
        id,
        member_id,
        artifact_template_version_id,
        artifact_award_id,
        status,
        priority,
        fulfillment_address_snapshot,
        idempotency_key
      ) values (
        ${jobId}::uuid,
        ${memberId}::uuid,
        ${templateVersionId}::uuid,
        ${awardId}::uuid,
        'requested',
        0,
        ${member.address === null ? null : tx.json(member.address)},
        ${`ops-artifact-job:${awardId}`}
      )
    `;
    await tx`
      insert into artifact_job_events (
        artifact_job_id,
        next_status,
        reason_code,
        actor_auth_user_id,
        metadata
      ) values (
        ${jobId}::uuid,
        'requested',
        'operator_award',
        ${actorAuthUserId}::uuid,
        ${tx.json({ awardId, reason })}
      )
    `;
    if (member.artifact_state === "not_started") {
      await tx`
        update member_lifecycle
        set artifact_state = 'collecting', version = version + 1, updated_at = statement_timestamp()
        where member_id = ${memberId}::uuid
      `;
      await tx`
        insert into member_state_history (
          member_id,
          dimension,
          previous_state,
          next_state,
          reason_code,
          source,
          source_event_id,
          actor_auth_user_id,
          metadata,
          dedupe_key
        ) values (
          ${memberId}::uuid,
          'artifact',
          'not_started',
          'collecting',
          'artifact_awarded',
          'ops',
          ${awardId},
          ${actorAuthUserId}::uuid,
          ${tx.json({ templateVersionId })},
          ${`artifact-award-state:${awardId}`}
        )
      `;
    }
    await writeArtifactAudit(tx, {
      action: "artifact.awarded",
      actorAuthUserId,
      after: { acquisitionType: input.acquisitionType, artifactJobId: jobId, templateVersionId },
      memberId,
      reason,
      subjectId: awardId,
      subjectType: "artifact_award",
    });
    return { awardId, jobId, replayed: false };
  });
}

export async function createOpsArtifactShipment(input: {
  actorAuthUserId: string;
  artifactJobId: string;
  carrier: string;
  serviceLevel?: string | null;
  trackingNumber: string;
  trackingUrl?: string | null;
}) {
  const artifactJobId = requireUuid(input.artifactJobId, "Artifact job");
  const carrier = requireText(input.carrier, "Carrier", 1, 120);
  const serviceLevel = optionalText(input.serviceLevel, 120);
  const trackingNumber = requireText(input.trackingNumber, "Tracking number", 3, 240);
  const trackingUrl = optionalText(input.trackingUrl, 2000);
  if (trackingUrl && !/^https:\/\//i.test(trackingUrl)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Tracking URL must use HTTPS.");
  }
  const shipmentId = randomUUID();
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireArtifactAdmin(tx, input.actorAuthUserId, true);
    const jobRows = await tx<Array<{ member_id: string; status: string }>>`
      select member_id, status from artifact_jobs where id = ${artifactJobId}::uuid for update
    `;
    const job = jobRows[0];
    if (!job) throw new OpsOperatingRepositoryError("not_found", "Artifact job not found.");
    if (job.status === "canceled" || job.status === "fulfilled") {
      throw new OpsOperatingRepositoryError("conflict", "A closed Artifact job cannot receive new tracking.");
    }
    await tx`
      insert into artifact_fulfillment_shipments (
        id,
        artifact_job_id,
        carrier,
        service_level,
        tracking_number,
        tracking_url,
        status,
        updated_by_auth_user_id
      ) values (
        ${shipmentId}::uuid,
        ${artifactJobId}::uuid,
        ${carrier},
        ${serviceLevel},
        ${trackingNumber},
        ${trackingUrl},
        'label_created',
        ${actorAuthUserId}::uuid
      )
    `;
    await tx`
      insert into artifact_fulfillment_events (
        shipment_id,
        event_type,
        next_status,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${shipmentId}::uuid,
        'created',
        'label_created',
        ${actorAuthUserId}::uuid,
        ${tx.json({ artifactJobId, carrier, serviceLevel, trackingNumber, trackingUrl })},
        ${`artifact-shipment-created:${shipmentId}`}
      )
    `;
    await writeArtifactAudit(tx, {
      action: "artifact.shipment_created",
      actorAuthUserId,
      after: { artifactJobId, carrier, serviceLevel, trackingNumber, trackingUrl },
      memberId: job.member_id,
      subjectId: shipmentId,
      subjectType: "artifact_shipment",
    });
    return { shipmentId, status: "label_created" };
  });
}

export async function updateOpsArtifactShipment(input: {
  actorAuthUserId: string;
  carrier: string;
  changeReason: string;
  expectedVersion: number;
  serviceLevel?: string | null;
  shipmentId: string;
  status: string;
  trackingNumber: string;
  trackingUrl?: string | null;
}) {
  const shipmentId = requireUuid(input.shipmentId, "Shipment");
  const status = input.status.trim();
  const carrier = requireText(input.carrier, "Carrier", 1, 120);
  const changeReason = requireText(input.changeReason, "Change reason", 3, 500);
  const serviceLevel = optionalText(input.serviceLevel, 120);
  const trackingNumber = requireText(input.trackingNumber, "Tracking number", 3, 240);
  const trackingUrl = optionalText(input.trackingUrl, 2000);
  if (!SHIPMENT_STATES.has(status)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Shipment status is invalid.");
  }
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new OpsOperatingRepositoryError("invalid_request", "Shipment version is invalid.");
  }
  if (trackingUrl && !/^https:\/\//i.test(trackingUrl)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Tracking URL must use HTTPS.");
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireArtifactAdmin(tx, input.actorAuthUserId, true);
    const rows = await tx<Array<{
      artifact_award_id: string | null;
      artifact_job_id: string;
      artifact_state: string;
      carrier: string;
      job_status: string;
      member_id: string;
      service_level: string | null;
      status: string;
      tracking_number: string;
      tracking_url: string | null;
      version: number | string;
    }>>`
      select
        shipment.artifact_job_id,
        shipment.carrier,
        shipment.service_level,
        shipment.tracking_number,
        shipment.tracking_url,
        shipment.status,
        shipment.version,
        job.member_id,
        job.status as job_status,
        job.artifact_award_id,
        lifecycle.artifact_state
      from artifact_fulfillment_shipments shipment
      join artifact_jobs job on job.id = shipment.artifact_job_id
      join member_lifecycle lifecycle on lifecycle.member_id = job.member_id
      where shipment.id = ${shipmentId}::uuid
      for update of shipment, job, lifecycle
    `;
    const shipment = rows[0];
    if (!shipment) throw new OpsOperatingRepositoryError("not_found", "Shipment not found.");
    if (Number(shipment.version) !== input.expectedVersion) {
      throw new OpsOperatingRepositoryError("conflict", "The shipment changed. Refresh before saving again.");
    }

    const statusChanged = shipment.status !== status;
    const trackingChanged = shipment.carrier !== carrier
      || shipment.service_level !== serviceLevel
      || shipment.tracking_number !== trackingNumber
      || shipment.tracking_url !== trackingUrl;
    if (!statusChanged && !trackingChanged) {
      return { shipmentId, status, version: Number(shipment.version) };
    }
    if (statusChanged && !canTransitionArtifactShipment(shipment.status, status)) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        `Shipment cannot move from ${shipment.status.replaceAll("_", " ")} to ${status.replaceAll("_", " ")}.`,
      );
    }

    const trackingConflicts = await tx<Array<{ id: string }>>`
      select id
      from artifact_fulfillment_shipments
      where lower(carrier) = lower(${carrier})
        and tracking_number = ${trackingNumber}
        and id <> ${shipmentId}::uuid
      limit 1
    `;
    if (trackingConflicts[0]) {
      throw new OpsOperatingRepositoryError("conflict", "That carrier and tracking number already belong to another shipment.");
    }

    if (statusChanged) {
      const updateRows = await tx<Array<{ version: number | string }>>`
        update artifact_fulfillment_shipments
        set
          carrier = ${carrier},
          service_level = ${serviceLevel},
          tracking_number = ${trackingNumber},
          tracking_url = ${trackingUrl},
          status = ${status},
          shipped_at = case
            when ${status} in ('in_transit', 'delivered') then coalesce(shipped_at, statement_timestamp())
            else shipped_at
          end,
          delivered_at = case when ${status} = 'delivered' then statement_timestamp() else delivered_at end,
          updated_by_auth_user_id = ${actorAuthUserId}::uuid,
          version = version + 1,
          updated_at = statement_timestamp()
        where id = ${shipmentId}::uuid
          and version = ${input.expectedVersion}
        returning version
      `;
      if (!updateRows[0]) {
        throw new OpsOperatingRepositoryError("conflict", "The shipment changed. Refresh before saving again.");
      }
    } else {
      const updateRows = await tx<Array<{ version: number | string }>>`
        update artifact_fulfillment_shipments
        set
          carrier = ${carrier},
          service_level = ${serviceLevel},
          tracking_number = ${trackingNumber},
          tracking_url = ${trackingUrl},
          updated_by_auth_user_id = ${actorAuthUserId}::uuid,
          version = version + 1,
          updated_at = statement_timestamp()
        where id = ${shipmentId}::uuid
          and version = ${input.expectedVersion}
        returning version
      `;
      if (!updateRows[0]) {
        throw new OpsOperatingRepositoryError("conflict", "The shipment changed. Refresh before saving again.");
      }
    }

    if (trackingChanged) {
      await tx`
        insert into artifact_fulfillment_events (
          shipment_id,
          event_type,
          previous_status,
          next_status,
          actor_auth_user_id,
          evidence,
          dedupe_key
        ) values (
          ${shipmentId}::uuid,
          'tracking_updated',
          ${shipment.status},
          ${status},
          ${actorAuthUserId}::uuid,
          ${tx.json({
            after: { carrier, serviceLevel, trackingNumber, trackingUrl },
            before: {
              carrier: shipment.carrier,
              serviceLevel: shipment.service_level,
              trackingNumber: shipment.tracking_number,
              trackingUrl: shipment.tracking_url,
            },
            reason: changeReason,
          })},
          ${`artifact-shipment-tracking:${shipmentId}:${input.expectedVersion + 1}`}
        )
      `;
    }
    if (statusChanged) {
      await tx`
        insert into artifact_fulfillment_events (
          shipment_id,
          event_type,
          previous_status,
          next_status,
          actor_auth_user_id,
          evidence,
          dedupe_key
        ) values (
          ${shipmentId}::uuid,
          'status_changed',
          ${shipment.status},
          ${status},
          ${actorAuthUserId}::uuid,
          ${tx.json({ reason: changeReason })},
          ${`artifact-shipment-status:${shipmentId}:${input.expectedVersion + 1}`}
        )
      `;
    }

    if (statusChanged && status === "delivered") {
      let awardStatus: string | null = null;
      if (shipment.artifact_award_id) {
        const awardRows = await tx<Array<{ status: string }>>`
          select status
          from artifact_awards
          where id = ${shipment.artifact_award_id}::uuid
          for update
        `;
        awardStatus = awardRows[0]?.status ?? null;
        if (awardStatus === "revoked") {
          throw new OpsOperatingRepositoryError("conflict", "A revoked Artifact award cannot be delivered.");
        }
      }

      if (shipment.job_status !== "fulfilled") {
        await tx`
          update artifact_jobs
          set
            status = 'fulfilled',
            completed_at = coalesce(completed_at, statement_timestamp()),
            updated_at = statement_timestamp()
          where id = ${shipment.artifact_job_id}::uuid
        `;
        await tx`
          insert into artifact_job_events (
            artifact_job_id,
            previous_status,
            next_status,
            reason_code,
            actor_auth_user_id,
            metadata
          ) values (
            ${shipment.artifact_job_id}::uuid,
            ${shipment.job_status},
            'fulfilled',
            'shipment_delivered',
            ${actorAuthUserId}::uuid,
            ${tx.json({ reason: changeReason, shipmentId })}
          )
        `;
      }

      if (shipment.artifact_award_id && awardStatus !== "fulfilled") {
        await tx`
          update artifact_awards
          set status = 'fulfilled', version = version + 1, updated_at = statement_timestamp()
          where id = ${shipment.artifact_award_id}::uuid
        `;
        await tx`
          insert into artifact_award_events (
            artifact_award_id,
            event_type,
            previous_status,
            next_status,
            actor_auth_user_id,
            evidence,
            dedupe_key
          ) values (
            ${shipment.artifact_award_id}::uuid,
            'fulfilled',
            ${awardStatus},
            'fulfilled',
            ${actorAuthUserId}::uuid,
            ${tx.json({ reason: changeReason, shipmentId })},
            ${`artifact-award-fulfilled:${shipment.artifact_award_id}`}
          )
          on conflict (dedupe_key) do nothing
        `;
      }

      const projectedRows = await tx<Array<{ artifact_state: string }>>`
        select case
          when exists (
            select 1 from artifact_jobs other_job
            where other_job.member_id = ${shipment.member_id}::uuid
              and other_job.status in ('in_production', 'review', 'ready')
          ) then 'in_production'
          when exists (
            select 1 from artifact_jobs other_job
            where other_job.member_id = ${shipment.member_id}::uuid
              and other_job.status in ('requested', 'collecting', 'ready_for_production')
          ) then 'collecting'
          when exists (
            select 1 from artifact_jobs other_job
            where other_job.member_id = ${shipment.member_id}::uuid
              and other_job.status = 'fulfilled'
          ) then 'fulfilled'
          else 'not_started'
        end as artifact_state
      `;
      const projectedState = projectedRows[0]?.artifact_state ?? "fulfilled";
      if (shipment.artifact_state !== projectedState) {
        await tx`
          update member_lifecycle
          set artifact_state = ${projectedState}, version = version + 1, updated_at = statement_timestamp()
          where member_id = ${shipment.member_id}::uuid
        `;
        await tx`
          insert into member_state_history (
            member_id,
            dimension,
            previous_state,
            next_state,
            reason_code,
            source,
            source_event_id,
            actor_auth_user_id,
            metadata,
            dedupe_key
          ) values (
            ${shipment.member_id}::uuid,
            'artifact',
            ${shipment.artifact_state},
            ${projectedState},
            'shipment_delivered',
            'ops',
            ${shipmentId},
            ${actorAuthUserId}::uuid,
            ${tx.json({ artifactJobId: shipment.artifact_job_id, reason: changeReason })},
            ${`artifact-shipment-delivered-state:${shipmentId}`}
          )
          on conflict (dedupe_key) do nothing
        `;
      }
    }

    await writeArtifactAudit(tx, {
      action: statusChanged ? "artifact.shipment_status_changed" : "artifact.shipment_tracking_corrected",
      actorAuthUserId,
      after: { carrier, serviceLevel, status, trackingNumber, trackingUrl },
      before: {
        carrier: shipment.carrier,
        serviceLevel: shipment.service_level,
        status: shipment.status,
        trackingNumber: shipment.tracking_number,
        trackingUrl: shipment.tracking_url,
      },
      memberId: shipment.member_id,
      reason: changeReason,
      subjectId: shipmentId,
      subjectType: "artifact_shipment",
    });
    return { shipmentId, status, version: input.expectedVersion + 1 };
  });
}
