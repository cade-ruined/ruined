begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Quote review is not billing authorization. Registration intake proves the
-- payer's verified account, adult profile and initial document acknowledgment;
-- the paid agreement and recurring consent remain mandatory at Checkout.
-- Completed historical registrations may review offers without changing their
-- original saved-card promise or any immutable registration requirements.
create function private.ruined_commercial_quote_agreement_ready(target_member_id uuid,payer_member_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select (target_member_id=payer_member_id and private.ruined_registration_intake_ready(target_member_id))
   or (
     exists(select 1 from public.member_consents consent where consent.member_id=target_member_id
       and consent.consent_type='age_attestation' and consent.decision='accepted')
     and exists(select 1 from public.membership_agreement_acceptances acceptance
       join public.ruined_members member on member.id=acceptance.member_id and member.person_id=acceptance.person_id
       join public.membership_agreement_versions agreement on agreement.id=acceptance.agreement_version_id
         and agreement.agreement_key='ruined_membership' and agreement.status='published' and agreement.version>=2
         and (agreement.effective_at is null or agreement.effective_at<=clock_timestamp())
       where acceptance.member_id=target_member_id)
   )
$$;

-- Separate from the strict payment-time validator, which is unchanged.
create function private.ruined_validate_commercial_quote(request_id uuid)
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
        and private.ruined_commercial_quote_agreement_ready(member.id,reservation.payer_member_id)
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
    perform private.ruined_validate_commercial_quote(request_id);
    return request_id;
  end if;
  select reservation.* into existing from public.membership_commercial_reservations reservation
    where reservation.payer_member_id = payer_id and reservation.status = 'reserved'
    order by reservation.created_at limit 1;
  if found then
    if existing.kind = membership_kind and existing.billing_plan = plan
      and existing.couple_authorization_id is not distinct from authorization_id
      and (select member_id from public.membership_commercial_participants where reservation_id = existing.id and ordinal = 2) is not distinct from partner_id
    then perform private.ruined_validate_commercial_quote(existing.id); return existing.id; end if;
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
  -- own verified adult account and named profile. The payer may review the
  -- exact quote before signing; the second adult must already have accepted.
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
        and private.ruined_commercial_quote_agreement_ready(member.id,payer_id);
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

revoke all on function private.ruined_commercial_quote_agreement_ready(uuid,uuid),
  private.ruined_validate_commercial_quote(uuid) from public,anon,authenticated;
commit;
