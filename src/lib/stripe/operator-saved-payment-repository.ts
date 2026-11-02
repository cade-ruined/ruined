import "server-only";

import { getBillingDatabase } from "./database";
import { MembershipCheckoutConflictError, type BillingTransaction, type MembershipCheckoutReservation } from "./billing-repository";
import { isUuid } from "./membership-state";

export type OperatorSavedPaymentTarget = {
  memberId: string; customerId: string; paymentMethodId: string; setupIntentId: string;
  stripeAccountId: string; livemode: boolean; email: string; memberName: string; actorName: string;
};
export type OperatorSavedPaymentBinding = {
  attemptId: string; memberId: string; actorAuthUserId: string; operatorAuthorizationId: string;
  customerId: string; paymentMethodId: string; setupIntentId: string; mandateId: string | null;
  stripeAccountId: string; livemode: boolean; providerRequestSha256: string; expectedTotal: number;
  automaticTaxEnabled: boolean; startedAt: Date | null; createdAt: Date; subscriptionId: string | null;
  status: "prepared" | "submitting" | "succeeded" | "failed" | "review"; errorCode: string | null;
};
type ActorInput = { authUserId: string; memberId: string; attemptId: string };
const conflict = () => new MembershipCheckoutConflictError("operator_saved_payment_mismatch");

async function requireActor(tx: BillingTransaction, input: { authUserId: string; memberId: string }) {
  if (!isUuid(input.authUserId) || !isUuid(input.memberId)) throw conflict();
  await tx`select private.ruined_require_operator_membership_actor(${input.authUserId}::uuid)`;
  const [member] = await tx`select id from ruined_members where id=${input.memberId}::uuid and deleted_at is null for update`;
  if (!member) throw conflict();
}

/** Read the existing member-owned storage record; never creates a customer or card. */
export async function getOperatorSavedPaymentTarget(input: { authUserId: string; memberId: string }): Promise<OperatorSavedPaymentTarget> {
  return await getBillingDatabase().begin(async tx => {
    await requireActor(tx, input);
    const [row] = await tx<Array<OperatorSavedPaymentTarget>>`
      select member.id as "memberId",account.stripe_customer_id as "customerId",account.stripe_payment_method_id as "paymentMethodId",
        setup.stripe_setup_intent_id as "setupIntentId",account.stripe_account_id as "stripeAccountId",account.livemode,
        member.email_normalized as email,profile.legal_name as "memberName",
        coalesce(nullif(btrim(actor_private.legal_name),''),nullif(btrim(actor_public.display_name),''),actor.email_normalized) as "actorName"
      from ruined_members member
      join person_private_profiles profile on profile.person_id=member.person_id
      join member_registration_access registration on registration.member_id=member.id
      join member_payment_method_accounts account on account.member_id=member.id
        and account.stripe_account_id=registration.payment_setup_account_id and account.livemode=registration.payment_setup_livemode
      join member_payment_method_setup_attempts setup on setup.id=account.consent_attempt_id
        and setup.member_id=member.id and setup.stripe_account_id=account.stripe_account_id and setup.livemode=account.livemode
      join platform_users actor on actor.auth_user_id=${input.authUserId}::uuid
      left join person_private_profiles actor_private on actor_private.person_id=actor.person_id
      left join person_profiles actor_public on actor_public.person_id=actor.person_id
      where member.id=${input.memberId}::uuid and private.ruined_operator_membership_target_ready(member.id,18)
        and account.stripe_customer_id is not null and account.stripe_payment_method_id is not null
        and account.saved_at is not null and account.consent_revoked_at is null and not account.cleanup_pending
        and setup.status='saved' and setup.consent_revoked_at is null and setup.stripe_setup_intent_id is not null
        and not exists(select 1 from member_payment_method_detachments detached
          where detached.stripe_account_id=account.stripe_account_id and detached.livemode=account.livemode
            and detached.stripe_payment_method_id=account.stripe_payment_method_id)
      for share of account,setup`;
    if (!row) throw new MembershipCheckoutConflictError("operator_saved_payment_unavailable");
    return row;
  }) as OperatorSavedPaymentTarget;
}

/** Internal transaction reader. Callers must authorize the actor or verify all provider identities. */
export async function readOperatorSavedPaymentBinding(tx: BillingTransaction, attemptId: string): Promise<OperatorSavedPaymentBinding | null> {
  if (!isUuid(attemptId)) return null;
  const [row] = await tx<Array<OperatorSavedPaymentBinding>>`
    select attempt_id as "attemptId",member_id as "memberId",actor_auth_user_id as "actorAuthUserId",
      operator_authorization_id as "operatorAuthorizationId",stripe_account_id as "stripeAccountId",livemode,
      stripe_customer_id as "customerId",stripe_payment_method_id as "paymentMethodId",stripe_setup_intent_id as "setupIntentId",
      stripe_mandate_id as "mandateId",provider_request_sha256 as "providerRequestSha256",expected_total::integer as "expectedTotal",
      automatic_tax_enabled as "automaticTaxEnabled",started_at as "startedAt",created_at as "createdAt",
      stripe_subscription_id as "subscriptionId",status,error_code as "errorCode"
    from operator_membership_saved_payments where attempt_id=${attemptId}::uuid for update`;
  return row ?? null;
}
async function actorBinding(tx: BillingTransaction, input: ActorInput) {
  await requireActor(tx, input);
  const binding = await readOperatorSavedPaymentBinding(tx,input.attemptId);
  if (!binding || binding.memberId !== input.memberId || binding.actorAuthUserId !== input.authUserId) throw conflict();
  return binding;
}
export async function getOperatorSavedPaymentBinding(input: Omit<ActorInput,"attemptId"> & {attemptId?:string}): Promise<OperatorSavedPaymentBinding | null> {
  return await getBillingDatabase().begin(async tx => {
    await requireActor(tx,input);
    const [latest] = input.attemptId ? [{attempt_id:input.attemptId}] : await tx<Array<{attempt_id:string}>>`
      select attempt_id from operator_membership_saved_payments where member_id=${input.memberId}::uuid
        and actor_auth_user_id=${input.authUserId}::uuid order by created_at desc limit 1`;
    const binding = latest ? await readOperatorSavedPaymentBinding(tx,latest.attempt_id) : null;
    if (binding && (binding.memberId !== input.memberId || binding.actorAuthUserId !== input.authUserId)) throw conflict();
    return binding;
  }) as OperatorSavedPaymentBinding | null;
}

export async function prepareOperatorSavedPaymentBinding(input: ActorInput & {
  customerId: string; paymentMethodId: string; setupIntentId: string; mandateId: string | null;
  stripeAccountId: string; livemode: boolean; providerRequestSha256: string; expectedTotal: number; automaticTaxEnabled: boolean;
}): Promise<OperatorSavedPaymentBinding> {
  if (!isUuid(input.attemptId) || !Number.isSafeInteger(input.expectedTotal) || input.expectedTotal <= 0 ||
    !/^[a-f0-9]{64}$/.test(input.providerRequestSha256)) throw conflict();
  return await getBillingDatabase().begin(async tx => {
    await requireActor(tx,input);
    const existing = await readOperatorSavedPaymentBinding(tx,input.attemptId);
    if (existing) {
      const keys = ["memberId","customerId","paymentMethodId","setupIntentId","mandateId","stripeAccountId","livemode","providerRequestSha256","expectedTotal","automaticTaxEnabled"] as const;
      if (existing.actorAuthUserId !== input.authUserId || keys.some(key => existing[key] !== input[key])) throw conflict();
      return existing;
    }
    const [attempt] = await tx`select attempt.id from stripe_checkout_attempts attempt
      join membership_commercial_reservations quote on quote.id=attempt.commercial_reservation_id
      where attempt.id=${input.attemptId}::uuid and attempt.member_id=${input.memberId}::uuid
        and attempt.billing_consent_auth_user_id=${input.authUserId}::uuid and attempt.billing_consent_source='operator_saved_payment'
        and attempt.status='creating' and attempt.stripe_session_id is null and attempt.stripe_subscription_id is null
        and attempt.expires_at>statement_timestamp() and quote.status='reserved' and quote.expires_at>statement_timestamp()
        and quote.billing_schedule is not null
        and (quote.billing_schedule->>'cutoffAt')::timestamptz>statement_timestamp()
      for update of attempt`;
    if (!attempt) throw conflict();
    await tx`update stripe_checkout_attempts set payment_setup_customer_checked=true,payment_setup_customer_id=${input.customerId},
      payment_setup_account_id=${input.stripeAccountId},payment_setup_livemode=${input.livemode}
      where id=${input.attemptId}::uuid`;
    await tx`insert into operator_membership_saved_payments(attempt_id,member_id,actor_auth_user_id,operator_authorization_id,
      stripe_account_id,livemode,stripe_customer_id,stripe_payment_method_id,stripe_setup_intent_id,stripe_mandate_id,
      provider_request_sha256,expected_total,automatic_tax_enabled)
      values(${input.attemptId}::uuid,${input.memberId}::uuid,${input.authUserId}::uuid,${input.attemptId}::uuid,
        ${input.stripeAccountId},${input.livemode},${input.customerId},${input.paymentMethodId},${input.setupIntentId},${input.mandateId},
        ${input.providerRequestSha256},${input.expectedTotal},${input.automaticTaxEnabled})`;
    return (await readOperatorSavedPaymentBinding(tx,input.attemptId))!;
  }) as OperatorSavedPaymentBinding;
}

/** One winner may contact the provider. An ambiguous response remains claimed. */
export async function claimOperatorSavedPaymentBinding(input: ActorInput): Promise<{binding: OperatorSavedPaymentBinding; claimed: boolean}> {
  return await getBillingDatabase().begin(async tx => {
    const binding = await actorBinding(tx,input);
    if (binding.status !== "prepared") return {binding,claimed:false};
    const [ready] = await tx`select attempt.id from stripe_checkout_attempts attempt
      join member_payment_method_accounts account on account.member_id=attempt.member_id
        and account.stripe_account_id=${binding.stripeAccountId} and account.livemode=${binding.livemode}
      join member_payment_method_setup_attempts setup on setup.id=account.consent_attempt_id
      where attempt.id=${input.attemptId}::uuid and attempt.status='creating' and attempt.expires_at>statement_timestamp()
        and (attempt.billing_schedule->>'cutoffAt')::timestamptz>statement_timestamp()
        and private.ruined_operator_membership_target_ready(attempt.member_id,18)
        and account.stripe_customer_id=${binding.customerId} and account.stripe_payment_method_id=${binding.paymentMethodId}
        and account.consent_revoked_at is null and not account.cleanup_pending
        and setup.status='saved' and setup.consent_revoked_at is null and setup.stripe_setup_intent_id=${binding.setupIntentId}
        and not exists(select 1 from member_payment_method_detachments detached
          where detached.stripe_account_id=${binding.stripeAccountId} and detached.livemode=${binding.livemode}
            and detached.stripe_payment_method_id=${binding.paymentMethodId})
      for update of attempt for share of account,setup`;
    if (!ready) throw conflict();
    await tx`update operator_membership_saved_payments set status='submitting',started_at=statement_timestamp(),updated_at=statement_timestamp()
      where attempt_id=${input.attemptId}::uuid and status='prepared'`;
    return {binding:(await readOperatorSavedPaymentBinding(tx,input.attemptId))!,claimed:true};
  }) as {binding:OperatorSavedPaymentBinding;claimed:boolean};
}

export async function bindOperatorSavedPaymentSubscription(input: ActorInput & {subscriptionId:string}): Promise<OperatorSavedPaymentBinding> {
  if (!/^sub_[A-Za-z0-9]+$/.test(input.subscriptionId)) throw conflict();
  return await getBillingDatabase().begin(async tx => {
    const binding = await actorBinding(tx,input);
    if (!["submitting","review","succeeded"].includes(binding.status) ||
      (binding.subscriptionId && binding.subscriptionId !== input.subscriptionId)) throw conflict();
    if (binding.subscriptionId === input.subscriptionId) return binding;
    await tx`update operator_membership_saved_payments set stripe_subscription_id=${input.subscriptionId},updated_at=statement_timestamp()
      where attempt_id=${input.attemptId}::uuid`;
    await tx`update stripe_checkout_attempts set stripe_subscription_id=${input.subscriptionId},
      status=case when status='completed' then status else 'open' end,updated_at=statement_timestamp()
      where id=${input.attemptId}::uuid`;
    return (await readOperatorSavedPaymentBinding(tx,input.attemptId))!;
  }) as OperatorSavedPaymentBinding;
}
export async function failOperatorSavedPaymentBinding(input: ActorInput & {errorCode:string; definitive?:boolean;status?:"failed"|"review"}): Promise<void> {
  await getBillingDatabase().begin(async tx => {
    const binding = await actorBinding(tx,input);
    if (binding.status==='succeeded' || binding.status==='failed') return;
    // Only a provider-declared failure with no subscription can release the attempt.
    const failed = (input.definitive===true || input.status==='failed') && !binding.subscriptionId;
    if (!failed && !binding.startedAt) throw conflict();
    await tx`update operator_membership_saved_payments set status=${failed?'failed':'review'},
      error_code=${input.errorCode.slice(0,120)},updated_at=statement_timestamp() where attempt_id=${input.attemptId}::uuid`;
    if (failed) await tx`update stripe_checkout_attempts set status='failed',updated_at=statement_timestamp()
      where id=${input.attemptId}::uuid and status in ('creating','open')`;
  });
}

/** Called after provider-settled proof was projected, inside that same transaction. */
export async function completeOperatorSavedPaymentAttempt(tx: BillingTransaction, input:{attemptId:string;subscriptionId:string}): Promise<boolean> {
  const binding = await readOperatorSavedPaymentBinding(tx,input.attemptId);
  if (!binding || binding.subscriptionId!==input.subscriptionId || !["submitting","review","succeeded"].includes(binding.status)) return false;
  if (binding.status === "succeeded") return true;
  // The trigger independently checks the exact paid invoice, amount, customer,
  // subscription and unrefunded proof. A subscription alone cannot complete it.
  await tx`update operator_membership_saved_payments set status='succeeded',error_code=null,updated_at=statement_timestamp()
    where attempt_id=${input.attemptId}::uuid`;
  await tx`update stripe_checkout_attempts set status='completed',stripe_subscription_id=${input.subscriptionId},updated_at=statement_timestamp()
    where id=${input.attemptId}::uuid and billing_consent_source='operator_saved_payment' and stripe_session_id is null`;
  return true;
}

/** Recovery reads the immutable accepted attempt without making a new quote or acceptance. */
export async function getMembershipCheckoutReservationForSavedPayment(input:ActorInput): Promise<MembershipCheckoutReservation> {
  return await getBillingDatabase().begin(async tx => {
    const binding=await actorBinding(tx,input);
    const [row]=await tx<Array<MembershipCheckoutReservation>>`
      select attempt.operator_authorization_id as "operatorAuthorizationId",attempt.billing_consent_auth_user_id as "operatorActorAuthUserId",
        attempt.agreement_acceptance_id as "agreementAcceptanceId",attempt.agreement_accepted_at as "agreementAcceptedAt",
        acceptance.agreement_content_sha256 as "agreementContentSha256",acceptance.agreement_key_snapshot as "agreementKey",
        attempt.agreement_version as "agreementVersion",attempt.age_attested_at as "ageAttestedAt",attempt.id as "attemptId",
        attempt.billing_plan as plan,attempt.stripe_price_id as "stripePriceId",attempt.recurring_payment_accepted_at as "recurringPaymentAcceptedAt",
        attempt.billing_consent_source as "consentSource",attempt.checkout_prepared_at as "checkoutPreparedAt",true as "existingAcceptanceMatches",
        attempt.stripe_session_id as "existingStripeSessionId",attempt.member_id as "memberId",attempt.commercial_reservation_id as "commercialReservationId",
        attempt.offer_id as "offerId",attempt.expires_at as "expiresAt",attempt.first_charge_at as "firstChargeAt",attempt.billing_schedule as "billingSchedule"
      from stripe_checkout_attempts attempt
      join membership_agreement_acceptances acceptance on acceptance.id=attempt.agreement_acceptance_id
      join operator_membership_authorizations authority on authority.id=attempt.operator_authorization_id
      where attempt.id=${binding.attemptId}::uuid and attempt.member_id=${input.memberId}::uuid
        and attempt.billing_consent_auth_user_id=${input.authUserId}::uuid and attempt.billing_consent_source='operator_saved_payment'
        and attempt.stripe_session_id is null and authority.authority_version='operator-saved-payment-authority-v2'
        and acceptance.operator_authorization_id=authority.id and acceptance.accepted_by_auth_user_id=${input.authUserId}::uuid
        and attempt.recurring_payment_accepted_at=authority.authorized_at`;
    if (!row) throw conflict();
    return row;
  }) as MembershipCheckoutReservation;
}

export const getOperatorSavedPaymentReservation = getMembershipCheckoutReservationForSavedPayment;
