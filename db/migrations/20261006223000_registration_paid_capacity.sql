begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

alter table public.member_registration_pricing_decisions
  drop constraint member_registration_pricing_decisions_completion_basis_check,
  add constraint member_registration_pricing_decisions_completion_basis_check
    check(completion_basis in ('saved_card','complimentary','paid_membership'));

-- Service never began only if no original or later paid enrollment has reached
-- service without a verified earlier provider cancellation. Looking at every
-- later enrollment prevents an old refunded signup reviving a departed rate.
create function private.ruined_paid_registration_never_started(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.member_registration_access registration
    join public.ruined_members member on member.id=registration.member_id
    join public.stripe_membership_prepaid_proofs original on original.reservation_id=registration.payment_reservation_id
    where registration.member_id=target_member_id and registration.registered_at is not null
      and registration.completion_basis='paid_membership'
      and not exists(select 1 from public.membership_enrollment_episodes episode
        where episode.person_id=member.person_id and episode.started_at>=registration.registered_at)
      and not exists(select 1 from public.membership_commercial_participants participant
        join public.stripe_membership_prepaid_proofs proof on proof.reservation_id=participant.reservation_id
        where participant.person_id=member.person_id
          and (proof.reservation_id=original.reservation_id or proof.created_at>=registration.registered_at)
          and (proof.activated_at is not null or (proof.service_starts_at<=clock_timestamp()
            and (proof.provider_canceled_at is null or proof.provider_canceled_at>=proof.service_starts_at)))))
$$;

-- A completed registration retains its reserved place after a fully settled
-- pre-service refund. Every subsequent payment must also be settled: an older
-- refund cannot make a later disputed, partial, pending or uncertain charge
-- appear confirmed. Those checkouts remain separate occupancy holds.
create function private.ruined_paid_registration_refund_reserved(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.ruined_paid_registration_never_started(target_member_id) and exists(
    select 1 from public.member_registration_access registration
    join public.ruined_members member on member.id=registration.member_id
    join public.stripe_membership_prepaid_proofs original on original.reservation_id=registration.payment_reservation_id
    where registration.member_id=target_member_id
      and not exists(select 1 from public.membership_commercial_participants participant
        join public.stripe_membership_prepaid_proofs proof on proof.reservation_id=participant.reservation_id
        join public.membership_commercial_reservations reservation on reservation.id=proof.reservation_id
        left join public.stripe_membership_cancellations cancellation on cancellation.id=proof.cancellation_id
        left join public.stripe_subscriptions subscription on subscription.id=proof.stripe_subscription_id
        where participant.person_id=member.person_id
          and (proof.reservation_id=original.reservation_id or proof.created_at>=registration.registered_at)
          and not (proof.refund_state='refunded' and proof.amount_refunded=proof.amount_paid
            and proof.stripe_refund_id is not null and proof.refund_verified_at is not null
            and proof.provider_canceled_at is not null and proof.provider_canceled_at<proof.service_starts_at
            and proof.activated_at is null and reservation.status='released'
            and reservation.release_reason='prepaid_cancelled_and_refunded'
            and coalesce(cancellation.status='completed' and cancellation.intent='cancel_before_start'
              and cancellation.billing_stopped_at is not null,false)
            and coalesce(subscription.stripe_status='canceled',false))))
$$;

create or replace function private.ruined_registration_pricing_end_reason(target_member_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case when member.deleted_at is not null then 'deleted'
    when lifecycle.account_state = 'closed' then 'account_closed'
    when lifecycle.standing_state = 'cancellation_requested'
      and lifecycle.cancellation_effective_at <= clock_timestamp()
      and not private.ruined_paid_registration_never_started(target_member_id) then 'cancellation_effective'
    when lifecycle.billing_state = 'ended'
      and not private.ruined_member_has_complimentary_funding(member.id)
      and not private.ruined_member_has_couple_funding(member.id)
      and not private.ruined_paid_registration_never_started(target_member_id) then 'billing_ended'
    when lifecycle.standing_state = 'inactive' and lifecycle.billing_state <> 'attention_required'
      and not private.ruined_paid_registration_never_started(target_member_id) then 'membership_inactive'
    when exists (select 1 from public.membership_enrollment_episodes episode
      where episode.person_id = member.person_id and episode.ended_at >= registration.registered_at) then 'enrollment_ended'
    end
  from public.member_registration_access registration
  join public.ruined_members member on member.id = registration.member_id
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  where registration.member_id = target_member_id
$$;

create or replace function private.ruined_registration_pricing_is_current(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.member_registration_pricing_decisions decision
    join public.ruined_members member on member.id = decision.member_id and member.person_id = decision.person_id
    where decision.member_id = target_member_id
      and private.ruined_registration_pricing_end_reason(target_member_id) is null
      and not exists (select 1 from public.member_registration_pricing_endings ending where ending.member_id = decision.member_id)
      and (decision.completion_basis<>'paid_membership'
        or private.ruined_registration_paid_reservation(target_member_id) is not null
        or private.ruined_paid_registration_refund_reserved(target_member_id)))
$$;

-- Copy the immutable decision actually purchased by each participant. Never
-- re-evaluate founding capacity, duplicate an award, or put individual prices
-- on a couples receipt. The paid receipt owns its amount; this ledger owns the
-- original participant's eligibility for a future qualifying enrollment.
create function private.ruined_confirm_paid_registration_pricing(target_member_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  insert into public.member_registration_pricing_decisions(member_id,person_id,registered_at,completion_basis,
    founding_eligible,occupied_count_at_decision)
    select registration.member_id,participant.person_id,registration.registered_at,'paid_membership',
      participant.founding_eligible,reservation.occupied_count_at_decision+participant.ordinal-1
    from public.member_registration_access registration
    join public.membership_commercial_reservations reservation on reservation.id=registration.payment_reservation_id
    join public.membership_commercial_participants participant on participant.reservation_id=reservation.id
      and participant.member_id=registration.member_id
    join public.stripe_membership_prepaid_proofs proof on proof.reservation_id=reservation.id
      and proof.member_id=reservation.payer_member_id
    where registration.member_id=target_member_id and registration.completion_basis='paid_membership'
      and registration.registered_at is not null
    on conflict(member_id) do nothing;
end $$;

create function private.ruined_paid_registration_pricing_trigger()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.completion_basis='paid_membership' and new.registered_at is not null then
    perform private.ruined_confirm_paid_registration_pricing(new.member_id);
  end if;
  return null;
end $$;
create trigger registration_paid_pricing after insert or update of registered_at on public.member_registration_access
  for each row execute function private.ruined_paid_registration_pricing_trigger();

-- The preceding release may already have confirmed paid registrations. Preserve
-- their original pinned purchase decisions; this creates no message or charge.
select private.ruined_confirm_paid_registration_pricing(member_id)
from public.member_registration_access where completion_basis='paid_membership' and registered_at is not null;

-- A settled prepaid registration is a confirmed person even while service and
-- profile access remain held for their cohort. Count each person once; retain
-- existing legacy/funded-member rules. The paid ledger requires current payment
-- proof or a retained completed-registration reservation after a settled full
-- pre-service refund; unresolved adjustments remain separate checkout holds.
create or replace function private.ruined_commercial_registered_people()
returns table(person_id uuid) language sql stable security invoker set search_path = '' as $$
  select member.person_id from public.ruined_members member
    where private.ruined_member_is_active_registered(member.id)
  union
  select decision.person_id from public.member_registration_pricing_decisions decision
    where private.ruined_registration_pricing_is_current(decision.member_id)
      and not exists (select 1 from public.membership_enrollment_episodes episode
        where episode.person_id = decision.person_id and episode.ended_at is null)
$$;

revoke all on function private.ruined_commercial_registered_people() from public,anon,authenticated;
revoke all on function private.ruined_paid_registration_never_started(uuid),
  private.ruined_paid_registration_refund_reserved(uuid),private.ruined_confirm_paid_registration_pricing(uuid),
  private.ruined_paid_registration_pricing_trigger() from public,anon,authenticated;
commit;
