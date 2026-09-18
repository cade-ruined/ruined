begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Delete now closes and erases an account atomically. Existing billing,
-- administrator, shared-identity and obligation safeguards are unchanged.
-- Prior deployed migrations and historical records remain untouched.

create or replace function private.ruined_member_deletion_eligibility(actor uuid, member uuid) returns jsonb
language plpgsql set search_path = '' as $$
declare
  target public.ruined_members%rowtype;
  lifecycle public.member_lifecycle%rowtype;
  identities uuid[];
  blockers text[] := '{}';
  name text;
begin
  if not exists(select 1 from public.platform_users u join public.platform_role_grants g on g.auth_user_id = u.auth_user_id
    where u.auth_user_id = actor and u.status = 'active' and g.role_slug = 'ops_admin' and g.revoked_at is null) then
    raise exception using errcode = 'PT403', message = 'An active administrator is required.';
  end if;
  select * into target from public.ruined_members where id = member;
  if not found then raise exception using errcode = 'PT404', message = 'Member not found.'; end if;
  select * into lifecycle from public.member_lifecycle where member_id = member;
  if target.deleted_at is not null then blockers := array_append(blockers, 'already_deleted'); end if;
  if lifecycle.member_id is null then blockers := array_append(blockers, 'lifecycle_missing'); end if;
  select coalesce(array_agg(auth_user_id), '{}'::uuid[]) into identities from public.platform_users
    where member_id = member or person_id = target.person_id;
  if actor = any(identities) then blockers := array_append(blockers, 'self_deletion'); end if;
  if target.person_id is null or cardinality(identities) > 1
    or exists(select 1 from public.platform_users where auth_user_id = any(identities)
      and (member_id is distinct from member or person_id is distinct from target.person_id))
    or exists(select 1 from public.people where id = target.person_id and status <> 'active')
    or exists(select 1 from public.ruined_members where person_id = target.person_id and id <> member)
    or exists(select 1 from public.person_merge_events where source_person_id = target.person_id or target_person_id = target.person_id)
    then blockers := array_append(blockers, 'shared_identity'); end if;
  if exists(select 1 from public.platform_users where auth_user_id = any(identities) and user_type <> 'member')
    or exists(select 1 from public.platform_role_grants where auth_user_id = any(identities) and role_slug <> 'member')
    or exists(select 1 from public.passwordless_account_invites where
      (member_id = member or email_normalized = target.email_normalized or accepted_by_auth_user_id = any(identities))
      and intended_user_type <> 'member') then blockers := array_append(blockers, 'operator_identity'); end if;
  if exists(select 1 from public.stripe_subscriptions where member_id = member and stripe_status not in ('canceled','incomplete_expired'))
    or exists(select 1 from public.stripe_checkout_sessions where member_id = member and (session_status is null or session_status not in ('complete','expired')))
    or exists(select 1 from public.stripe_checkout_attempts where member_id = member and status not in ('completed','expired','failed'))
    or exists(select 1 from public.stripe_invoices where member_id = member and (stripe_status is null or stripe_status not in ('paid','void','uncollectible')))
    then blockers := array_append(blockers, 'stripe_not_terminal'); end if;
  if exists(select 1 from public.circle_member_assignments where member_id = member and ended_at is null)
    or exists(select 1 from public.accountability_partner_assignments where (member_one_id = member or member_two_id = member) and ended_at is null)
    then blockers := array_append(blockers, 'active_circle'); end if;
  if exists(select 1 from public.experience_registrations r join public.experiences e on e.id = r.experience_id
    where (r.member_id = member or r.person_id = target.person_id) and r.status <> 'cancelled'
      and coalesce(e.ends_at,e.starts_at) >= statement_timestamp() and e.status <> 'cancelled')
    or exists(select 1 from public.community_event_registrations r left join public.community_event_listings e on e.event_key = r.event_key
      where (r.person_id = target.person_id or r.email_normalized = target.email_normalized) and r.status = 'registered'
        and (e.event_key is null or e.starts_at >= statement_timestamp() or e.event_state = 'Ongoing'))
    then blockers := array_append(blockers, 'active_experience'); end if;
  if exists(select 1 from public.artifact_jobs where member_id = member and status not in ('fulfilled','canceled'))
    or exists(select 1 from public.artifact_awards where member_id = member and status = 'in_fulfillment')
    then blockers := array_append(blockers, 'active_fulfillment'); end if;
  if exists(select 1 from public.workflow_actions a join public.domain_events e on e.id = a.domain_event_id
    where (e.member_id = member or e.person_id = target.person_id or a.target_id in (member::text,target.person_id::text))
      and a.status in ('pending','processing','failed'))
    then blockers := array_append(blockers, 'pending_workflows'); end if;
  if exists(select 1 from public.communication_contacts where member_id = member or person_id = target.person_id or email_normalized = target.email_normalized)
    then blockers := array_append(blockers, 'linked_communications'); end if;
  if exists(select 1 from public.member_journal_media where member_id = member
    and storage_path !~ ('^' || member::text || '/(pending/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|verified/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(webp|mp4|webm))$'))
    then blockers := array_append(blockers, 'protected_storage'); end if;
  select coalesce(display_name,preferred_name,'Member') into name from public.person_profiles where person_id = target.person_id;
  return jsonb_build_object('allowed',cardinality(blockers) = 0,'blockers',to_jsonb(blockers),
    'confirmationEmail',target.email_normalized,'memberName',coalesce(name,'Member'),'lifecycleVersion',lifecycle.version);
end; $$;

create or replace function private.ruined_delete_member(actor uuid, member uuid, expected_version bigint, confirmation_email text, reason text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  target public.ruined_members%rowtype;
  decision jsonb;
  identities uuid[];
  cleanup_id uuid;
  token uuid := gen_random_uuid();
  removed_at timestamptz := statement_timestamp();
  paths jsonb;
begin
  perform 1 from public.platform_users where auth_user_id = actor for update;
  perform 1 from public.platform_role_grants where auth_user_id = actor order by id for update;
  if not exists(select 1 from public.platform_users u join public.platform_role_grants g on g.auth_user_id = u.auth_user_id
    where u.auth_user_id = actor and u.status = 'active' and g.role_slug = 'ops_admin' and g.revoked_at is null)
    then raise exception using errcode = 'PT403', message = 'An active administrator is required.'; end if;
  select * into target from public.ruined_members where id = member;
  if not found then raise exception using errcode = 'PT404', message = 'Member not found.'; end if;
  perform pg_advisory_xact_lock(hashtext(target.email_normalized), 1);
  select * into target from public.ruined_members where id = member for update;
  perform 1 from public.member_lifecycle where member_id = member for update;
  if target.deleted_at is not null then
    select id into cleanup_id from private.member_deletion_jobs where member_id = member;
    if cleanup_id is null then raise exception using errcode = 'PT409', message = 'Historical account cleanup requires review.'; end if;
    return jsonb_build_object('deleted',true,'cleanupId',cleanup_id);
  end if;
  perform 1 from public.people where id = target.person_id for update;
  perform 1 from public.platform_users where member_id = member or person_id = target.person_id order by auth_user_id for update;
  perform 1 from public.platform_role_grants where auth_user_id in (select auth_user_id from public.platform_users where member_id = member or person_id = target.person_id) order by id for update;
  perform 1 from public.stripe_subscriptions where member_id = member order by id for update;
  perform 1 from public.stripe_checkout_sessions where member_id = member order by id for update;
  perform 1 from public.stripe_checkout_attempts where member_id = member order by id for update;
  perform 1 from public.stripe_invoices where member_id = member order by id for update;
  perform 1 from public.circle_member_assignments where member_id = member for update;
  perform 1 from public.accountability_partner_assignments where member_one_id = member or member_two_id = member for update;
  perform 1 from public.experience_registrations where member_id = member or person_id = target.person_id for update;
  perform 1 from public.community_event_registrations where person_id = target.person_id or email_normalized = target.email_normalized for update;
  perform 1 from public.artifact_jobs where member_id = member for update;
  perform 1 from public.artifact_awards where member_id = member for update;
  perform 1 from public.workflow_actions a join public.domain_events e on e.id = a.domain_event_id
    where e.member_id = member or e.person_id = target.person_id or a.target_id in (member::text,target.person_id::text) for update of a;
  decision := private.ruined_member_deletion_eligibility(actor,member);
  if not (decision->>'allowed')::boolean then raise exception using errcode = 'PT409', message = 'Resolve this member’s active or shared records before deleting the account.'; end if;
  if expected_version is null or expected_version is distinct from (decision->>'lifecycleVersion')::bigint
    then raise exception using errcode = 'PT409', message = 'The member changed. Reload before deleting.'; end if;
  if confirmation_email is null or lower(btrim(confirmation_email)) is distinct from decision->>'confirmationEmail'
    then raise exception using errcode = 'PT400', message = 'Enter the exact member email to confirm deletion.'; end if;
  if reason is null or reason not in ('test_account','duplicate_account','account_removal','member_request')
    then raise exception using errcode = 'PT400', message = 'Choose a deletion reason.'; end if;
  select coalesce(array_agg(auth_user_id), '{}'::uuid[]) into identities from public.platform_users where member_id = member or person_id = target.person_id;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'path',path)), '[]') into paths from (
    select distinct 'member-portraits' as bucket, replace(avatar,'/api/member-photos/','') as path from (
      select avatar_storage_path as avatar from public.person_profiles where person_id = target.person_id
      union select avatar_storage_path from public.user_profiles where auth_user_id = any(identities)
      union select public_portrait_url from public.member_public_cards where member_id = member
    ) portraits where avatar ~ ('^/api/member-photos/' || member::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
    union select 'member-journal',storage_path from public.member_journal_media where member_id = member
  ) objects;
  insert into private.member_deletion_jobs(member_id,person_id,actor_auth_user_id,reason,transaction_id,authorization_token,auth_user_ids,storage_objects)
    values(member,target.person_id,actor,reason,txid_current(),token,identities,paths) returning id into cleanup_id;
  perform set_config('ruined.member_deletion_token',token::text,true);
  insert into private.member_deletion_records(member_id,person_id,display_name,member_tag,member_number,joined_at,deleted_at,reason,actor_auth_user_id)
    select member,target.person_id,decision->>'memberName',p.member_tag,target.member_number,
      coalesce(l.access_started_at,o.completed_at,target.membership_activated_at),removed_at,reason,actor
    from public.member_lifecycle l left join public.member_onboardings o on o.member_id = l.member_id
    left join public.person_profiles p on p.person_id = target.person_id where l.member_id = member;
  update public.ruined_members set deleted_at = removed_at, email = 'deleted+' || member::text || '@members.invalid',
    email_normalized = 'deleted+' || member::text || '@members.invalid',updated_at = removed_at where id = member;
  -- Closing is part of the same authorized transaction as account erasure.
  -- Keep the original state and actor in append-only history, exactly once.
  insert into public.member_state_history(member_id,dimension,previous_state,next_state,reason_code,source,
    actor_auth_user_id,metadata,dedupe_key,occurred_at)
    select member,'account',l.account_state,'closed','member_account_deleted','ops',actor,
      jsonb_build_object('cleanupId',cleanup_id,'reason',reason),'member.account_deleted:' || member::text || ':account',removed_at
    from public.member_lifecycle l where l.member_id = member and l.account_state <> 'closed';
  update public.member_lifecycle set account_state = 'closed',standing_state = 'inactive',program_state = 'withdrawn',
    version = version + 1,updated_at = removed_at where member_id = member;
  delete from public.member_journal_media where member_id = member;
  delete from public.member_journal_entries where member_id = member;
  delete from public.member_timeline_entry_versions where member_id = member;
  delete from public.member_timeline_entries where member_id = member;
  update public.foundation_submissions set payload = '{}' where enrollment_id in (select id from public.foundation_enrollments where member_id = member);
  delete from public.member_public_cards where member_id = member;
  delete from public.member_invitations where member_id = member;
  delete from public.member_private_profiles where member_id = member;
  update public.platform_role_grants set revoked_at = removed_at,revoke_reason = 'Member account deleted'
    where auth_user_id = any(identities) and revoked_at is null;
  update public.passwordless_account_invites set revoked_at = removed_at where member_id = member and revoked_at is null;
  delete from public.user_profiles where auth_user_id = any(identities);
  update public.platform_users set member_id = null,status = 'disabled',
    email_normalized = 'deleted+' || auth_user_id::text || '@members.invalid',invited_at = null,activated_at = null,
    suspended_at = null,last_signed_in_at = null,updated_at = removed_at where auth_user_id = any(identities);
  delete from public.person_email_addresses where person_id = target.person_id;
  delete from public.person_profiles where person_id = target.person_id;
  delete from public.person_private_profiles where person_id = target.person_id;
  update public.people set status = 'erased',updated_at = removed_at where id = target.person_id;
  insert into public.operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,reason,metadata,dedupe_key)
    values(actor,'member.account_deleted','member',member::text,member,reason,jsonb_build_object('cleanupId',cleanup_id),'member.account_deleted:' || member::text);
  perform set_config('ruined.member_deletion_token','',true);
  return jsonb_build_object('deleted',true,'cleanupId',cleanup_id);
exception when foreign_key_violation or restrict_violation then
  raise exception using errcode = 'PT409', message = 'Linked content requires review before this account can be deleted.';
end; $$;

revoke all on function private.ruined_member_deletion_eligibility(uuid,uuid),
  private.ruined_delete_member(uuid,uuid,bigint,text,text) from public,anon,authenticated;

commit;
