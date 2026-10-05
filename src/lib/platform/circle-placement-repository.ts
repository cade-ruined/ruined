import "server-only";
import type postgres from "postgres";
import { getBillingDatabase } from "@/lib/stripe/database";
import { OpsRepositoryError, requireOpsAdmin } from "@/lib/platform/ops-repository";
import { requireLeadershipResponsibility } from "@/lib/platform/leadership-repository";
import {
  scoreCirclePlacement, validateCirclePreferences, type CirclePreferences, type CirclePreferencesView,
  type CirclePlacementConnection, type CircleRecommendationSnapshot,
} from "@/lib/platform/circle-placement-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Tx = postgres.TransactionSql;
function validId(id: string) { if (!UUID.test(id)) throw new OpsRepositoryError("invalid_request", "Choose a valid member or Circle."); }
async function ownMember(tx: Tx, actor: string) {
  const [member] = await tx<Array<{ id: string; timezone: string | null }>>`
    select member.id, profile.timezone from platform_users viewer
    join ruined_members member on member.person_id = viewer.person_id
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    left join person_profiles profile on profile.person_id = member.person_id
    where viewer.auth_user_id = ${actor}::uuid and viewer.status = 'active' and lifecycle.account_state = 'active'
      and exists (select 1 from platform_role_grants role where role.auth_user_id = viewer.auth_user_id and role.role_slug = 'member' and role.revoked_at is null)
    for share of viewer, member, lifecycle`;
  if (!member) throw new OpsRepositoryError("forbidden", "Active member account access is required.");
  return member;
}
async function connections(tx: Tx, memberId: string) {
  return tx<Array<{ memberId: string; name: string }>>`
    select distinct connected.id as "memberId", coalesce(nullif(profile.display_name, ''), 'Your connection') as name
    from member_referrals referral
    join ruined_members connected on connected.id = case when referral.referred_member_id = ${memberId}::uuid then referral.inviter_member_id else referral.referred_member_id end
    join member_lifecycle lifecycle on lifecycle.member_id = connected.id and lifecycle.account_state = 'active'
    left join person_profiles profile on profile.person_id = connected.person_id
    where referral.referred_member_id is not null and (referral.referred_member_id = ${memberId}::uuid or referral.inviter_member_id = ${memberId}::uuid)
    order by name, "memberId" limit 100`;
}
export async function getCirclePreferences(actor: string): Promise<CirclePreferencesView> {
  return getBillingDatabase().begin(async tx => {
    const member = await ownMember(tx, actor);
    const [row] = await tx<Array<{ timezone: string; availability: string[]; preferred_connection_id: string | null }>>`select timezone, availability, preferred_connection_id from member_circle_preferences where member_id = ${member.id}::uuid`;
    const known = await connections(tx, member.id);
    return { preferences: { timezone: row?.timezone ?? member.timezone ?? "", availability: row?.availability ?? [], preferredConnectionId: known.some(item => item.memberId === row?.preferred_connection_id) ? row!.preferred_connection_id : null }, connections: known };
  });
}
export async function saveCirclePreferences(actor: string, input: unknown) {
  let value: CirclePreferences;
  try { value = validateCirclePreferences(input); } catch (error) { throw new OpsRepositoryError("invalid_request", error instanceof Error ? error.message : "Choose valid preferences."); }
  return getBillingDatabase().begin(async tx => {
    const member = await ownMember(tx, actor);
    const known = await connections(tx, member.id);
    if (value.preferredConnectionId && !known.some(item => item.memberId === value.preferredConnectionId)) throw new OpsRepositoryError("invalid_request", "Choose a connection from your invitation history.");
    await tx`insert into member_circle_preferences(member_id, timezone, availability, preferred_connection_id)
      values (${member.id}::uuid, ${value.timezone}, ${value.availability}::text[], ${value.preferredConnectionId}::uuid)
      on conflict (member_id) do update set timezone = excluded.timezone, availability = excluded.availability,
        preferred_connection_id = excluded.preferred_connection_id, updated_at = statement_timestamp()`;
    return { preferences: value, connections: known };
  });
}
async function placementConnection(tx: Tx, memberId: string | null): Promise<CirclePlacementConnection | null> {
  if (!memberId) return null;
  const [member] = await tx<Array<{ id: string; name: string; active: boolean }>>`
    select member.id,
      case when member.deleted_at is not null then 'Former member'
        else coalesce(nullif(btrim(profile.display_name), ''), nullif(btrim(profile.preferred_name), ''), 'Member') end as name,
      member.deleted_at is null and person.status = 'active'
        and private.ruined_member_can_share_invitation(member.id)
        and exists (select 1 from platform_users viewer
          join platform_role_grants access on access.auth_user_id = viewer.auth_user_id
            and access.role_slug = 'member' and access.revoked_at is null
          where viewer.member_id = member.id and viewer.person_id = member.person_id and viewer.status = 'active') as active
    from ruined_members member
    join people person on person.id = member.person_id
    left join person_profiles profile on profile.person_id = member.person_id
    where member.id = ${memberId}::uuid`;
  if (!member) return null;
  const base = { memberId: member.id, name: member.name, circleId: null, circleName: null, circles: [] };
  if (!member.active) return { ...base, status: "inactive" };
  const rows = await tx<Array<{ circle_id: string; name: string; status: string; relationship: "member" | "supporter" }>>`
    select circle.id as circle_id, circle.name, circle.status,
      case when bool_or(current_placement.relationship = 'member') then 'member' else 'supporter' end as relationship
    from (
      select assignment.circle_id, 'member'::text as relationship
      from circle_member_assignments assignment
      where assignment.member_id = ${memberId}::uuid and assignment.ended_at is null and assignment.assigned_at <= statement_timestamp()
      union all
      select staff.circle_id, 'supporter'::text
      from circle_staff_assignments staff
      join platform_users viewer on viewer.auth_user_id = staff.auth_user_id
      join ruined_members member on member.id = viewer.member_id and member.person_id = viewer.person_id
      where member.id = ${memberId}::uuid and viewer.status = 'active'
        and staff.role_slug = 'circle_leader' and staff.ended_at is null and staff.assigned_at <= statement_timestamp()
        and exists (select 1 from platform_role_grants access where access.auth_user_id = viewer.auth_user_id
          and access.role_slug in ('circle_leader', 'ops_admin') and access.revoked_at is null)
    ) current_placement
    join circles circle on circle.id = current_placement.circle_id
    group by circle.id, circle.name, circle.status order by circle.name, circle.id`;
  const circles = rows.filter(row => row.status === "active" || row.status === "forming")
    .map(row => ({ circleId: row.circle_id, name: row.name, relationship: row.relationship }));
  if (!circles.length) return { ...base, status: rows.length ? "circle_unavailable" : "no_circle" };
  return {
    ...base, circles, status: circles.length > 1 ? "multiple_circles" : "available",
    circleId: circles.length === 1 ? circles[0].circleId : null,
    circleName: circles.length === 1 ? circles[0].name : null,
  };
}

export async function getCircleRecommendationSnapshot(actor: string, memberId: string): Promise<CircleRecommendationSnapshot> {
  validId(memberId);
  return getBillingDatabase().begin(async tx => {
    await tx`set transaction isolation level repeatable read`;
    await requireOpsAdmin(tx, actor);
    const [member] = await tx<Array<{
      timezone: string | null; availability: string[] | null; preferred_connection_id: string | null;
      inviter_member_id: string | null; bound_at: Date | string | null; joined_at: Date | string | null;
    }>>`
      select coalesce(preference.timezone, profile.timezone) as timezone, preference.availability,
        case when exists (
          select 1 from member_referrals known
          join ruined_members referred on referred.id = known.referred_member_id and referred.person_id = known.referred_person_id
          where known.bound_at is not null and (
            (known.referred_member_id = member.id and known.inviter_member_id = preference.preferred_connection_id)
            or (known.inviter_member_id = member.id and known.referred_member_id = preference.preferred_connection_id)
          )
        ) then preference.preferred_connection_id else null end as preferred_connection_id,
        referral.inviter_member_id, referral.bound_at, referral.joined_at
      from ruined_members member left join person_profiles profile on profile.person_id = member.person_id
      left join member_circle_preferences preference on preference.member_id = member.id
      -- Attribution is the first verified, bound referral. Acceptance can precede
      -- completed joining; neither email guesses nor joined_at gate this signal.
      left join member_referrals referral on referral.referred_member_id = member.id
        and referral.referred_person_id = member.person_id and referral.bound_at is not null
      where member.id = ${memberId}::uuid and member.deleted_at is null`;
    if (!member) throw new OpsRepositoryError("not_found", "Member not found.");
    const inviterConnection = await placementConnection(tx, member.inviter_member_id);
    const preferredConnection = member.preferred_connection_id === member.inviter_member_id
      ? inviterConnection : await placementConnection(tx, member.preferred_connection_id);
    const inviter = inviterConnection && member.bound_at ? {
      ...inviterConnection, boundAt: new Date(member.bound_at).toISOString(),
      joinedAt: member.joined_at ? new Date(member.joined_at).toISOString() : null,
    } : null;
    const [couple] = await tx<Array<{ partner_id: string | null; member_circle_id: string | null; partner_circle_id: string | null; partner_circle_name: string | null }>>`
      select pair.partner_id,
        (select circle_id from circle_member_assignments where member_id = ${memberId}::uuid and ended_at is null) as member_circle_id,
        partner_assignment.circle_id as partner_circle_id, partner_circle.name as partner_circle_name
      from (select private.ruined_circle_couple_partner(${memberId}::uuid) as partner_id) pair
      left join circle_member_assignments partner_assignment on partner_assignment.member_id = pair.partner_id and partner_assignment.ended_at is null
      left join circles partner_circle on partner_circle.id = partner_assignment.circle_id`;
    const circles = await tx<Array<{ id: string; name: string; active_members: number; incoming_seats: number }>>`
      select circle.id, circle.name, private.ruined_circle_participant_count(circle.id) as active_members,
        (select count(*)::integer from unnest(array_remove(array[${memberId}::uuid, ${couple?.partner_id ?? null}::uuid], null)) incoming(member_id)
          where not exists (select 1 from circle_member_assignments placement
            where placement.circle_id = circle.id and placement.member_id = incoming.member_id and placement.ended_at is null)
          and not exists (select 1 from circle_staff_assignments staff
            join platform_users viewer on viewer.auth_user_id = staff.auth_user_id
            join ruined_members supporter on supporter.person_id = viewer.person_id
            where staff.circle_id = circle.id and staff.role_slug = 'circle_leader' and staff.ended_at is null
              and supporter.id = incoming.member_id)) as incoming_seats
      from circles circle where circle.status in ('forming', 'active') order by circle.name`;
    const people = await tx<Array<{ circle_id: string; timezone: string | null; availability: string[] | null }>>`
      select assignment.circle_id, coalesce(preference.timezone, profile.timezone) as timezone, preference.availability
      from circle_member_assignments assignment join ruined_members member on member.id = assignment.member_id
      left join member_circle_preferences preference on preference.member_id = member.id
      left join person_profiles profile on profile.person_id = member.person_id
      where assignment.ended_at is null and member.id <> ${memberId}::uuid`;
    const recommendations = scoreCirclePlacement({ timezone: member.timezone ?? "", availability: member.availability ?? [], preferredConnectionId: member.preferred_connection_id }, circles.map(circle => {
      const inviterPlacement = inviter?.circles.find(placement => placement.circleId === circle.id);
      const preferredPlacement = preferredConnection?.circles.find(placement => placement.circleId === circle.id);
      return {
        circleId: circle.id, name: circle.name, activeMembers: Number(circle.active_members), incomingSeats: Number(circle.incoming_seats),
        inviter: inviter && inviterPlacement ? { memberId: inviter.memberId, name: inviter.name, relationship: inviterPlacement.relationship } : undefined,
        preferredConnection: preferredConnection && preferredPlacement ? { memberId: preferredConnection.memberId, name: preferredConnection.name, relationship: preferredPlacement.relationship } : undefined,
        participantPreferences: people.filter(person => person.circle_id === circle.id).map(person => ({ timezone: person.timezone ?? "", availability: person.availability ?? [], preferredConnectionId: null })),
      };
    }), new Date(), couple?.partner_id ? { memberCircleId: couple.member_circle_id, partnerCircleId: couple.partner_circle_id } : undefined);
    return {
      recommendations,
      context: {
        memberId, inviter, preferredConnection,
        requiredPartnerCircle: couple?.partner_id && !couple.member_circle_id && couple.partner_circle_id
          ? { circleId: couple.partner_circle_id, name: couple.partner_circle_name ?? "Partner's Circle" } : null,
      },
    };
  });
}

// Preserve callers that only need the original ranked array.
export async function getCircleRecommendations(actor: string, memberId: string) {
  return (await getCircleRecommendationSnapshot(actor, memberId)).recommendations;
}

export async function requestCirclePlacementReview(actor: string, input: { memberId: string; circleId: string; reason: string }) {
  validId(input.memberId); validId(input.circleId);
  if (input.reason.trim().length < 10 || input.reason.length > 1000) throw new OpsRepositoryError("invalid_request", "Explain the requested exception in 10–1000 characters.");
  return getBillingDatabase().begin(async tx => {
    await requireLeadershipResponsibility(tx, actor, "circle_placement");
    await tx`select pg_advisory_xact_lock(hashtext(${input.memberId}), 2)`;
    const [circle] = await tx`select id from circles where id = ${input.circleId}::uuid and status in ('active','forming') for share`;
    if (!circle) throw new OpsRepositoryError("not_found", "Choose a current Circle.");
    const [assignment] = await tx<Array<{ id: string; circle_id: string }>>`select id::text, circle_id from circle_member_assignments where member_id = ${input.memberId}::uuid and ended_at is null`;
    if (assignment?.circle_id === input.circleId) throw new OpsRepositoryError("conflict", "This member is already in that Circle.");
    const [review] = await tx<Array<{ id: string }>>`insert into circle_placement_reviews(member_id, circle_id, previous_assignment_id, requested_by_auth_user_id, reason)
      values (${input.memberId}::uuid, ${input.circleId}::uuid, ${assignment?.id ?? null}::bigint, ${actor}::uuid, ${input.reason.trim()})
      on conflict (member_id, circle_id) where status = 'pending' do nothing returning id`;
    if (!review) throw new OpsRepositoryError("conflict", "An exception request is already pending for this member and Circle.");
    await tx`insert into operator_audit_events(actor_auth_user_id, action, subject_type, subject_id, reason, after_snapshot, metadata, dedupe_key)
      values (${actor}::uuid, 'circle.placement_exception_requested', 'circle_placement_review', ${review.id}, ${input.reason.trim()},
        ${tx.json({ circleId: input.circleId, memberId: input.memberId })}, '{}'::jsonb, gen_random_uuid()::text)`;
    return review;
  });
}
export async function getCirclePlacementReviews(actor: string) {
  return getBillingDatabase().begin(async tx => {
    await requireOpsAdmin(tx, actor);
    return tx<Array<{ id: string; memberId: string; memberName: string; circleId: string; circleName: string; reason: string; previousAssignmentId: string | null; fromCircleId: string | null }>>`
      select review.id, review.member_id as "memberId", coalesce(profile.display_name, 'Member') as "memberName",
        review.circle_id as "circleId", circle.name as "circleName", review.reason, review.previous_assignment_id::text as "previousAssignmentId", assignment.circle_id as "fromCircleId"
      from circle_placement_reviews review join circles circle on circle.id = review.circle_id
      join ruined_members member on member.id = review.member_id left join person_profiles profile on profile.person_id = member.person_id
      left join circle_member_assignments assignment on assignment.id = review.previous_assignment_id
      where review.status = 'pending' order by review.created_at limit 100`;
  });
}
export async function declineCirclePlacementReview(actor: string, reviewId: string) {
  validId(reviewId);
  return getBillingDatabase().begin(async tx => {
    await requireLeadershipResponsibility(tx, actor, "circle_exception");
    const [review] = await tx`update circle_placement_reviews set status = 'declined', reviewed_by_auth_user_id = ${actor}::uuid, reviewed_at = statement_timestamp()
      where id = ${reviewId}::uuid and status = 'pending' returning id`;
    if (!review) throw new OpsRepositoryError("conflict", "This request has already been reviewed.");
    await tx`insert into operator_audit_events(actor_auth_user_id, action, subject_type, subject_id, after_snapshot, metadata, dedupe_key)
      values (${actor}::uuid, 'circle.placement_exception_declined', 'circle_placement_review', ${reviewId}, '{}'::jsonb, '{}'::jsonb, gen_random_uuid()::text)`;
    return review;
  });
}
export async function saveCircleStory(actor: string, circleId: string, story: string) {
  validId(circleId);
  if (story.length > 2000) throw new OpsRepositoryError("invalid_request", "Keep the Circle story within 2,000 characters.");
  return getBillingDatabase().begin(async tx => {
    await requireOpsAdmin(tx, actor);
    const [circle] = await tx`update circles set story = ${story.trim() || null}, updated_at = statement_timestamp() where id = ${circleId}::uuid returning id, story`;
    if (!circle) throw new OpsRepositoryError("not_found", "Circle not found.");
    await tx`insert into operator_audit_events(actor_auth_user_id, action, subject_type, subject_id, after_snapshot, metadata, dedupe_key)
      values (${actor}::uuid, 'circle.story_updated', 'circle', ${circleId}, ${tx.json({ story: story.trim() || null })}, '{}'::jsonb, gen_random_uuid()::text)`;
    return circle;
  });
}
