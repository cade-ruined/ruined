begin;

-- Stripe can return py_ charges (including Link payments) and pyr_ refunds.
-- Only the provider identifier format changes: all exact invoice, customer,
-- consent, amount, livemode and immutable-payment guards remain in force.
alter table public.stripe_membership_prepaid_proofs
  drop constraint stripe_membership_prepaid_proofs_stripe_charge_id_check,
  add constraint stripe_membership_prepaid_proofs_stripe_charge_id_check
    check (stripe_charge_id ~ '^(ch|py)_[A-Za-z0-9][A-Za-z0-9_]*$'),
  drop constraint stripe_membership_prepaid_proofs_stripe_refund_id_check,
  add constraint stripe_membership_prepaid_proofs_stripe_refund_id_check
    check (stripe_refund_id is null or stripe_refund_id ~ '^(re|pyr)_[A-Za-z0-9][A-Za-z0-9_]*$');

commit;
