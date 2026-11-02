begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Preserve sponsor-as-cardholder v1 and every existing acceptance. This is a
-- separate recorded instruction to use the member's own saved payment method.
alter table public.operator_membership_authorizations add column authority_evidence jsonb;
alter table public.operator_membership_authorizations drop constraint operator_membership_authorizations_authority_version_check;
alter table public.operator_membership_authorizations drop constraint operator_membership_authorizations_authority_text_check;
alter table public.operator_membership_authorizations add constraint operator_membership_authority_basis check ((
 (authority_version='operator-membership-authority-v1' and authority_text='I have this member’s authorization to accept the Ruined Membership Agreement on their behalf. I am the cardholder and authorize the payment shown and recurring renewals on this card under these terms.' and authority_evidence is null)
 or (authority_version='operator-saved-payment-authority-v2' and authority_text='I have this member’s authorization to accept the Ruined Membership Agreement on their behalf and charge their saved payment method for the disclosed first membership payment and recurring renewals. I am recording their authorization as an administrator, not claiming to be the cardholder.' and
   authority_evidence->>'source'='operator_recorded_member_authorization'
   and jsonb_typeof(authority_evidence)='object'
   and jsonb_typeof(authority_evidence->'statement')='string'
   and length(btrim(authority_evidence->>'statement')) between 10 and 4000
   and authority_evidence-array['source','statement','reference']='{}'::jsonb
   and (not authority_evidence ? 'reference' or (jsonb_typeof(authority_evidence->'reference')='string'
     and length(authority_evidence->>'reference')<=500)))
) is true);
alter table public.membership_agreement_acceptances drop constraint membership_agreement_acceptances_affirmative_action_check;
alter table public.membership_agreement_acceptances add constraint membership_agreement_acceptances_affirmative_action_check
 check(affirmative_action in ('checkbox_and_submit','typed_signature','operator_recorded_authorization'));

create or replace function private.ruined_validate_agreement_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_record public.membership_agreement_versions%rowtype;
  accepting_person_id uuid;
  attestation_member_id uuid;
  attestation_type text;
  attestation_decision text;
  delegation public.operator_membership_authorizations%rowtype;
begin
  select agreement.*
  into agreement_record
  from public.membership_agreement_versions agreement
  where agreement.id = new.agreement_version_id;

  if agreement_record.id is null or agreement_record.status <> 'published' then
    raise exception 'Only a published agreement version may be accepted.';
  end if;

  if new.accepted_at < agreement_record.published_at
     or (
       agreement_record.effective_at is not null
       and new.accepted_at < agreement_record.effective_at
     ) then
    raise exception 'The agreement was not effective at the acceptance time.';
  end if;

  if new.agreement_key_snapshot <> agreement_record.agreement_key
     or new.agreement_version_snapshot <> agreement_record.version
     or new.agreement_title_snapshot <> agreement_record.title
     or new.agreement_content_sha256 <> agreement_record.content_sha256
     or new.agreement_body_snapshot <> agreement_record.body_text then
    raise exception 'Agreement acceptance snapshot does not match the published version.';
  end if;

  select platform_user.person_id
  into accepting_person_id
  from public.platform_users platform_user
  where platform_user.auth_user_id = new.accepted_by_auth_user_id
    and platform_user.status = 'active';

  if new.operator_authorization_id is null then
    if new.affirmative_action='operator_recorded_authorization' or accepting_person_id is distinct from new.person_id then
      raise exception 'The accepting authentication identity does not belong to this Person.';
    end if;
  else
    select * into delegation from public.operator_membership_authorizations
      where id=new.operator_authorization_id;
    perform private.ruined_require_operator_membership_actor(new.accepted_by_auth_user_id);
    if delegation.id is null or delegation.member_id is distinct from new.member_id
      or delegation.person_id is distinct from new.person_id
      or delegation.actor_auth_user_id is distinct from new.accepted_by_auth_user_id
      or delegation.agreement_version_id is distinct from new.agreement_version_id
      or delegation.agreement_content_sha256 is distinct from new.agreement_content_sha256
      or delegation.actor_name_snapshot is distinct from new.signer_name_snapshot
      or delegation.actor_email_snapshot is distinct from new.signer_email_snapshot
      or new.accepted_at < delegation.authorized_at
      or new.age_attestation_id is null
      or (delegation.authority_version='operator-membership-authority-v1' and new.affirmative_action <> 'checkbox_and_submit')
      or (delegation.authority_version='operator-saved-payment-authority-v2' and (new.affirmative_action <> 'operator_recorded_authorization'
        or new.acceptance_evidence->'memberAuthorization' is distinct from delegation.authority_evidence))
      or new.acceptance_context <> 'initial_membership'
      or not private.ruined_operator_membership_target_ready(new.member_id,delegation.minimum_age) then
      raise exception 'Delegated agreement acceptance does not match its operator delegation.';
    end if;
    if not exists(select 1 from public.member_consents age_consent
      where age_consent.id=new.age_attestation_id and age_consent.member_id=new.member_id
        and age_consent.consent_type='age_attestation' and age_consent.decision='accepted'
        and age_consent.source='ops' and age_consent.actor_auth_user_id=new.accepted_by_auth_user_id
        and age_consent.evidence->>'operatorAuthorizationId'=delegation.id::text
        and age_consent.evidence->>'basis'='verified_registration_birth_date'
        and age_consent.evidence->>'minimumAge'=delegation.minimum_age::text) then
      raise exception 'Delegated acceptance requires the operator age verification record.';
    end if;
  end if;

  if new.age_attestation_id is not null then
    select consent.member_id, consent.consent_type, consent.decision
    into attestation_member_id, attestation_type, attestation_decision
    from public.member_consents consent
    where consent.id = new.age_attestation_id;

    if attestation_member_id is distinct from new.member_id
       or attestation_type is distinct from 'age_attestation'
       or attestation_decision is distinct from 'accepted' then
      raise exception 'The linked age attestation is not an accepted attestation for this member.';
    end if;
  end if;

  return new;
end;
$$;



create or replace function private.ruined_validate_operator_membership_checkout()
returns trigger language plpgsql security invoker set search_path='' as $$
declare delegation public.operator_membership_authorizations%rowtype; acceptance public.membership_agreement_acceptances%rowtype;
begin
 if tg_op='UPDATE' then
   if new.operator_authorization_id is distinct from old.operator_authorization_id then
     raise exception 'Checkout operator delegation is immutable.';
   end if;
   if new.operator_authorization_id is null and exists(select 1 from public.membership_agreement_acceptances
     where id=new.agreement_acceptance_id and operator_authorization_id is not null) then
     raise exception 'Delegated acceptance requires its operator checkout delegation.';
   end if;
   if old.operator_authorization_id is not null and row(new.id,new.member_id,new.email_normalized,
     new.agreement_acceptance_id,new.billing_consent_auth_user_id,new.commercial_reservation_id,new.billing_plan,new.billing_consent_source)
     is distinct from row(old.id,old.member_id,old.email_normalized,old.agreement_acceptance_id,old.billing_consent_auth_user_id,
       old.commercial_reservation_id,old.billing_plan,old.billing_consent_source) then
     raise exception 'Checkout operator delegation binding is immutable.';
   end if;
   return new;
 end if;
 select * into acceptance from public.membership_agreement_acceptances where id=new.agreement_acceptance_id;
 if new.operator_authorization_id is null then
   if acceptance.operator_authorization_id is not null then raise exception 'Delegated acceptance requires its operator checkout delegation.'; end if;
   return new;
 end if;
 select * into delegation from public.operator_membership_authorizations where id=new.operator_authorization_id;
 perform private.ruined_require_operator_membership_actor(new.billing_consent_auth_user_id);
 if delegation.id is null or delegation.id is distinct from new.id
   or delegation.reservation_id is distinct from new.commercial_reservation_id
   or delegation.member_id is distinct from new.member_id
   or delegation.member_email_snapshot is distinct from new.email_normalized
   or delegation.actor_auth_user_id is distinct from new.billing_consent_auth_user_id
   or delegation.billing_plan is distinct from new.billing_plan
   or acceptance.operator_authorization_id is distinct from delegation.id
   or acceptance.accepted_by_auth_user_id is distinct from delegation.actor_auth_user_id
   or (delegation.authority_version='operator-membership-authority-v1' and (new.billing_consent_source <> 'stripe_checkout'
     or new.recurring_payment_accepted_at is not null or new.billing_consent_evidence is not null))
   or (delegation.authority_version='operator-saved-payment-authority-v2' and (new.billing_consent_source <> 'operator_saved_payment'
     or new.recurring_payment_accepted_at is distinct from delegation.authorized_at
     or new.stripe_session_id is not null))
   or not private.ruined_operator_membership_target_ready(new.member_id,delegation.minimum_age) then
   raise exception 'Checkout does not match its delegated operator delegation.';
 end if;
 return new;
end $$;

alter table public.stripe_checkout_attempts drop constraint stripe_checkout_consent_source;
alter table public.stripe_checkout_attempts add constraint stripe_checkout_consent_source check ((
  billing_consent_source in ('member','stripe_checkout','operator_saved_payment') and (
    (billing_consent_source='member' and billing_consent_evidence is null)
    or (billing_consent_source='stripe_checkout' and commercial_reservation_id is not null and (
      (recurring_payment_accepted_at is null and billing_consent_evidence is null)
      or (recurring_payment_accepted_at is not null and (
        billing_consent_evidence->>'source'='stripe_checkout'
        and billing_consent_evidence->>'termsOfService'='accepted'
        and billing_consent_evidence->>'sessionId'=stripe_session_id
        and billing_consent_evidence->>'subscriptionId'=stripe_subscription_id
        and billing_consent_evidence->>'memberId'=member_id::text
        and billing_consent_evidence->>'attemptId'=id::text
        and (billing_consent_evidence->>'verifiedAt')::timestamptz=recurring_payment_accepted_at
      ) is true)
    )))
    or (billing_consent_source='operator_saved_payment' and operator_authorization_id=id and commercial_reservation_id=id
      and recurring_payment_accepted_at is not null and stripe_session_id is null
      and billing_consent_evidence->>'source'='operator_saved_payment'
      and billing_consent_evidence->>'operatorAuthorizationId'=operator_authorization_id::text
      and billing_consent_evidence->>'actorAuthUserId'=billing_consent_auth_user_id::text
      and billing_consent_evidence->>'memberId'=member_id::text
      and billing_consent_evidence->>'attemptId'=id::text
      and (billing_consent_evidence->>'acceptedAt')::timestamptz=recurring_payment_accepted_at)
    ) is true
);


create table public.operator_membership_saved_payments (
 attempt_id uuid primary key references public.stripe_checkout_attempts(id) on delete restrict,
 member_id uuid not null references public.ruined_members(id) on delete restrict,
 actor_auth_user_id uuid not null references public.platform_users(auth_user_id) on delete restrict,
 operator_authorization_id uuid not null unique references public.operator_membership_authorizations(id) on delete restrict,
 stripe_account_id text not null check(stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
 livemode boolean not null,
 stripe_customer_id text not null check(stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 stripe_payment_method_id text not null check(stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
 stripe_setup_intent_id text not null check(stripe_setup_intent_id ~ '^seti_[A-Za-z0-9]+$'),
 stripe_mandate_id text check(stripe_mandate_id ~ '^mandate_[A-Za-z0-9]+$'),
 provider_request_sha256 text not null check(provider_request_sha256 ~ '^[a-f0-9]{64}$'),
 expected_total bigint not null check(expected_total>0),
 automatic_tax_enabled boolean not null,
 status text not null default 'prepared' check(status in ('prepared','submitting','succeeded','failed','review')),
 started_at timestamptz,
 stripe_subscription_id text unique check(stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
 error_code text check(length(error_code)<=120),
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 check(attempt_id=operator_authorization_id),
 check(status not in ('submitting','succeeded','review') or started_at is not null),
 check(status<>'succeeded' or stripe_subscription_id is not null)
);
alter table public.operator_membership_saved_payments enable row level security;
revoke all on public.operator_membership_saved_payments from public,anon,authenticated;
grant select,insert,update on public.operator_membership_saved_payments to service_role;

create function private.ruined_validate_saved_payment_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Saved payment audit records cannot be deleted.'; end if;
 if tg_op='INSERT' then
   perform private.ruined_require_operator_membership_actor(new.actor_auth_user_id);
   if new.status<>'prepared' or new.started_at is not null or new.stripe_subscription_id is not null
     or not private.ruined_operator_membership_target_ready(new.member_id,18) then
     raise exception 'Saved payment must begin as a prepared eligible request.';
   end if;
   if not exists(select 1 from public.stripe_checkout_attempts attempt
     join public.operator_membership_authorizations authority on authority.id=attempt.operator_authorization_id
     join public.member_payment_method_accounts account on account.member_id=attempt.member_id
       and account.stripe_account_id=new.stripe_account_id and account.livemode=new.livemode
     join public.member_payment_method_setup_attempts setup on setup.id=account.consent_attempt_id
       and setup.member_id=account.member_id and setup.stripe_account_id=account.stripe_account_id and setup.livemode=account.livemode
     join public.member_registration_access registration on registration.member_id=attempt.member_id
     where attempt.id=new.attempt_id and attempt.operator_authorization_id=new.operator_authorization_id
       and attempt.member_id=new.member_id and attempt.billing_consent_auth_user_id=new.actor_auth_user_id
       and attempt.billing_consent_source='operator_saved_payment' and attempt.status='creating'
       and attempt.billing_schedule is not null and attempt.first_charge_at is null and attempt.billing_plan='monthly'
       and new.expected_total >= (attempt.recurring_payment_terms->>'amount')::bigint
       and (new.automatic_tax_enabled or new.expected_total=(attempt.recurring_payment_terms->>'amount')::bigint)
       and attempt.recurring_payment_accepted_at=authority.authorized_at and attempt.stripe_session_id is null
       and authority.authority_version='operator-saved-payment-authority-v2'
       and authority.actor_auth_user_id=new.actor_auth_user_id and authority.member_id=new.member_id
       and attempt.payment_setup_customer_checked and attempt.payment_setup_customer_id=new.stripe_customer_id
       and attempt.payment_setup_account_id=new.stripe_account_id and attempt.payment_setup_livemode=new.livemode
       and registration.payment_setup_account_id=new.stripe_account_id and registration.payment_setup_livemode=new.livemode
       and account.stripe_customer_id=new.stripe_customer_id and account.stripe_payment_method_id=new.stripe_payment_method_id
       and account.consent_revoked_at is null and not account.cleanup_pending and account.saved_at is not null
       and setup.status='saved' and setup.consent_revoked_at is null and setup.stripe_setup_intent_id=new.stripe_setup_intent_id
       and not exists(select 1 from public.member_payment_method_detachments detached
         where detached.stripe_account_id=new.stripe_account_id and detached.livemode=new.livemode
           and detached.stripe_payment_method_id=new.stripe_payment_method_id)
   ) then raise exception 'Saved payment does not match current storage and delegated billing authority.'; end if;
 else
   if row(new.attempt_id,new.member_id,new.actor_auth_user_id,new.operator_authorization_id,new.stripe_account_id,new.livemode,
     new.stripe_customer_id,new.stripe_payment_method_id,new.stripe_setup_intent_id,new.stripe_mandate_id,
     new.provider_request_sha256,new.expected_total,new.automatic_tax_enabled,new.created_at)
     is distinct from row(old.attempt_id,old.member_id,old.actor_auth_user_id,old.operator_authorization_id,old.stripe_account_id,old.livemode,
       old.stripe_customer_id,old.stripe_payment_method_id,old.stripe_setup_intent_id,old.stripe_mandate_id,
       old.provider_request_sha256,old.expected_total,old.automatic_tax_enabled,old.created_at)
     or (old.started_at is not null and new.started_at is distinct from old.started_at)
     or (old.stripe_subscription_id is not null and new.stripe_subscription_id is distinct from old.stripe_subscription_id)
     or (old.status='succeeded' and new.status<>'succeeded')
     or (old.status='failed' and new.status<>'failed') then
       raise exception 'Saved payment identity and submission are immutable.';
   end if;
   if new.started_at>statement_timestamp() or (old.status='prepared' and new.status not in ('prepared','submitting','failed'))
     or (old.status in ('submitting','review') and new.status='prepared') then
     raise exception 'Invalid saved payment submission transition.';
   end if;
 end if;
 if new.status='succeeded' and not exists(select 1 from public.stripe_membership_prepaid_proofs proof
   join public.stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
   join public.stripe_subscriptions subscription on subscription.id=proof.stripe_subscription_id
   where proof.reservation_id=new.attempt_id and proof.member_id=new.member_id and proof.livemode=new.livemode
     and proof.stripe_subscription_id=new.stripe_subscription_id and proof.refund_state='none' and proof.amount_refunded=0
     and proof.provider_canceled_at is null and proof.review_reason is null and proof.amount_paid=new.expected_total
     and invoice.stripe_status='paid' and invoice.purpose='membership' and invoice.amount_paid=new.expected_total
     and invoice.amount_due=new.expected_total and invoice.paid_at is not null and invoice.currency='usd'
     and invoice.member_id=new.member_id and invoice.stripe_customer_id=new.stripe_customer_id
     and invoice.stripe_subscription_id=new.stripe_subscription_id
     and subscription.member_id=new.member_id and subscription.stripe_customer_id=new.stripe_customer_id
     and subscription.stripe_status in ('active','trialing')
 ) then raise exception 'Saved payment completion requires verified settled membership payment.'; end if;
 return new;
end $$;
create trigger operator_saved_payment_validate before insert or update or delete on public.operator_membership_saved_payments
 for each row execute function private.ruined_validate_saved_payment_binding();
revoke all on function private.ruined_validate_saved_payment_binding() from public,anon,authenticated;

create function private.ruined_preserve_saved_payment_attempt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.billing_consent_source='operator_saved_payment' then
   if new.stripe_session_id is not null or (tg_op='UPDATE' and old.stripe_subscription_id is not null
     and new.stripe_subscription_id is distinct from old.stripe_subscription_id) then
     raise exception 'Saved payment must retain its subscription and cannot invent a Checkout Session.';
   end if;
   if new.status in ('expired','failed') and exists(select 1 from public.operator_membership_saved_payments binding
     where binding.attempt_id=new.id and binding.status in ('submitting','review','succeeded')) then
     raise exception 'An uncertain or settled saved payment cannot be released as an abandoned Checkout.';
   end if;
   if new.status='completed' and not exists(select 1 from public.operator_membership_saved_payments binding
     where binding.attempt_id=new.id and binding.member_id=new.member_id and binding.status='succeeded'
       and binding.stripe_subscription_id=new.stripe_subscription_id) then
     raise exception 'Saved payment cannot complete before settlement verification.';
   end if;
 end if;
 return new;
end $$;
create trigger stripe_checkout_saved_payment_preserve before insert or update on public.stripe_checkout_attempts
 for each row execute function private.ruined_preserve_saved_payment_attempt();
revoke all on function private.ruined_preserve_saved_payment_attempt() from public,anon,authenticated;

create or replace function private.ruined_member_paid_reservation(target_member_id uuid) returns uuid
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
  left join public.operator_membership_saved_payments saved_payment on saved_payment.attempt_id=attempt.id
  left join public.operator_membership_authorizations authority on authority.id=attempt.operator_authorization_id
  left join public.stripe_checkout_sessions checkout on checkout.id=attempt.stripe_session_id
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
    and ((attempt.billing_consent_source<>'operator_saved_payment' and checkout.session_status='complete'
      and checkout.payment_status='paid' and checkout.livemode=proof.livemode
      and checkout.member_id=proof.member_id and checkout.stripe_subscription_id=proof.stripe_subscription_id)
      or (attempt.billing_consent_source='operator_saved_payment' and attempt.stripe_session_id is null
        and saved_payment.status='succeeded' and saved_payment.operator_authorization_id=authority.id
        and saved_payment.member_id=proof.member_id and saved_payment.actor_auth_user_id=attempt.billing_consent_auth_user_id
        and saved_payment.stripe_subscription_id=proof.stripe_subscription_id and saved_payment.livemode=proof.livemode
        and saved_payment.stripe_account_id=attempt.payment_setup_account_id
        and saved_payment.stripe_customer_id=contract.stripe_customer_id and saved_payment.expected_total=proof.amount_paid
        and authority.authority_version='operator-saved-payment-authority-v2'
        and authority.member_id=proof.member_id and authority.actor_auth_user_id=attempt.billing_consent_auth_user_id
        and authority.authorized_at=attempt.recurring_payment_accepted_at))
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


commit;
