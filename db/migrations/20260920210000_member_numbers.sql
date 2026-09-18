begin;

-- Permanent order of completed, real membership entry. A billing checkpoint,
-- a pending staff profile, or a Stripe test payment does not reserve a place.
alter table public.ruined_members add column member_number integer
  constraint ruined_members_member_number_positive check (member_number is null or member_number > 0);
create unique index ruined_members_member_number_unique on public.ruined_members(member_number) where member_number is not null;

create table private.member_number_assignments (
  member_number integer primary key check (member_number > 0),
  member_id uuid unique references public.ruined_members(id) on delete set null,
  activated_at timestamptz not null check (isfinite(activated_at)),
  recorded_at timestamptz not null default statement_timestamp()
);
create table private.member_number_counter (
  singleton boolean primary key default true check (singleton),
  last_number integer not null check (last_number >= 0)
);
alter table private.member_number_assignments enable row level security;
alter table private.member_number_counter enable row level security;
revoke all on private.member_number_assignments, private.member_number_counter from public, anon, authenticated;

-- Legacy-v1 completed entries may have no modern profile/agreement checkpoint
-- timestamps. Their durable completed state plus dated access is retained.
-- Historical membership survives cancellation, suspension, and revoked roles.
with candidates as (
  select member.id,
    coalesce(lifecycle.access_started_at, onboarding.completed_at, member.membership_activated_at) as first_access
  from public.ruined_members member
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  join public.member_onboardings onboarding on onboarding.member_id = member.id
  where member.person_id is not null and lifecycle.administrative_onboarding_state = 'completed'
    and onboarding.state = 'completed'
    and (
      private.ruined_member_has_operator_funding(member.id)
      or onboarding.completion_evidence->>'funding' = 'operator'
      or exists (select 1 from public.stripe_invoices invoice join public.stripe_webhook_events event
        on event.object_id = invoice.id and event.event_type = 'invoice.paid' and event.livemode and event.status = 'processed'
        where invoice.member_id = member.id and invoice.purpose = 'membership' and invoice.stripe_status = 'paid')
    )
), numbered as (
  select id, first_access, row_number() over (order by first_access, id)::integer as member_number
  from candidates where isfinite(first_access) and first_access <= statement_timestamp()
)
insert into private.member_number_assignments(member_number, member_id, activated_at)
select member_number, id, first_access from numbered;

update public.ruined_members member set member_number = assignment.member_number
from private.member_number_assignments assignment where assignment.member_id = member.id;
insert into private.member_number_counter(singleton, last_number)
select true, coalesce(max(member_number), 0) from private.member_number_assignments;

-- The counter is transactional, unlike nextval(): a failed activation consumes
-- no number. The assignment ledger retains used numbers after member deletion.
create function private.ruined_guard_member_number_counter()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'The permanent member number counter cannot be deleted.'; end if;
  if new.singleton is distinct from old.singleton or new.last_number <> old.last_number + 1 then
    raise exception 'The permanent member number counter can only advance one place.';
  end if;
  return new;
end
$$;
create trigger member_number_counter_guard before update or delete on private.member_number_counter
for each row execute function private.ruined_guard_member_number_counter();

create function private.ruined_guard_member_number_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'A permanent member number cannot be reused.'; end if;
  if new.member_number is distinct from old.member_number or new.activated_at is distinct from old.activated_at
    or new.recorded_at is distinct from old.recorded_at
    or (new.member_id is distinct from old.member_id and new.member_id is not null) then
    raise exception 'A permanent member number assignment cannot change.';
  end if;
  return new;
end
$$;
create trigger member_number_assignment_guard before update or delete on private.member_number_assignments
for each row execute function private.ruined_guard_member_number_assignment();

create function private.ruined_guard_member_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.member_number is not null and new.member_number is distinct from old.member_number then
    raise exception 'A member number is permanent and cannot be changed or cleared.';
  end if;
  if new.member_number is not null and not exists (
    select 1 from private.member_number_assignments assignment
    where assignment.member_id = new.id and assignment.member_number = new.member_number
  ) then raise exception 'A member number must come from completed membership allocation.'; end if;
  return new;
end
$$;
create trigger ruined_members_member_number_guard before insert or update of member_number on public.ruined_members
for each row execute function private.ruined_guard_member_number();

create function private.ruined_allocate_member_number(target_member_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare existing_number integer; first_access timestamptz; next_number integer; eligibility_check integer;
begin
  -- Immutable assigned numbers, incomplete entries, and test-only accounts do
  -- not add a member row lock to unrelated lifecycle updates.
  select member_number into existing_number from public.ruined_members
  where id = target_member_id;
  if not found or existing_number is not null then return; end if;
  -- Check eligibility before taking the member lock, then again after obtaining
  -- it. Actual first-entry writers use member-before-lifecycle order.
  for eligibility_check in 1..2 loop
  select coalesce(lifecycle.access_started_at, onboarding.completed_at, member.membership_activated_at)
  into first_access
  from public.ruined_members member
  join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
  join public.member_onboardings onboarding on onboarding.member_id = member.id
  where member.id = target_member_id and member.person_id is not null
    and lifecycle.account_state = 'active' and lifecycle.administrative_onboarding_state = 'completed'
    and lifecycle.program_state in ('onboarding', 'active')
    and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested'
      and lifecycle.cancellation_effective_at > statement_timestamp()))
    and onboarding.state = 'completed'
    and (private.ruined_member_has_operator_funding(member.id) or (lifecycle.billing_state = 'active' and exists (
      select 1 from public.stripe_invoices invoice join public.stripe_webhook_events event
        on event.object_id = invoice.id and event.event_type = 'invoice.paid' and event.livemode
          and event.status in ('processing', 'processed')
      where invoice.member_id = member.id and invoice.purpose = 'membership' and invoice.stripe_status = 'paid'
    )));
  if first_access is null or not isfinite(first_access) or first_access > statement_timestamp() then return; end if;
  if eligibility_check = 1 then
    select member_number into existing_number from public.ruined_members
    where id = target_member_id for update;
    if not found or existing_number is not null then return; end if;
  end if;
  end loop;
  update private.member_number_counter set last_number = last_number + 1
  where singleton returning last_number into next_number;
  if next_number is null then raise exception 'The member number counter is unavailable.'; end if;
  insert into private.member_number_assignments(member_number, member_id, activated_at)
  values (next_number, target_member_id, first_access);
  update public.ruined_members set member_number = next_number where id = target_member_id;
end
$$;

create function private.ruined_member_number_activation_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ruined_allocate_member_number(new.member_id);
  return new;
end
$$;
create trigger member_lifecycle_member_number
after insert or update of account_state, administrative_onboarding_state, billing_state, program_state, standing_state, access_started_at
on public.member_lifecycle for each row
when (new.administrative_onboarding_state = 'completed' and new.account_state = 'active')
execute function private.ruined_member_number_activation_trigger();

-- A completed test-only account may pay for real later without changing its
-- lifecycle state. Successful live invoice processing retries its allocation.
create function private.ruined_member_number_live_invoice_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_member_id uuid;
begin
  select member_id into target_member_id from public.stripe_invoices
  where id = new.object_id and purpose = 'membership' and stripe_status = 'paid';
  if target_member_id is not null then perform private.ruined_allocate_member_number(target_member_id); end if;
  return new;
end
$$;
create trigger member_number_live_invoice after insert or update of status on public.stripe_webhook_events
for each row when (new.status = 'processed' and new.event_type = 'invoice.paid' and new.livemode)
execute function private.ruined_member_number_live_invoice_trigger();

revoke all on function private.ruined_guard_member_number_counter(), private.ruined_guard_member_number_assignment(),
  private.ruined_guard_member_number(), private.ruined_allocate_member_number(uuid),
  private.ruined_member_number_activation_trigger(), private.ruined_member_number_live_invoice_trigger()
from public, anon, authenticated;
comment on column public.ruined_members.member_number is 'Permanent membership entry number, assigned only on completed live-paid or authorized complimentary activation. Null for unnumbered accounts.';
comment on table private.member_number_assignments is 'Permanent number reservations. Deleting a member clears its link without releasing or renumbering the place.';

commit;
