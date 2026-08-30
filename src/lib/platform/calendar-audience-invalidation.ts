import "server-only";

import type postgres from "postgres";

import { markOpsExperienceCalendarPending } from "@/lib/platform/ops-calendar-repository";

type CalendarAudienceInvalidationInput = {
  actorAuthUserId: string;
};

async function markExperienceRowsPending(
  tx: postgres.TransactionSql,
  actorAuthUserId: string,
  rows: Array<{ experience_id: string }>,
): Promise<void> {
  for (const { experience_id: experienceId } of rows) {
    await markOpsExperienceCalendarPending(tx, {
      actorAuthUserId,
      experienceId,
      reason: "attendees",
    });
  }
}

/**
 * A Circle roster change alters Circle-scoped invites and, while the Circle is
 * assigned to a Block, that Block's invites. This only dirties the durable
 * Calendar link; the provider is reconciled by the explicit sync boundary.
 */
export async function markCalendarAudiencesPendingForCircle(
  tx: postgres.TransactionSql,
  input: CalendarAudienceInvalidationInput & { circleId: string },
): Promise<void> {
  const rows = await tx<Array<{ experience_id: string }>>`
    select distinct experience.id as experience_id
    from experiences experience
    join experience_calendar_links calendar_link
      on calendar_link.experience_id = experience.id
     and calendar_link.provider = 'google'
     and calendar_link.status <> 'cancelled'
    where experience.status = 'published'
      and (
        (
          experience.visibility = 'circle'
          and experience.circle_id = ${input.circleId}::uuid
        )
        or (
          experience.visibility = 'block'
          and exists (
            select 1
            from block_circle_assignments block_assignment
            where block_assignment.circle_id = ${input.circleId}::uuid
              and block_assignment.block_id = experience.block_id
              and block_assignment.ended_at is null
          )
        )
      )
    order by experience.id
  `;

  await markExperienceRowsPending(tx, input.actorAuthUserId, rows);
}

/** A Circle entering or leaving a Block changes only that Block's audience. */
export async function markCalendarAudiencesPendingForBlock(
  tx: postgres.TransactionSql,
  input: CalendarAudienceInvalidationInput & { blockId: string },
): Promise<void> {
  const rows = await tx<Array<{ experience_id: string }>>`
    select distinct experience.id as experience_id
    from experiences experience
    join experience_calendar_links calendar_link
      on calendar_link.experience_id = experience.id
     and calendar_link.provider = 'google'
     and calendar_link.status <> 'cancelled'
    where experience.status = 'published'
      and experience.visibility = 'block'
      and experience.block_id = ${input.blockId}::uuid
    order by experience.id
  `;

  await markExperienceRowsPending(tx, input.actorAuthUserId, rows);
}

/**
 * Eligibility or verified-identity changes can affect every audience the member
 * currently belongs to, plus public/invite-only Experiences they registered for.
 */
export async function markCalendarAudiencesPendingForMember(
  tx: postgres.TransactionSql,
  input: CalendarAudienceInvalidationInput & { memberId: string },
): Promise<void> {
  const rows = await tx<Array<{ experience_id: string }>>`
    select distinct experience.id as experience_id
    from experiences experience
    join experience_calendar_links calendar_link
      on calendar_link.experience_id = experience.id
     and calendar_link.provider = 'google'
     and calendar_link.status <> 'cancelled'
    join ruined_members member on member.id = ${input.memberId}::uuid
    left join circle_member_assignments circle_assignment
      on circle_assignment.member_id = member.id
     and circle_assignment.ended_at is null
    left join block_circle_assignments block_assignment
      on block_assignment.circle_id = circle_assignment.circle_id
     and block_assignment.ended_at is null
    left join experience_registrations registration
      on registration.experience_id = experience.id
     and registration.person_id = member.person_id
     and registration.status = 'registered'
    where experience.status = 'published'
      and (
        experience.visibility = 'all_members'
        or (
          experience.visibility = 'circle'
          and experience.circle_id = circle_assignment.circle_id
        )
        or (
          experience.visibility = 'block'
          and experience.block_id = block_assignment.block_id
        )
        or (
          experience.visibility in ('public', 'invite_only')
          and registration.id is not null
        )
      )
    order by experience.id
  `;

  await markExperienceRowsPending(tx, input.actorAuthUserId, rows);
}
