import "server-only";
import type { BillingTransaction } from "@/lib/stripe/billing-repository";
import { PaymentMethodSetupError, type SavedPaymentMethodDisplay } from "@/lib/stripe/payment-method-model";

export type SetupContext = { accountId: string; livemode: boolean };
export type SetupMember = { id: string; email: string; stripe_customer_id: string | null; reason: string | null };
export type SetupAccount = {
  member_id: string; stripe_account_id: string; livemode: boolean; stripe_customer_id: string | null;
  consent_attempt_id: string | null; consent_revoked_at: Date | null; cleanup_pending: boolean;
  stripe_payment_method_id: string | null; payment_method_display: SavedPaymentMethodDisplay | null;
};
export type SetupAttempt = {
  id: string; member_id: string; stripe_account_id: string; livemode: boolean;
  status: "creating" | "open" | "saved" | "expired" | "revoked";
  stripe_session_id: string | null; stripe_setup_intent_id: string | null;
  consent_revoked_at: Date | null; expires_at: Date; return_origin: string;
};

/** Same canonical lock as paid Checkout and complimentary invitation redemption. */
export async function lockSetupMember(tx: BillingTransaction, memberId: string) {
  await tx`select private.ruined_lock_member_complimentary_funding(${memberId}::uuid)`;
  const [member] = await tx`select id from ruined_members where id=${memberId}::uuid for update`;
  if (!member) throw new PaymentMethodSetupError("Your member account is unavailable.", 403);
}

export async function findSetupMember(tx: BillingTransaction, authUserId: string, minimumAge: number): Promise<SetupMember | null> {
  const [member] = await tx<Array<SetupMember>>`
    select member.id, viewer.email_normalized as email, member.stripe_customer_id,
      case
        when member.deleted_at is not null or person.status <> 'active' or lifecycle.account_state <> 'active'
          then 'Your member account is not available for payment setup.'
        when not exists (select 1 from person_email_addresses email where email.person_id=member.person_id
          and email.email_normalized=viewer.email_normalized and email.verification_state='verified' and email.retired_at is null)
          then 'Verify your email before saving a payment method.'
        when onboarding.profile_completed_at is null then 'Complete your profile before saving a payment method.'
        when private_profile.birth_date is null or private_profile.birth_date > current_date - make_interval(years => ${minimumAge})
          then 'You must meet the membership age requirement before saving a payment method.'
        when private.ruined_member_has_complimentary_funding(member.id)
          or private.ruined_member_has_operator_funding(member.id)
          or exists (select 1 from platform_role_grants roles where roles.auth_user_id=viewer.auth_user_id
            and roles.revoked_at is null and roles.role_slug in ('ops_admin','ops_support'))
          then 'Your membership does not require a saved payment method.'
        when private.ruined_member_has_couple_funding(member.id)
          or exists (select 1 from membership_couple_authorizations couple
            where (couple.payer_member_id=member.id or couple.partner_member_id=member.id)
              and couple.accepted_at is not null and couple.revoked_at is null and couple.expires_at>clock_timestamp())
          or exists (select 1 from membership_commercial_reservations quote
            where quote.payer_member_id=member.id and quote.kind='couple' and quote.status in ('reserved','activated'))
          then 'Your shared membership payment is handled through its checkout.'
        when member.membership_state <> 'pending' or lifecycle.billing_state <> 'pending'
          or lifecycle.standing_state <> 'pre_active' or lifecycle.program_state not in ('prospect','onboarding')
          then 'Manage your existing membership payment through billing.'
        else null end as reason
    from platform_users viewer
    join ruined_members member on member.id=viewer.member_id and member.person_id=viewer.person_id
    join people person on person.id=member.person_id
    join member_lifecycle lifecycle on lifecycle.member_id=member.id
    left join member_onboardings onboarding on onboarding.member_id=member.id
    left join person_private_profiles private_profile on private_profile.person_id=member.person_id
    where viewer.auth_user_id=${authUserId}::uuid and viewer.status='active'
      and exists (select 1 from platform_role_grants grant_row where grant_row.auth_user_id=viewer.auth_user_id
        and grant_row.role_slug='member' and grant_row.revoked_at is null)
    limit 1`;
  return member ?? null;
}

export async function hasPaymentInProgress(tx: BillingTransaction, memberId: string): Promise<boolean> {
  const [row] = await tx<Array<{ blocked: boolean }>>`
    select exists (select 1 from stripe_checkout_attempts where member_id=${memberId}::uuid
      and (status in ('creating','open') or (status='completed' and (stripe_subscription_id is null
        or not exists (select 1 from stripe_subscriptions subscription where subscription.id=stripe_checkout_attempts.stripe_subscription_id)))))
      or exists (select 1 from stripe_subscriptions where member_id=${memberId}::uuid
        and stripe_status not in ('canceled','incomplete_expired')) as blocked`;
  return row.blocked;
}

export async function getSetupAccount(tx: BillingTransaction, memberId: string, context: SetupContext) {
  const [row] = await tx<Array<SetupAccount>>`select * from member_payment_method_accounts
    where member_id=${memberId}::uuid and stripe_account_id=${context.accountId} and livemode=${context.livemode}`;
  return row ?? null;
}
export async function getSetupAttempt(tx: BillingTransaction, attemptId: string) {
  const [row] = await tx<Array<SetupAttempt>>`select * from member_payment_method_setup_attempts where id=${attemptId}::uuid`;
  return row ?? null;
}
export async function recordMethodDetached(tx: BillingTransaction, context: SetupContext, methodId: string) {
  await tx`insert into member_payment_method_detachments(stripe_account_id,livemode,stripe_payment_method_id)
    values(${context.accountId},${context.livemode},${methodId}) on conflict do nothing`;
  await tx`update member_payment_method_accounts set stripe_payment_method_id=null,payment_method_display=null,saved_at=null,updated_at=clock_timestamp()
    where stripe_account_id=${context.accountId} and livemode=${context.livemode} and stripe_payment_method_id=${methodId}`;
}
export async function methodWasDetached(tx: BillingTransaction, context: SetupContext, methodId: string) {
  const rows = await tx`select 1 from member_payment_method_detachments where stripe_account_id=${context.accountId}
    and livemode=${context.livemode} and stripe_payment_method_id=${methodId}`;
  return rows.length > 0;
}
