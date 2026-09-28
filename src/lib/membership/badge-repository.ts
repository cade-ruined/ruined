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

/** Owner-scoped profile loader. No waitlist email or billing evidence leaves the server. */
export async function getMemberBadges(memberId: string): Promise<MemberBadge[]> {
  const sql = getApplicationDatabase();
  try {
    const rows = await sql<Array<{ badge_key: string; earned_at: Date }>>`
      select award.badge_key, award.earned_at from member_badge_awards award
      join ruined_members member on member.id = award.member_id and member.deleted_at is null
      where award.member_id = ${memberId}::uuid
        and (award.badge_key <> 'early-supporter' or exists (
          select 1 from private.member_number_assignments assignment
          where assignment.member_id = member.id and assignment.member_number = member.member_number
            and assignment.member_number between 0 and 50
        ))
      order by award.earned_at, award.badge_key
    `;
    return rows.flatMap(row => {
      const badge = memberBadge(row.badge_key, new Date(row.earned_at).toISOString());
      return badge ? [badge] : [];
    });
  } catch (error) {
    // A staged code release can read profiles before this additive migration.
    // Other database failures remain visible instead of looking like no awards.
    if (error && typeof error === "object" && "code" in error && error.code === "42P01"
        && "message" in error && String(error.message).includes("member_badge_awards")) return [];
    throw error;
  }
}
