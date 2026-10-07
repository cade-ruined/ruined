begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Historical registrations keep their original no-charge completion option.
-- They may instead explicitly purchase membership after verified intake.
-- No requirement, accepted agreement, subscription, or completed identity is
-- changed here. Only verified payment can satisfy the alternative completion.
create or replace function private.ruined_member_registration_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
 select exists(select 1 from public.member_registration_access registration
   where registration.member_id=target_member_id and private.ruined_registration_intake_ready(target_member_id)
     and (private.ruined_member_has_complimentary_funding(target_member_id) or private.ruined_member_has_operator_funding(target_member_id)
       or (private.ruined_member_paid_reservation(target_member_id) is not null)
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

-- Checkout and agreement APIs still enforce live configuration, intake and
-- explicit member consent. A standalone saved card is not a prerequisite.
create or replace function private.ruined_member_paid_activation_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select private.ruined_member_profile_released(target_member_id)
    or private.ruined_registration_intake_ready(target_member_id)
$$;

-- A voluntarily paid historical registration can finish with payment proof.
-- Existing completed registrations retain their immutable completion identity.
create or replace function private.ruined_guard_registration_payment_requirement() returns trigger
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
    if new.completion_basis='paid_membership' and (new.payment_reservation_id is null or
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

commit;
