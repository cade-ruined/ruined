import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";

import { getApplicationDatabase } from "@/lib/database/server";
import {
  normalizeOpsNotificationRequestKey,
  type OpsNotificationDeliveryStatus,
  resolveOpsNotificationStatusAt,
} from "@/lib/platform/ops-notification-model";
import { OpsOperatingRepositoryError } from "@/lib/platform/ops-operating-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTIFICATION_TYPES = new Set([
  "announcement",
  "reminder",
  "membership",
  "circle",
  "foundations",
  "artifact",
  "system",
]);
const TARGET_TYPES = new Set(["all_active_members", "block", "circle", "member"]);

export type OpsNotificationAudienceOption = {
  id: string;
  label: string;
};

export type OpsNotificationHistoryItem = {
  memberId: string;
  memberName: string;
  notificationId: string;
  readAt: string | null;
  status: OpsNotificationDeliveryStatus;
  statusAt: string;
  title: string;
  type: string;
};

export type OpsNotificationCenterData = {
  blocks: OpsNotificationAudienceOption[];
  circles: OpsNotificationAudienceOption[];
  history: OpsNotificationHistoryItem[];
  members: OpsNotificationAudienceOption[];
};

function requireUuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new OpsOperatingRepositoryError("invalid_request", `${label} is invalid.`);
  }
  return normalized;
}

function requireText(value: string, label: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
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

function asIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requireRequestKey(value: string): string {
  const normalized = normalizeOpsNotificationRequestKey(value);
  if (!normalized) {
    throw new OpsOperatingRepositoryError(
      "invalid_request",
      "A valid notification request key is required.",
    );
  }
  return normalized;
}

function notificationFingerprint(input: {
  actionLabel: string | null;
  actionUrl: string | null;
  actorAuthUserId: string;
  body: string;
  notificationType: string;
  targetId: string | null;
  targetType: string;
  title: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

async function requireNotificationAdmin(
  tx: postgres.TransactionSql,
  actorAuthUserIdValue: string,
  lock = false,
): Promise<string> {
  const actorAuthUserId = requireUuid(actorAuthUserIdValue, "Operator identity");
  const rows = lock
    ? await tx<Array<{ auth_user_id: string }>>`
        select platform_user.auth_user_id
        from platform_users platform_user
        join platform_role_grants role_grant on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null
        for update of platform_user, role_grant
      `
    : await tx<Array<{ auth_user_id: string }>>`
        select platform_user.auth_user_id
        from platform_users platform_user
        join platform_role_grants role_grant on role_grant.auth_user_id = platform_user.auth_user_id
        where platform_user.auth_user_id = ${actorAuthUserId}::uuid
          and platform_user.status = 'active'
          and role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null
      `;
  if (!rows[0]) {
    throw new OpsOperatingRepositoryError("forbidden", "Notifications require operations administrator access.");
  }
  return actorAuthUserId;
}

export async function getOpsNotificationCenter(
  actorAuthUserId: string,
): Promise<OpsNotificationCenterData> {
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    await tx`set transaction isolation level repeatable read read only`;
    await requireNotificationAdmin(tx, actorAuthUserId);
    const [blockRows, circleRows, memberRows, historyRows] = await Promise.all([
      tx<Array<{ id: string; label: string }>>`
        select id, name as label from membership_blocks where status <> 'archived' order by name
      `,
      tx<Array<{ id: string; label: string }>>`
        select id, name as label from circles where status <> 'archived' order by name
      `,
      tx<Array<{ id: string; label: string }>>`
        select
          member.id,
          coalesce(profile.preferred_name, profile.display_name, private_profile.legal_name, 'Member') as label
        from ruined_members member
        join member_lifecycle lifecycle on lifecycle.member_id = member.id
        join platform_users platform_user
          on platform_user.person_id = member.person_id
          and platform_user.status = 'active'
        join platform_role_grants role_grant
          on role_grant.auth_user_id = platform_user.auth_user_id
          and role_grant.role_slug = 'member'
          and role_grant.revoked_at is null
        left join person_profiles profile on profile.person_id = member.person_id
        left join person_private_profiles private_profile on private_profile.person_id = member.person_id
        where lifecycle.account_state = 'active'
          and lifecycle.billing_state = 'active'
          and lifecycle.administrative_onboarding_state = 'completed'
          and lifecycle.standing_state in ('active', 'cancellation_requested')
          and (
            lifecycle.standing_state = 'active'
            or lifecycle.cancellation_effective_at > statement_timestamp()
          )
        order by label, member.id
      `,
      tx<Array<{
        created_at: Date | string;
        delivered_at: Date | string | null;
        latest_status_event_at: Date | string | null;
        member_id: string;
        member_name: string;
        notification_id: string;
        notification_type: string;
        read_at: Date | string | null;
        sent_at: Date | string | null;
        status: OpsNotificationDeliveryStatus;
        title_snapshot: string;
        updated_at: Date | string;
      }>>`
        select
          notification.id as notification_id,
          notification.member_id,
          notification.notification_type,
          notification.title_snapshot,
          notification.status,
          notification.created_at,
          notification.updated_at,
          notification.sent_at,
          notification.delivered_at,
          notification.read_at,
          status_event.occurred_at as latest_status_event_at,
          coalesce(profile.preferred_name, profile.display_name, 'Member') as member_name
        from member_notifications notification
        join ruined_members member on member.id = notification.member_id
        left join person_profiles profile on profile.person_id = member.person_id
        left join lateral (
          select event.occurred_at
          from member_notification_events event
          where event.notification_id = notification.id
            and event.event_type = notification.status
          order by event.occurred_at desc, event.id desc
          limit 1
        ) status_event on true
        where notification.channel = 'in_app'
        order by notification.created_at desc
        limit 250
      `,
    ]);
    return {
      blocks: blockRows,
      circles: circleRows,
      history: historyRows.map((row) => {
        const createdAt = asIso(row.created_at)!;
        const updatedAt = asIso(row.updated_at) ?? createdAt;
        return {
          memberId: row.member_id,
          memberName: row.member_name,
          notificationId: row.notification_id,
          readAt: asIso(row.read_at),
          status: row.status,
          statusAt: resolveOpsNotificationStatusAt({
            createdAt,
            deliveredAt: asIso(row.delivered_at),
            latestStatusEventAt: asIso(row.latest_status_event_at),
            sentAt: asIso(row.sent_at),
            status: row.status,
            updatedAt,
          }),
          title: row.title_snapshot,
          type: row.notification_type,
        };
      }),
      members: memberRows,
    };
  });
}

export async function sendOpsNotification(input: {
  actionLabel?: string | null;
  actionUrl?: string | null;
  actorAuthUserId: string;
  body: string;
  notificationType: string;
  requestKey: string;
  targetId?: string | null;
  targetType: string;
  title: string;
}) {
  const title = requireText(input.title, "Title", 2, 200);
  const body = requireText(input.body, "Message", 2, 10_000);
  const notificationType = input.notificationType.trim();
  const targetType = input.targetType.trim();
  const actionLabel = optionalText(input.actionLabel, 120);
  const actionUrl = optionalText(input.actionUrl, 2000);
  if (!NOTIFICATION_TYPES.has(notificationType)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Notification type is invalid.");
  }
  if (!TARGET_TYPES.has(targetType)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Audience is invalid.");
  }
  if (Boolean(actionLabel) !== Boolean(actionUrl)) {
    throw new OpsOperatingRepositoryError("invalid_request", "Action label and link must be supplied together.");
  }
  if (actionUrl && !/^https:\/\//i.test(actionUrl) && !actionUrl.startsWith("/my")) {
    throw new OpsOperatingRepositoryError("invalid_request", "Action link must be a secure URL or a My Ruined path.");
  }
  const actorAuthUserIdValue = requireUuid(input.actorAuthUserId, "Operator identity");
  const requestKey = requireRequestKey(input.requestKey);
  const targetId = targetType === "all_active_members"
    ? null
    : requireUuid(input.targetId ?? "", targetType === "member" ? "Member" : "Audience");
  const dispatchId = randomUUID();
  const requestFingerprint = notificationFingerprint({
    actionLabel,
    actionUrl,
    actorAuthUserId: actorAuthUserIdValue,
    body,
    notificationType,
    targetId,
    targetType,
    title,
  });
  const sql = getApplicationDatabase();
  return sql.begin(async (tx) => {
    const actorAuthUserId = await requireNotificationAdmin(tx, actorAuthUserIdValue, true);
    const insertedDispatchRows = await tx<Array<{
      id: string;
      recipient_count: number;
      request_fingerprint: string;
      status: "completed" | "processing";
    }>>`
      insert into operator_notification_dispatches (
        id,
        request_key,
        request_fingerprint,
        actor_auth_user_id,
        notification_type,
        target_type,
        target_id,
        title_snapshot,
        body_snapshot,
        action_label_snapshot,
        action_url_snapshot
      ) values (
        ${dispatchId}::uuid,
        ${requestKey},
        ${requestFingerprint},
        ${actorAuthUserId}::uuid,
        ${notificationType},
        ${targetType},
        ${targetId}::uuid,
        ${title},
        ${body},
        ${actionLabel},
        ${actionUrl}
      )
      on conflict (request_key) do nothing
      returning id, recipient_count, request_fingerprint, status
    `;
    const dispatchRows = insertedDispatchRows[0]
      ? insertedDispatchRows
      : await tx<Array<{
          id: string;
          recipient_count: number;
          request_fingerprint: string;
          status: "completed" | "processing";
        }>>`
          select id, recipient_count, request_fingerprint, status
          from operator_notification_dispatches
          where request_key = ${requestKey}
          for update
        `;
    const dispatch = dispatchRows[0];
    if (!dispatch || dispatch.request_fingerprint !== requestFingerprint) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "That notification request key was already used for different content.",
      );
    }
    if (dispatch.status === "completed") {
      return {
        dispatchId: dispatch.id,
        recipientCount: Number(dispatch.recipient_count),
        replayed: true,
      };
    }
    if (!insertedDispatchRows[0]) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "That notification request is still being processed.",
      );
    }
    const recipients = await tx<Array<{ member_id: string; person_id: string }>>`
      select distinct member.id as member_id, member.person_id
      from ruined_members member
      join member_lifecycle lifecycle on lifecycle.member_id = member.id
      join platform_users platform_user
        on platform_user.person_id = member.person_id
        and platform_user.status = 'active'
      join platform_role_grants role_grant
        on role_grant.auth_user_id = platform_user.auth_user_id
        and role_grant.role_slug = 'member'
        and role_grant.revoked_at is null
      left join circle_member_assignments circle_assignment
        on circle_assignment.member_id = member.id and circle_assignment.ended_at is null
      left join block_circle_assignments block_assignment
        on block_assignment.circle_id = circle_assignment.circle_id and block_assignment.ended_at is null
      where lifecycle.account_state = 'active'
        and lifecycle.billing_state = 'active'
        and lifecycle.administrative_onboarding_state = 'completed'
        and lifecycle.standing_state in ('active', 'cancellation_requested')
        and (
          lifecycle.standing_state = 'active'
          or lifecycle.cancellation_effective_at > statement_timestamp()
        )
        and (
          ${targetType} = 'all_active_members'
          or (${targetType} = 'member' and member.id = ${targetId}::uuid)
          or (${targetType} = 'circle' and circle_assignment.circle_id = ${targetId}::uuid)
          or (${targetType} = 'block' and block_assignment.block_id = ${targetId}::uuid)
        )
      order by member.id
    `;
    if (recipients.length === 0) {
      throw new OpsOperatingRepositoryError("not_found", "No active members match that audience.");
    }
    for (const recipient of recipients) {
      const notificationId = randomUUID();
      await tx`
        insert into member_notifications (
          id,
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
          operator_dispatch_id,
          dedupe_key
        ) values (
          ${notificationId}::uuid,
          ${recipient.person_id}::uuid,
          ${recipient.member_id}::uuid,
          ${notificationType},
          'in_app',
          ${title},
          ${body},
          ${actionLabel},
          ${actionUrl},
          'delivered',
          statement_timestamp(),
          statement_timestamp(),
          ${dispatch.id}::uuid,
          ${`ops-notification:${requestKey}:${recipient.member_id}`}
        )
      `;
      await tx`
        insert into member_notification_events (
          notification_id,
          event_type,
          actor_auth_user_id,
          evidence,
          dedupe_key
        ) values (
          ${notificationId}::uuid,
          'delivered',
          ${actorAuthUserId}::uuid,
          ${tx.json({ dispatchId: dispatch.id, requestKey, source: "operator", targetId, targetType })},
          ${`ops-notification-delivered:${requestKey}:${recipient.member_id}`}
        )
      `;
    }
    const completedDispatchRows = await tx<Array<{ id: string }>>`
      update operator_notification_dispatches
      set
        status = 'completed',
        recipient_count = ${recipients.length},
        completed_at = statement_timestamp()
      where id = ${dispatch.id}::uuid
        and status = 'processing'
      returning id
    `;
    if (!completedDispatchRows[0]) {
      throw new OpsOperatingRepositoryError(
        "conflict",
        "The notification request changed before it could complete.",
      );
    }
    await tx`
      insert into operator_audit_events (
        actor_auth_user_id,
        action,
        subject_type,
        subject_id,
        after_snapshot,
        metadata,
        dedupe_key
      ) values (
        ${actorAuthUserId}::uuid,
        'notification.sent',
        'notification_dispatch',
        ${dispatch.id},
        ${tx.json({ notificationType, recipientCount: recipients.length, targetId, targetType, title })},
        ${tx.json({ channel: "in_app", requestKey })},
        ${`notification-dispatch:${requestKey}`}
      )
    `;
    return { dispatchId: dispatch.id, recipientCount: recipients.length, replayed: false };
  });
}
