import "server-only";

import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import type { MemberRegistrationSnapshot, OpsMemberRegistration, OpsRegistrationInvitation, RegistrationFoundingPricing, RegistrationInitialPayment } from "./registration-model";
import type { OperatorRegistrationProgress } from "./operator-registration-progress";
import { memberRegistrationDestination } from "./registration-routing";

export class MemberRegistrationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MemberRegistrationError";
  }
}

type RegistrationRow = {
  member_id: string; registered_at: Date | string | null; profile_activated_at: Date | string | null;
  founding_pricing: RegistrationFoundingPricing | null;
  requires_initial_payment: boolean;
  completion_basis: MemberRegistrationSnapshot["completionBasis"];
  initial_payment?: RegistrationInitialPayment | null;
  complimentary: boolean; profile_complete: boolean; ready: boolean; version: number | string;
};
const iso = (date: Date | string | null) => date ? new Date(date).toISOString() : null;
const snapshot = (row: RegistrationRow): MemberRegistrationSnapshot => ({
  memberId: row.member_id, state: row.profile_activated_at ? "activated" : row.registered_at ? "registered" : "collecting",
  foundingPricing: row.founding_pricing ?? null,
  registeredAt: iso(row.registered_at), profileActivatedAt: iso(row.profile_activated_at),
  requiresPaymentMethod: !row.complimentary && !row.requires_initial_payment,
  requiresInitialPayment: !row.complimentary && row.requires_initial_payment,
  completionBasis: row.completion_basis, initialPayment: row.initial_payment ?? null,
  profileComplete: row.profile_complete, ready: row.ready, version: Number(row.version),
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validId(id: string) { if (!UUID.test(id)) throw new MemberRegistrationError(400, "Choose a valid member."); }

/** Call only in the branch that INSERTs a new member. Never backfill returning accounts. */
export async function enrollNewMemberRegistration(tx: TransactionSql, memberId: string): Promise<void> {
  const configuration = getPlatformConfiguration();
  if (!configuration.membershipRegistrationOnly) return;
  const configuredAccount = process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() || "";
  const keyMode = process.env.STRIPE_SECRET_KEY?.trim().match(/^(?:sk|rk)_(test|live)_/)?.[1];
  const accountId = keyMode && /^acct_[A-Za-z0-9]+$/.test(configuredAccount) ? configuredAccount : null;
  await tx`insert into member_registration_access(member_id,payment_setup_account_id,payment_setup_livemode,requires_initial_payment)
    values(${memberId}::uuid,${accountId},${accountId ? keyMode === "live" : null},${configuration.membershipPrepaymentRequired}) on conflict(member_id) do nothing`;
}

async function ownerMemberId(tx: TransactionSql, authUserId: string, allowRestricted = false): Promise<string> {
  validId(authUserId);
  const [row] = await tx<Array<{ id: string }>>`select member.id from platform_users identity
    join ruined_members member on member.person_id=identity.person_id and member.deleted_at is null
      and (identity.member_id is null or identity.member_id=member.id)
    join people person on person.id=member.person_id and person.status='active'
    join member_lifecycle lifecycle on lifecycle.member_id=member.id and (${allowRestricted} or lifecycle.account_state not in ('closed','suspended'))
    join platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
    where identity.auth_user_id=${authUserId}::uuid and identity.status='active' limit 1`;
  if (!row) throw new MemberRegistrationError(403, "Registration is unavailable for this account.");
  return row.id;
}

async function readRegistration(tx: TransactionSql, memberId: string): Promise<MemberRegistrationSnapshot | null> {
  const [row] = await tx<Array<RegistrationRow>>`select registration.*,
    (select jsonb_build_object('amountPaid',proof.amount_paid,'installmentDues',proof.dues_amount,
      'currency',proof.currency,'plan',reservation.billing_plan,'offerId',reservation.tier || '_' || reservation.billing_plan,
      'billingSchedule',reservation.billing_schedule,'paidAt',invoice.paid_at,'isPayer',proof.member_id=registration.member_id)
      from stripe_membership_prepaid_proofs proof
      join membership_commercial_reservations reservation on reservation.id=proof.reservation_id
      join stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
      where proof.reservation_id=private.ruined_registration_paid_reservation(registration.member_id)) as initial_payment,
    case when private.ruined_registration_founding_pricing_is_current(registration.member_id) then jsonb_build_object(
      'confirmed',true,'awardedAt',pricing.decided_at,'monthlyAmountCents',pricing.monthly_amount_cents,
      'annualAmountCents',pricing.annual_amount_cents,'currency',pricing.currency) end as founding_pricing,
    (private.ruined_member_has_complimentary_funding(registration.member_id) or private.ruined_member_has_operator_funding(registration.member_id)) as complimentary,
    (onboarding.profile_completed_at is not null and private.ruined_registration_legal_complete(registration.member_id)
      and (registration.profile_activated_at is not null
      or private.ruined_registration_intake_eligibility_error(profile.birth_date,
        profile.default_fulfillment_address->>'countryCode') is null)) as profile_complete,
    private.ruined_member_registration_ready(registration.member_id) as ready
    from member_registration_access registration
    join ruined_members member on member.id=registration.member_id
    left join member_registration_pricing_decisions pricing on pricing.member_id=registration.member_id
    left join person_private_profiles profile on profile.person_id=member.person_id
    left join member_onboardings onboarding on onboarding.member_id=registration.member_id
    where registration.member_id=${memberId}::uuid`;
  return row ? snapshot(row) : null;
}

/** Reads do not advance registration or queue messages. */
export async function getMemberRegistration(authUserId: string): Promise<MemberRegistrationSnapshot | null> {
  return getApplicationDatabase().begin(async tx => readRegistration(tx, await ownerMemberId(tx, authUserId, true)));
}

export async function getMemberRegistrationDestination(authUserId: string): Promise<string | null> {
  const registration = await getMemberRegistration(authUserId);
  const configuration = getPlatformConfiguration();
  return memberRegistrationDestination(registration, configuration.stripeActivationReady || configuration.stripeCheckoutReady);
}

/** Caller holds funding and member locks, in that order. No billing state changes. */
export async function reconcileMemberRegistration(tx: TransactionSql, memberId: string): Promise<void> {
  // Operator-created complimentary entries can precede payment setup configuration.
  // Bind a previously unset context once, never replace an established mode/account.
  const accountId = process.env.STRIPE_PAYMENT_SETUP_ACCOUNT_ID?.trim() || null;
  const keyMode = process.env.STRIPE_SECRET_KEY?.trim().match(/^(?:sk|rk)_(test|live)_/)?.[1];
  if (accountId && keyMode && (getPlatformConfiguration().stripePaymentSetupReady || getPlatformConfiguration().stripeActivationReady)) {
    await tx`update member_registration_access set payment_setup_account_id=${accountId},payment_setup_livemode=${keyMode === "live"}
      where member_id=${memberId}::uuid and registered_at is null and payment_setup_account_id is null and payment_setup_livemode is null`;
  }
  const [completed] = await tx<Array<{ member_id: string }>>`update member_registration_access registration
    set registered_at=clock_timestamp(),
      completion_basis=case when private.ruined_member_has_complimentary_funding(registration.member_id)
        or private.ruined_member_has_operator_funding(registration.member_id) then 'complimentary'
        when private.ruined_member_paid_reservation(registration.member_id) is not null then 'paid_membership' else 'saved_card' end,
      payment_reservation_id=case when not (private.ruined_member_has_complimentary_funding(registration.member_id)
        or private.ruined_member_has_operator_funding(registration.member_id)) then private.ruined_registration_paid_reservation(registration.member_id) end,
      payment_setup_attempt_id=(select consent_attempt_id from member_payment_method_accounts account
        where account.member_id=registration.member_id and account.stripe_account_id=registration.payment_setup_account_id
          and account.livemode=registration.payment_setup_livemode),
      version=version+1,updated_at=clock_timestamp()
    where member_id=${memberId}::uuid and registered_at is null and private.ruined_member_registration_ready(member_id)
      and (not registration.requires_initial_payment or private.ruined_member_has_complimentary_funding(member_id)
        or private.ruined_member_has_operator_funding(member_id)
        or (registration.payment_setup_account_id=${accountId} and registration.payment_setup_livemode=${keyMode === "live"}))
    returning member_id`;
  // The database trigger pins new completions before this point. Reconcile an
  // existing historical completion idempotently without queuing another welcome.
  await tx`select private.ruined_confirm_registration_pricing(${memberId}::uuid)`;
  if (completed) await tx`insert into member_registration_messages(member_id,kind) values(${memberId}::uuid,'welcome')
    on conflict(member_id,kind) do nothing`;
}

async function lockRegistrationMember(tx: TransactionSql, memberId: string) {
  await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`;
  await tx`select id from ruined_members where id=${memberId}::uuid for update`;
}

export async function completeMemberRegistration(authUserId: string): Promise<MemberRegistrationSnapshot | null> {
  try {
    return await getApplicationDatabase().begin(async tx => {
      const memberId = await ownerMemberId(tx, authUserId);
      await lockRegistrationMember(tx, memberId);
      await ownerMemberId(tx, authUserId);
      await reconcileMemberRegistration(tx, memberId);
      return readRegistration(tx, memberId);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P4205") {
      throw new MemberRegistrationError(409, "A Founding place is being confirmed in another checkout. Please try again shortly.");
    }
    throw error;
  }
}

async function requireAdministrator(tx: TransactionSql, actor: string) {
  validId(actor);
  const [authorized] = await tx`select identity.auth_user_id from platform_users identity
    join platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id
      and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
    where identity.auth_user_id=${actor}::uuid and identity.status='active' for share of identity,grant_row`;
  if (!authorized) throw new MemberRegistrationError(403, "Operations administrator access is required.");
}

export async function getOpsMemberRegistration(actor: string, memberId: string) {
  validId(memberId);
  return getApplicationDatabase().begin(async tx => { await requireAdministrator(tx, actor); return readRegistration(tx, memberId); });
}

/** Admin-only, current progress for a bounded, already selected roster. No writes. */
export async function readOperatorRegistrationProgress(tx: TransactionSql, actor: string, memberIds: string[]): Promise<Map<string, OperatorRegistrationProgress>> {
  validId(actor);
  const [authorized] = await tx`select identity.auth_user_id from platform_users identity
    join platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id
      and grant_row.role_slug='ops_admin' and grant_row.revoked_at is null
    where identity.auth_user_id=${actor}::uuid and identity.status='active'`;
  if (!authorized) throw new MemberRegistrationError(403, "Operations administrator access is required.");
  return readMemberRegistrationProgress(tx, memberIds);
}

/** Trusted server workers only. Public/operator callers must pass through the administrator wrapper. */
export async function readMemberRegistrationProgress(tx: TransactionSql, memberIds: string[]): Promise<Map<string, OperatorRegistrationProgress>> {
  if (!memberIds.length) return new Map();
  if (memberIds.length > 200) throw new MemberRegistrationError(400, "Choose up to 200 members.");
  memberIds.forEach(validId);
  const configuration = getPlatformConfiguration();
  const paidCheckoutAvailable = configuration.stripeActivationReady || configuration.stripeCheckoutReady;
  const rows = await tx<Array<RegistrationRow & { email_verified: boolean; card_saved: boolean; card_removed: boolean;
    payment_confirmed: boolean; payment_needs_review: boolean; billing_arranged: boolean; checkout_started: boolean; billing_state: string; service_starts_at: Date | string | null;
    email_verified_at: Date | string | null; information_collected_at: Date | string | null; payment_information_collected_at: Date | string | null;
    payment_received_at: Date | string | null; profile_granted: boolean; payment_by_partner: boolean; historical_payment_recorded: boolean }>>`
    select registration.*,member.id as member_id,
      private.ruined_member_profile_released(member.id) as profile_granted,
      (select max(address.verified_at) from person_email_addresses address where address.person_id=member.person_id
        and address.email_normalized=member.email_normalized and address.verification_state='verified' and address.retired_at is null) as email_verified_at,
      greatest(onboarding.profile_completed_at, (select min(consent.accepted_at) from member_consents consent
        where registration.legal_acknowledgment_required and consent.member_id=member.id and consent.consent_type='privacy'
          and consent.decision='accepted' and consent.source='member' and consent.actor_auth_user_id is not null
          and consent.evidence->>'context'='registration_documents_v1'
          and consent.evidence->>'affirmativeAction'='checkbox_and_submit'
          and consent.evidence->'membershipTerms'->>'key'='ruined_registration'
          and consent.evidence->'membershipTerms'->>'sha256' ~ '^[0-9a-f]{64}$'
          and consent.evidence->>'registrationTermsAccepted'='true'
          and consent.evidence->>'paidAgreementAccepted'='false' and consent.evidence->>'chargeAuthorized'='false')) as information_collected_at,
      method.saved_at as payment_information_collected_at, paid_invoice.paid_at as payment_received_at,
      (private.ruined_member_has_complimentary_funding(member.id) or private.ruined_member_has_operator_funding(member.id)) as complimentary,
      (onboarding.profile_completed_at is not null and private.ruined_registration_legal_complete(member.id)
        and (registration.member_id is null or registration.profile_activated_at is not null or private.ruined_registration_intake_eligibility_error(
          profile.birth_date,profile.default_fulfillment_address->>'countryCode') is null)) as profile_complete,
      private.ruined_member_registration_ready(member.id) as ready,
      exists(select 1 from person_email_addresses address where address.person_id=member.person_id
        and address.email_normalized=member.email_normalized and address.verification_state='verified' and address.retired_at is null) as email_verified,
      (method.stripe_payment_method_id is not null and method.saved_at is not null and method.consent_revoked_at is null
        and not method.cleanup_pending and setup.status='saved' and setup.consent_revoked_at is null
        and not exists(select 1 from member_payment_method_detachments detached where detached.stripe_account_id=method.stripe_account_id
          and detached.livemode=method.livemode and detached.stripe_payment_method_id=method.stripe_payment_method_id)) as card_saved,
      (method.consent_revoked_at is not null or method.cleanup_pending or setup.consent_revoked_at is not null
        or exists(select 1 from member_payment_method_detachments detached where detached.stripe_account_id=method.stripe_account_id
          and detached.livemode=method.livemode and detached.stripe_payment_method_id=method.stripe_payment_method_id)) as card_removed,
      paid.reservation_id is not null as payment_confirmed,paid.service_starts_at,
      (paid.reservation_id is null and exists(select 1 from membership_commercial_participants participant
        join membership_commercial_reservations reservation on reservation.id=participant.reservation_id
        join stripe_membership_prepaid_proofs proof on proof.reservation_id=reservation.id
        where participant.member_id=member.id and participant.person_id=member.person_id)) as payment_needs_review,
      exists(select 1 from membership_commercial_participants participant
        join membership_commercial_reservations reservation on reservation.id=participant.reservation_id
          and reservation.kind='couple' and reservation.status in ('reserved','activated')
        join membership_commercial_participants payer on payer.reservation_id=reservation.id and payer.member_id=reservation.payer_member_id
        join ruined_members payer_member on payer_member.id=payer.member_id and payer_member.person_id=payer.person_id
        where participant.member_id=member.id and participant.person_id=member.person_id and reservation.payer_member_id<>member.id
          and payer.member_id=private.ruined_commercial_circle_couple_partner(member.id)) as payment_by_partner,
      exists(select 1 from stripe_invoices invoice
        join stripe_subscriptions subscription on subscription.id=invoice.stripe_subscription_id
          and subscription.member_id=member.id and subscription.stripe_customer_id=invoice.stripe_customer_id
        where invoice.member_id=member.id and invoice.purpose='membership' and invoice.stripe_status='paid'
          and invoice.amount_paid>0 and invoice.paid_at is not null
          and not exists(select 1 from stripe_membership_prepaid_proofs proof where proof.stripe_invoice_id=invoice.id)
          and exists(select 1 from stripe_webhook_events event where event.object_id=invoice.id
            and event.event_type='invoice.paid' and event.status='processed'
            and event.livemode=coalesce(registration.payment_setup_livemode,${process.env.STRIPE_SECRET_KEY?.trim().match(/^(?:sk|rk)_(test|live)_/)?.[1] === "live"}))) as historical_payment_recorded,
      exists(select 1 from membership_commercial_participants participant
        join membership_commercial_reservations reservation on reservation.id=participant.reservation_id and reservation.status='reserved'
        join stripe_checkout_attempts attempt on attempt.commercial_reservation_id=reservation.id and attempt.status in ('creating','open','completed')
        where participant.member_id=member.id and participant.person_id=member.person_id) as checkout_started,
      exists(select 1 from membership_commercial_participants participant
        join membership_commercial_reservations reservation on reservation.id=participant.reservation_id and reservation.status in ('reserved','activated')
        join stripe_membership_commitments commitment on commitment.checkout_attempt_id=reservation.id and commitment.status='active'
        join stripe_subscriptions subscription on subscription.id=commitment.stripe_subscription_id and subscription.stripe_status in ('active','trialing')
        where participant.member_id=member.id and participant.person_id=member.person_id
          and (subscription.cancel_at is null or subscription.cancel_at>statement_timestamp())) as billing_arranged,
      coalesce(private.ruined_member_shared_billing_state(member.id),lifecycle.billing_state) as billing_state
    from ruined_members member
    left join member_registration_access registration on registration.member_id=member.id
    join member_lifecycle lifecycle on lifecycle.member_id=member.id
    left join member_onboardings onboarding on onboarding.member_id=member.id
    left join person_private_profiles profile on profile.person_id=member.person_id
    left join member_payment_method_accounts method on method.member_id=member.id
      and method.stripe_account_id=registration.payment_setup_account_id and method.livemode=registration.payment_setup_livemode
    left join member_payment_method_setup_attempts setup on setup.id=method.consent_attempt_id and setup.member_id=method.member_id
      and setup.stripe_account_id=method.stripe_account_id and setup.livemode=method.livemode
    left join stripe_membership_prepaid_proofs paid on paid.reservation_id=private.ruined_member_paid_reservation(member.id)
    left join stripe_invoices paid_invoice on paid_invoice.id=paid.stripe_invoice_id
    where member.id=any(${memberIds}::uuid[]) and member.deleted_at is null`;
  return new Map(rows.map(row => [row.member_id, {
    state: row.profile_granted ? "activated" : row.registered_at ? "registered" : "collecting",
    registeredAt: iso(row.registered_at), profileComplete: row.profile_complete, ready: row.ready,
    requiresInitialPayment: !row.complimentary && Boolean(row.requires_initial_payment),
    requiresPaymentMethod: !row.complimentary && !row.requires_initial_payment, completionBasis: row.completion_basis,
    emailVerified: row.email_verified, paymentMethodState: row.card_saved ? "saved" : row.card_removed ? "removed" : "missing",
    paymentConfirmed: row.payment_confirmed, paidCheckoutAvailable, paymentNeedsReview: row.payment_needs_review, billingArranged: row.billing_arranged, checkoutStarted: row.checkout_started, billingState: row.billing_state,
    serviceStartsAt: iso(row.service_starts_at),
    emailVerifiedAt: row.email_verified ? iso(row.email_verified_at) : null,
    informationCollectedAt: row.profile_complete ? iso(row.information_collected_at) : null,
    paymentInformationCollectedAt: row.card_saved ? iso(row.payment_information_collected_at) : row.payment_confirmed ? iso(row.payment_received_at) : null,
    paymentReceivedAt: row.payment_confirmed ? iso(row.payment_received_at) : null,
    profileGranted: row.profile_granted, profileGrantedAt: iso(row.profile_activated_at), paymentExempt: row.complimentary,
    paymentByPartner: row.payment_by_partner, historicalPaymentRecorded: row.historical_payment_recorded,
  }]));
}

export async function getOpsMemberRegistrationProgress(actor: string, memberId: string): Promise<OperatorRegistrationProgress | null> {
  return getApplicationDatabase().begin(async tx => (await readOperatorRegistrationProgress(tx, actor, [memberId])).get(memberId) ?? null);
}

export async function getOpsMemberRegistrations(actor: string): Promise<OpsMemberRegistration[]> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdministrator(tx, actor);
    const rows = await tx<Array<RegistrationRow & { display_name: string; email: string; welcome_status: string | null; profile_ready_status: string | null;
      couple_partner_email: string | null; couple_partner_member_id: string | null; invitation: OpsRegistrationInvitation | null }>>`
      select registration.*,case when private.ruined_registration_founding_pricing_is_current(registration.member_id) then jsonb_build_object(
      'confirmed',true,'awardedAt',pricing.decided_at,'monthlyAmountCents',pricing.monthly_amount_cents,
      'annualAmountCents',pricing.annual_amount_cents,'currency',pricing.currency) end as founding_pricing,
        coalesce(nullif(profile.legal_name,''),nullif(public_profile.display_name,''),member.email) as display_name,member.email,
        (private.ruined_member_has_complimentary_funding(member.id) or private.ruined_member_has_operator_funding(member.id)) as complimentary,
        (onboarding.profile_completed_at is not null and private.ruined_registration_legal_complete(registration.member_id)
      and (registration.profile_activated_at is not null
          or private.ruined_registration_intake_eligibility_error(profile.birth_date,
            profile.default_fulfillment_address->>'countryCode') is null)) as profile_complete,
        private.ruined_member_registration_ready(member.id) as ready,
        welcome.status as welcome_status,ready_message.status as profile_ready_status,
        couple.partner_email_normalized as couple_partner_email,
        private.ruined_registration_circle_couple_partner(member.id) as couple_partner_member_id,
        invitation.details as invitation
      from member_registration_access registration join ruined_members member on member.id=registration.member_id and member.deleted_at is null
      left join member_registration_pricing_decisions pricing on pricing.member_id=registration.member_id
      join member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
      left join member_onboardings onboarding on onboarding.member_id=member.id
      left join person_private_profiles profile on profile.person_id=member.person_id
      left join person_profiles public_profile on public_profile.person_id=member.person_id
      left join member_registration_messages welcome on welcome.member_id=member.id and welcome.kind='welcome'
      left join member_registration_messages ready_message on ready_message.member_id=member.id and ready_message.kind='profile_ready'
      left join member_registration_couple_intents couple on couple.member_id=member.id
      left join lateral (
        select jsonb_build_object(
          'id',invite.id,'recipientName',invite.recipient_name,'recipientEmail',invite.recipient_email_normalized,
          'inviterName',invite.inviter_name,'issuedAt',invite.issued_at,'expiresAt',invite.expires_at,
          'revokedAt',invite.revoked_at,'submittedAt',invite.submitted_at,'acceptedAt',invite.accepted_at,
          'emailRequested',invite.email_requested,'deliveryStatus',invite.delivery_status,'sentAt',invite.sent_at,
          'origin',invite.origin,'membershipType',invite.membership_type) as details
        from member_personal_invitations invite
        left join member_referrals referral on referral.personal_invitation_id=invite.id
        where invite.accepted_member_id=member.id
          or (invite.accepted_member_id is null and invite.accepted_at is null
            and (referral.referred_member_id is null or referral.referred_member_id=member.id)
            and (referral.referred_member_id=member.id
              or invite.recipient_email_normalized=lower(btrim(member.email))))
        -- A verified association outranks a later invitation to the same mailbox.
        -- Otherwise prefer a usable invitation, then the most recently issued.
        order by case when invite.accepted_member_id=member.id then 0
          when referral.referred_member_id=member.id then 1 else 2 end,
          (invite.revoked_at is null and (invite.expires_at is null or invite.expires_at>statement_timestamp())) desc,
          invite.issued_at desc,invite.id desc
        limit 1
      ) invitation on true
      order by registration.profile_activated_at nulls first,registration.created_at desc limit 200`;
    const progress = await readOperatorRegistrationProgress(tx, actor, rows.map(row => row.member_id));
    return rows.map(row => ({ ...snapshot(row), progress: progress.get(row.member_id), name: row.display_name, email: row.email,
      welcomeStatus: row.welcome_status, activationEmailStatus: row.profile_ready_status, invitation: row.invitation ?? null,
      coupleStatus: row.couple_partner_member_id ? "paired" : row.couple_partner_email ? "pending" : "none",
      couplePartnerEmail: row.couple_partner_email, couplePartnerMemberId: row.couple_partner_member_id }));
  });
}

export async function activateMemberRegistration(actor: string, memberId: string, expectedVersion: number): Promise<MemberRegistrationSnapshot> {
  validId(memberId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new MemberRegistrationError(400, "Reload this registration before activating it.");
  return getApplicationDatabase().begin(async tx => {
    await requireAdministrator(tx, actor);
    await lockRegistrationMember(tx, memberId);
    const before = await readRegistration(tx, memberId);
    if (!before) throw new MemberRegistrationError(404, "This member has no registration hold.");
    if (before.state === "activated") return before;
    if (before.version !== expectedVersion) throw new MemberRegistrationError(409, "This registration changed. Reload it before activating.");
    if (!before.registeredAt || !before.ready) throw new MemberRegistrationError(409, "Complete the personal information and required membership payment before activation.");
    await tx`update member_registration_access set profile_activated_at=clock_timestamp(),activated_by_auth_user_id=${actor}::uuid,
      version=version+1,updated_at=clock_timestamp() where member_id=${memberId}::uuid`;
    await tx`insert into member_registration_messages(member_id,kind) values(${memberId}::uuid,'profile_ready') on conflict(member_id,kind) do nothing`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,before_snapshot,after_snapshot,metadata,dedupe_key)
      values(${actor}::uuid,'member.profile_activated','member',${memberId},${tx.json(before)},
        '{"profileActivated":true,"billingChanged":false}'::jsonb,'{}'::jsonb,${`registration-activation:${memberId}`})`;
    return (await readRegistration(tx, memberId))!;
  });
}

/** Runs after provider projection commits, including replays. Acquiring funding
 * locks before member locks avoids inverting the commercial projection order.
 * This records completion and queues one welcome; it never grants profile access.
 */
export async function reconcilePaidMemberRegistrations(subscriptionId: string): Promise<void> {
  if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) return;
  await getApplicationDatabase().begin(async tx => {
    const participants = await tx<Array<{ member_id: string }>>`select participant.member_id
      from membership_commercial_participants participant
      join membership_commercial_reservations reservation on reservation.id=participant.reservation_id
      join member_registration_access registration on registration.member_id=participant.member_id
      where reservation.stripe_subscription_id=${subscriptionId}
      order by participant.member_id`;
    for (const participant of participants) await tx`select private.ruined_lock_member_complimentary_funding(${participant.member_id}::uuid)`;
    for (const participant of participants) await tx`select id from ruined_members where id=${participant.member_id}::uuid for update`;
    for (const participant of participants) await reconcileMemberRegistration(tx, participant.member_id);
  });
}
