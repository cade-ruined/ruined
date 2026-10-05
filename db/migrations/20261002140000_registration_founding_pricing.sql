begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- A registration decision is independent of a charge, subscription, profile
-- release or member number. Retain both positive and negative decisions.
create table public.member_registration_pricing_decisions (
  member_id uuid primary key references public.member_registration_access(member_id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  registered_at timestamptz not null,
  decided_at timestamptz not null default clock_timestamp(),
  completion_basis text not null check (completion_basis in ('saved_card','complimentary')),
  founding_eligible boolean not null,
  occupied_count_at_decision integer not null check (occupied_count_at_decision >= 0),
  currency text not null default 'usd' check (currency = 'usd'),
  monthly_amount_cents integer,
  annual_amount_cents integer,
  check (case when founding_eligible and completion_basis = 'saved_card'
    then monthly_amount_cents = 34900 and annual_amount_cents = 349000
      and monthly_amount_cents is not null and annual_amount_cents is not null
    else monthly_amount_cents is null and annual_amount_cents is null end)
);
-- Ending a registration's membership continuity never edits its award. In
-- particular, reopening an account cannot resurrect an earlier confirmation.
create table public.member_registration_pricing_endings (
  member_id uuid primary key references public.member_registration_pricing_decisions(member_id) on delete restrict,
  ended_at timestamptz not null default clock_timestamp(),
  reason text not null check (reason in ('deleted','account_closed','cancellation_effective',
    'billing_ended','membership_inactive','enrollment_ended'))
);
alter table public.member_registration_pricing_decisions enable row level security;
alter table public.member_registration_pricing_endings enable row level security;
revoke all on public.member_registration_pricing_decisions, public.member_registration_pricing_endings
  from public, anon, authenticated;
create trigger registration_pricing_decisions_append_only before update or delete on public.member_registration_pricing_decisions
  for each row execute function public.ruined_reject_append_only_mutation();
create trigger registration_pricing_endings_append_only before update or delete on public.member_registration_pricing_endings
  for each row execute function public.ruined_reject_append_only_mutation();

create function private.ruined_registration_pricing_end_reason(target_member_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case when member.deleted_at is not null then 'deleted'
    when lifecycle.account_state = 'closed' then 'account_closed'
    when lifecycle.standing_state = 'cancellation_requested'
      and lifecycle.cancellation_effective_at <= clock_timestamp() then 'cancellation_effective'
    when lifecycle.billing_state = 'ended'
      and not private.ruined_member_has_complimentary_funding(member.id)
      and not private.ruined_member_has_couple_funding(member.id) then 'billing_ended'
    when lifecycle.standing_state = 'inactive' and lifecycle.billing_state <> 'attention_required' then 'membership_inactive'
    when exists (select 1 from public.membership_enrollment_episodes episode
      where episode.person_id = member.person_id and episode.ended_at >= registration.registered_at) then 'enrollment_ended'
    end
  from public.member_registration_access registration
  join public.ruined_members member on member.id = registration.member_id
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  where registration.member_id = target_member_id
$$;

create function private.ruined_registration_pricing_is_current(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.member_registration_pricing_decisions decision
    join public.ruined_members member on member.id = decision.member_id and member.person_id = decision.person_id
    where decision.member_id = target_member_id
      and private.ruined_registration_pricing_end_reason(target_member_id) is null
      and not exists (select 1 from public.member_registration_pricing_endings ending where ending.member_id = decision.member_id))
$$;

create function private.ruined_registration_founding_pricing_is_current(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.member_registration_pricing_decisions decision
    where decision.member_id = target_member_id and decision.founding_eligible and decision.completion_basis = 'saved_card'
      and private.ruined_registration_pricing_is_current(target_member_id))
$$;

create function private.ruined_end_registration_pricing()
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  insert into public.member_registration_pricing_endings(member_id, reason)
    select decision.member_id, private.ruined_registration_pricing_end_reason(decision.member_id)
    from public.member_registration_pricing_decisions decision
    where private.ruined_registration_pricing_end_reason(decision.member_id) is not null
    on conflict (member_id) do nothing;
end
$$;

-- Confirmed registrations occupy a person once, including complimentary
-- registrations and both adults of a couple. Existing paid people keep their
-- original episode decisions. In-flight Stripe Checkouts remain separate holds.
create function private.ruined_commercial_registered_people()
returns table(person_id uuid) language sql stable security invoker set search_path = '' as $$
  select member.person_id from public.ruined_members member
    where private.ruined_member_is_active_registered(member.id)
  union
  select decision.person_id from public.member_registration_pricing_decisions decision
    where private.ruined_registration_pricing_is_current(decision.member_id)
      -- Once enrolled, the existing funded-member predicate owns occupancy.
      -- Billing attention retains the award without reviving the intake hold.
      and not exists (select 1 from public.membership_enrollment_episodes episode
        where episode.person_id = decision.person_id and episode.ended_at is null)
$$;

create function private.ruined_commercial_occupied_people()
returns table(person_id uuid) language sql stable security invoker set search_path = '' as $$
  select registered.person_id from private.ruined_commercial_registered_people() registered
  union
  select participant.person_id from public.membership_commercial_participants participant
  join public.membership_commercial_reservations reservation on reservation.id = participant.reservation_id
  where reservation.status = 'reserved'
    or (reservation.status = 'activated' and not exists (
      select 1 from public.membership_enrollment_episodes episode
      where episode.reservation_id = reservation.id and episode.member_id = participant.member_id
    ) and exists (select 1 from public.stripe_subscriptions subscription
      where subscription.id = reservation.stripe_subscription_id and subscription.stripe_status not in ('canceled','incomplete_expired')))
$$;

create or replace function private.ruined_commercial_occupied_count()
returns integer language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from private.ruined_commercial_occupied_people()
$$;

create function private.ruined_confirm_registration_pricing(target_member_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare registration public.member_registration_access%rowtype; target_person uuid;
  founder boolean; occupancy integer; registered_count integer;
begin
  -- Existing writers take funding/member/registration locks before this lock.
  -- Never acquire any of those row locks while holding the commercial lock.
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  if exists (select 1 from public.member_registration_pricing_decisions where member_id = target_member_id) then return; end if;
  select * into registration from public.member_registration_access where member_id = target_member_id;
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

create function private.ruined_registration_pricing_trigger()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.registered_at is not null then
    if not private.ruined_member_registration_ready(new.member_id) then
      raise exception using errcode = 'P4303', message = 'Complete registration with a verified saved card or complimentary funding first.';
    end if;
    perform private.ruined_confirm_registration_pricing(new.member_id);
  end if;
  return null;
end
$$;
create trigger registration_founding_pricing after insert or update of registered_at on public.member_registration_access
  for each row execute function private.ruined_registration_pricing_trigger();

-- Pin the completion identity as well as the decision; removing a timestamp
-- must not make an existing confirmation eligible to be allocated twice.
create function private.ruined_guard_registration_pricing_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.registered_at is not null and row(new.member_id,new.registered_at,new.completion_basis,new.payment_setup_attempt_id)
    is distinct from row(old.member_id,old.registered_at,old.completion_basis,old.payment_setup_attempt_id) then
    raise exception 'A completed registration identity is immutable.';
  end if;
  return new;
end
$$;
create trigger registration_pricing_identity before update on public.member_registration_access
  for each row execute function private.ruined_guard_registration_pricing_identity();

-- Commercial function replacements and deterministic historical allocation
-- follow below. No welcome messages or billing records are created here.
create or replace function private.ruined_reconcile_commercial_memberships()
returns void language plpgsql security invoker set search_path = '' as $$
declare row_record record; enrollment public.membership_enrollment_episodes%rowtype;
  participant public.membership_commercial_participants%rowtype; occupancy integer; active_count integer; founder boolean; source_kind text;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  perform private.ruined_end_registration_pricing();
  -- A quote with no persisted Stripe attempt cannot have contacted Stripe.
  -- Expire only these abandoned local quotes; ambiguous remote creates stay held.
  with expired as (
    update public.membership_commercial_reservations reservation
    set status = 'released', released_at = clock_timestamp(), release_reason = 'before_checkout_abandoned'
    where reservation.status = 'reserved' and reservation.expires_at <= clock_timestamp()
      and not exists (select 1 from public.stripe_checkout_attempts attempt where attempt.id = reservation.id)
    returning id, payer_member_id
  ) insert into public.membership_commercial_events(member_id, reservation_id, event_type, evidence)
    select payer_member_id, id, 'released', jsonb_build_object('reason', 'unused_quote_expired') from expired;
  -- Attention/paused billing restricts access but does not itself cancel an
  -- enrollment or erase a continuous member's previously earned founding rate.
  for row_record in
    select episode.*, lifecycle.cancellation_effective_at as next_cancellation,
      lifecycle.billing_state, member.deleted_at,
      case when member.deleted_at is not null then 'deleted'
        when lifecycle.account_state = 'closed' then 'account_closed'
        when lifecycle.standing_state = 'cancellation_requested'
          and lifecycle.cancellation_effective_at <= clock_timestamp() then 'cancellation_effective'
        when lifecycle.billing_state = 'ended' and not private.ruined_member_has_complimentary_funding(member.id)
          and not private.ruined_member_has_couple_funding(member.id) then 'billing_ended'
        when lifecycle.standing_state = 'inactive' and lifecycle.billing_state <> 'attention_required' then 'membership_inactive'
        when episode.source = 'complimentary' and lifecycle.billing_state = 'pending'
          and not private.ruined_member_has_complimentary_funding(member.id) then 'complimentary_ended'
        when episode.source = 'couple' and not private.ruined_member_has_complimentary_funding(member.id)
          and exists (select 1 from public.membership_commercial_reservations reservation
          join public.stripe_subscriptions subscription on subscription.id = reservation.stripe_subscription_id
          where reservation.id = episode.reservation_id and subscription.stripe_status in ('canceled', 'incomplete_expired')) then 'couple_ended'
      end as termination_reason
    from public.membership_enrollment_episodes episode
    join public.ruined_members member on member.id = episode.member_id
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
    where episode.ended_at is null
  loop
    if row_record.termination_reason is not null then
      update public.membership_enrollment_episodes set ended_at = greatest(started_at,
        case when row_record.termination_reason = 'cancellation_effective' then row_record.next_cancellation else clock_timestamp() end),
        end_reason = row_record.termination_reason where id = row_record.id;
      insert into public.membership_commercial_events(member_id, episode_id, reservation_id, event_type, evidence)
        values(row_record.member_id, row_record.id, row_record.reservation_id, 'ended', jsonb_build_object('reason', row_record.termination_reason));
    else
      if row_record.cancellation_effective_at is distinct from row_record.next_cancellation then
        update public.membership_enrollment_episodes set cancellation_effective_at = row_record.next_cancellation where id = row_record.id;
        insert into public.membership_commercial_events(member_id, episode_id, event_type, evidence)
          values(row_record.member_id, row_record.id, case when row_record.next_cancellation is null then 'cancellation_withdrawn' else 'cancellation_scheduled' end,
            jsonb_build_object('effectiveAt', row_record.next_cancellation));
      end if;
      if (row_record.billing_attention_at is not null) is distinct from (row_record.billing_state = 'attention_required') then
        update public.membership_enrollment_episodes set billing_attention_at = case when row_record.billing_state = 'attention_required' then clock_timestamp() end where id = row_record.id;
        insert into public.membership_commercial_events(member_id, episode_id, event_type)
          values(row_record.member_id, row_record.id, case when row_record.billing_state = 'attention_required' then 'billing_attention' else 'billing_recovered' end);
      end if;
    end if;
  end loop;

  for row_record in
    select member.id, member.person_id, onboarding.completed_at, lifecycle.access_started_at
    from public.ruined_members member
    join public.member_onboardings onboarding on onboarding.member_id = member.id
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
    where private.ruined_member_is_active_registered(member.id)
      and not exists (select 1 from public.membership_enrollment_episodes episode where episode.person_id = member.person_id and episode.ended_at is null)
    order by coalesce(lifecycle.access_started_at, onboarding.completed_at), member.id
  loop
    select candidate.* into participant from public.membership_commercial_participants candidate
      join public.membership_commercial_reservations reservation on reservation.id = candidate.reservation_id
      where candidate.member_id = row_record.id and reservation.status in ('reserved', 'activated')
        and not exists (select 1 from public.membership_enrollment_episodes previous where previous.reservation_id = candidate.reservation_id and previous.member_id = row_record.id)
      order by reservation.created_at limit 1;
    if participant.reservation_id is not null then
      -- Paid reservations must first be confirmed by the verified billing path.
      if not exists (select 1 from public.membership_commercial_reservations reservation
        where reservation.id = participant.reservation_id and reservation.status = 'activated') then continue; end if;
      founder := participant.founding_eligible;
      select case when kind = 'couple' then 'couple' else 'paid' end into source_kind
        from public.membership_commercial_reservations where id = participant.reservation_id;
    elsif private.ruined_registration_pricing_is_current(row_record.id) then
      select decision.founding_eligible into founder from public.member_registration_pricing_decisions decision
        where decision.member_id = row_record.id;
      source_kind := case when private.ruined_member_has_complimentary_funding(row_record.id) then 'complimentary' else 'existing' end;
    else
      -- Existing active people are ranked only during the initial backfill.
      -- Subsequently every completed activation is serialized by this lock.
      select count(*)::integer into active_count from (
        select member.person_id from public.ruined_members member
          where private.ruined_member_is_active_registered(member.id) and member.person_id <> row_record.person_id
            and (exists (select 1 from public.membership_enrollment_episodes known where known.person_id = member.person_id and known.ended_at is null)
              or (coalesce((select access_started_at from public.member_lifecycle where member_id = member.id),
                (select completed_at from public.member_onboardings where member_id = member.id)), member.id)
                < (coalesce(row_record.access_started_at, row_record.completed_at), row_record.id))
        union
        select decision.person_id from public.member_registration_pricing_decisions decision
          where decision.person_id <> row_record.person_id and private.ruined_registration_pricing_is_current(decision.member_id)
            and not exists (select 1 from public.membership_enrollment_episodes episode
              where episode.person_id = decision.person_id and episode.ended_at is null)
      ) registered;
      occupancy := active_count + (select count(distinct held.person_id)::integer from public.membership_commercial_participants held
        join public.membership_commercial_reservations reservation on reservation.id = held.reservation_id
        where (reservation.status = 'reserved' or (reservation.status = 'activated'
          and not exists (select 1 from public.membership_enrollment_episodes consumed
            where consumed.reservation_id = reservation.id and consumed.member_id = held.member_id)
          and exists (select 1 from public.stripe_subscriptions subscription
            where subscription.id = reservation.stripe_subscription_id and subscription.stripe_status not in ('canceled', 'incomplete_expired'))))
          and held.member_id <> row_record.id
          and not exists (select 1 from private.ruined_commercial_registered_people() registered where registered.person_id = held.person_id));
      -- A pending offer cannot demote an otherwise founding complimentary
      -- activation. Retry its final activation after the reserved place settles;
      -- the enclosing transaction rolls back and the accepted price stays bound.
      if active_count < 50 and occupancy >= 50 then
        raise exception using errcode = 'P4205', message = 'A founding place is temporarily reserved in another checkout. Please try again shortly.';
      end if;
      founder := active_count < 50;
      source_kind := case when private.ruined_member_has_complimentary_funding(row_record.id) then 'complimentary' else 'existing' end;
    end if;
    insert into public.membership_enrollment_episodes(member_id, person_id, reservation_id, source, founding_eligible, started_at)
      values(row_record.id, row_record.person_id, participant.reservation_id, source_kind, founder,
        case when exists(select 1 from public.membership_enrollment_episodes previous where previous.member_id = row_record.id)
          then clock_timestamp() else coalesce(row_record.access_started_at, row_record.completed_at, clock_timestamp()) end)
      returning * into enrollment;
    insert into public.membership_commercial_events(member_id, episode_id, reservation_id, event_type, evidence)
      values(row_record.id, enrollment.id, participant.reservation_id, 'enrolled', jsonb_build_object('foundingEligible', founder, 'source', source_kind));
  end loop;
end
$$;

create or replace function private.ruined_reserve_commercial_membership(request_id uuid, payer_id uuid, membership_kind text, plan text, partner_id uuid, authorization_id uuid, reservation_expires_at timestamptz)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare existing public.membership_commercial_reservations%rowtype; target_id uuid; target_person uuid;
  target_name text; founder boolean; payer_founder boolean; occupancy integer; active_count integer; position integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  perform private.ruined_reconcile_commercial_memberships();
  if membership_kind not in ('individual', 'couple') or membership_kind is null
    or plan is null or plan not in ('monthly', 'annual')
    or (membership_kind = 'couple') is distinct from (partner_id is not null)
    or payer_id = partner_id or payer_id is null or request_id is null
    or reservation_expires_at <= clock_timestamp() or not isfinite(reservation_expires_at)
  then raise exception using errcode = 'P4200', message = 'Invalid membership reservation.'; end if;
  select * into existing from public.membership_commercial_reservations where id = request_id;
  if found then
    if existing.payer_member_id <> payer_id or existing.kind <> membership_kind or existing.billing_plan <> plan
      or existing.couple_authorization_id is distinct from authorization_id
      or existing.status = 'released' or (select member_id from public.membership_commercial_participants where reservation_id = request_id and ordinal = 2) is distinct from partner_id
    then raise exception using errcode = 'P4201', message = 'Membership reservation conflicts with an existing request.'; end if;
    perform private.ruined_validate_commercial_reservation(request_id);
    return request_id;
  end if;
  select reservation.* into existing from public.membership_commercial_reservations reservation
    where reservation.payer_member_id = payer_id and reservation.status = 'reserved'
    order by reservation.created_at limit 1;
  if found then
    if existing.kind = membership_kind and existing.billing_plan = plan
      and existing.couple_authorization_id is not distinct from authorization_id
      and (select member_id from public.membership_commercial_participants where reservation_id = existing.id and ordinal = 2) is not distinct from partner_id
    then perform private.ruined_validate_commercial_reservation(existing.id); return existing.id; end if;
    raise exception using errcode = 'P4201', message = 'Release the previous Checkout quote before choosing a different membership.';
  end if;
  if (membership_kind = 'couple' and not exists (
    select 1 from public.membership_couple_authorizations approval
    join public.platform_users partner on partner.auth_user_id = approval.accepted_by_auth_user_id
      and partner.member_id = partner_id and partner.status = 'active'
    where approval.id = authorization_id and approval.payer_member_id = payer_id
      and approval.partner_member_id = partner_id and approval.accepted_at is not null
      and approval.revoked_at is null and approval.expires_at > clock_timestamp()
  )) or (membership_kind = 'individual' and authorization_id is not null) then
    raise exception using errcode = 'P4204', message = 'The second adult must accept this shared membership first.';
  end if;
  occupancy := private.ruined_commercial_occupied_count();
  select count(*)::integer into active_count from private.ruined_commercial_registered_people();
  -- Validate every person before persisting either seat. Both adults use their
  -- own verified account, named profile and durable age attestation.
  foreach target_id in array array_remove(array[payer_id, partner_id], null) loop
    select member.person_id, coalesce(nullif(btrim(profile.preferred_name), ''), nullif(btrim(profile.display_name), ''))
      into target_person, target_name
      from public.ruined_members member
      join public.people person on person.id = member.person_id and person.status = 'active'
      join public.person_profiles profile on profile.person_id = member.person_id
      join public.person_private_profiles private_profile on private_profile.person_id = member.person_id
        and private_profile.default_fulfillment_address->>'countryCode' = 'US'
        and private_profile.birth_date <= (current_date - interval '18 years')::date
      join public.member_lifecycle lifecycle on lifecycle.member_id = member.id and lifecycle.account_state = 'active'
      where member.id = target_id and member.deleted_at is null
        and exists (select 1 from public.platform_users account
          join public.platform_role_grants grant_row on grant_row.auth_user_id = account.auth_user_id
            and grant_row.role_slug = 'member' and grant_row.revoked_at is null
          where account.member_id = member.id and account.person_id = member.person_id and account.status = 'active')
        and exists (select 1 from public.person_email_addresses email where email.person_id = member.person_id and email.verification_state = 'verified' and email.retired_at is null)
        and exists (select 1 from public.member_consents consent where consent.member_id = member.id
          and consent.consent_type = 'age_attestation' and consent.decision = 'accepted')
        and exists (select 1 from public.membership_agreement_acceptances acceptance
          join public.membership_agreement_versions agreement on agreement.id = acceptance.agreement_version_id
            and agreement.agreement_key = 'ruined_membership' and agreement.status = 'published' and agreement.version >= 2
            and (agreement.effective_at is null or agreement.effective_at <= clock_timestamp())
          where acceptance.member_id = member.id and acceptance.person_id = member.person_id);
    if target_person is null or target_name is null then
      raise exception using errcode = 'P4202', message = 'Each member needs a named verified adult account and a United States profile address.';
    end if;
    if exists (select 1 from public.membership_commercial_participants held
      join public.membership_commercial_reservations reservation on reservation.id = held.reservation_id
      where held.person_id = target_person and (reservation.status = 'reserved' or (reservation.status = 'activated'
        and not exists (select 1 from public.membership_enrollment_episodes episode where episode.reservation_id = reservation.id and episode.member_id = held.member_id and episode.ended_at is not null))))
      or (membership_kind = 'couple' and exists (select 1 from public.stripe_subscriptions subscription where subscription.member_id = target_id and subscription.stripe_status not in ('canceled', 'incomplete_expired')))
    then raise exception using errcode = 'P4201', message = 'This person already has a membership reservation or active billing group.'; end if;
  end loop;
  select episode.founding_eligible into payer_founder from public.membership_enrollment_episodes episode
    where episode.member_id = payer_id and episode.ended_at is null;
  if payer_founder is null then
    select decision.founding_eligible into payer_founder from public.member_registration_pricing_decisions decision
      where decision.member_id = payer_id and private.ruined_registration_pricing_is_current(payer_id);
  end if;
  -- Pending checkouts reserve capacity, but are not active registered members.
  -- Wait for their outcome instead of substituting a higher-priced offer.
  if payer_founder is null and active_count < 50 and occupancy >= 50 then
    raise exception using errcode = 'P4205', message = 'A founding place is temporarily reserved in another checkout. Please try again shortly.';
  end if;
  payer_founder := coalesce(payer_founder, active_count < 50);
  insert into public.membership_commercial_reservations(id, payer_member_id, kind, billing_plan, couple_authorization_id, tier, occupied_count_at_decision, expires_at)
    values(request_id, payer_id, membership_kind, plan, authorization_id, case when membership_kind = 'couple' then 'couple'
      when payer_founder then 'founding_individual' else 'individual' end, occupancy, reservation_expires_at);
  foreach target_id in array array_remove(array[payer_id, partner_id], null) loop
    position := position + 1;
    select member.person_id, coalesce(nullif(btrim(profile.preferred_name), ''), nullif(btrim(profile.display_name), ''))
      into target_person, target_name from public.ruined_members member join public.person_profiles profile on profile.person_id = member.person_id where member.id = target_id;
    select episode.founding_eligible into founder from public.membership_enrollment_episodes episode where episode.member_id = target_id and episode.ended_at is null;
    if founder is null then
      select decision.founding_eligible into founder from public.member_registration_pricing_decisions decision
        where decision.member_id = target_id and private.ruined_registration_pricing_is_current(target_id);
    end if;
    if founder is null and active_count < 50 and occupancy >= 50 then
      raise exception using errcode = 'P4205', message = 'A founding place is temporarily reserved in another checkout. Please try again shortly.';
    end if;
    founder := coalesce(founder, active_count < 50);
    insert into public.membership_commercial_participants(reservation_id, member_id, person_id, ordinal, founding_eligible, name_snapshot)
      values(request_id, target_id, target_person, position, founder, target_name);
    if not exists (select 1 from private.ruined_commercial_registered_people() registered where registered.person_id = target_person) then
      occupancy := occupancy + 1;
      active_count := active_count + 1;
    end if;
  end loop;
  insert into public.membership_commercial_events(member_id, reservation_id, event_type, evidence)
    values(payer_id, request_id, 'reserved', jsonb_build_object('kind', membership_kind, 'occupiedCount', occupancy));
  return request_id;
end
$$;

-- Historical decisions use completed-registration order after preserving all
-- existing paid/complimentary episode decisions. This deliberately does not
-- enqueue or rewrite welcome email deliveries.
do $$
declare registration record;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  perform private.ruined_reconcile_commercial_memberships();
  for registration in select member_id from public.member_registration_access
    where registered_at is not null order by registered_at, member_id loop
    perform private.ruined_confirm_registration_pricing(registration.member_id);
  end loop;
end
$$;

revoke all on function private.ruined_registration_pricing_end_reason(uuid),
  private.ruined_registration_pricing_is_current(uuid), private.ruined_registration_founding_pricing_is_current(uuid),
  private.ruined_end_registration_pricing(), private.ruined_commercial_registered_people(),
  private.ruined_commercial_occupied_people(), private.ruined_confirm_registration_pricing(uuid),
  private.ruined_registration_pricing_trigger(), private.ruined_guard_registration_pricing_identity()
  from public, anon, authenticated;

commit;
