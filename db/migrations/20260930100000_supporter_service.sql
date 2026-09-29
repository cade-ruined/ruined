begin;

-- Explicit responsibilities are independent of operator access. No account is
-- selected by name/email, and no administrator inherits these decisions.
create table public.leadership_responsibility_grants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.platform_users(auth_user_id),
  capability text not null check (capability in ('circle_placement','circle_exception','supporter_readiness','reimbursements')),
  granted_by_auth_user_id uuid not null references public.platform_users(auth_user_id),
  granted_at timestamptz not null default statement_timestamp(),
  reason text not null check (length(btrim(reason)) between 1 and 1200),
  revoked_at timestamptz,
  revoked_by_auth_user_id uuid references public.platform_users(auth_user_id),
  revoke_reason text,
  check ((revoked_at is null and revoked_by_auth_user_id is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by_auth_user_id is not null and length(btrim(revoke_reason)) between 1 and 1200))
);
create unique index leadership_responsibility_active on public.leadership_responsibility_grants(auth_user_id, capability) where revoked_at is null;
create or replace function private.ruined_has_leadership_responsibility(actor uuid, responsibility text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.leadership_responsibility_grants responsibility_grant
    join public.platform_users account on account.auth_user_id = responsibility_grant.auth_user_id
    where account.auth_user_id = actor and account.status = 'active'
      and responsibility_grant.capability = responsibility and responsibility_grant.revoked_at is null
      and exists (select 1 from public.platform_role_grants role_grant
        where role_grant.auth_user_id = actor and role_grant.role_slug = 'ops_admin' and role_grant.revoked_at is null)
  )
$$;
revoke all on function private.ruined_has_leadership_responsibility(uuid,text) from public, anon, authenticated;

create table public.supporter_readiness_approvals (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.platform_users(auth_user_id),
  circle_id uuid not null references public.circles(id),
  approved_by_auth_user_id uuid not null references public.platform_users(auth_user_id),
  approved_at timestamptz not null default statement_timestamp(),
  reason text not null check (length(btrim(reason)) between 1 and 1200),
  unique (auth_user_id,circle_id)
);
create table public.supporter_service_details (
  assignment_id bigint primary key references public.circle_staff_assignments(id),
  readiness_id uuid not null references public.supporter_readiness_approvals(id),
  temporary boolean not null default false,
  reason text not null check (length(btrim(reason)) between 1 and 1200)
);
-- Existing assignments remain historical evidence. All new assignments must
-- come from a current Circle member whose readiness has been approved.
create or replace function private.ruined_guard_new_supporter_service()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.role_slug <> 'circle_leader' then return new; end if;
  if not private.ruined_has_leadership_responsibility(new.assigned_by_auth_user_id,'supporter_readiness') then
    raise exception 'Configure Supporter readiness responsibility before starting service.';
  end if;
  if not exists (select 1 from public.supporter_readiness_approvals ready
    where ready.auth_user_id = new.auth_user_id and ready.circle_id = new.circle_id) then
    raise exception 'Approve this Circle member readiness before starting service.';
  end if;
  if not exists (select 1 from public.platform_users account
    join public.circle_member_assignments placement on placement.member_id = account.member_id
    join public.ruined_members member on member.id = account.member_id and member.person_id = account.person_id
    join public.people person on person.id = member.person_id
    join public.member_lifecycle lifecycle on lifecycle.member_id = member.id
    join public.circles circle on circle.id = placement.circle_id
    where account.status = 'active' and person.status = 'active' and circle.status in ('active','forming')
      and lifecycle.account_state = 'active' and lifecycle.administrative_onboarding_state = 'completed'
      and lifecycle.program_state in ('active','onboarding') and lifecycle.foundations_state = 'completed'
      and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested' and lifecycle.cancellation_effective_at > statement_timestamp()))
      and ((lifecycle.billing_state = 'active' and member.membership_state = 'active') or private.ruined_member_has_complimentary_funding(member.id))
      and exists(select 1 from public.platform_role_grants access where access.auth_user_id = account.auth_user_id and access.role_slug = 'member' and access.revoked_at is null)
      and account.auth_user_id = new.auth_user_id and placement.circle_id = new.circle_id
      and placement.ended_at is null and placement.assigned_at <= statement_timestamp()) then
    raise exception 'A Circle Supporter must be an eligible current member of that Circle who has completed Foundations.';
  end if;
  return new;
end;
$$;
create trigger circle_staff_assignments_supporter_readiness before insert on public.circle_staff_assignments
for each row execute function private.ruined_guard_new_supporter_service();
revoke all on function private.ruined_guard_new_supporter_service() from public,anon,authenticated;

-- Leaving a Circle ends its scoped service immediately, including transfers and
-- account closure. A replacement is never a prerequisite for leaving.
create or replace function private.ruined_end_supporter_on_circle_departure()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare service record;
begin
  for service in
    update public.circle_staff_assignments staff
    set ended_at = greatest(new.ended_at,staff.assigned_at),
      ended_by_auth_user_id = new.ended_by_auth_user_id,
      end_reason = 'Circle membership ended'
    from public.platform_users account
    where account.member_id = new.member_id and account.auth_user_id = staff.auth_user_id
      and staff.circle_id = new.circle_id and staff.role_slug = 'circle_leader' and staff.ended_at is null
    returning staff.id,staff.auth_user_id,staff.circle_id,staff.ended_at
  loop
    update public.platform_role_grants role_grant set revoked_at = statement_timestamp(), revoke_reason = 'Circle membership and Supporter service ended'
    where role_grant.auth_user_id = service.auth_user_id and role_grant.role_slug = 'circle_leader' and role_grant.revoked_at is null
      and not exists(select 1 from public.circle_staff_assignments remaining where remaining.auth_user_id = service.auth_user_id and remaining.role_slug = 'circle_leader' and remaining.ended_at is null);
    insert into public.operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,reason,before_snapshot,after_snapshot,metadata,dedupe_key)
    values(new.ended_by_auth_user_id,'supporter.service_ended_membership','circle_staff_assignment',service.id::text,'Circle membership ended',
      jsonb_build_object('authUserId',service.auth_user_id,'circleId',service.circle_id),jsonb_build_object('endedAt',service.ended_at,'memberAssignmentId',new.id),
      '{}'::jsonb,'supporter-circle-departure:' || service.id::text);
  end loop;
  return new;
end;
$$;
create trigger circle_member_assignments_end_supporter after update of ended_at on public.circle_member_assignments
for each row when (old.ended_at is null and new.ended_at is not null) execute function private.ruined_end_supporter_on_circle_departure();
revoke all on function private.ruined_end_supporter_on_circle_departure() from public,anon,authenticated;

create table public.supporter_reimbursements (
  id uuid primary key default gen_random_uuid(),
  assignment_id bigint not null references public.circle_staff_assignments(id),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  amount_minor integer not null check (amount_minor between 1 and 10000000),
  currency text not null check (currency = 'USD'),
  status text not null default 'pending' check (status in ('pending','approved','rejected','processed')),
  reason text not null check (length(btrim(reason)) between 1 and 1200),
  requested_by_auth_user_id uuid not null references public.platform_users(auth_user_id),
  requested_at timestamptz not null default statement_timestamp(),
  decided_by_auth_user_id uuid references public.platform_users(auth_user_id),
  decided_at timestamptz,
  decision_reason text,
  processed_by_auth_user_id uuid references public.platform_users(auth_user_id),
  processed_at date,
  payment_reference text,
  processing_reason text,
  check ((status = 'pending' and decided_by_auth_user_id is null and decided_at is null and decision_reason is null)
    or (status <> 'pending' and decided_by_auth_user_id is not null and decided_at is not null and length(btrim(decision_reason)) between 1 and 1200)),
  check ((status <> 'processed' and processed_by_auth_user_id is null and processed_at is null and payment_reference is null and processing_reason is null)
    or (status = 'processed' and processed_by_auth_user_id is not null and processed_at is not null and length(btrim(payment_reference)) between 1 and 160 and length(btrim(processing_reason)) between 1 and 1200))
);
create unique index supporter_reimbursement_payment_reference on public.supporter_reimbursements(lower(btrim(payment_reference))) where status = 'processed';
create index supporter_reimbursement_service on public.supporter_reimbursements(assignment_id,period_start,period_end);

create or replace function private.ruined_guard_supporter_reimbursement()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare service public.circle_staff_assignments%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'Reimbursement history cannot be deleted.'; end if;
  select * into service from public.circle_staff_assignments where id = new.assignment_id for update;
  if service.id is null or service.role_slug <> 'circle_leader'
    or new.period_start < (service.assigned_at at time zone 'UTC')::date
    or new.period_end > least(coalesce((service.ended_at at time zone 'UTC')::date, (statement_timestamp() at time zone 'UTC')::date), (statement_timestamp() at time zone 'UTC')::date) then
    raise exception 'Reimbursements must cover an elapsed period of active Supporter service.';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'New reimbursement records require a decision first.'; end if;
  else
    if row(new.assignment_id,new.period_start,new.period_end,new.amount_minor,new.currency,new.reason,new.requested_by_auth_user_id,new.requested_at)
      is distinct from row(old.assignment_id,old.period_start,old.period_end,old.amount_minor,old.currency,old.reason,old.requested_by_auth_user_id,old.requested_at) then
      raise exception 'Reimbursement details are immutable.';
    end if;
    if not ((old.status = 'pending' and new.status in ('approved','rejected')) or (old.status = 'approved' and new.status = 'processed')) then
      raise exception 'This reimbursement transition is not available.';
    end if;
    if old.status = 'approved' and row(new.decided_by_auth_user_id,new.decided_at,new.decision_reason)
      is distinct from row(old.decided_by_auth_user_id,old.decided_at,old.decision_reason) then
      raise exception 'The approval record is immutable.';
    end if;
  end if;
  if new.status <> 'rejected' and exists (select 1 from public.supporter_reimbursements prior
    join public.circle_staff_assignments prior_service on prior_service.id = prior.assignment_id
    where prior_service.auth_user_id = service.auth_user_id and prior.id <> new.id and prior.status <> 'rejected'
      and prior.period_start <= new.period_end and prior.period_end >= new.period_start) then
    raise exception 'An overlapping reimbursement already exists for this service period.';
  end if;
  if new.processed_at is not null and (new.processed_at > (statement_timestamp() at time zone 'UTC')::date or new.processed_at < (new.decided_at at time zone 'UTC')::date) then
    raise exception 'Processing date must be between approval and today.';
  end if;
  return new;
end;
$$;
create trigger supporter_reimbursements_guard before insert or update or delete on public.supporter_reimbursements
for each row execute function private.ruined_guard_supporter_reimbursement();
revoke all on function private.ruined_guard_supporter_reimbursement() from public,anon,authenticated;

-- Reimbursement eligibility never funds access. Preserve explicit independent
-- complimentary grants and administrator funding, without charging anyone.
create or replace function private.ruined_member_has_operator_funding(requested_member_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.ruined_members member
    join public.people person on person.id = member.person_id and person.status = 'active'
    join public.platform_users account on account.member_id = member.id and account.person_id = member.person_id and account.status = 'active'
    where member.id = requested_member_id
      and exists (select 1 from public.platform_role_grants member_grant where member_grant.auth_user_id = account.auth_user_id and member_grant.role_slug = 'member' and member_grant.revoked_at is null)
      and exists (select 1 from public.platform_role_grants operator_grant where operator_grant.auth_user_id = account.auth_user_id and operator_grant.role_slug = 'ops_admin' and operator_grant.revoked_at is null)
  )
$$;
revoke all on function private.ruined_member_has_operator_funding(uuid) from public,anon,authenticated;

-- Lock exactly the grants that can fund membership. Locking Circle Supporter
-- or legacy Guide grants here would create a SHARE(role) -> member versus
-- departure member -> UPDATE(role) cycle even though those roles no longer fund access.
create or replace function private.ruined_lock_member_operator_funding(requested_member_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform operator_grant.id
  from public.platform_role_grants operator_grant
  join public.platform_users account on account.auth_user_id = operator_grant.auth_user_id
  where account.member_id = requested_member_id
    and operator_grant.role_slug = 'ops_admin'
    and operator_grant.revoked_at is null
  order by operator_grant.role_slug, operator_grant.id
  for share of operator_grant;
  return private.ruined_member_has_operator_funding(requested_member_id);
end;
$$;
revoke all on function private.ruined_lock_member_operator_funding(uuid) from public,anon,authenticated;

alter table public.leadership_responsibility_grants enable row level security;
alter table public.supporter_readiness_approvals enable row level security;
alter table public.supporter_service_details enable row level security;
alter table public.supporter_reimbursements enable row level security;
revoke all on public.leadership_responsibility_grants,public.supporter_readiness_approvals,public.supporter_service_details,public.supporter_reimbursements from public,anon,authenticated;
comment on table public.supporter_reimbursements is 'Private manual reimbursement decisions. Eligibility is discretionary, not a guarantee. Records never issue payments or change membership billing.';
commit;
