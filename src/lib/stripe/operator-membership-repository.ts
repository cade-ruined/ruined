import "server-only";

import type { BillingTransaction } from "@/lib/stripe/billing-repository";
import { MembershipCheckoutConflictError } from "@/lib/stripe/billing-repository";
import { getBillingDatabase } from "@/lib/stripe/database";
import { getPaidMembershipAgreementVersion } from "@/lib/stripe/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { PlatformAccessDeniedError } from "@/lib/platform/repository";
import { isUuid } from "@/lib/stripe/membership-state";
import { OPERATOR_MEMBERSHIP_AUTHORITY_TEXT, OPERATOR_MEMBERSHIP_AUTHORITY_VERSION } from "@/lib/stripe/operator-membership-model";

export type OperatorCheckoutMember = {
  memberId: string; personId: string; name: string; email: string;
  actorName: string; actorEmail: string; eligible: boolean; reason: string | null; paid: boolean;
};
const ineligibleReason = "This member needs a verified, completed United States registration and must not already have funded or active membership billing.";

async function resolveMember(tx: BillingTransaction, authUserId: string, memberId: string): Promise<OperatorCheckoutMember> {
  const [actor] = await tx<Array<{ name: string; email: string }>>`
    select coalesce(nullif(btrim(private_profile.legal_name),''),nullif(btrim(profile.display_name),''),actor.email_normalized) as name,
      actor.email_normalized as email
    from platform_users actor
    join platform_role_grants role_grant on role_grant.auth_user_id=actor.auth_user_id
      and role_grant.role_slug='ops_admin' and role_grant.revoked_at is null
    left join person_private_profiles private_profile on private_profile.person_id=actor.person_id
    left join person_profiles profile on profile.person_id=actor.person_id
    where actor.auth_user_id=${authUserId}::uuid and actor.status='active'
    for share of actor,role_grant`;
  if (!actor) throw new PlatformAccessDeniedError();
  const [member] = await tx<Array<{ id: string; person_id: string; name: string; email: string; eligible: boolean; paid: boolean }>>`
    select member.id,member.person_id,coalesce(nullif(btrim(private_profile.legal_name),''),nullif(btrim(profile.display_name),''),member.email_normalized) as name,
      member.email_normalized as email,
      private.ruined_operator_membership_target_ready(member.id,${getPlatformConfiguration().minimumAge}) as eligible,
      (private.ruined_member_paid_reservation(member.id) is not null or exists(
        select 1 from stripe_checkout_attempts attempt
        join membership_commercial_reservations quote on quote.id=attempt.commercial_reservation_id
          and quote.payer_member_id=member.id and quote.status='activated' and quote.billing_schedule is null
        join stripe_membership_commitments commitment on commitment.checkout_attempt_id=attempt.id
          and commitment.member_id=member.id and commitment.agreement_acceptance_id=attempt.agreement_acceptance_id
          and commitment.status='active' and commitment.terms_snapshot->>'billingPlan'=attempt.billing_plan
        join stripe_checkout_sessions checkout on checkout.id=attempt.stripe_session_id
          and checkout.member_id=member.id and checkout.session_status='complete' and checkout.livemode=commitment.livemode
          and checkout.stripe_subscription_id=commitment.stripe_subscription_id
        join stripe_subscriptions subscription on subscription.id=commitment.stripe_subscription_id
          and subscription.member_id=member.id and subscription.stripe_status in ('active','trialing')
          and subscription.stripe_customer_id=commitment.stripe_customer_id and subscription.price_id=attempt.stripe_price_id
          and subscription.id=attempt.stripe_subscription_id and subscription.id=quote.stripe_subscription_id
          and (subscription.cancel_at is null or subscription.cancel_at>statement_timestamp())
        join stripe_invoices invoice on invoice.id=subscription.latest_invoice_id and invoice.stripe_subscription_id=subscription.id
          and invoice.member_id=member.id and invoice.stripe_status='paid' and invoice.purpose='membership'
          and invoice.stripe_customer_id=commitment.stripe_customer_id and invoice.currency='usd'
          and invoice.amount_paid>=invoice.amount_due and invoice.amount_due>0 and invoice.paid_at is not null
        left join stripe_membership_commitment_ledgers ledger on ledger.contract_id=commitment.id and ledger.revision=commitment.ledger_revision
        where attempt.member_id=member.id and attempt.status='completed' and attempt.recurring_payment_accepted_at is not null
          and exists(select 1 from stripe_webhook_events event where event.object_id=invoice.id
            and event.event_type='invoice.paid' and event.status='processed' and event.livemode=commitment.livemode)
          and (ledger.id is null or (ledger.state='complete' and not exists(
            select 1 from jsonb_array_elements(ledger.invoices) line where line->>'invoiceId'=invoice.id
              and (line->>'adjustmentState' is distinct from 'none' or coalesce((line->>'duesRefunded')::numeric,0)>0))))
      )) as paid
    from ruined_members member
    join people person on person.id=member.person_id and person.status='active'
    join member_lifecycle lifecycle on lifecycle.member_id=member.id
    left join person_private_profiles private_profile on private_profile.person_id=member.person_id
    left join person_profiles profile on profile.person_id=member.person_id
    where member.id=${memberId}::uuid and member.deleted_at is null and lifecycle.account_state='active'
      and exists(select 1 from platform_users owner where owner.member_id=member.id and owner.person_id=member.person_id and owner.status='active')`;
  if (!member) throw new MembershipCheckoutConflictError("operator_member_unavailable");
  return { memberId: member.id, personId: member.person_id, name: member.name, email: member.email,
    actorName: actor.name, actorEmail: actor.email, eligible: member.eligible, paid: member.paid,
    reason: member.eligible ? null : member.paid ? "This membership has already been paid." : ineligibleReason };
}

/** Read-only status uses the same real operator and beneficiary resolution as purchase. */
export async function getOperatorCheckoutMember(authUserId: string, memberId: string, options: { allowIneligible?: boolean } = {}): Promise<OperatorCheckoutMember> {
  if (!isUuid(authUserId) || !isUuid(memberId)) throw new PlatformAccessDeniedError();
  return await getBillingDatabase().begin(async tx => {
    const member = await resolveMember(tx, authUserId, memberId);
    if (!options.allowIneligible && !member.eligible) throw new MembershipCheckoutConflictError("operator_member_ineligible");
    return member;
  }) as OperatorCheckoutMember;
}

/** Record the administrator's affirmative action, never manufacture member authentication. */
export async function acceptOperatorMembershipAgreement(input: {
  authUserId: string; memberId: string; reservationId: string; authorityAccepted: unknown;
  authorityVersion: unknown; expectedAgreementVersion: string; expectedAgreementSha256: string; origin: string; userAgent?: string | null;
}): Promise<{ acceptanceId: string }> {
  if (!isUuid(input.authUserId) || !isUuid(input.memberId) || !isUuid(input.reservationId) ||
    input.authorityAccepted !== true || input.authorityVersion !== OPERATOR_MEMBERSHIP_AUTHORITY_VERSION) {
    throw new MembershipCheckoutConflictError("operator_authority_required");
  }
  const configuration = getPlatformConfiguration();
  const paidVersion = getPaidMembershipAgreementVersion();
  if (!paidVersion || !(configuration.stripeActivationReady || configuration.stripeCheckoutReady)) throw new MembershipCheckoutConflictError("membership_checkout_unavailable");
  return await getBillingDatabase().begin(async tx => {
    let member = await resolveMember(tx, input.authUserId, input.memberId);
    await tx`select pg_advisory_xact_lock(hashtext(${member.email}),0)`;
    await tx`select private.ruined_lock_member_complimentary_funding(${member.memberId}::uuid)`;
    await tx`select id from ruined_members where id=${member.memberId}::uuid for update`;
    member = await resolveMember(tx, input.authUserId, input.memberId);
    if (!member.eligible) throw new MembershipCheckoutConflictError("operator_member_ineligible");
    // Lock and validate the reviewed quote before an acceptance exists; the
    // stricter paid-agreement validator runs when Checkout is reserved.
    await tx`select private.ruined_validate_commercial_quote(${input.reservationId}::uuid)`;
    const [quote] = await tx<Array<{ id: string; billing_plan: "monthly" | "annual"; expires_at: Date }>>`
      select id,billing_plan,expires_at from membership_commercial_reservations
      where id=${input.reservationId}::uuid and payer_member_id=${member.memberId}::uuid
        and kind='individual' and status='reserved' and stripe_price_id is not null for share`;
    if (!quote) throw new MembershipCheckoutConflictError();
    const [otherAttempt] = await tx`select id from stripe_checkout_attempts
      where member_id=${member.memberId}::uuid and status in ('creating','open')
        and (id<>${input.reservationId}::uuid or billing_consent_auth_user_id is distinct from ${input.authUserId}::uuid
          or operator_authorization_id is distinct from ${input.reservationId}::uuid) limit 1`;
    if (otherAttempt) throw new MembershipCheckoutConflictError();
    const [agreement] = await tx<Array<{ id: string; agreement_key: string; version: number; title: string; body_text: string; content_sha256: string }>>`
      select id,agreement_key,version,title,body_text,content_sha256 from membership_agreement_versions
      where agreement_key='ruined_membership' and 'ruined_membership-v'||version::text=${paidVersion}
        and status='published' and (effective_at is null or effective_at<=statement_timestamp())
      for share`;
    if (!agreement || input.expectedAgreementVersion !== `ruined_membership-v${agreement.version}` ||
      input.expectedAgreementSha256 !== agreement.content_sha256) throw new MembershipCheckoutConflictError("membership_agreement_changed");
    const [previous] = await tx<Array<{ actor_auth_user_id: string; member_id: string; agreement_version_id: string; acceptance_id: string | null }>>`
      select delegation.actor_auth_user_id,delegation.member_id,delegation.agreement_version_id,acceptance.id as acceptance_id
      from operator_membership_authorizations delegation
      left join membership_agreement_acceptances acceptance on acceptance.operator_authorization_id=delegation.id
      where delegation.id=${quote.id}::uuid`;
    if (previous) {
      if (previous.actor_auth_user_id !== input.authUserId || previous.member_id !== member.memberId ||
        previous.agreement_version_id !== agreement.id || !previous.acceptance_id) throw new MembershipCheckoutConflictError();
      return { acceptanceId: previous.acceptance_id };
    }
    if (new Date(quote.expires_at).getTime() <= Date.now()) throw new MembershipCheckoutConflictError("membership_offer_expired");
    await tx`insert into operator_membership_authorizations(id,member_id,person_id,actor_auth_user_id,
      actor_name_snapshot,actor_email_snapshot,member_name_snapshot,member_email_snapshot,
      agreement_version_id,agreement_content_sha256,reservation_id,billing_plan,authority_version,authority_text,
      minimum_age,origin,user_agent)
      values(${quote.id}::uuid,${member.memberId}::uuid,${member.personId}::uuid,${input.authUserId}::uuid,
        ${member.actorName},${member.actorEmail},${member.name},${member.email},${agreement.id}::uuid,${agreement.content_sha256},
        ${quote.id}::uuid,${quote.billing_plan},${OPERATOR_MEMBERSHIP_AUTHORITY_VERSION},${OPERATOR_MEMBERSHIP_AUTHORITY_TEXT},
        ${configuration.minimumAge},${input.origin},${input.userAgent?.slice(0,500) ?? null})`;
    const [age] = await tx<Array<{ id: number }>>`insert into member_consents(member_id,consent_type,policy_version,
      decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
      values(${member.memberId}::uuid,'age_attestation',${`minimum-age-${configuration.minimumAge}`},'accepted',
        statement_timestamp(),'ops',${input.authUserId}::uuid,
        ${tx.json({ minimumAge: configuration.minimumAge, basis: "verified_registration_birth_date", operatorAuthorizationId: quote.id })}::jsonb,
        ${`operator-membership-age:${quote.id}`}) returning id`;
    const [acceptance] = await tx<Array<{ id: string }>>`insert into membership_agreement_acceptances(
      agreement_version_id,person_id,member_id,accepted_by_auth_user_id,age_attestation_id,signer_name_snapshot,
      signer_email_snapshot,affirmative_action,acceptance_context,accepted_at,agreement_key_snapshot,agreement_version_snapshot,
      agreement_title_snapshot,agreement_content_sha256,agreement_body_snapshot,acceptance_evidence,dedupe_key,operator_authorization_id)
      values(${agreement.id}::uuid,${member.personId}::uuid,${member.memberId}::uuid,${input.authUserId}::uuid,${age.id},
        ${member.actorName},${member.actorEmail},'checkbox_and_submit','initial_membership',statement_timestamp(),
        ${agreement.agreement_key},${agreement.version},${agreement.title},${agreement.content_sha256},${agreement.body_text},
        ${tx.json({ channel: "ops_delegated_membership", operatorAuthorizationId: quote.id,
          beneficiaryName: member.name, beneficiaryEmail: member.email, authorityVersion: OPERATOR_MEMBERSHIP_AUTHORITY_VERSION,
          authorityText: OPERATOR_MEMBERSHIP_AUTHORITY_TEXT, origin: input.origin, userAgent: input.userAgent?.slice(0,500) ?? null })}::jsonb,
        ${`operator-membership-agreement:${quote.id}`},${quote.id}::uuid) returning id`;
    await tx`update member_onboardings set agreement_completed_at=coalesce(agreement_completed_at,statement_timestamp()),
      state=case when state='completed' then state else 'in_progress' end,
      started_at=coalesce(started_at,statement_timestamp()),version=version+1,updated_at=statement_timestamp()
      where member_id=${member.memberId}::uuid`;
    await tx`update member_lifecycle set administrative_onboarding_state=case when administrative_onboarding_state='completed'
      then administrative_onboarding_state else 'in_progress' end,version=version+1,updated_at=statement_timestamp()
      where member_id=${member.memberId}::uuid`;
    return { acceptanceId: acceptance.id };
  }) as { acceptanceId: string };
}
