import "server-only";

import type { TransactionSql } from "postgres";
import { markCalendarAudiencesPendingForMember } from "@/lib/platform/calendar-audience-invalidation";

/** Uses existing registration evidence. Never accepts an agreement, starts
 * billing, records attendance, or completes a member's Foundations work. */
export async function reconcileComplimentaryRegistrationOnboarding(
  tx: TransactionSql,
  memberId: string,
  actorAuthUserId?: string,
): Promise<boolean> {
  const [result] = await tx<Array<{ reconciled: boolean }>>`
    select private.ruined_reconcile_complimentary_onboarding(
      ${memberId}::uuid, ${actorAuthUserId ?? null}::uuid
    ) as reconciled
  `;
  if (result?.reconciled) {
    await markCalendarAudiencesPendingForMember(tx, { memberId, actorAuthUserId });
  }
  return result?.reconciled === true;
}
