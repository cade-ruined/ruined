import "server-only";
import type Stripe from "stripe";
import type { BillingTransaction } from "./billing-repository";
import { isUuid } from "./membership-state";
import { readOperatorSavedPaymentBinding } from "./operator-saved-payment-repository";
import { OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION } from "./operator-membership-model";
import { prepaidScheduleFromSubscription, prepaidScheduleFingerprint } from "./prepaid-policy";
import type { FoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";

const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null;

/** This is operator-recorded authorization, never a fabricated Checkout click.
 * Runs for invoice-first delivery too, before any payment can count as funded. */
export async function reconcileOperatorSavedPaymentConsent(tx: BillingTransaction, subscription: Stripe.Subscription): Promise<boolean> {
  if (!isUuid(subscription.metadata.ruined_member_id)) return false;
  // Same member -> binding -> attempt order as the submission path.
  await tx`select id from ruined_members where id=${subscription.metadata.ruined_member_id}::uuid for update`;
  const binding = await readOperatorSavedPaymentBinding(tx, subscription.metadata.ruined_checkout_attempt_id);
  if (!binding) return false;
  const mismatch = (): never => { throw new Error("Saved-method payment does not match its operator authorization."); };
  const [attempt] = await tx<Array<{
    id: string; member_id: string; commercial_reservation_id: string; billing_plan: string;
    offer_id: string; stripe_price_id: string; agreement_acceptance_id: string; agreement_version: string;
    billing_consent_source: string; recurring_payment_accepted_at: Date | null; stripe_session_id: string | null;
    stripe_subscription_id: string | null; operator_authorization_id: string | null; billing_consent_auth_user_id: string | null;
    billing_schedule: FoundationsBillingSchedule | null; first_charge_at: Date | null;
    agreement_content_sha256: string; agreement_accepted_at: Date; authority_version: string;
    acceptance_actor: string; authority_actor: string; affirmative_action: string;
  }>>`select attempt.id,attempt.member_id,attempt.commercial_reservation_id,attempt.billing_plan,attempt.offer_id,attempt.stripe_price_id,
      attempt.agreement_acceptance_id,attempt.agreement_version,attempt.billing_consent_source,attempt.recurring_payment_accepted_at,
      attempt.stripe_session_id,attempt.stripe_subscription_id,attempt.operator_authorization_id,attempt.billing_consent_auth_user_id,
      attempt.billing_schedule,attempt.first_charge_at,acceptance.agreement_content_sha256,acceptance.accepted_at as agreement_accepted_at,
      authority.authority_version,acceptance.accepted_by_auth_user_id as acceptance_actor,authority.actor_auth_user_id as authority_actor,
      acceptance.affirmative_action
    from stripe_checkout_attempts attempt
    join membership_agreement_acceptances acceptance on acceptance.id=attempt.agreement_acceptance_id
      and acceptance.member_id=attempt.member_id and acceptance.operator_authorization_id=attempt.operator_authorization_id
    join operator_membership_authorizations authority on authority.id=attempt.operator_authorization_id
      and authority.reservation_id=attempt.commercial_reservation_id and authority.member_id=attempt.member_id
      and authority.agreement_version_id=acceptance.agreement_version_id
      and authority.agreement_content_sha256=acceptance.agreement_content_sha256
    where attempt.id=${binding.attemptId}::uuid for update of attempt`;
  if (!attempt || attempt.billing_consent_source !== "operator_saved_payment" || !attempt.recurring_payment_accepted_at
    || attempt.authority_version !== OPERATOR_SAVED_PAYMENT_AUTHORITY_VERSION || attempt.affirmative_action !== "operator_recorded_authorization"
    || attempt.member_id !== binding.memberId || attempt.commercial_reservation_id !== binding.attemptId
    || attempt.operator_authorization_id !== binding.operatorAuthorizationId
    || attempt.billing_consent_auth_user_id !== binding.actorAuthUserId || attempt.acceptance_actor !== binding.actorAuthUserId
    || attempt.authority_actor !== binding.actorAuthUserId || attempt.stripe_session_id || attempt.first_charge_at
    || !binding.startedAt || !["submitting", "review", "succeeded"].includes(binding.status)
    || binding.subscriptionId && binding.subscriptionId !== subscription.id
    || attempt.stripe_subscription_id && attempt.stripe_subscription_id !== subscription.id) return mismatch();
  const expected = {
    ruined_context: "membership", billing_terms_version: "membership-billing-v2",
    billing_consent_source: "operator_saved_payment", ruined_checkout_source: "operator_saved_payment",
    ruined_saved_payment_id: binding.attemptId, ruined_member_id: binding.memberId,
    ruined_checkout_attempt_id: binding.attemptId, ruined_commercial_reservation_id: binding.attemptId,
    ruined_checkout_actor_id: binding.actorAuthUserId, ruined_operator_authorization_id: binding.operatorAuthorizationId,
    ruined_stripe_account_id: binding.stripeAccountId, ruined_saved_payment_method_id: binding.paymentMethodId,
    ruined_offer_id: attempt.offer_id, ruined_price_id: attempt.stripe_price_id, ruined_billing_plan: attempt.billing_plan,
    agreement_acceptance_id: attempt.agreement_acceptance_id, agreement_version: attempt.agreement_version,
    agreement_content_sha256: attempt.agreement_content_sha256,
    agreement_accepted_at: new Date(attempt.agreement_accepted_at).toISOString(),
    billing_consent_at: new Date(attempt.recurring_payment_accepted_at).toISOString(),
  };
  const schedule = prepaidScheduleFromSubscription(subscription);
  if (Object.entries(expected).some(([key, value]) => subscription.metadata[key] !== value)
    || subscription.livemode !== binding.livemode || id(subscription.customer) !== binding.customerId
    || subscription.collection_method !== "charge_automatically" || subscription.automatic_tax.enabled !== binding.automaticTaxEnabled
    || subscription.items.has_more || subscription.items.data.length !== 1 || subscription.items.data[0].price.id !== attempt.stripe_price_id
    || subscription.items.data[0].quantity !== 1 || !schedule || !attempt.billing_schedule
    || prepaidScheduleFingerprint(schedule) !== prepaidScheduleFingerprint(attempt.billing_schedule)
    // Later card updates must remain possible once the original subscription is pinned.
    || !binding.subscriptionId && id(subscription.default_payment_method) !== binding.paymentMethodId) return mismatch();
  if (!binding.subscriptionId) await tx`update operator_membership_saved_payments set stripe_subscription_id=${subscription.id},updated_at=statement_timestamp()
    where attempt_id=${binding.attemptId}::uuid and stripe_subscription_id is null`;
  if (!attempt.stripe_subscription_id) await tx`update stripe_checkout_attempts set stripe_subscription_id=${subscription.id},
    status=case when status='completed' then status else 'open' end,updated_at=statement_timestamp()
    where id=${binding.attemptId}::uuid and stripe_subscription_id is null`;
  return true;
}
