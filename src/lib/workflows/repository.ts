import "server-only";

import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import {
  AGREEMENT_RECEIPT_GENERATOR_VERSION,
  agreementReceiptSha256,
  renderAgreementReceipt,
} from "@/lib/membership/agreement-receipt";
import { getApplicationDatabase } from "@/lib/database/server";

const STALE_LOCK_MINUTES = 10;

export type WorkflowActionType =
  | "create_artifact_job"
  | "create_operator_task"
  | "generate_agreement_receipt"
  | "project_milestone"
  | "send_notification";

export type WorkflowAction = Readonly<{
  actionType: WorkflowActionType;
  attempts: number;
  domainEventId: string;
  eventType: string;
  id: string;
  idempotencyKey: string;
  maxAttempts: number;
  memberId: string | null;
  payload: Record<string, unknown>;
  personId: string | null;
  targetId: string | null;
  targetType: string | null;
}>;

function payloadString(action: WorkflowAction, key: string): string | null {
  const value = action.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredPayloadString(action: WorkflowAction, key: string): string {
  const value = payloadString(action, key);
  if (!value) throw new Error(`Workflow payload is missing ${key}.`);
  return value;
}

function safeActionError(action: WorkflowAction, error: unknown): {
  code: string;
  message: string;
} {
  const errorName = error instanceof Error && error.name ? error.name : "Error";
  return {
    code: `${action.actionType}.${errorName}`.slice(0, 100),
    message: `${action.actionType} failed (${errorName})`.slice(0, 500),
  };
}

async function recoverStaleWorkflowActions(tx: postgres.TransactionSql): Promise<void> {
  const stale = await tx<Array<{
    attempts: number;
    id: string;
    maxAttempts: number;
    workerId: string | null;
  }>>`
    select
      id,
      attempts,
      max_attempts as "maxAttempts",
      locked_by as "workerId"
    from workflow_actions
    where status = 'processing'
      and locked_at < statement_timestamp() - (${STALE_LOCK_MINUTES} * interval '1 minute')
    order by locked_at, id
    limit 50
    for update skip locked
  `;

  for (const action of stale) {
    const terminal = action.attempts >= action.maxAttempts;
    await tx`
      update workflow_actions
      set
        status = ${terminal ? "dead_letter" : "failed"},
        available_at = case
          when ${terminal} then available_at
          else statement_timestamp()
        end,
        locked_at = null,
        locked_by = null,
        last_error = 'Worker lease expired before completion.',
        completed_at = case when ${terminal} then statement_timestamp() else null end,
        updated_at = statement_timestamp()
      where id = ${action.id}::uuid
        and status = 'processing'
    `;
    await tx`
      insert into workflow_action_attempts (
        workflow_action_id,
        attempt_number,
        outcome,
        worker_id,
        error_code,
        error_message,
        evidence
      ) values (
        ${action.id}::uuid,
        ${action.attempts},
        ${terminal ? "dead_lettered" : "failed"},
        ${action.workerId},
        'worker_lease_expired',
        'Worker lease expired before completion.',
        ${tx.json({ recovered: true })}
      )
      on conflict (workflow_action_id, attempt_number, outcome) do nothing
    `;
  }
}

export function createWorkflowWorkerId(): string {
  return `membership-${randomUUID()}`;
}

export async function claimNextWorkflowAction(
  workerId: string,
): Promise<WorkflowAction | null> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await recoverStaleWorkflowActions(tx);
    const rows = await tx<Array<WorkflowAction>>`
      with candidate as (
        select id
        from workflow_actions
        where status in ('pending', 'failed')
          and attempts < max_attempts
          and available_at <= statement_timestamp()
        order by available_at, created_at, id
        limit 1
        for update skip locked
      ), claimed as (
        update workflow_actions action
        set
          status = 'processing',
          attempts = action.attempts + 1,
          locked_at = statement_timestamp(),
          locked_by = ${workerId},
          last_error = null,
          completed_at = null,
          updated_at = statement_timestamp()
        from candidate
        where action.id = candidate.id
        returning action.*
      )
      select
        claimed.id,
        claimed.domain_event_id as "domainEventId",
        claimed.action_type as "actionType",
        claimed.target_type as "targetType",
        claimed.target_id as "targetId",
        claimed.payload,
        claimed.idempotency_key as "idempotencyKey",
        claimed.attempts,
        claimed.max_attempts as "maxAttempts",
        event.event_type as "eventType",
        event.person_id as "personId",
        event.member_id as "memberId"
      from claimed
      join domain_events event on event.id = claimed.domain_event_id
    `;
    const action = rows[0];
    if (!action) return null;

    await tx`
      insert into workflow_action_attempts (
        workflow_action_id,
        attempt_number,
        outcome,
        worker_id,
        evidence
      ) values (
        ${action.id}::uuid,
        ${action.attempts},
        'started',
        ${workerId},
        ${tx.json({ eventType: action.eventType })}
      )
      on conflict (workflow_action_id, attempt_number, outcome) do nothing
    `;
    return action;
  });
}

export async function markWorkflowActionSucceeded(
  action: WorkflowAction,
  workerId: string,
  evidence: Record<string, unknown> = {},
): Promise<boolean> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      update workflow_actions
      set
        status = 'succeeded',
        completed_at = statement_timestamp(),
        locked_at = null,
        locked_by = null,
        last_error = null,
        updated_at = statement_timestamp()
      where id = ${action.id}::uuid
        and status = 'processing'
        and locked_by = ${workerId}
        and attempts = ${action.attempts}
      returning id
    `;
    if (!rows[0]) return false;
    await tx`
      insert into workflow_action_attempts (
        workflow_action_id,
        attempt_number,
        outcome,
        worker_id,
        evidence
      ) values (
        ${action.id}::uuid,
        ${action.attempts},
        'succeeded',
        ${workerId},
        ${JSON.stringify(evidence)}::jsonb
      )
      on conflict (workflow_action_id, attempt_number, outcome) do nothing
    `;
    return true;
  });
}

export async function markWorkflowActionFailed(
  action: WorkflowAction,
  workerId: string,
  error: unknown,
): Promise<boolean> {
  const sql = getApplicationDatabase();
  const terminal = action.attempts >= action.maxAttempts;
  const backoffSeconds = Math.min(3_600, 30 * (2 ** Math.max(0, action.attempts - 1)));
  const safeError = safeActionError(action, error);
  return sql.begin(async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      update workflow_actions
      set
        status = ${terminal ? "dead_letter" : "failed"},
        available_at = case
          when ${terminal} then available_at
          else statement_timestamp() + (${backoffSeconds} * interval '1 second')
        end,
        locked_at = null,
        locked_by = null,
        last_error = ${safeError.message},
        completed_at = case when ${terminal} then statement_timestamp() else null end,
        updated_at = statement_timestamp()
      where id = ${action.id}::uuid
        and status = 'processing'
        and locked_by = ${workerId}
        and attempts = ${action.attempts}
      returning id
    `;
    if (!rows[0]) return false;
    await tx`
      insert into workflow_action_attempts (
        workflow_action_id,
        attempt_number,
        outcome,
        worker_id,
        error_code,
        error_message,
        evidence
      ) values (
        ${action.id}::uuid,
        ${action.attempts},
        ${terminal ? "dead_lettered" : "failed"},
        ${workerId},
        ${safeError.code},
        ${safeError.message},
        ${tx.json({ retryAfterSeconds: terminal ? null : backoffSeconds })}
      )
      on conflict (workflow_action_id, attempt_number, outcome) do nothing
    `;
    return true;
  });
}

async function createArtifactJob(action: WorkflowAction): Promise<Record<string, unknown>> {
  const awardId = action.targetType === "artifact_award"
    ? action.targetId
    : payloadString(action, "artifact_award_id");
  if (!awardId) throw new Error("Artifact award target is required.");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const awards = await tx<Array<{
      address: Record<string, unknown> | null;
      input: Record<string, unknown>;
      memberId: string;
      templateVersionId: string | null;
    }>>`
      select
        award.member_id as "memberId",
        award.artifact_template_version_id as "templateVersionId",
        award.member_input_snapshot as input,
        private_profile.default_fulfillment_address as address
      from artifact_awards award
      join ruined_members member_record on member_record.id = award.member_id
      left join person_private_profiles private_profile
        on private_profile.person_id = member_record.person_id
      where award.id = ${awardId}::uuid
        and award.status <> 'revoked'
      limit 1
      for update of award
    `;
    const award = awards[0];
    if (!award?.templateVersionId) throw new Error("Artifact award is not production-ready.");
    const jobId = randomUUID();
    const inserted = await tx<Array<{ id: string }>>`
      insert into artifact_jobs (
        id,
        member_id,
        artifact_template_version_id,
        artifact_award_id,
        status,
        input_snapshot,
        fulfillment_address_snapshot,
        idempotency_key
      ) values (
        ${jobId}::uuid,
        ${award.memberId}::uuid,
        ${award.templateVersionId}::uuid,
        ${awardId}::uuid,
        'requested',
        ${JSON.stringify(award.input)}::jsonb,
        ${award.address ? JSON.stringify(award.address) : null}::jsonb,
        ${action.idempotencyKey}
      )
      on conflict (idempotency_key) do nothing
      returning id
    `;
    const resolvedJobId = inserted[0]?.id ?? (await tx<Array<{ id: string }>>`
      select id from artifact_jobs where idempotency_key = ${action.idempotencyKey} limit 1
    `)[0]?.id;
    if (!resolvedJobId) throw new Error("Artifact job could not be created.");
    if (inserted[0]) {
      await tx`
        insert into artifact_job_events (
          artifact_job_id,
          previous_status,
          next_status,
          reason_code,
          metadata
        ) values (
          ${resolvedJobId}::uuid,
          null,
          'requested',
          'artifact_awarded',
          ${tx.json({ workflowActionId: action.id })}
        )
      `;
    }
    return { artifactJobId: resolvedJobId, created: Boolean(inserted[0]) };
  });
}

async function generateAgreementReceipt(action: WorkflowAction): Promise<Record<string, unknown>> {
  const acceptanceId = action.targetType === "membership_agreement_acceptance"
    ? action.targetId
    : payloadString(action, "acceptance_id");
  if (!acceptanceId) throw new Error("Agreement acceptance target is required.");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const rows = await tx<Array<{
      acceptanceId: string;
      acceptedAt: Date | string;
      affirmativeAction: string;
      agreementBody: string;
      agreementContentSha256: string;
      agreementKey: string;
      agreementTitle: string;
      agreementVersion: number;
      signerEmail: string;
      signerName: string;
    }>>`
      select
        acceptance.id as "acceptanceId",
        acceptance.accepted_at as "acceptedAt",
        acceptance.affirmative_action as "affirmativeAction",
        acceptance.agreement_body_snapshot as "agreementBody",
        acceptance.agreement_content_sha256 as "agreementContentSha256",
        acceptance.agreement_key_snapshot as "agreementKey",
        acceptance.agreement_title_snapshot as "agreementTitle",
        acceptance.agreement_version_snapshot as "agreementVersion",
        acceptance.signer_email_snapshot as "signerEmail",
        acceptance.signer_name_snapshot as "signerName"
      from membership_agreement_acceptances acceptance
      where acceptance.id = ${acceptanceId}::uuid
      limit 1
      for share
    `;
    const source = rows[0];
    if (!source) throw new Error("Agreement acceptance does not exist.");
    const receipt = renderAgreementReceipt({
      ...source,
      acceptedAt: new Date(source.acceptedAt).toISOString(),
    });
    const receiptHash = agreementReceiptSha256(receipt);
    const inserted = await tx<Array<{ id: string }>>`
      insert into membership_agreement_receipts (
        acceptance_id,
        delivery_method,
        storage_bucket,
        storage_path,
        mime_type,
        byte_size,
        content_sha256,
        generator_version,
        generated_at
      ) values (
        ${acceptanceId}::uuid,
        'database_snapshot',
        null,
        null,
        'text/plain; charset=utf-8',
        ${Buffer.byteLength(receipt, "utf8")},
        ${receiptHash},
        ${AGREEMENT_RECEIPT_GENERATOR_VERSION},
        statement_timestamp()
      )
      on conflict (acceptance_id) do nothing
      returning id
    `;
    const receiptId = inserted[0]?.id ?? (await tx<Array<{ id: string }>>`
      select id from membership_agreement_receipts where acceptance_id = ${acceptanceId}::uuid limit 1
    `)[0]?.id;
    if (!receiptId) throw new Error("Agreement receipt could not be recorded.");
    return { receiptId, created: Boolean(inserted[0]) };
  });
}

async function sendAnnouncementNotifications(
  action: WorkflowAction,
): Promise<Record<string, unknown>> {
  const announcementId = action.targetId ?? payloadString(action, "announcementId");
  if (!announcementId) throw new Error("Announcement target is required.");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const rows = await tx<Array<{
      announcementCount: number | string;
      createdCount: number | string;
      eligibleCount: number | string;
      eventCount: number | string;
    }>>`
      with announcement_source as (
        select
          announcement.id as announcement_id,
          announcement.title,
          announcement.body_text,
          announcement.image_storage_path,
          announcement.action_label,
          announcement.action_url
        from member_announcements announcement
        where announcement.id = ${announcementId}::uuid
          and announcement.status = 'published'
          and announcement.published_at <= statement_timestamp()
        limit 1
        for share
      ), eligible_members as (
        select distinct
          member_record.id as member_id,
          member_record.person_id
        from ruined_members member_record
        join member_lifecycle lifecycle
          on lifecycle.member_id = member_record.id
        join platform_users platform_user
          on platform_user.person_id = member_record.person_id
          and platform_user.status = 'active'
        where lifecycle.account_state = 'active'
          and lifecycle.billing_state = 'active'
          and lifecycle.administrative_onboarding_state = 'completed'
          and lifecycle.standing_state in ('active', 'cancellation_requested')
          and (
            lifecycle.standing_state = 'active'
            or lifecycle.cancellation_effective_at > statement_timestamp()
          )
          and exists (
            select 1
            from platform_role_grants role_grant
            where role_grant.auth_user_id = platform_user.auth_user_id
              and role_grant.role_slug = 'member'
              and role_grant.revoked_at is null
          )
          and exists (
            select 1
            from member_announcement_targets target
            where target.announcement_id = ${announcementId}::uuid
              and (
                target.target_type = 'all_active_members'
                or (
                  target.target_type = 'member'
                  and target.member_id = member_record.id
                )
                or (
                  target.target_type = 'circle'
                  and exists (
                    select 1
                    from circle_member_assignments circle_assignment
                    where circle_assignment.circle_id = target.circle_id
                      and circle_assignment.member_id = member_record.id
                      and circle_assignment.ended_at is null
                  )
                )
                or (
                  target.target_type = 'block'
                  and exists (
                    select 1
                    from circle_member_assignments circle_assignment
                    join block_circle_assignments block_assignment
                      on block_assignment.circle_id = circle_assignment.circle_id
                      and block_assignment.ended_at is null
                    where block_assignment.block_id = target.block_id
                      and circle_assignment.member_id = member_record.id
                      and circle_assignment.ended_at is null
                  )
                )
                or (
                  target.target_type = 'progression'
                  and target.progression_level_slug = lifecycle.current_progression_level_slug
                )
              )
          )
      ), inserted_notifications as (
        insert into member_notifications (
          person_id,
          member_id,
          announcement_id,
          notification_type,
          channel,
          title_snapshot,
          body_snapshot,
          image_storage_path_snapshot,
          action_label_snapshot,
          action_url_snapshot,
          status,
          sent_at,
          delivered_at,
          dedupe_key
        )
        select
          eligible.person_id,
          eligible.member_id,
          announcement.announcement_id,
          'announcement',
          'in_app',
          announcement.title,
          announcement.body_text,
          announcement.image_storage_path,
          announcement.action_label,
          announcement.action_url,
          'delivered',
          statement_timestamp(),
          statement_timestamp(),
          ${action.idempotencyKey} || ':' || eligible.member_id::text
        from eligible_members eligible
        cross join announcement_source announcement
        on conflict (dedupe_key) do nothing
        returning id
      ), inserted_events as (
        insert into member_notification_events (
          notification_id,
          event_type,
          evidence,
          dedupe_key
        )
        select
          notification.id,
          'delivered',
          jsonb_build_object(
            'channel', 'in_app',
            'workflowActionId', ${action.id},
            'announcementId', ${announcementId}
          ),
          ${action.idempotencyKey} || ':' || notification.id::text || ':delivered'
        from inserted_notifications notification
        on conflict (dedupe_key) do nothing
        returning id
      )
      select
        (select count(*) from announcement_source) as "announcementCount",
        (select count(*) from eligible_members) as "eligibleCount",
        (select count(*) from inserted_notifications) as "createdCount",
        (select count(*) from inserted_events) as "eventCount"
    `;
    const result = rows[0];
    if (!result || Number(result.announcementCount) !== 1) {
      throw new Error("Published announcement does not exist.");
    }
    return {
      announcementId,
      createdCount: Number(result.createdCount),
      eligibleCount: Number(result.eligibleCount),
      eventCount: Number(result.eventCount),
    };
  });
}

async function sendNotification(action: WorkflowAction): Promise<Record<string, unknown>> {
  if (action.targetType === "member_announcement") {
    return sendAnnouncementNotifications(action);
  }
  if (!action.memberId || !action.personId) throw new Error("Member notification identity is missing.");
  const title = requiredPayloadString(action, "title");
  const body = requiredPayloadString(action, "body");
  const notificationType = payloadString(action, "notification_type") ?? "system";
  const actionLabel = payloadString(action, "action_label");
  const actionUrl = payloadString(action, "action_url");
  if (Boolean(actionLabel) !== Boolean(actionUrl)) {
    throw new Error("Notification action label and URL must be supplied together.");
  }
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      insert into member_notifications (
        person_id,
        member_id,
        notification_type,
        channel,
        title_snapshot,
        body_snapshot,
        action_label_snapshot,
        action_url_snapshot,
        status,
        sent_at,
        delivered_at,
        dedupe_key
      ) values (
        ${action.personId}::uuid,
        ${action.memberId}::uuid,
        ${notificationType},
        'in_app',
        ${title},
        ${body},
        ${actionLabel},
        ${actionUrl},
        'delivered',
        statement_timestamp(),
        statement_timestamp(),
        ${action.idempotencyKey}
      )
      on conflict (dedupe_key) do update
      set dedupe_key = excluded.dedupe_key
      returning id
    `;
    if (!rows[0]) throw new Error("Member notification could not be recorded.");
    await tx`
      insert into member_notification_events (
        notification_id,
        event_type,
        evidence,
        dedupe_key
      ) values (
        ${rows[0].id}::uuid,
        'delivered',
        ${JSON.stringify({ channel: "in_app", workflowActionId: action.id })}::jsonb,
        ${`${action.idempotencyKey}:delivered`}
      )
      on conflict (dedupe_key) do nothing
    `;
    return { notificationId: rows[0].id };
  });
}

async function projectMilestone(action: WorkflowAction): Promise<Record<string, unknown>> {
  if (!action.memberId || !action.personId) throw new Error("Milestone identity is missing.");
  const milestoneType = requiredPayloadString(action, "milestone_type");
  const title = requiredPayloadString(action, "title");
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const inserted = await tx<Array<{ id: string }>>`
      insert into member_milestones (
        member_id,
        person_id,
        milestone_type,
        title,
        occurred_at,
        source_entity_type,
        source_entity_id,
        evidence,
        dedupe_key
      ) values (
        ${action.memberId}::uuid,
        ${action.personId}::uuid,
        ${milestoneType},
        ${title},
        statement_timestamp(),
        ${payloadString(action, "source_entity_type") ?? action.targetType},
        ${payloadString(action, "source_entity_id") ?? action.targetId},
        ${tx.json({ domainEventId: action.domainEventId })},
        ${action.idempotencyKey}
      )
      on conflict (dedupe_key) do nothing
      returning id
    `;
    const milestoneId = inserted[0]?.id ?? (await tx<Array<{ id: string }>>`
      select id
      from member_milestones
      where dedupe_key = ${action.idempotencyKey}
      limit 1
    `)[0]?.id;
    if (!milestoneId) throw new Error("Member milestone could not be recorded.");
    return { milestoneId, created: Boolean(inserted[0]) };
  });
}

async function createOperatorTask(action: WorkflowAction): Promise<Record<string, unknown>> {
  const sql = getApplicationDatabase();
  const taskId = randomUUID();
  return sql.begin(async (tx) => {
    const rows = await tx<Array<{ id: string }>>`
      insert into operator_tasks (
        id,
        member_id,
        person_id,
        task_type,
        title,
        description,
        priority,
        created_by_type,
        created_by_auth_user_id,
        idempotency_key
      ) values (
        ${taskId}::uuid,
        ${action.memberId}::uuid,
        ${action.personId}::uuid,
        ${requiredPayloadString(action, "task_type")},
        ${requiredPayloadString(action, "title")},
        ${payloadString(action, "description")},
        ${payloadString(action, "priority") ?? "normal"},
        'system',
        null,
        ${action.idempotencyKey}
      )
      on conflict (idempotency_key) where idempotency_key is not null do update
      set idempotency_key = excluded.idempotency_key
      returning id
    `;
    if (!rows[0]) throw new Error("Operator task could not be created.");
    await tx`
      insert into operator_task_events (
        operator_task_id,
        event_type,
        actor_type,
        actor_auth_user_id,
        evidence,
        dedupe_key
      ) values (
        ${rows[0].id}::uuid,
        'created',
        'system',
        null,
        ${JSON.stringify({ workflowActionId: action.id })}::jsonb,
        ${`${action.idempotencyKey}:created`}
      )
      on conflict (dedupe_key) do nothing
    `;
    return { operatorTaskId: rows[0].id };
  });
}

export async function executeWorkflowAction(
  action: WorkflowAction,
): Promise<Record<string, unknown>> {
  if (action.actionType === "create_artifact_job") return createArtifactJob(action);
  if (action.actionType === "create_operator_task") return createOperatorTask(action);
  if (action.actionType === "generate_agreement_receipt") return generateAgreementReceipt(action);
  if (action.actionType === "project_milestone") return projectMilestone(action);
  if (action.actionType === "send_notification") return sendNotification(action);
  throw new Error(`No worker is connected for ${action.actionType}.`);
}
