begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

create index membership_commercial_participants_member_reservation
  on public.membership_commercial_participants(member_id, reservation_id);

-- The accepted quote is a temporary pair; the paid reservation is its durable
-- replacement. A reserved Checkout may remain payable after its local quote or
-- authorization expires. Only confirmed release ends that hold; fresh Checkout
-- still validates approval. Authorization expiry never ends an activated pair.
create function private.ruined_circle_couple_partner(target_member_id uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select (
    select distinct partner.member_id
    from public.membership_commercial_participants own
    join public.membership_commercial_reservations reservation
      on reservation.id = own.reservation_id and reservation.kind = 'couple'
    join public.membership_commercial_participants partner
      on partner.reservation_id = reservation.id and partner.member_id <> own.member_id
        and partner.person_id <> own.person_id and partner.ordinal <> own.ordinal
    join public.ruined_members own_member on own_member.id = own.member_id and own_member.deleted_at is null
    join public.ruined_members partner_member on partner_member.id = partner.member_id and partner_member.deleted_at is null
    join public.member_lifecycle own_lifecycle on own_lifecycle.member_id = own.member_id and own_lifecycle.account_state <> 'closed'
    join public.member_lifecycle partner_lifecycle on partner_lifecycle.member_id = partner.member_id and partner_lifecycle.account_state <> 'closed'
    where own.member_id = target_member_id
      and (own_lifecycle.cancellation_effective_at is null or own_lifecycle.cancellation_effective_at > clock_timestamp())
      and (partner_lifecycle.cancellation_effective_at is null or partner_lifecycle.cancellation_effective_at > clock_timestamp())
      and not exists (
        select 1 from public.membership_enrollment_episodes episode
        where episode.reservation_id = reservation.id and episode.member_id in (own.member_id, partner.member_id)
          and episode.ended_at is not null
      )
      and (
        (reservation.status = 'reserved'
          and exists (
            select 1 from public.membership_couple_authorizations approval
            where approval.id = reservation.couple_authorization_id
              and approval.payer_member_id = reservation.payer_member_id
              and approval.partner_member_id in (own.member_id, partner.member_id)
              and approval.payer_member_id in (own.member_id, partner.member_id)
              and approval.accepted_at is not null and approval.accepted_by_auth_user_id is not null
          ))
        or (reservation.status = 'activated' and exists (
          select 1 from public.stripe_subscriptions subscription
          where subscription.id = reservation.stripe_subscription_id
            and subscription.member_id = reservation.payer_member_id
            and subscription.stripe_status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')
            and (subscription.cancel_at is null or subscription.cancel_at > clock_timestamp())
        ))
      )
  )
$$;

-- Every placement/pair writer uses the same dedicated per-member locks. They
-- deliberately do NOT wait: billing writers may already hold commercial locks,
-- while placement writers may hold member rows. A retry avoids reversing either
-- lock order. Include historical candidates so reopening a lifecycle cannot race
-- a partner's placement while the current-pair predicate temporarily returns null.
create function private.ruined_lock_circle_couple_members(requested_members uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare member_id uuid;
begin
  for member_id in
    select distinct candidate.id from (
      select unnest(requested_members) as id
      union all
      select partner.member_id
      from public.membership_commercial_participants own
      join public.membership_commercial_reservations reservation
        on reservation.id = own.reservation_id and reservation.kind = 'couple'
          and reservation.status in ('reserved', 'activated')
      join public.membership_commercial_participants partner on partner.reservation_id = own.reservation_id
      where own.member_id = any(requested_members)
    ) candidate where candidate.id is not null order by candidate.id
  loop
    if not pg_try_advisory_xact_lock(hashtext('ruined-circle-couple:' || member_id::text)) then
      raise exception using errcode = '40001', message = 'This couple or Circle placement is being updated. Refresh and try again.';
    end if;
  end loop;
end
$$;

create function private.ruined_assert_couple_circle(target_member_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare partner_id uuid;
begin
  partner_id := private.ruined_circle_couple_partner(target_member_id);
  if partner_id is not null and exists (
    select 1 from public.circle_member_assignments own
    join public.circle_member_assignments partner on partner.member_id = partner_id and partner.ended_at is null
    where own.member_id = target_member_id and own.ended_at is null and own.circle_id <> partner.circle_id
  ) then
    raise exception using errcode = 'P4206', message = 'Couples membership partners must be placed in the same Circle.';
  end if;
end
$$;

-- Resolve affected identities from OLD/NEW without changing membership or
-- placement history. This covers both sides when a previously inactive relation
-- becomes current, not only writes to Circle assignments themselves.
create function private.ruined_circle_couple_row_members(source_table text, row_data jsonb)
returns uuid[] language plpgsql stable security invoker set search_path = '' as $$
declare members uuid[]; affected_reservation_id uuid;
begin
  if row_data is null then return '{}'::uuid[]; end if;
  case source_table
    when 'ruined_members' then members := array[(row_data->>'id')::uuid];
    when 'membership_couple_authorizations' then
      members := array[(row_data->>'payer_member_id')::uuid, (row_data->>'partner_member_id')::uuid];
    when 'membership_commercial_reservations' then
      affected_reservation_id := (row_data->>'id')::uuid;
      members := array[(row_data->>'payer_member_id')::uuid,
        (select approval.partner_member_id from public.membership_couple_authorizations approval
          where approval.id = (row_data->>'couple_authorization_id')::uuid)];
    when 'membership_commercial_participants' then
      affected_reservation_id := (row_data->>'reservation_id')::uuid;
      members := array[(row_data->>'member_id')::uuid];
      members := members || array(select approval.partner_member_id
        from public.membership_commercial_reservations reservation
        join public.membership_couple_authorizations approval on approval.id = reservation.couple_authorization_id
        where reservation.id = affected_reservation_id);
    when 'stripe_subscriptions' then
      members := array[(row_data->>'member_id')::uuid] || array(
        select participant.member_id from public.membership_commercial_participants participant
        join public.membership_commercial_reservations reservation on reservation.id = participant.reservation_id
        where reservation.stripe_subscription_id = row_data->>'id');
    else members := array[(row_data->>'member_id')::uuid];
  end case;
  if affected_reservation_id is not null then
    members := members || array(select participant.member_id from public.membership_commercial_participants participant
      where participant.reservation_id = affected_reservation_id);
  end if;
  return array(select distinct value from unnest(members) value where value is not null order by value);
end
$$;

create function private.ruined_lock_couple_circle_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare members uuid[] := '{}'::uuid[];
begin
  if tg_op <> 'INSERT' then members := private.ruined_circle_couple_row_members(tg_table_name, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then members := members || private.ruined_circle_couple_row_members(tg_table_name, to_jsonb(new)); end if;
  perform private.ruined_lock_circle_couple_members(members);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create function private.ruined_check_couple_circle_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare members uuid[] := '{}'::uuid[]; member_id uuid;
begin
  if tg_op <> 'INSERT' then members := private.ruined_circle_couple_row_members(tg_table_name, to_jsonb(old)); end if;
  if tg_op <> 'DELETE' then members := members || private.ruined_circle_couple_row_members(tg_table_name, to_jsonb(new)); end if;
  for member_id in select distinct value from unnest(members) value where value is not null loop
    perform private.ruined_assert_couple_circle(member_id);
  end loop;
  return null;
end
$$;

-- Assignment checks run at commit: moving two people is two historical ends and
-- two new rows, temporarily unmatched inside one atomic transaction. One unplaced
-- partner is valid (including explicit departure); two different Circles are not.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'circle_member_assignments', 'membership_commercial_participants', 'membership_commercial_reservations',
    'membership_couple_authorizations', 'membership_enrollment_episodes', 'member_lifecycle',
    'ruined_members', 'stripe_subscriptions'
  ] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.ruined_lock_couple_circle_write()',
      table_name || '_01_couple_lock', table_name);
    execute format('create constraint trigger %I after insert or update or delete on public.%I deferrable initially deferred for each row execute function private.ruined_check_couple_circle_write()',
      table_name || '_couple_circle_check', table_name);
  end loop;
end
$$;

-- Fail early as the second participant creates the quote, before the caller can
-- proceed to Stripe. Deferred checks remain a backstop for concurrent changes.
create trigger membership_commercial_participants_couple_circle_preflight
  after insert on public.membership_commercial_participants
  for each row execute function private.ruined_check_couple_circle_write();
create trigger membership_commercial_reservations_couple_circle_preflight
  after insert or update on public.membership_commercial_reservations
  for each row execute function private.ruined_check_couple_circle_write();

revoke all on function private.ruined_circle_couple_partner(uuid),
  private.ruined_lock_circle_couple_members(uuid[]), private.ruined_assert_couple_circle(uuid),
  private.ruined_circle_couple_row_members(text, jsonb), private.ruined_lock_couple_circle_write(),
  private.ruined_check_couple_circle_write() from public, anon, authenticated;

-- Existing mismatches require deliberate operator placement, not silent moves.
do $$
declare member_id uuid;
begin
  for member_id in select distinct participant.member_id from public.membership_commercial_participants participant loop
    perform private.ruined_assert_couple_circle(member_id);
  end loop;
end
$$;
commit;
