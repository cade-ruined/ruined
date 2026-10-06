begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- No backfill: an existing registration or accepted billing schedule keeps its
-- original requirements. New enrollment explicitly pins this release decision.
alter table public.member_registration_access
  add column requires_initial_payment boolean not null default false,
  add column payment_reservation_id uuid references public.membership_commercial_reservations(id) on delete restrict;
alter table public.member_registration_access drop constraint member_registration_access_completion_basis_check;
alter table public.member_registration_access add constraint member_registration_access_completion_basis_check
  check(completion_basis in ('saved_card','complimentary','paid_membership'));
alter table public.member_registration_access add constraint registration_paid_completion_identity
  check((completion_basis='paid_membership') = (payment_reservation_id is not null));
alter table public.member_registration_messages
  add column delivery_payment_reservation_id uuid references public.membership_commercial_reservations(id) on delete restrict;

create function private.ruined_registration_intake_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog,public,private as $$
 select exists(
   select 1 from public.member_registration_access registration
   join public.ruined_members member on member.id=registration.member_id and member.deleted_at is null
   join public.people person on person.id=member.person_id and person.status='active'
   join public.member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
   join public.member_onboardings onboarding on onboarding.member_id=member.id and onboarding.profile_completed_at is not null
   left join public.person_private_profiles profile on profile.person_id=member.person_id
   where member.id=target_member_id
   and private.ruined_registration_legal_complete(member.id)
   and (registration.profile_activated_at is not null or private.ruined_registration_intake_eligibility_error(
     profile.birth_date, profile.default_fulfillment_address->>'countryCode') is null)
   and exists(select 1 from public.platform_users identity
     join public.platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
     join public.person_email_addresses email on email.person_id=identity.person_id and email.email_normalized=identity.email_normalized
       and email.verification_state='verified' and email.retired_at is null
     where identity.person_id=member.person_id and identity.status='active' and (identity.member_id is null or identity.member_id=member.id))
 )
$$;

-- A saved card, subscription status, or browser return is never payment proof.
-- The provider reconciliation has already verified actual charge settlement,
-- amount, currency, invoice lines, schedule, and refund/dispute history.
create function private.ruined_registration_paid_reservation(target_member_id uuid) returns uuid
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select proof.reservation_id
  from public.member_registration_access registration
  join public.membership_commercial_participants participant on participant.member_id=registration.member_id
  join public.member_lifecycle lifecycle on lifecycle.member_id=registration.member_id and lifecycle.billing_state in ('pending','active')
  join public.membership_commercial_reservations reservation on reservation.id=participant.reservation_id
  join public.stripe_membership_prepaid_proofs proof on proof.reservation_id=reservation.id
  join public.stripe_checkout_attempts attempt on attempt.id=reservation.id
  join public.stripe_checkout_sessions checkout on checkout.id=attempt.stripe_session_id
  join public.stripe_membership_commitments contract on contract.id=proof.contract_id
  join public.stripe_subscriptions subscription on subscription.id=proof.stripe_subscription_id
  join public.stripe_invoices invoice on invoice.id=proof.stripe_invoice_id
  where registration.member_id=target_member_id and registration.requires_initial_payment
    and registration.payment_setup_account_id is not null and registration.payment_setup_livemode=proof.livemode
    and reservation.status in ('reserved','activated') and reservation.stripe_subscription_id=proof.stripe_subscription_id
    and reservation.billing_schedule is not null and proof.member_id=reservation.payer_member_id
    and proof.refund_state='none' and proof.amount_refunded=0 and proof.provider_canceled_at is null
    and proof.amount_paid>=proof.dues_amount and proof.verified_at<=clock_timestamp()
    and attempt.status='completed' and attempt.member_id=proof.member_id
    and attempt.payment_setup_account_id=registration.payment_setup_account_id
    and attempt.payment_setup_livemode=registration.payment_setup_livemode
    and attempt.stripe_subscription_id=proof.stripe_subscription_id and attempt.commercial_reservation_id=reservation.id
    and attempt.billing_schedule=reservation.billing_schedule
    and checkout.session_status='complete' and checkout.payment_status='paid' and checkout.livemode=proof.livemode
    and checkout.member_id=proof.member_id and checkout.stripe_subscription_id=proof.stripe_subscription_id
    and contract.checkout_attempt_id=attempt.id and contract.member_id=proof.member_id and contract.livemode=proof.livemode
    and contract.terms_snapshot->'billingSchedule'=reservation.billing_schedule
    and subscription.stripe_status in ('active','trialing') and subscription.stripe_customer_id=contract.stripe_customer_id
    and invoice.stripe_status='paid' and invoice.purpose='membership' and invoice.amount_paid=proof.amount_paid
    and invoice.amount_due=proof.amount_paid and invoice.currency=proof.currency and invoice.paid_at is not null
  order by proof.created_at limit 1
$$;

create or replace function private.ruined_member_registration_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select exists(select 1 from public.member_registration_access registration
   where registration.member_id=target_member_id and private.ruined_registration_intake_ready(target_member_id)
     and (private.ruined_member_has_complimentary_funding(target_member_id) or private.ruined_member_has_operator_funding(target_member_id)
       or (registration.requires_initial_payment and private.ruined_registration_paid_reservation(target_member_id) is not null)
       or (not registration.requires_initial_payment and exists(select 1 from public.member_payment_method_accounts account
       join public.member_payment_method_setup_attempts attempt on attempt.id=account.consent_attempt_id
         and attempt.member_id=account.member_id and attempt.stripe_account_id=account.stripe_account_id and attempt.livemode=account.livemode
       where account.member_id=target_member_id and account.stripe_account_id=registration.payment_setup_account_id
         and account.livemode=registration.payment_setup_livemode and account.stripe_payment_method_id is not null
         and account.saved_at is not null and account.consent_revoked_at is null and not account.cleanup_pending
         and attempt.status='saved' and attempt.consent_revoked_at is null
         and not exists(select 1 from public.member_payment_method_detachments detached
           where detached.stripe_account_id=account.stripe_account_id and detached.livemode=account.livemode
             and detached.stripe_payment_method_id=account.stripe_payment_method_id)))))
$$;

-- Paying now must be reachable after complete intake, before registration is
-- considered finished. Historical save-card registrations retain the old gate.
create or replace function private.ruined_member_paid_activation_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select private.ruined_member_profile_released(target_member_id) or exists(
    select 1 from public.member_registration_access registration where registration.member_id=target_member_id
      and ((registration.requires_initial_payment and private.ruined_registration_intake_ready(target_member_id))
        or (not registration.requires_initial_payment and registration.registered_at is not null
          and private.ruined_member_registration_ready(target_member_id))))
$$;

create function private.ruined_guard_registration_payment_requirement() returns trigger
language plpgsql set search_path=pg_catalog,public,private as $$
begin
  if tg_op='UPDATE' and new.requires_initial_payment is distinct from old.requires_initial_payment then
    raise exception 'The registration payment requirement is immutable.';
  end if;
  if tg_op='UPDATE' and new.requires_initial_payment and old.payment_setup_account_id is not null
    and row(new.payment_setup_account_id,new.payment_setup_livemode) is distinct from row(old.payment_setup_account_id,old.payment_setup_livemode) then
    raise exception 'The registration payment account is immutable.';
  end if;
  if tg_op='UPDATE' and old.registered_at is not null and new.payment_reservation_id is distinct from old.payment_reservation_id then
    raise exception 'Completed registration payment identity is immutable.';
  end if;
  if new.registered_at is not null and (tg_op='INSERT' or old.registered_at is null) then
    if new.requires_initial_payment and new.completion_basis='saved_card' then
      raise exception 'A saved card does not complete paid registration.';
    end if;
    if new.completion_basis='paid_membership' and (not new.requires_initial_payment or
      new.payment_reservation_id is distinct from private.ruined_registration_paid_reservation(new.member_id)) then
      raise exception 'Verified initial membership payment is required.';
    end if;
    if new.completion_basis='complimentary' and not (private.ruined_member_has_complimentary_funding(new.member_id)
      or private.ruined_member_has_operator_funding(new.member_id)) then
      raise exception 'Verified complimentary funding is required.';
    end if;
  end if;
  return new;
end $$;
create trigger registration_payment_requirement before insert or update on public.member_registration_access
  for each row execute function private.ruined_guard_registration_payment_requirement();

-- The original registration keeps its original payment identity. An unsent
-- welcome may describe a later, explicitly purchased membership after a refund,
-- but once its delivery bytes are prepared their proof must never be restamped.
create function private.ruined_guard_registration_message_payment() returns trigger
language plpgsql set search_path=pg_catalog,public,private as $$
begin
  if tg_op='UPDATE' and (old.delivery_payload is not null or old.delivery_payment_reservation_id is not null)
    and new.delivery_payment_reservation_id is distinct from old.delivery_payment_reservation_id then
    raise exception 'Prepared registration email payment identity is immutable.';
  end if;
  if new.delivery_payload is not null and (tg_op='INSERT' or old.delivery_payload is null)
    and new.kind='welcome' and exists(select 1 from public.member_registration_access registration
      where registration.member_id=new.member_id and registration.completion_basis='paid_membership') then
    if new.delivery_payment_reservation_id is null or new.delivery_payment_reservation_id
      is distinct from private.ruined_registration_paid_reservation(new.member_id) then
      raise exception 'A paid welcome requires its current verified payment identity.';
    end if;
  end if;
  if new.delivery_payment_reservation_id is not null and (tg_op='INSERT' or old.delivery_payment_reservation_id is null)
    and (new.delivery_payload is null or new.kind<>'welcome' or new.delivery_payment_reservation_id
      is distinct from private.ruined_registration_paid_reservation(new.member_id)) then
    raise exception 'A registration email payment identity requires verified prepared bytes.';
  end if;
  return new;
end $$;
create trigger registration_message_payment_guard before insert or update on public.member_registration_messages
  for each row execute function private.ruined_guard_registration_message_payment();

-- The purchased offer itself owns founding eligibility for paid registration.
-- Do not create a second founding allocation or mislabel couples as individuals.
create or replace function private.ruined_confirm_registration_pricing(target_member_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare registration public.member_registration_access%rowtype; target_person uuid;
  founder boolean; occupancy integer; registered_count integer;
begin
  -- Existing writers take funding/member/registration locks before this lock.
  -- Never acquire any of those row locks while holding the commercial lock.
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  if exists (select 1 from public.member_registration_pricing_decisions where member_id = target_member_id) then return; end if;
  select * into registration from public.member_registration_access where member_id = target_member_id;
  if registration.completion_basis = 'paid_membership' then return; end if;
  if registration.registered_at is null
    or private.ruined_registration_pricing_end_reason(target_member_id) is not null then return; end if;
  perform private.ruined_reconcile_commercial_memberships();
  select person_id into target_person from public.ruined_members where id = target_member_id;
  select founding_eligible into founder from public.membership_enrollment_episodes
    where person_id = target_person and ended_at is null;
  if founder is null then
    select participant.founding_eligible into founder from public.membership_commercial_participants participant
      join public.membership_commercial_reservations reservation on reservation.id = participant.reservation_id
      where participant.person_id = target_person and reservation.status in ('reserved','activated')
        and not exists (select 1 from public.membership_enrollment_episodes episode
          where episode.reservation_id = reservation.id and episode.person_id = target_person and episode.ended_at is not null)
      order by reservation.created_at limit 1;
  end if;
  select count(*)::integer into occupancy from private.ruined_commercial_occupied_people() occupied where occupied.person_id <> target_person;
  select count(*)::integer into registered_count from private.ruined_commercial_registered_people() registered where registered.person_id <> target_person;
  if founder is null and registered_count < 50 and occupancy >= 50 then
    raise exception using errcode = 'P4205', message = 'A founding place is temporarily reserved in another checkout. Please try again shortly.';
  end if;
  founder := coalesce(founder, registered_count < 50);
  insert into public.member_registration_pricing_decisions(member_id,person_id,registered_at,completion_basis,
    founding_eligible,occupied_count_at_decision,monthly_amount_cents,annual_amount_cents)
    values(target_member_id,target_person,registration.registered_at,registration.completion_basis,founder,occupancy,
      case when founder and registration.completion_basis = 'saved_card' then 34900 end,
      case when founder and registration.completion_basis = 'saved_card' then 349000 end);
end
$$;


revoke all on function private.ruined_registration_intake_ready(uuid),
  private.ruined_registration_paid_reservation(uuid),private.ruined_guard_registration_payment_requirement(),
  private.ruined_guard_registration_message_payment()
  from public,anon,authenticated;
commit;
