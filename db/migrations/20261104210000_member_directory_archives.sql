begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- A reversible directory filing choice, never a membership/access/billing state.
create table public.member_directory_archives (
  member_id uuid primary key references public.ruined_members(id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.platform_users(auth_user_id) on delete restrict,
  reason text not null check(char_length(btrim(reason)) between 3 and 1000),
  version integer not null default 1 check(version > 0),
  check((archived_at is null) = (archived_by is null))
);
create index member_directory_archives_current on public.member_directory_archives(archived_at,member_id) where archived_at is not null;
alter table public.member_directory_archives enable row level security;
revoke all on public.member_directory_archives from public,anon,authenticated;
grant select,insert,update on public.member_directory_archives to service_role;

create function private.ruined_member_archive_state(actor uuid, member uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  target public.ruined_members%rowtype;
  lifecycle public.member_lifecycle%rowtype;
  archive public.member_directory_archives%rowtype;
  blockers text[] := '{}';
  base_blockers text[] := '{}';
  name text;
begin
  if not exists(select 1 from public.platform_users u join public.platform_role_grants g on g.auth_user_id=u.auth_user_id
    where u.auth_user_id=actor and u.status='active' and g.role_slug='ops_admin' and g.revoked_at is null) then
    raise exception using errcode='PT403',message='Administrator access is required.';
  end if;
  select * into target from public.ruined_members where id=member;
  if not found then raise exception using errcode='PT404',message='Member not found.'; end if;
  select * into archive from public.member_directory_archives where member_id=member;
  select * into lifecycle from public.member_lifecycle where member_id=member;
  select coalesce(nullif(btrim(display_name),''),nullif(btrim(preferred_name),''),'Member') into name
    from public.person_profiles where person_id=target.person_id;
  if target.deleted_at is not null then base_blockers:=array_append(base_blockers,'Deleted accounts cannot be archived or restored.'); end if;
  if lifecycle.member_id is null then base_blockers:=array_append(base_blockers,'This member’s account state needs review before it can be archived.'); end if;
  if exists(select 1 from public.platform_users u where u.auth_user_id=actor and (u.member_id=member or u.person_id=target.person_id)) then
    base_blockers:=array_append(base_blockers,'You cannot archive your own member record.');
  end if;
  if exists(select 1 from public.platform_users u where (u.member_id=member or u.person_id=target.person_id)
    and (u.user_type<>'member' or exists(select 1 from public.platform_role_grants g where g.auth_user_id=u.auth_user_id and g.role_slug<>'member' and g.revoked_at is null))) then
    base_blockers:=array_append(base_blockers,'Operator member records cannot be archived here.');
  end if;
  blockers:=base_blockers;
  if lifecycle.billing_state in ('active','attention_required') or target.membership_state in ('active','attention_required')
    or (lifecycle.standing_state in ('active','cancellation_requested') and lifecycle.account_state='active') then
    blockers:=array_append(blockers,'This membership is active or has billing to resolve. End or resolve it before archiving.');
  end if;
  if exists(select 1 from public.stripe_subscriptions where member_id=member and stripe_status not in ('canceled','incomplete_expired'))
    or exists(select 1 from public.stripe_checkout_sessions where member_id=member and (session_status is null or session_status not in ('complete','expired')))
    or exists(select 1 from public.stripe_checkout_attempts where member_id=member and status not in ('completed','expired','failed'))
    or exists(select 1 from public.stripe_invoices where member_id=member and (stripe_status is null or stripe_status not in ('paid','void','uncollectible')))
    or exists(select 1 from public.operator_membership_saved_payments where member_id=member and status in ('prepared','submitting','review')) then
    blockers:=array_append(blockers,'Resolve the open subscription, payment, invoice, or checkout before archiving. Archiving does not cancel billing.');
  end if;
  if exists(select 1 from public.member_complimentary_grants where member_id=member and revoked_at is null and (ends_at is null or ends_at>statement_timestamp()))
    or private.ruined_member_has_operator_funding(member) then
    blockers:=array_append(blockers,'This member has complimentary or operator-funded membership. End that access before archiving.');
  end if;
  if exists(select 1 from public.membership_commercial_reservations r
    where (r.payer_member_id=member or exists(select 1 from public.membership_commercial_participants p where p.reservation_id=r.id and p.member_id=member))
      and ((r.status='reserved' and r.expires_at>statement_timestamp())
        or (r.status='activated' and exists(select 1 from public.stripe_subscriptions s where s.id=r.stripe_subscription_id and s.stripe_status not in ('canceled','incomplete_expired')))
        or exists(select 1 from public.stripe_membership_prepaid_proofs p where p.reservation_id=r.id and p.refund_state<>'refunded'
          and (p.activated_at is null or (p.prepaid_through>statement_timestamp() and p.provider_canceled_at is null))))) then
    blockers:=array_append(blockers,'This member has a pending or prepaid membership, including shared membership. Resolve it before archiving.');
  end if;
  return jsonb_build_object('archivedAt',archive.archived_at,'version',coalesce(archive.version,0),
    'memberName',coalesce(name,'Member'),'allowed',archive.archived_at is null and cardinality(blockers)=0,
    'restoreAllowed',archive.archived_at is not null and cardinality(base_blockers)=0,
    'blockers',to_jsonb(case when archive.archived_at is not null then base_blockers else blockers end),'reason',archive.reason);
end; $$;

create function private.ruined_set_member_archive(actor uuid, member uuid, action text, expected_version integer, reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare state jsonb; result jsonb;
begin
  if action is null or action not in ('archive','restore') or expected_version is null or expected_version<0
    or reason is null or char_length(btrim(reason)) not between 3 and 1000 then
    raise exception using errcode='PT400',message='Choose archive or restore, and include a reason between 3 and 1,000 characters.';
  end if;
  -- Recheck the actor under locks. Member serialization also covers checkout,
  -- state correction, deletion and funding writers which lock the member first.
  perform 1 from public.platform_users where auth_user_id=actor for update;
  perform 1 from public.platform_role_grants where auth_user_id=actor order by id for update;
  if not exists(select 1 from public.platform_users u join public.platform_role_grants g on g.auth_user_id=u.auth_user_id
    where u.auth_user_id=actor and u.status='active' and g.role_slug='ops_admin' and g.revoked_at is null) then
    raise exception using errcode='PT403',message='Administrator access is required.';
  end if;
  perform 1 from public.ruined_members where id=member for update;
  if not found then raise exception using errcode='PT404',message='Member not found.'; end if;
  perform 1 from public.member_lifecycle where member_id=member for update;
  perform 1 from public.member_directory_archives where member_id=member for update;
  perform 1 from public.stripe_subscriptions where member_id=member order by id for update;
  perform 1 from public.stripe_checkout_sessions where member_id=member order by id for update;
  perform 1 from public.stripe_checkout_attempts where member_id=member order by id for update;
  perform 1 from public.stripe_invoices where member_id=member order by id for update;
  state:=private.ruined_member_archive_state(actor,member);
  if (state->>'version')::integer<>expected_version then
    raise exception using errcode='PT409',message='This record changed. Refresh before trying again.';
  end if;
  if (action='archive' and not (state->>'allowed')::boolean) or (action='restore' and not (state->>'restoreAllowed')::boolean) then
    raise exception using errcode='PT409',message=coalesce(state->'blockers'->>0,
      case when action='archive' then 'This member is already archived.' else 'This member is not archived.' end);
  end if;
  insert into public.member_directory_archives(member_id,archived_at,archived_by,reason,version)
  values(member,case when action='archive' then statement_timestamp() else null end,
    case when action='archive' then actor else null end,btrim(reason),1)
  on conflict(member_id) do update set archived_at=excluded.archived_at,archived_by=excluded.archived_by,
    reason=excluded.reason,version=public.member_directory_archives.version+1;
  result:=private.ruined_member_archive_state(actor,member);
  insert into public.operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,reason,before_snapshot,after_snapshot,metadata,dedupe_key)
  values(actor,case when action='archive' then 'member.directory_archived' else 'member.directory_restored' end,
    'member',member::text,member,btrim(reason),state,result,'{"scope":"directory_only"}'::jsonb,
    'member.directory:'||member::text||':'||(result->>'version'));
  return result;
end; $$;
revoke all on function private.ruined_member_archive_state(uuid,uuid),private.ruined_set_member_archive(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function private.ruined_member_archive_state(uuid,uuid),private.ruined_set_member_archive(uuid,uuid,text,integer,text) to service_role;
commit;
