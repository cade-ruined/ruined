import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { deriveMemberAccessPolicy, memberCan, type MemberAccessIdentity } from "./access-policy";
import {
  MEMBER_NOTIFICATION_UUID, MemberNotificationError, safeMemberNotificationHref,
  type MemberAnnouncementAction, type MemberNotificationAnnouncement, type MemberNotificationState,
} from "./notification-inbox-model";

type NotificationOwner = MemberAccessIdentity & {
  memberId: string;
  personId: string;
  circleRevealed: boolean;
  operatorFunded: boolean;
  complimentaryFunded: boolean;
};

/** Authorize within the same transaction as the inbox read or acknowledgement. */
async function requireNotificationOwner(tx: TransactionSql, authUserId: string, lock = false): Promise<NotificationOwner> {
  if (!MEMBER_NOTIFICATION_UUID.test(authUserId)) throw new MemberNotificationError(403, "Your member updates are unavailable.");
  const [owner] = await tx<NotificationOwner[]>`
    select member.id as "memberId", member.person_id as "personId",
      lifecycle.account_state as "accountState",
      lifecycle.administrative_onboarding_state as "administrativeOnboardingState",
      coalesce(private.ruined_member_shared_billing_state(member.id), lifecycle.billing_state) as "billingState",
      lifecycle.program_state as "programState", lifecycle.standing_state as "standingState",
      lifecycle.cancellation_effective_at as "cancellationEffectiveAt",
      not private.ruined_member_profile_released(member.id) as "registrationHeld",
      private.ruined_member_circle_is_revealed(member.id) as "circleRevealed",
      private.ruined_member_has_operator_funding(member.id) as "operatorFunded",
      private.ruined_member_has_complimentary_funding(member.id) as "complimentaryFunded"
    from platform_users account
    join ruined_members member on member.person_id = account.person_id
      and (account.member_id is null or account.member_id = member.id) and member.deleted_at is null
    join people person on person.id = member.person_id and person.status = 'active'
    join member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
    join platform_role_grants member_grant on member_grant.auth_user_id = account.auth_user_id
      and member_grant.role_slug = 'member' and member_grant.revoked_at is null
    where account.auth_user_id = ${authUserId}::uuid and account.status = 'active'
    ${lock ? tx`for share of account, member, person, lifecycle, member_grant` : tx``}
  `;
  if (!owner || !memberCan(deriveMemberAccessPolicy({ ...owner,
    membershipFunding: owner.operatorFunded ? "operator" : owner.complimentaryFunded ? "complimentary" : "self",
  }), "updates.read")) throw new MemberNotificationError(403, "Your member updates are unavailable.");
  return owner;
}

/** Keep the current inbox's Circle reveal boundary on both reads and writes. */
function visibleNotification(tx: TransactionSql, owner: NotificationOwner) {
  return tx`
    notification.member_id = ${owner.memberId}::uuid
    and notification.person_id = ${owner.personId}::uuid
    and notification.channel = 'in_app' and notification.status = 'delivered'
    and notification.scheduled_for <= statement_timestamp()
    and notification.dismissed_at is null
    and (notification.notification_type <> 'circle' or ${owner.circleRevealed})
    and (${owner.circleRevealed} or dispatch.target_type is null or dispatch.target_type not in ('circle', 'block'))
    and (${owner.circleRevealed} or notification.announcement_id is null or exists (
      select 1 from member_announcement_targets target
      where target.announcement_id = notification.announcement_id and target.target_type not in ('circle', 'block')
    ))
  `;
}

export async function getMemberNotificationState(authUserId: string): Promise<MemberNotificationState> {
  return getApplicationDatabase().begin(async tx => {
    await tx`set transaction isolation level repeatable read read only`;
    const owner = await requireNotificationOwner(tx, authUserId);
    const [row] = await tx<Array<{ unread_count: number; announcement: MemberNotificationAnnouncement | null }>>`
      with inbox as (
        select notification.*
        from member_notifications notification
        left join operator_notification_dispatches dispatch on dispatch.id = notification.operator_dispatch_id
        where ${visibleNotification(tx, owner)}
      )
      select (select count(*)::integer from inbox where read_at is null) as unread_count,
        (select jsonb_build_object('id', id, 'title', title_snapshot, 'body', body_snapshot,
          'actionLabel', action_label_snapshot, 'href', action_url_snapshot, 'publishedAt', created_at)
         from inbox where show_on_next_visit and read_at is null and announcement_dismissed_at is null
         order by created_at desc, id desc limit 1) as announcement
    `;
    const announcement = row?.announcement ?? null;
    return { ownerId: authUserId, unreadCount: Number(row?.unread_count ?? 0),
      announcement: announcement ? { ...announcement,
        href: safeMemberNotificationHref(announcement.href),
        actionLabel: announcement.actionLabel?.trim() || null,
        publishedAt: new Date(announcement.publishedAt).toISOString(),
      } : null };
  });
}

export async function acknowledgeMemberAnnouncement(authUserId: string, notificationId: string, action: MemberAnnouncementAction): Promise<void> {
  if (!MEMBER_NOTIFICATION_UUID.test(notificationId) || !["dismiss", "open"].includes(action)) {
    throw new MemberNotificationError(400, "Choose a valid announcement action.");
  }
  await getApplicationDatabase().begin(async tx => {
    const owner = await requireNotificationOwner(tx, authUserId, true);
    // Share the existing read action's lock and event key so two surfaces cannot
    // acknowledge the same notification twice or race its read history.
    await tx`select pg_advisory_xact_lock(hashtext(${notificationId}), 47)`;
    const [notification] = await tx<Array<{ read_at: Date | null; announcement_dismissed_at: Date | null }>>`
      select notification.read_at, notification.announcement_dismissed_at
      from member_notifications notification
      left join operator_notification_dispatches dispatch on dispatch.id = notification.operator_dispatch_id
      where notification.id = ${notificationId}::uuid and notification.show_on_next_visit
        and ${visibleNotification(tx, owner)}
      for update of notification
    `;
    if (!notification) throw new MemberNotificationError(404, "That announcement is unavailable.");
    const dismiss = !notification.announcement_dismissed_at;
    const read = action === "open" && !notification.read_at;
    if (!dismiss && !read) return;
    await tx`
      update member_notifications set
        announcement_dismissed_at = coalesce(announcement_dismissed_at, statement_timestamp()),
        read_at = case when ${action} = 'open' then coalesce(read_at, statement_timestamp()) else read_at end,
        updated_at = statement_timestamp()
      where id = ${notificationId}::uuid
    `;
    if (dismiss) await tx`
      insert into member_notification_events(notification_id, event_type, actor_auth_user_id, evidence, dedupe_key)
      values (${notificationId}::uuid, 'dismissed', ${authUserId}::uuid,
        '{"source":"my_ruined","surface":"next_visit_announcement"}'::jsonb,
        ${`notification-announcement-dismissed:${notificationId}`})
      on conflict (dedupe_key) do nothing
    `;
    if (read) await tx`
      insert into member_notification_events(notification_id, event_type, actor_auth_user_id, evidence, dedupe_key)
      values (${notificationId}::uuid, 'read', ${authUserId}::uuid,
        '{"source":"my_ruined"}'::jsonb, ${`notification-read:${notificationId}`})
      on conflict (dedupe_key) do nothing
    `;
  });
}
