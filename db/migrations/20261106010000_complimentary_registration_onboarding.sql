begin;

-- Complimentary registration terms are their own recorded legal basis. They
-- do not create a paid agreement, a billing confirmation, or an operator role.
create function private.ruined_complimentary_onboarding_ready(target_member_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(
    select 1 from public.ruined_members member
    join public.people person on person.id=member.person_id and person.status='active'
    join public.member_lifecycle lifecycle on lifecycle.member_id=member.id
    join public.member_registration_access registration on registration.member_id=member.id
    join public.member_onboardings onboarding on onboarding.member_id=member.id
    join public.person_profiles profile on profile.person_id=member.person_id
    join lateral (
      select decision.* from public.member_consents decision
      where decision.member_id=member.id and decision.consent_type='privacy'
        and decision.evidence->>'context'='registration_documents_v1'
      order by decision.id desc limit 1
    ) consent on true
    join public.platform_users account on account.auth_user_id=consent.actor_auth_user_id
      and account.member_id=member.id and account.person_id=member.person_id and account.status='active'
      and account.email_normalized=member.email_normalized
    where member.id=target_member_id and member.deleted_at is null
      and lifecycle.account_state='active' and lifecycle.billing_state in ('pending','active')
      and lifecycle.program_state in ('prospect','onboarding','active')
      and lifecycle.standing_state in ('pre_active','active')
      and lifecycle.cancellation_effective_at is null
      and registration.completion_basis='complimentary'
      and registration.registered_at<=clock_timestamp() and registration.profile_activated_at<=clock_timestamp()
      and onboarding.state in ('not_started','in_progress','completed')
      and onboarding.profile_completed_at<=clock_timestamp()
      and nullif(btrim(coalesce(profile.preferred_name,profile.display_name)),'') is not null
      and private.ruined_member_profile_released(member.id)
      and private.ruined_member_registration_ready(member.id)
      and private.ruined_registration_legal_complete(member.id)
      and private.ruined_member_has_complimentary_funding(member.id)
      and exists(select 1 from public.platform_role_grants role_grant
        where role_grant.auth_user_id=account.auth_user_id and role_grant.role_slug='member' and role_grant.revoked_at is null)
      and exists(select 1 from public.person_email_addresses address
        where address.person_id=member.person_id and address.email_normalized=member.email_normalized
          and address.verification_state='verified' and address.retired_at is null)
      and consent.decision='accepted' and consent.source='member' and consent.accepted_at<=clock_timestamp()
      and consent.evidence->>'affirmativeAction'='checkbox_and_submit'
      and consent.evidence->>'registrationTermsAccepted'='true'
      and consent.evidence->>'paidAgreementAccepted'='false'
      and consent.evidence->>'chargeAuthorized'='false'
      and consent.evidence->'membershipTerms'->>'key'='ruined_registration'
      and consent.evidence->'membershipTerms'->>'sha256' ~ '^[0-9a-f]{64}$'
      and exists(select 1 from public.membership_agreement_versions terms
        where terms.id::text=consent.evidence->'membershipTerms'->>'id'
          and terms.agreement_key='ruined_registration' and terms.published_at is not null
          and terms.published_at<=consent.accepted_at
          and terms.version::text=consent.evidence->'membershipTerms'->>'version'
          and terms.content_sha256=consent.evidence->'membershipTerms'->>'sha256'
          and terms.body_text=consent.evidence->'membershipTerms'->>'body')
  );
$$;

-- Keep the established paid/couple checks exactly as shipped. The sole new
-- alternative is verified complimentary registration evidence, including when
-- legacy agreement_completed_at remains null because no paid agreement exists.
do $$
declare definition text; checkpoint text:='or new.agreement_completed_at is null';
  acceptance text:=E'if not exists (\n    select 1\n    from public.membership_agreement_acceptances acceptance';
begin
  select pg_get_functiondef('private.ruined_validate_member_onboarding_completion()'::regprocedure) into definition;
  if position(checkpoint in definition)=0 or position(acceptance in definition)=0 then
    raise exception 'Cannot safely extend the existing onboarding completion guard.';
  end if;
  definition:=replace(definition,checkpoint,'or (new.agreement_completed_at is null and not private.ruined_complimentary_onboarding_ready(new.member_id))');
  definition:=replace(definition,acceptance,E'if not private.ruined_complimentary_onboarding_ready(new.member_id) and not exists (\n    select 1\n    from public.membership_agreement_acceptances acceptance');
  execute definition;
end $$;

-- Service-only, scoped reconciliation. Callers supply a real administrator for
-- an operator repair, or null for normal system registration reconciliation.
-- The caller invalidates calendar audiences in this same transaction on true.
create function private.ruined_reconcile_complimentary_onboarding(target_member_id uuid,actor_id uuid default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare prior public.member_lifecycle%rowtype; onboarding public.member_onboardings%rowtype;
  consent public.member_consents%rowtype; evidence jsonb; source_kind text;
  transition_key text; next_program text; next_standing text;
begin
  if actor_id is not null then
    perform actor.auth_user_id from public.platform_users actor
      join public.people person on person.id=actor.person_id and person.status='active'
      join public.platform_role_grants role_grant on role_grant.auth_user_id=actor.auth_user_id
        and role_grant.role_slug='ops_admin' and role_grant.revoked_at is null
      where actor.auth_user_id=actor_id and actor.status='active'
      for share of actor,person,role_grant;
    if not found then raise exception 'An active administrator is required for this onboarding repair.'; end if;
  end if;
  perform private.ruined_lock_member_complimentary_funding(target_member_id);
  perform member.id from public.ruined_members member where member.id=target_member_id for update;
  if not found then return false; end if;
  select * into prior from public.member_lifecycle where member_id=target_member_id for update;
  if not found then return false; end if;
  perform registration.member_id from public.member_registration_access registration where registration.member_id=target_member_id for share;
  select * into onboarding from public.member_onboardings where member_id=target_member_id for update;
  if not found then return false; end if;
  if onboarding.state='completed' and prior.administrative_onboarding_state='completed'
    and prior.program_state in ('onboarding','active') and prior.standing_state='active' then return false; end if;
  perform person.id from public.people person join public.ruined_members member on member.person_id=person.id
    where member.id=target_member_id for share of person;
  perform profile.person_id from public.person_profiles profile join public.ruined_members member on member.person_id=profile.person_id
    where member.id=target_member_id for share of profile;
  perform account.auth_user_id from public.platform_users account join public.ruined_members member on member.person_id=account.person_id
    where member.id=target_member_id for share of account;
  perform role_grant.id from public.platform_role_grants role_grant join public.platform_users account on account.auth_user_id=role_grant.auth_user_id
    join public.ruined_members member on member.person_id=account.person_id
    where member.id=target_member_id and role_grant.role_slug='member' for share of role_grant;
  perform address.id from public.person_email_addresses address join public.ruined_members member on member.person_id=address.person_id
    where member.id=target_member_id for share of address;
  perform decision.id from public.member_consents decision where decision.member_id=target_member_id
    and decision.consent_type='privacy' and decision.evidence->>'context'='registration_documents_v1' for share;
  if not private.ruined_complimentary_onboarding_ready(target_member_id) then return false; end if;
  select * into consent from public.member_consents decision where decision.member_id=target_member_id
    and decision.consent_type='privacy' and decision.evidence->>'context'='registration_documents_v1' order by decision.id desc limit 1;
  source_kind:=case when actor_id is null then 'system' else 'ops' end;
  transition_key:='complimentary-registration-onboarding:'||target_member_id::text||':'||onboarding.version::text;
  evidence:=jsonb_build_object('source','complimentary_registration_reconciliation','executionSource',source_kind,
    'registrationConsentId',consent.id::text,'registrationAcceptedAt',consent.accepted_at,
    'registrationTerms',jsonb_build_object('key',consent.evidence->'membershipTerms'->>'key',
      'id',consent.evidence->'membershipTerms'->>'id','version',consent.evidence->'membershipTerms'->>'version',
      'sha256',consent.evidence->'membershipTerms'->>'sha256'),
    'funding','complimentary','fundingGrantIds',coalesce((select jsonb_agg(funding.id order by funding.id)
      from public.member_complimentary_grants funding where funding.member_id=target_member_id and funding.revoked_at is null
        and funding.starts_at<=clock_timestamp() and (funding.ends_at is null or funding.ends_at>clock_timestamp())),'[]'::jsonb),
    'operatorRoleGrantIds',coalesce((select jsonb_agg(role_grant.id order by role_grant.id)
      from public.platform_role_grants role_grant join public.platform_users account on account.auth_user_id=role_grant.auth_user_id
      join public.ruined_members member on member.id=account.member_id and member.person_id=account.person_id
      where member.id=target_member_id and account.status='active'
        and role_grant.role_slug in ('ops_admin','circle_leader','guide') and role_grant.revoked_at is null),'[]'::jsonb),
    'actorAuthUserId',actor_id,'paidAgreementCreated',false,'billingChanged',false,'reconciledAt',clock_timestamp());
  -- The existing guard rechecks current evidence. Do not manufacture any
  -- agreement/billing checkpoint or alter the original completion timestamps.
  update public.member_onboardings set state='completed',started_at=coalesce(started_at,clock_timestamp()),
    completed_at=coalesce(completed_at,clock_timestamp()),completion_evidence=completion_evidence||evidence,
    version=version+1,updated_at=clock_timestamp() where member_id=target_member_id;
  next_program:=case when prior.program_state='prospect' then 'onboarding' else prior.program_state end;
  next_standing:=case when prior.standing_state='pre_active' then 'active' else prior.standing_state end;
  update public.member_lifecycle set administrative_onboarding_state='completed',program_state=next_program,
    standing_state=next_standing,access_started_at=coalesce(access_started_at,clock_timestamp()),version=version+1,updated_at=clock_timestamp()
    where member_id=target_member_id;
  insert into public.member_state_history(member_id,dimension,previous_state,next_state,reason_code,source,
    source_event_id,actor_auth_user_id,metadata,dedupe_key)
    select target_member_id,change.dimension,change.previous_state,change.next_state,'complimentary_registration_complete',source_kind,
      transition_key,actor_id,evidence,transition_key||':'||change.dimension
    from (values ('administrative_onboarding',prior.administrative_onboarding_state,'completed'),
      ('program',prior.program_state,next_program),('standing',prior.standing_state,next_standing)) change(dimension,previous_state,next_state)
    where change.previous_state is distinct from change.next_state on conflict(dedupe_key) do nothing;
  insert into public.member_onboarding_events(member_id,event_type,previous_state,next_state,actor_auth_user_id,evidence,dedupe_key)
    values(target_member_id,'completed',onboarding.state,'completed',actor_id,evidence,transition_key) on conflict(dedupe_key) do nothing;
  insert into public.operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,reason,before_snapshot,after_snapshot,metadata,dedupe_key)
    values(actor_id,'membership.complimentary_onboarding_reconciled','member',target_member_id::text,target_member_id,
      'Reconciled completed complimentary registration from existing member-accepted terms and current funding.',
      jsonb_build_object('onboarding',onboarding.state,'administrativeOnboarding',prior.administrative_onboarding_state,'program',prior.program_state,'standing',prior.standing_state),
      jsonb_build_object('onboarding','completed','administrativeOnboarding','completed','program',next_program,'standing',next_standing),evidence,transition_key);
  return true;
end $$;

revoke all on function private.ruined_complimentary_onboarding_ready(uuid),private.ruined_reconcile_complimentary_onboarding(uuid,uuid) from public,anon,authenticated;
grant execute on function private.ruined_complimentary_onboarding_ready(uuid),private.ruined_reconcile_complimentary_onboarding(uuid,uuid) to service_role;

commit;
