begin;

-- Administrator access includes all current Leadership decisions. Retain the
-- explicit responsibility records and their audit history for provenance;
-- they no longer restrict an active Administrator or authorize a non-admin.
create or replace function private.ruined_has_leadership_responsibility(actor uuid, responsibility text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(responsibility in (
    'circle_placement', 'circle_exception', 'supporter_readiness', 'reimbursements'
  ), false) and exists (
    select 1 from public.platform_users account
    where account.auth_user_id = actor and account.status = 'active'
      and exists (select 1 from public.platform_role_grants role_grant
        where role_grant.auth_user_id = actor and role_grant.role_slug = 'ops_admin'
          and role_grant.revoked_at is null)
  )
$$;
revoke all on function private.ruined_has_leadership_responsibility(uuid,text) from public, anon, authenticated;

commit;
