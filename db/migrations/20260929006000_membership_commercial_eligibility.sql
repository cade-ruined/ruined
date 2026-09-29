begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create table public.membership_couple_authorizations (
  id uuid primary key,
  payer_member_id uuid not null references public.ruined_members(id) on delete restrict,
  partner_member_id uuid not null references public.ruined_members(id) on delete restrict,
  accepted_by_auth_user_id uuid references public.platform_users(auth_user_id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  created_at timestamptz not null default clock_timestamp(),
  check (payer_member_id <> partner_member_id),
  check ((accepted_at is null) = (accepted_by_auth_user_id is null)),
  check (expires_at > created_at)
);
alter table public.membership_couple_authorizations enable row level security;
revoke all on public.membership_couple_authorizations from public, anon, authenticated;

-- These are membership episodes, not permanent member numbers. A cancelled
-- person's next episode must receive a new decision using the current count.
create table public.membership_commercial_reservations (
  id uuid primary key,
  payer_member_id uuid not null references public.ruined_members(id) on delete restrict,
  kind text not null check (kind in ('individual', 'couple')),
  billing_plan text not null check (billing_plan in ('monthly', 'annual')),
  couple_authorization_id uuid references public.membership_couple_authorizations(id) on delete restrict,
  tier text not null check (tier in ('individual', 'founding_individual', 'couple')),
  status text not null default 'reserved' check (status in ('reserved', 'activated', 'released')),
  occupied_count_at_decision integer not null check (occupied_count_at_decision >= 0),
  stripe_subscription_id text unique,
  stripe_price_id text check (stripe_price_id is null or stripe_price_id like 'price_%'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  activated_at timestamptz,
  released_at timestamptz,
  release_reason text,
  check ((kind = 'couple') = (tier = 'couple')),
  check ((kind = 'couple') = (couple_authorization_id is not null)),
  check (isfinite(expires_at) and expires_at > created_at),
  check (status <> 'activated' or (activated_at is not null and stripe_subscription_id is not null)),
  check (status <> 'released' or (released_at is not null and release_reason is not null))
);

create table public.membership_commercial_participants (
  reservation_id uuid not null references public.membership_commercial_reservations(id) on delete restrict,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  ordinal integer not null check (ordinal in (1, 2)),
  founding_eligible boolean not null,
  name_snapshot text not null check (char_length(btrim(name_snapshot)) between 1 and 180),
  primary key (reservation_id, member_id),
  unique (reservation_id, person_id),
  unique (reservation_id, ordinal)
);

create table public.membership_enrollment_episodes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  reservation_id uuid references public.membership_commercial_reservations(id) on delete restrict,
  source text not null check (source in ('existing', 'paid', 'complimentary', 'couple')),
  founding_eligible boolean not null,
  started_at timestamptz not null,
  cancellation_effective_at timestamptz,
  billing_attention_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default clock_timestamp(),
  check (ended_at is null or (ended_at >= started_at and end_reason is not null))
);
create unique index membership_enrollment_open_member on public.membership_enrollment_episodes(member_id) where ended_at is null;
create unique index membership_enrollment_open_person on public.membership_enrollment_episodes(person_id) where ended_at is null;
create index membership_enrollment_history on public.membership_enrollment_episodes(member_id, started_at desc);

create table public.membership_commercial_events (
  id bigint generated always as identity primary key,
  member_id uuid references public.ruined_members(id) on delete restrict,
  episode_id uuid references public.membership_enrollment_episodes(id) on delete restrict,
  reservation_id uuid references public.membership_commercial_reservations(id) on delete restrict,
  event_type text not null check (event_type in (
    'reserved', 'activated', 'released', 'enrolled', 'ended', 'cancellation_scheduled',
    'cancellation_withdrawn', 'billing_attention', 'billing_recovered'
  )),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz not null default clock_timestamp()
);
create trigger membership_commercial_events_append_only before update or delete on public.membership_commercial_events
  for each row execute function public.ruined_reject_append_only_mutation();
create trigger membership_commercial_participants_append_only before update or delete on public.membership_commercial_participants
  for each row execute function public.ruined_reject_append_only_mutation();

create function private.ruined_guard_commercial_enrollment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Membership enrollment history must be retained.'; end if;
  if new.id is distinct from old.id or new.member_id is distinct from old.member_id
    or new.person_id is distinct from old.person_id or new.reservation_id is distinct from old.reservation_id
    or new.source is distinct from old.source or new.founding_eligible is distinct from old.founding_eligible
    or new.started_at is distinct from old.started_at or new.created_at is distinct from old.created_at
    or old.ended_at is not null
  then raise exception 'Membership eligibility history is immutable; rejoining requires a new enrollment.'; end if;
  return new;
end
$$;
create trigger membership_enrollment_history_guard before update or delete on public.membership_enrollment_episodes
  for each row execute function private.ruined_guard_commercial_enrollment();

alter table public.membership_commercial_reservations enable row level security;
alter table public.membership_commercial_participants enable row level security;
alter table public.membership_enrollment_episodes enable row level security;
alter table public.membership_commercial_events enable row level security;
revoke all on public.membership_commercial_reservations, public.membership_commercial_participants,
  public.membership_enrollment_episodes, public.membership_commercial_events from public, anon, authenticated;

create function private.ruined_member_has_couple_funding(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.membership_commercial_participants participant
    join public.membership_commercial_reservations reservation on reservation.id = participant.reservation_id
      and reservation.kind = 'couple' and reservation.status = 'activated'
    join public.stripe_subscriptions subscription on subscription.id = reservation.stripe_subscription_id
      and subscription.member_id = reservation.payer_member_id and subscription.stripe_status in ('active', 'trialing')
    join public.ruined_members payer on payer.id = reservation.payer_member_id and payer.deleted_at is null
    join public.member_lifecycle lifecycle on lifecycle.member_id = payer.id
      and lifecycle.account_state = 'active' and lifecycle.billing_state = 'active'
    where participant.member_id = target_member_id
      and (subscription.cancel_at is null or subscription.cancel_at > clock_timestamp())
      and (lifecycle.cancellation_effective_at is null or lifecycle.cancellation_effective_at > clock_timestamp())
      and not exists (select 1 from public.membership_enrollment_episodes episode
        where episode.reservation_id = reservation.id and episode.member_id = target_member_id and episode.ended_at is not null)
  )
$$;

-- A second adult's access follows the same canonical subscription. Their old
-- projected billing row can never keep access after shared billing ends.
create function private.ruined_member_shared_billing_state(target_member_id uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select case when latest.kind <> 'couple' or latest.payer_member_id = target_member_id then null
    when subscription.stripe_status in ('canceled', 'incomplete_expired')
      or (subscription.cancel_at is not null and subscription.cancel_at <= clock_timestamp())
      or payer.account_state = 'closed'
      or (payer.standing_state = 'cancellation_requested' and payer.cancellation_effective_at <= clock_timestamp())
      or exists(select 1 from public.membership_enrollment_episodes episode
        where episode.reservation_id = latest.id and episode.member_id = target_member_id and episode.ended_at is not null) then 'ended'
    when subscription.stripe_status in ('past_due', 'paused', 'unpaid') then 'attention_required'
    when subscription.stripe_status in ('active', 'trialing') then payer.billing_state
    else 'pending' end
  from (
    select reservation.* from public.membership_commercial_participants participant
    join public.membership_commercial_reservations reservation on reservation.id = participant.reservation_id and reservation.status = 'activated'
    where participant.member_id = target_member_id order by reservation.created_at desc limit 1
  ) latest
  join public.stripe_subscriptions subscription on subscription.id = latest.stripe_subscription_id
  join public.member_lifecycle payer on payer.member_id = latest.payer_member_id
$$;

-- Signup activation alone is insufficient. Both canonical onboarding records,
-- a verified login, the member role, a named profile and current funding count.
create function private.ruined_member_is_active_registered(target_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.ruined_members member
    join public.people person on person.id = member.person_id and person.status = 'active'
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
    join public.member_onboardings onboarding on onboarding.member_id = member.id and onboarding.state = 'completed'
    join public.person_profiles profile on profile.person_id = member.person_id
      and coalesce(nullif(btrim(profile.preferred_name), ''), nullif(btrim(profile.display_name), '')) is not null
    where member.id = target_member_id and member.deleted_at is null
      and lifecycle.account_state = 'active' and lifecycle.administrative_onboarding_state = 'completed'
      and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested'
        and lifecycle.cancellation_effective_at > clock_timestamp()))
      and ((lifecycle.billing_state = 'active' and not coalesce((
        select subscription.stripe_status in ('canceled', 'incomplete_expired')
        from public.membership_commercial_participants participant
        join public.membership_commercial_reservations reservation on reservation.id = participant.reservation_id and reservation.status = 'activated'
        join public.stripe_subscriptions subscription on subscription.id = reservation.stripe_subscription_id
        where participant.member_id = member.id order by reservation.created_at desc limit 1
      ), false)) or private.ruined_member_has_complimentary_funding(member.id)
        or private.ruined_member_has_couple_funding(member.id))
      and exists (select 1 from public.platform_users account
        join public.platform_role_grants grant_row on grant_row.auth_user_id = account.auth_user_id
          and grant_row.role_slug = 'member' and grant_row.revoked_at is null
        where account.person_id = member.person_id and account.member_id = member.id and account.status = 'active')
      and exists (select 1 from public.person_email_addresses email where email.person_id = member.person_id
        and email.verification_state = 'verified' and email.retired_at is null)
  )
$$;

create function private.ruined_commercial_occupied_count()
returns integer language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from (
    select member.person_id from public.ruined_members member
      where private.ruined_member_is_active_registered(member.id)
    union
    -- No local timeout releases a Checkout that could still be paid at Stripe.
    select participant.person_id from public.membership_commercial_participants participant
    join public.membership_commercial_reservations reservation on reservation.id = participant.reservation_id
    where reservation.status = 'reserved'
      or (reservation.status = 'activated' and not exists (
        select 1 from public.membership_enrollment_episodes episode
        where episode.reservation_id = reservation.id and episode.member_id = participant.member_id
      ) and exists (select 1 from public.stripe_subscriptions subscription
        where subscription.id = reservation.stripe_subscription_id and subscription.stripe_status not in ('canceled', 'incomplete_expired')))
  ) occupied
$$;

create function private.ruined_reconcile_commercial_memberships()
returns void language plpgsql security invoker set search_path = '' as $$
declare row_record record; enrollment public.membership_enrollment_episodes%rowtype;
  participant public.membership_commercial_participants%rowtype; occupancy integer; active_count integer; founder boolean; source_kind text;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
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
    else
      -- Existing active people are ranked only during the initial backfill.
      -- Subsequently every completed activation is serialized by this lock.
      select count(distinct member.person_id)::integer into active_count from public.ruined_members member
        where private.ruined_member_is_active_registered(member.id) and member.id <> row_record.id
          and (exists (select 1 from public.membership_enrollment_episodes known where known.person_id = member.person_id and known.ended_at is null)
            or (coalesce((select access_started_at from public.member_lifecycle where member_id = member.id),
              (select completed_at from public.member_onboardings where member_id = member.id)), member.id)
              < (coalesce(row_record.access_started_at, row_record.completed_at), row_record.id));
      occupancy := active_count + (select count(distinct held.person_id)::integer from public.membership_commercial_participants held
        join public.membership_commercial_reservations reservation on reservation.id = held.reservation_id
        where (reservation.status = 'reserved' or (reservation.status = 'activated'
          and not exists (select 1 from public.membership_enrollment_episodes consumed
            where consumed.reservation_id = reservation.id and consumed.member_id = held.member_id)
          and exists (select 1 from public.stripe_subscriptions subscription
            where subscription.id = reservation.stripe_subscription_id and subscription.stripe_status not in ('canceled', 'incomplete_expired'))))
          and held.member_id <> row_record.id
          and not private.ruined_member_is_active_registered(held.member_id));
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

create function private.ruined_reserve_commercial_membership(request_id uuid, payer_id uuid, membership_kind text, plan text, partner_id uuid, authorization_id uuid, reservation_expires_at timestamptz)
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
  select count(distinct member.person_id)::integer into active_count from public.ruined_members member
    where private.ruined_member_is_active_registered(member.id);
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
    if founder is null and active_count < 50 and occupancy >= 50 then
      raise exception using errcode = 'P4205', message = 'A founding place is temporarily reserved in another checkout. Please try again shortly.';
    end if;
    founder := coalesce(founder, active_count < 50);
    insert into public.membership_commercial_participants(reservation_id, member_id, person_id, ordinal, founding_eligible, name_snapshot)
      values(request_id, target_id, target_person, position, founder, target_name);
    if not private.ruined_member_is_active_registered(target_id) then
      occupancy := occupancy + 1;
      active_count := active_count + 1;
    end if;
  end loop;
  insert into public.membership_commercial_events(member_id, reservation_id, event_type, evidence)
    values(payer_id, request_id, 'reserved', jsonb_build_object('kind', membership_kind, 'occupiedCount', occupancy));
  return request_id;
end
$$;

create function private.ruined_validate_commercial_reservation(request_id uuid)
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

create function private.ruined_activate_commercial_membership(reservation_id uuid, subscription_id text)
returns void language plpgsql security invoker set search_path = '' as $$
declare reservation public.membership_commercial_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  select * into reservation from public.membership_commercial_reservations where id = reservation_id;
  if reservation.id is null or reservation.status = 'released' then
    raise exception using errcode = 'P4201', message = 'Membership reservation is unavailable.'; end if;
  if reservation.status = 'activated' then
    if reservation.stripe_subscription_id <> subscription_id then raise exception using errcode = 'P4201', message = 'Membership subscription conflicts.'; end if;
    perform private.ruined_reconcile_commercial_memberships(); return;
  end if;
  if not exists (select 1 from public.stripe_subscriptions subscription
    join public.stripe_invoices invoice on invoice.id = subscription.latest_invoice_id
      and invoice.stripe_subscription_id = subscription.id and invoice.member_id = reservation.payer_member_id
      and invoice.purpose = 'membership' and invoice.stripe_status = 'paid' and invoice.amount_paid > 0
    where subscription.id = subscription_id and subscription.member_id = reservation.payer_member_id
      and subscription.price_id = reservation.stripe_price_id and reservation.stripe_price_id is not null
      and subscription.stripe_status in ('active', 'trialing'))
  then raise exception using errcode = 'P4203', message = 'Verified paid membership billing is required.'; end if;
  update public.membership_commercial_reservations set status = 'activated', activated_at = clock_timestamp(), stripe_subscription_id = subscription_id where id = reservation_id;
  insert into public.membership_commercial_events(member_id, reservation_id, event_type, evidence)
    values(reservation.payer_member_id, reservation.id, 'activated', jsonb_build_object('subscriptionId', subscription_id));
  perform private.ruined_reconcile_commercial_memberships();
end
$$;

create function private.ruined_release_commercial_membership(reservation_id uuid, confirmed_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
declare reservation public.membership_commercial_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('ruined-membership-commercial-eligibility'));
  select * into reservation from public.membership_commercial_reservations where id = reservation_id;
  if reservation.id is null then return; end if;
  if reservation.status = 'released' then return; end if;
  if reservation.status <> 'reserved' or confirmed_reason not in ('checkout_expired', 'checkout_failed', 'before_checkout_abandoned')
    or confirmed_reason is null or exists (select 1 from public.stripe_checkout_attempts attempt
      where attempt.id = reservation_id and attempt.status not in ('expired', 'failed'))
  then raise exception using errcode = 'P4201', message = 'Confirm Checkout termination before releasing membership eligibility.'; end if;
  update public.membership_commercial_reservations set status = 'released', released_at = clock_timestamp(), release_reason = confirmed_reason where id = reservation_id;
  insert into public.membership_commercial_events(member_id, reservation_id, event_type, evidence)
    values(reservation.payer_member_id, reservation_id, 'released', jsonb_build_object('reason', confirmed_reason));
end
$$;

-- Existing activation writers participate even before application rollout.
-- These functions never lock member/lifecycle rows after taking the commercial
-- advisory lock; that avoids reversing existing per-member writer lock order.
create function private.ruined_commercial_lifecycle_trigger()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform private.ruined_reconcile_commercial_memberships();
  return null;
end
$$;
create trigger member_lifecycle_commercial_eligibility after insert or update on public.member_lifecycle
  for each statement execute function private.ruined_commercial_lifecycle_trigger();
create trigger member_onboardings_commercial_eligibility after insert or update on public.member_onboardings
  for each statement execute function private.ruined_commercial_lifecycle_trigger();
create trigger member_complimentary_commercial_eligibility after insert or update on public.member_complimentary_grants
  for each statement execute function private.ruined_commercial_lifecycle_trigger();
create trigger member_roles_commercial_eligibility after insert or update or delete on public.platform_role_grants
  for each statement execute function private.ruined_commercial_lifecycle_trigger();
create trigger member_subscriptions_commercial_eligibility after insert or update on public.stripe_subscriptions
  for each statement execute function private.ruined_commercial_lifecycle_trigger();

-- Keep the established SQL access gates and invitation rules, substituting
-- canonical shared billing only for the second adult of an activated couple.
do $$
declare function_name text; definition text;
begin
  foreach function_name in array array['private.ruined_current_active_access_member_id()',
    'private.ruined_current_updates_member_id()', 'private.ruined_member_can_share_invitation(uuid)'] loop
    select pg_get_functiondef(function_name::regprocedure) into definition;
    if position('lifecycle.billing_state = ''active''' in definition) = 0 then
      raise exception 'Cannot safely extend shared billing access for %', function_name;
    end if;
    execute replace(definition, 'lifecycle.billing_state = ''active''',
      'coalesce(private.ruined_member_shared_billing_state(member.id), lifecycle.billing_state) = ''active''');
  end loop;
  select pg_get_functiondef('private.ruined_validate_member_onboarding_completion()'::regprocedure) into definition;
  execute replace(definition, 'not private.ruined_member_has_complimentary_funding(new.member_id)',
    'not (private.ruined_member_has_complimentary_funding(new.member_id) or private.ruined_member_has_couple_funding(new.member_id))');
  select pg_get_functiondef('private.ruined_allocate_member_number(uuid)'::regprocedure) into definition;
  -- Access can begin inside this statement (for example clock_timestamp() in
  -- an activation update). Compare with the actual clock rather than the
  -- earlier statement start, while still rejecting genuinely future access.
  definition := replace(definition, 'first_access > statement_timestamp()', 'first_access > clock_timestamp()');
  execute replace(definition, 'private.ruined_member_has_complimentary_funding(member.id)',
    '(private.ruined_member_has_complimentary_funding(member.id) or (private.ruined_member_has_couple_funding(member.id) and exists (
      select 1 from public.membership_commercial_participants participant
      join public.membership_commercial_reservations reservation on reservation.id=participant.reservation_id and reservation.kind=''couple'' and reservation.status=''activated''
      join public.stripe_invoices shared_invoice on shared_invoice.stripe_subscription_id=reservation.stripe_subscription_id and shared_invoice.member_id=reservation.payer_member_id
        and shared_invoice.purpose=''membership'' and shared_invoice.stripe_status=''paid''
      join public.stripe_webhook_events shared_event on shared_event.object_id=shared_invoice.id and shared_event.event_type=''invoice.paid'' and shared_event.livemode
        and shared_event.status in (''processing'',''processed'') where participant.member_id=member.id)))');
end
$$;

revoke all on function private.ruined_member_has_couple_funding(uuid),
  private.ruined_member_shared_billing_state(uuid),
  private.ruined_member_is_active_registered(uuid), private.ruined_commercial_occupied_count(),
  private.ruined_reconcile_commercial_memberships(),
  private.ruined_reserve_commercial_membership(uuid, uuid, text, text, uuid, uuid, timestamptz),
  private.ruined_activate_commercial_membership(uuid, text),
  private.ruined_validate_commercial_reservation(uuid),
  private.ruined_guard_commercial_enrollment(),
  private.ruined_release_commercial_membership(uuid, text), private.ruined_commercial_lifecycle_trigger()
  from public, anon, authenticated;

select private.ruined_reconcile_commercial_memberships();

comment on table public.membership_enrollment_episodes is 'Founding eligibility for one continuous membership, independent of permanent member numbers. Effective cancellation closes the episode; rejoining checks the current active count.';
comment on column public.membership_commercial_reservations.expires_at is 'Operational deadline only. A hold releases only after confirmed remote Checkout termination, never merely because local time elapsed.';

commit;
