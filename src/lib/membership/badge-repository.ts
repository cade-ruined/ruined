import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { evaluateMembershipBadges, memberBadge, type MemberBadge } from "./badge-model";

/** Uses the same current entitlement policy as member invitation access. */
export async function reconcileMemberBadges(tx: TransactionSql, memberId: string): Promise<void> {
  const [membership] = await tx<Array<{
    member_id: string; member_number: number; activated_at: Date; membership_active: boolean;
    verified_email: string; waitlist_email: string; joined_waitlist_at: Date;
  }>>`
    select member.id as member_id, member.member_number, assignment.activated_at,
      private.ruined_member_can_share_invitation(member.id) as membership_active,
      email.email_normalized as verified_email, waitlist.email_normalized as waitlist_email,
      waitlist.joined_waitlist_at
    from ruined_members member
    join private.member_number_assignments assignment on assignment.member_id = member.id
      and assignment.member_number = member.member_number and assignment.member_number between 0 and 50
    join people person on person.id = member.person_id and person.status = 'active'
    join person_email_addresses email on email.person_id = member.person_id
      and email.email_normalized = member.email_normalized
      and email.verification_state = 'verified' and email.retired_at is null
    join membership_waitlist waitlist on waitlist.email_normalized = email.email_normalized
      and waitlist.joined_waitlist_at is not null
    where member.id = ${memberId}::uuid and member.deleted_at is null
  `;
  if (!membership) return;
  const badges = evaluateMembershipBadges({
    memberNumber: membership.member_number,
    activatedAt: new Date(membership.activated_at).toISOString(),
    membershipActive: membership.membership_active,
    verifiedEmail: membership.verified_email,
    waitlistEmail: membership.waitlist_email,
    waitlistedAt: new Date(membership.joined_waitlist_at).toISOString(),
  });
  for (const badge of badges) {
    await tx`
      insert into member_badge_awards(member_id, badge_key, earned_at, source_event_id, source_invoice_id, rule_version)
      values (${membership.member_id}::uuid, ${badge.key}, ${badge.earnedAt}::timestamptz,
        ${`membership-activation:${membership.member_number}`}, null, 2)
      on conflict(member_id, badge_key) do nothing
    `;
  }
}

/** Called inside the verified webhook transaction; any failure rolls it all back. */
export async function reconcileMemberBadgesForStripeEvent(tx: TransactionSql, eventId: string): Promise<void> {
  const [event] = await tx<Array<{ member_id: string }>>`
    select invoice.member_id from stripe_webhook_events event
    join stripe_invoices invoice on invoice.id = event.object_id and invoice.purpose = 'membership'
    where event.event_id = ${eventId} and event.event_type = 'invoice.paid' and event.livemode
      and event.status in ('processing', 'processed') and invoice.stripe_status = 'paid'
  `;
  if (event?.member_id) await reconcileMemberBadges(tx, event.member_id);
}

export class BadgeNotificationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BadgeNotificationError";
  }
}

/** Canonical person linkage, current member role and the paid-registration release gate. */
export async function lockBadgeOwner(tx: TransactionSql, authUserId: string): Promise<string> {
  const [owner] = await tx<Array<{ member_id: string }>>`
    select member.id as member_id
    from platform_users account
    join ruined_members member on member.person_id = account.person_id
      and (account.member_id is null or member.id = account.member_id) and member.deleted_at is null
    join people person on person.id = member.person_id and person.status = 'active'
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
      and lifecycle.account_state not in ('suspended', 'closed')
    join platform_role_grants member_grant on member_grant.auth_user_id = account.auth_user_id
      and member_grant.role_slug = 'member' and member_grant.revoked_at is null
    where account.auth_user_id = ${authUserId}::uuid and account.status = 'active'
      and private.ruined_member_profile_released(member.id)
    for share of account, member, person, lifecycle, member_grant
  `;
  if (!owner) throw new BadgeNotificationError(403, "Your member badges are unavailable.");
  return owner.member_id;
}

/** Inserts each achievement once; current evidence governs visibility on every read. */
export async function reconcileMemberBadgeCollection(tx: TransactionSql, memberId: string): Promise<void> {
  await reconcileMemberBadges(tx, memberId);
  await tx`
    insert into member_badge_awards(member_id, badge_key, earned_at, source_event_id, rule_version, public_visible)
    select ${memberId}::uuid, progress.badge_key, progress.earned_at, progress.source_event_id, 1,
      progress.badge_key <> 'first-words'
    from private.ruined_member_badge_progress(${memberId}::uuid) progress
    where progress.progress >= progress.target and progress.earned_at is not null
      and progress.earned_at <= statement_timestamp()
      and private.ruined_member_profile_released(${memberId}::uuid)
    on conflict(member_id, badge_key) do nothing
  `;
}

export type ValidMemberBadgeRow = {
  badge_key: string; earned_at: Date; public_visible: boolean; acknowledged_at: Date | null;
  source_event_id: string; rule_version: number;
};

/** Public callers must opt into this explicit visibility filter. Unknown keys fail closed in memberBadge. */
export async function readValidMemberBadgeRows(tx: TransactionSql, memberId: string, publicOnly = false): Promise<ValidMemberBadgeRow[]> {
  return tx<ValidMemberBadgeRow[]>`
    select award.badge_key, award.earned_at, award.public_visible, award.acknowledged_at,
      award.source_event_id, award.rule_version
    from member_badge_awards award
    join ruined_members member on member.id = award.member_id and member.deleted_at is null
    join people person on person.id = member.person_id and person.status = 'active'
    join member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state not in ('suspended', 'closed')
    left join private.ruined_member_badge_progress(${memberId}::uuid) progress on progress.badge_key = award.badge_key
    where award.member_id = ${memberId}::uuid and (not ${publicOnly} or award.public_visible)
      and private.ruined_member_profile_released(member.id)
      and ((award.badge_key = 'early-supporter' and exists (
        select 1 from private.member_number_assignments assignment
        where assignment.member_id = member.id and assignment.member_number = member.member_number
          and assignment.member_number between 0 and 50
      )) or (progress.progress >= progress.target and progress.earned_at is not null
        and progress.earned_at <= statement_timestamp()))
    order by award.earned_at, award.badge_key
  `;
}

export function memberBadgeFromAward(row: ValidMemberBadgeRow): MemberBadge | null {
  const badge = memberBadge(row.badge_key, new Date(row.earned_at).toISOString());
  if (!badge) return null;
  return { ...badge, ...(row.badge_key === "early-supporter" && row.rule_version === 3
    && row.source_event_id === "existing-profile-grant:2026-09-28"
    ? { description: "Had a Ruined profile before launch." } : {}) };
}

/** Member ID is supplied by the already authenticated profile repository. */
export async function getMemberBadges(memberId: string): Promise<MemberBadge[]> {
  return getApplicationDatabase().begin(async tx => {
    await reconcileMemberBadgeCollection(tx, memberId);
    const rows = await readValidMemberBadgeRows(tx, memberId);
    return rows.flatMap(row => { const badge = memberBadgeFromAward(row); return badge ? [badge] : []; });
  });
}

/** Never reconcile on a public read or return private awards. */
export async function getPublicMemberBadges(memberId: string): Promise<MemberBadge[]> {
  return getApplicationDatabase().begin(async tx => {
    const rows = await readValidMemberBadgeRows(tx, memberId, true);
    return rows.flatMap(row => { const badge = memberBadgeFromAward(row); return badge ? [badge] : []; });
  });
}
