import "server-only";

import { getApplicationDatabase } from "@/lib/database/server";
import { requireOpsAdmin } from "@/lib/platform/ops-repository";
import type { PersonalInvitationDeliveryStatus } from "@/lib/membership/personal-invitation-model";
import type { MembershipBillingPlan } from "@/lib/membership/pricing";

export type OpsDirectInvitation = {
  id: string; origin: "ruined_direct"; sourceLabel: "Ruined Direct";
  recipientName: string; recipientEmail: string; billingPlan: MembershipBillingPlan;
  issuedAt: string; expiresAt: string; sentAt: string | null; acceptedAt: string | null;
  joinedAt: string | null; revokedAt: string | null; acceptedMemberId: string | null;
  deliveryStatus: PersonalInvitationDeliveryStatus;
  status: "pending" | "sent" | "failed" | "accepted" | "joined" | "expired" | "revoked";
};
export type OpsDirectInvitationCounts = { created: number; pending: number; sent: number; failed: number; accepted: number; joined: number; expired: number; revoked: number };
export type OpsDirectInvitationPage = {
  entries: OpsDirectInvitation[]; query: string; page: number; pageCount: number; totalResults: number;
  counts: OpsDirectInvitationCounts;
};
type Row = {
  id: string; recipient_name: string; recipient_email_normalized: string; billing_plan: MembershipBillingPlan;
  issued_at: Date | string; expires_at: Date | string; sent_at: Date | string | null; accepted_at: Date | string | null;
  direct_joined_at: Date | string | null; revoked_at: Date | string | null; accepted_member_id: string | null;
  delivery_status: PersonalInvitationDeliveryStatus; expired: boolean;
};
const date = (value: Date | string) => new Date(value).toISOString();
const nullableDate = (value: Date | string | null) => value === null ? null : date(value);
function entry(row: Row): OpsDirectInvitation {
  return { id: row.id, origin: "ruined_direct", sourceLabel: "Ruined Direct", recipientName: row.recipient_name,
    recipientEmail: row.recipient_email_normalized, billingPlan: row.billing_plan, issuedAt: date(row.issued_at), expiresAt: date(row.expires_at),
    sentAt: nullableDate(row.sent_at), acceptedAt: nullableDate(row.accepted_at), joinedAt: nullableDate(row.direct_joined_at),
    revokedAt: nullableDate(row.revoked_at), acceptedMemberId: row.accepted_member_id, deliveryStatus: row.delivery_status,
    status: row.direct_joined_at ? "joined" : row.revoked_at ? "revoked" : row.accepted_at ? "accepted" : row.expired ? "expired"
      : row.delivery_status === "failed" ? "failed" : row.sent_at ? "sent" : "pending" };
}

/** Operator-private acquisition history. Member referrals remain separately attributed. */
export async function getOpsDirectInvitations(actorAuthUserId: string, input: { query?: string; page?: number } = {}): Promise<OpsDirectInvitationPage> {
  const query = (input.query ?? "").trim().slice(0, 120).toLowerCase();
  const requestedPage = Number.isSafeInteger(input.page) && (input.page ?? 0) > 0 ? input.page! : 1;
  return getApplicationDatabase().begin(async tx => {
    await requireOpsAdmin(tx, actorAuthUserId);
    const [counts] = await tx<OpsDirectInvitationCounts[]>`select count(*)::integer as created,
      count(*) filter(where accepted_at is null and revoked_at is null and expires_at > clock_timestamp())::integer as pending,
      count(*) filter(where sent_at is not null)::integer as sent,
      count(*) filter(where delivery_status = 'failed')::integer as failed,
      count(*) filter(where accepted_at is not null)::integer as accepted,
      count(*) filter(where direct_joined_at is not null)::integer as joined,
      count(*) filter(where accepted_at is null and revoked_at is null and expires_at <= clock_timestamp())::integer as expired,
      count(*) filter(where revoked_at is not null)::integer as revoked
      from member_personal_invitations where origin = 'ruined_direct'`;
    const [total] = await tx<Array<{ count: number }>>`select count(*)::integer as count from member_personal_invitations
      where origin = 'ruined_direct' and (${query} = '' or position(${query} in recipient_email_normalized) > 0
        or position(${query} in lower(recipient_name)) > 0)`;
    const totalResults = total?.count ?? 0, pageCount = Math.max(1, Math.ceil(totalResults / 25)), page = Math.min(requestedPage, pageCount);
    const rows = await tx<Row[]>`select id,recipient_name,recipient_email_normalized,billing_plan,issued_at,expires_at,sent_at,accepted_at,
      direct_joined_at,revoked_at,accepted_member_id,delivery_status,expires_at <= clock_timestamp() as expired
      from member_personal_invitations where origin = 'ruined_direct'
        and (${query} = '' or position(${query} in recipient_email_normalized) > 0 or position(${query} in lower(recipient_name)) > 0)
      order by issued_at desc,id desc limit 25 offset ${(page - 1) * 25}`;
    return { entries: rows.map(entry), query, page, pageCount, totalResults,
      counts: counts ?? { created: 0, pending: 0, sent: 0, failed: 0, accepted: 0, joined: 0, expired: 0, revoked: 0 } };
  });
}
