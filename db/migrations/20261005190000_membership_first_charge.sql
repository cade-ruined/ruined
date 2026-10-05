begin;

-- Null retains immediate billing for historical consent and purchases made after
-- launch. A separate bound timestamp distinguishes a new, not-yet-issued quote.
alter table public.membership_commercial_reservations
  add column first_charge_at timestamptz,
  add column billing_schedule_bound_at timestamptz;
update public.membership_commercial_reservations set billing_schedule_bound_at=created_at;
alter table public.stripe_checkout_attempts add column first_charge_at timestamptz;

create function private.ruined_preserve_membership_billing_schedule() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='membership_commercial_reservations' then
    if old.billing_schedule_bound_at is not null and
      (new.first_charge_at is distinct from old.first_charge_at or
       new.billing_schedule_bound_at is distinct from old.billing_schedule_bound_at) then
      raise exception 'The disclosed membership billing date is immutable.';
    end if;
  elsif new.first_charge_at is distinct from old.first_charge_at then
    raise exception 'The accepted membership billing date is immutable.';
  end if;
  return new;
end $$;
create trigger membership_commercial_billing_schedule_immutable before update on public.membership_commercial_reservations
  for each row execute function private.ruined_preserve_membership_billing_schedule();
create trigger membership_checkout_billing_schedule_immutable before update on public.stripe_checkout_attempts
  for each row execute function private.ruined_preserve_membership_billing_schedule();

alter table public.stripe_checkout_attempts add constraint stripe_checkout_first_charge_consent check (
  first_charge_at is null or (
    recurring_payment_terms->>'firstPayment'='scheduled'
    and (recurring_payment_terms->>'firstChargeAt')::timestamptz=first_charge_at
    and first_charge_at > recurring_payment_accepted_at
    and expires_at < first_charge_at
  ) is true
);

-- Completed, still-held registrations may authorize billing. This grants no
-- profile, program, badge or membership access, and incomplete registrations
-- continue to fail at the database boundary for both payer and partner.
create function private.ruined_member_paid_activation_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select private.ruined_member_profile_released(target_member_id) or (
    exists(select 1 from public.member_registration_access
      where member_id=target_member_id and registered_at is not null)
    and private.ruined_member_registration_ready(target_member_id)
  )
$$;
create or replace function private.ruined_guard_registration_checkout() returns trigger
language plpgsql set search_path=pg_catalog,public,private as $$
begin
  if not private.ruined_member_paid_activation_ready(new.member_id) then
    raise exception using errcode='P4201',message='Complete registration before authorizing membership billing.';
  end if;
  return new;
end $$;

-- Recheck both adults at payment time, including a held partner who withdrew
-- their saved method after the offer was issued.
create or replace function private.ruined_validate_commercial_reservation(request_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare reservation public.membership_commercial_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  select * into reservation from public.membership_commercial_reservations where id = request_id;
  if reservation.id is null or reservation.status <> 'reserved' then return; end if;
  if exists (select 1 from public.membership_commercial_participants participant
    where participant.reservation_id = request_id and not exists (
      select 1 from public.ruined_members member
      join public.people person on person.id = member.person_id and person.status = 'active'
      join public.member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
      join public.person_profiles profile on profile.person_id = member.person_id
        and coalesce(nullif(btrim(profile.preferred_name), ''), nullif(btrim(profile.display_name), '')) is not null
      join public.person_private_profiles private_profile on private_profile.person_id = member.person_id
        and private_profile.default_fulfillment_address->>'countryCode' = 'US'
        and private_profile.birth_date <= (current_date - interval '18 years')::date
      where member.id = participant.member_id and member.person_id = participant.person_id and member.deleted_at is null
        and private.ruined_member_paid_activation_ready(member.id)
        and exists (select 1 from public.platform_users account
          join public.platform_role_grants grant_row on grant_row.auth_user_id = account.auth_user_id and grant_row.role_slug = 'member' and grant_row.revoked_at is null
          where account.member_id = member.id and account.person_id = member.person_id and account.status = 'active')
        and exists (select 1 from public.person_email_addresses email where email.person_id = member.person_id and email.verification_state = 'verified' and email.retired_at is null)
        and exists (select 1 from public.member_consents consent where consent.member_id = member.id and consent.consent_type = 'age_attestation' and consent.decision = 'accepted')
        and exists (select 1 from public.membership_agreement_acceptances acceptance
          join public.membership_agreement_versions agreement on agreement.id = acceptance.agreement_version_id
            and agreement.agreement_key = 'ruined_membership' and agreement.status = 'published' and agreement.version >= 2
            and (agreement.effective_at is null or agreement.effective_at <= clock_timestamp())
          where acceptance.member_id = member.id and acceptance.person_id = member.person_id)
    )) then raise exception using errcode = 'P4202', message = 'Each member must retain a verified adult account and United States profile address.'; end if;
  if reservation.kind = 'couple' and not exists (
    select 1 from public.membership_couple_authorizations approval
    join public.platform_users partner on partner.auth_user_id = approval.accepted_by_auth_user_id
      and partner.member_id = approval.partner_member_id and partner.status = 'active'
    join public.membership_commercial_participants participant on participant.reservation_id = request_id and participant.ordinal = 2
      and participant.member_id = approval.partner_member_id and participant.person_id = partner.person_id
    where approval.id = reservation.couple_authorization_id and approval.payer_member_id = reservation.payer_member_id
      and approval.accepted_at is not null and approval.revoked_at is null and approval.expires_at > clock_timestamp()
  ) then raise exception using errcode = 'P4204', message = 'The second adult must accept this shared membership first.'; end if;
end
$$;

-- A completed $0 Checkout may be canceled before billing begins. Never release
-- a paid enrollment or infer cancellation from time alone. The caller first
-- persists the Stripe subscription retrieved during its verified webhook.
create function private.ruined_release_scheduled_membership(reservation_id uuid, subscription_id text, provider_canceled_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare reservation public.membership_commercial_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  select * into reservation from public.membership_commercial_reservations where id=reservation_id;
  if reservation.id is null or reservation.status='released' then return; end if;
  if reservation.status<>'reserved' or reservation.first_charge_at is null
    or provider_canceled_at is null or provider_canceled_at >= reservation.first_charge_at
    or provider_canceled_at > clock_timestamp()
    or reservation.stripe_subscription_id is distinct from subscription_id
    or not exists(select 1 from public.stripe_subscriptions
      where id=subscription_id and member_id=reservation.payer_member_id and stripe_status='canceled')
    or exists(select 1 from public.stripe_invoices
      where stripe_subscription_id=subscription_id)
  then raise exception using errcode='P4201',message='Confirm unpaid scheduled membership cancellation before releasing its place.'; end if;
  update public.membership_commercial_reservations set status='released',released_at=clock_timestamp(),release_reason='cancelled_before_payment'
    where id=reservation_id;
  insert into public.membership_commercial_events(member_id,reservation_id,event_type,evidence)
    values(reservation.payer_member_id,reservation.id,'released',jsonb_build_object('reason','cancelled_before_payment','subscriptionId',subscription_id,'canceledAt',provider_canceled_at));
end $$;

alter table public.stripe_membership_cancellations drop constraint stripe_membership_cancellations_intent_check;
alter table public.stripe_membership_cancellations add constraint stripe_membership_cancellations_intent_check
  check(intent in ('disable_renewal','early_exit','cancel_before_start'));
alter table public.stripe_membership_cancellations add constraint stripe_membership_prestart_no_fee
  check(intent='early_exit' or buyout_dues=0);

revoke all on function private.ruined_preserve_membership_billing_schedule(),
  private.ruined_member_paid_activation_ready(uuid), private.ruined_release_scheduled_membership(uuid,text,timestamptz)
  from public,anon,authenticated;
commit;
