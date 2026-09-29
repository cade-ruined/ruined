import "server-only";

import { getBillingDatabase } from "@/lib/stripe/database";
import { getStripeLivemode } from "@/lib/stripe/server";
import type { MembershipCommitment } from "@/lib/stripe/commitment-policy";

/** The payer's durable accepted contract, never a browser-supplied subscription. */
export async function getMemberBillingCommitment(memberId: string): Promise<MembershipCommitment | null> {
  const sql = getBillingDatabase();
  const rows = await sql<Array<{ terms: MembershipCommitment }>>`
    select c.terms_snapshot as terms from stripe_membership_commitments c
    join stripe_subscriptions s on s.id = c.stripe_subscription_id and s.member_id = c.member_id
    where c.member_id = ${memberId}::uuid and c.livemode = ${getStripeLivemode()}
    order by c.created_at desc limit 1
  `;
  return rows[0]?.terms ?? null;
}
