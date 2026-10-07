begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Payment evidence belongs to the purchase, not the registration release that
-- enrolled the member. A historical save-card registration can later pay without
-- rewriting its original completion, card consent, or profile-access identity.
-- Keep provider-settled, unrefunded proof bound to its accepted Checkout, account,
-- mode, invoice, and participant. A saved card or subscription alone is not paid.
create function private.ruined_member_paid_reservation(target_member_id uuid) returns uuid
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select proof.reservation_id
  from public.member_registration_access registration
  join public.ruined_members member on member.id=registration.member_id
  join public.membership_commercial_participants participant on participant.member_id=registration.member_id
    and participant.person_id=member.person_id
  join public.member_lifecycle lifecycle on lifecycle.member_id=registration.member_id and lifecycle.billing_state in ('pending','active')
  join public.membership_commercial_reservations reservation on reservation.id=participant.reservation_id
  join public.stripe_membership_prepaid_proofs proof on proof.reservation_id=reservation.id
  join public.stripe_checkout_attempts attempt on attempt.id=reservation.id
  join public.stripe_checkout_sessions checkout on checkout.id=attempt.stripe_session_id
  join public.stripe_membership_commitments contract on contract.id=proof.contract_id
  join public.stripe_subscriptions subscription on subscription.id=proof.stripe_subscription_id
  join public.stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
  where registration.member_id=target_member_id
    and registration.payment_setup_account_id is not null and registration.payment_setup_livemode=proof.livemode
    and reservation.status in ('reserved','activated') and reservation.stripe_subscription_id=proof.stripe_subscription_id
    and reservation.billing_schedule is not null and proof.member_id=reservation.payer_member_id
    and proof.refund_state='none' and proof.amount_refunded=0 and proof.provider_canceled_at is null and proof.review_reason is null
    and proof.amount_paid>=proof.dues_amount and proof.verified_at<=clock_timestamp()
    and attempt.status='completed' and attempt.member_id=proof.member_id
    and attempt.recurring_payment_accepted_at is not null
    and attempt.payment_setup_account_id=registration.payment_setup_account_id
    and attempt.payment_setup_livemode=registration.payment_setup_livemode
    and attempt.stripe_subscription_id=proof.stripe_subscription_id and attempt.commercial_reservation_id=reservation.id
    and attempt.billing_schedule=reservation.billing_schedule
    and checkout.session_status='complete' and checkout.payment_status='paid' and checkout.livemode=proof.livemode
    and checkout.member_id=proof.member_id and checkout.stripe_subscription_id=proof.stripe_subscription_id
    and contract.checkout_attempt_id=attempt.id and contract.member_id=proof.member_id and contract.livemode=proof.livemode
    and contract.terms_snapshot->'billingSchedule'=reservation.billing_schedule
    and subscription.stripe_status in ('active','trialing') and subscription.stripe_customer_id=contract.stripe_customer_id
    and subscription.member_id=proof.member_id
    and invoice.member_id=proof.member_id and invoice.stripe_subscription_id=proof.stripe_subscription_id
    and invoice.stripe_customer_id=contract.stripe_customer_id
    and invoice.stripe_status='paid' and invoice.purpose='membership' and invoice.amount_paid=proof.amount_paid
    and invoice.amount_due=proof.amount_paid and invoice.currency=proof.currency and invoice.paid_at is not null
  order by proof.created_at limit 1
$$;

-- Existing fulfillment and welcome callers share the same evidence. Their own
-- registration readiness and immutable-completion guards remain authoritative.
create or replace function private.ruined_registration_paid_reservation(target_member_id uuid) returns uuid
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select private.ruined_member_paid_reservation(target_member_id)
$$;

revoke all on function private.ruined_member_paid_reservation(uuid),
  private.ruined_registration_paid_reservation(uuid) from public,anon,authenticated;
commit;
