import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import type { MembershipWaitlistSubmission } from "@/lib/membership/waitlist-model";

export async function consumeMembershipWaitlistRateLimit(fingerprintHash: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(fingerprintHash)) return false;
  const sql = getApplicationDatabase();
  const rows = await sql<Array<{ attempts: number }>>`
    with cleanup as (
      delete from membership_waitlist_rate_limits
      where window_started_at < now() - interval '48 hours'
    )
    insert into membership_waitlist_rate_limits (fingerprint_hash, window_started_at, attempts)
    values (${fingerprintHash}, date_trunc('hour', now()), 1)
    on conflict (fingerprint_hash, window_started_at) do update
    set attempts = membership_waitlist_rate_limits.attempts + 1
    where membership_waitlist_rate_limits.attempts < 8
    returning attempts
  `;
  return rows.length > 0;
}

export async function joinMembershipWaitlist(submission: MembershipWaitlistSubmission): Promise<void> {
  const sql = getApplicationDatabase();
  await sql.begin(async (tx) => {
    // Validate before checking the email, so existing and new submissions receive
    // the same expired/revoked response. The row lock also serializes renewal.
    if (submission.invitationToken) {
      await tx`select private.ruined_require_member_invitation(${submission.invitationToken}, ${submission.emailNormalized})`;
    }
    // Avoid consuming a spreadsheet row for routine retries. The unique email
    // constraint also handles simultaneous requests safely.
    const rows = await tx<Array<{ id: string }>>`
      insert into membership_waitlist (name, email_normalized, phone)
      select ${submission.name}, ${submission.emailNormalized}, ${submission.phone}
      where not exists (
        select 1 from membership_waitlist where email_normalized = ${submission.emailNormalized}
      )
      on conflict (email_normalized) do nothing
      returning id::text as id
    `;
    const entry = rows[0];
    // Knowing an email address never lets a public request replace its details.
    // The route returns the same response for both existing and new entries.
    if (!entry) {
      // The matching recipient may already be waiting. Record their response
      // without editing their details or replacing the first referral owner.
      if (submission.invitationToken) await tx`select private.ruined_mark_personal_invitation_submission(${submission.invitationToken}, ${submission.emailNormalized})`;
      return;
    }

    // Attribution belongs to the first actual submission. Repeated requests for
    // a known email cannot replace the inviter or manufacture another joining.
    if (submission.invitationToken) {
      await tx`select private.ruined_capture_member_referral(${entry.id}::uuid, ${submission.invitationToken})`;
    }

    await tx`
      insert into integration_outbox (destination, event_type, aggregate_type, aggregate_id, dedupe_key, payload)
      values (
        'google', 'membership_waitlist.sheet_sync_requested', 'membership_waitlist',
        ${entry.id}, ${`google:membership-waitlist:${entry.id}:created:v1`}, '{}'::jsonb
      )
      on conflict (dedupe_key) do nothing
    `;
  });
}
