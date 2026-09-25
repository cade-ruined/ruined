import "server-only";

import { randomBytes } from "node:crypto";
import { getApplicationDatabase } from "@/lib/database/server";
import { MemberInvitationError } from "./invitation-model";
import { PERSONAL_INVITATION_UUID } from "./personal-invitation-model";
import { isMembershipBillingPlan, type MembershipBillingPlan } from "./pricing";

export type RuinedDirectInvitationInput = {
  requestId: string; recipientName: string; recipientEmail: string; billingPlan: MembershipBillingPlan;
};
export type RuinedDirectInvitationIssue = { invitationId: string; created: boolean };

type InvitationRow = { id: string; recipient_name: string; recipient_email_normalized: string; billing_plan: MembershipBillingPlan };

function parseInput(value: unknown): RuinedDirectInvitationInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberInvitationError(400, "Add your name, email, and membership plan.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["requestId", "recipientName", "recipientEmail", "billingPlan"].includes(key))
    || typeof input.requestId !== "string" || !PERSONAL_INVITATION_UUID.test(input.requestId)
    || typeof input.recipientName !== "string" || typeof input.recipientEmail !== "string"
    || /[\u0000-\u001f\u007f]/u.test(input.recipientName + input.recipientEmail)
    || !isMembershipBillingPlan(input.billingPlan)) throw new MemberInvitationError(400, "Check your name, email, and membership plan.");
  const recipientName = input.recipientName.trim().replace(/\s+/gu, " ");
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (!recipientName || Array.from(recipientName).length > 100 || recipientEmail.length > 254
    || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipientEmail)) throw new MemberInvitationError(400, "Check your name and email.");
  return { requestId: input.requestId.toLowerCase(), recipientName, recipientEmail, billingPlan: input.billingPlan };
}

/** Called only after the launch/readiness and public signup rate-limit gates.
 * The public response must never include the token, recipient identity or eligibility.
 */
export async function issueRuinedDirectInvitation(value: RuinedDirectInvitationInput): Promise<RuinedDirectInvitationIssue | null> {
  const input = parseInput(value);
  return getApplicationDatabase().begin(async tx => {
    // Serialize request collisions first, then duplicate recipients. Namespace 2
    // is separate from admission's email lock (1): claim locks invitation first.
    await tx`select pg_advisory_xact_lock(hashtext(${input.requestId}), 3)`;
    await tx`select pg_advisory_xact_lock(hashtext(${input.recipientEmail}), 2)`;
    const [eligible] = await tx<Array<{ eligible: boolean }>>`select private.ruined_direct_invitation_recipient_eligible(${input.recipientEmail}) as eligible`;
    if (!eligible?.eligible) return null;
    const [existing] = await tx<InvitationRow[]>`select id,recipient_name,recipient_email_normalized,billing_plan
      from member_personal_invitations where origin = 'ruined_direct' and request_id = ${input.requestId}::uuid`;
    if (existing) {
      if (existing.recipient_name !== input.recipientName || existing.recipient_email_normalized !== input.recipientEmail
        || existing.billing_plan !== input.billingPlan) throw new MemberInvitationError(409, "This request already created an invitation. Start a new request.");
      return { invitationId: existing.id, created: false };
    }
    const [current] = await tx<InvitationRow[]>`select id,recipient_name,recipient_email_normalized,billing_plan
      from member_personal_invitations where origin = 'ruined_direct' and recipient_email_normalized = ${input.recipientEmail}
        and (accepted_at is not null or (revoked_at is null and expires_at > clock_timestamp()))
      order by accepted_at desc nulls last, issued_at desc, id desc limit 1`;
    // A retry or new tab keeps the original recipient, plan, queue and deadline.
    if (current) return { invitationId: current.id, created: false };
    // Existing members sign in; a fresh acquisition invitation must not turn
    // their next lifecycle update into a newly attributed direct joining.
    const [priorJoining] = await tx<Array<{ joined: boolean }>>`select exists (
      select 1 from ruined_members member join member_lifecycle lifecycle on lifecycle.member_id = member.id
      left join member_onboardings onboarding on onboarding.member_id = member.id
      where (member.email_normalized = ${input.recipientEmail} or member.person_id in (
        select person_id from person_email_addresses where email_normalized = ${input.recipientEmail} and retired_at is null))
        and (lifecycle.access_started_at is not null or (lifecycle.billing_state = 'active' and onboarding.state = 'completed'))
    ) as joined`;
    if (priorJoining?.joined) return null;
    const [created] = await tx<Array<{ id: string }>>`insert into member_personal_invitations(
      member_id,origin,request_id,public_token,recipient_name,recipient_email_normalized,inviter_name,inviter_tag,
      email_requested,delivery_status,next_attempt_at,membership_type,billing_plan)
      values(null,'ruined_direct',${input.requestId}::uuid,${randomBytes(32).toString("base64url")},${input.recipientName},${input.recipientEmail},
        'Ruined',null,true,'queued',statement_timestamp(),'standard',${input.billingPlan}) returning id`;
    if (!created) throw new MemberInvitationError(503, "Your invitation could not be prepared. Please try again.");
    return { invitationId: created.id, created: true };
  });
}
