import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";

/** Public legal text only. Acceptance receipts and member identities remain private. */
async function getMembershipAgreement(version: string, includeRetired: boolean) {
  const match = /^ruined_membership-v([1-9]\d{0,8})$/.exec(version);
  if (!match || !process.env.DATABASE_URL?.trim()) return null;
  const rows = await getApplicationDatabase()<Array<{ title: string; body_text: string; version: number }>>`
    select title, body_text, version
    from membership_agreement_versions
    where agreement_key = 'ruined_membership'
      and version = ${Number(match[1])}
      and (status = 'published' or (${includeRetired} and status = 'retired'))
      and published_at is not null and published_at <= statement_timestamp()
      and (effective_at is null or effective_at <= statement_timestamp())
    limit 1
  `;
  const agreement = rows[0];
  return agreement ? { title: agreement.title, body: agreement.body_text, version: agreement.version } : null;
}

/** Checkout must use the effective version that is still published for acceptance. */
export const getPublishedMembershipAgreement = (version: string) => getMembershipAgreement(version, false);

/** A versioned terms link remains readable after a replacement is published. */
export const getPublicMembershipAgreement = (version: string) => getMembershipAgreement(version, true);
