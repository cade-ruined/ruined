begin;

-- Grandfather completed registrations only. The flag is pinned at enrollment,
-- so document publication never signs new terms for an existing member.
alter table public.member_registration_access add column legal_acknowledgment_required boolean not null default false;
update public.member_registration_access set legal_acknowledgment_required=true
  where registered_at is null and profile_activated_at is null;
alter table public.member_registration_access alter column legal_acknowledgment_required set default true;

create function private.ruined_registration_legal_complete(target_member_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public,private as $$
  select not exists(select 1 from public.member_registration_access registration
    where registration.member_id=target_member_id and registration.legal_acknowledgment_required
      and not exists(select 1 from public.member_consents consent
        where consent.member_id=registration.member_id and consent.consent_type='privacy' and consent.decision='accepted'
          and consent.source='member' and consent.actor_auth_user_id is not null
          and consent.evidence->>'context'='registration_documents_v1'
          and consent.evidence->>'affirmativeAction'='checkbox_and_submit'
          and consent.evidence->'membershipTerms'->>'key'='ruined_registration'
          and consent.evidence->'membershipTerms'->>'sha256' ~ '^[0-9a-f]{64}$'
          and consent.evidence->>'registrationTermsAccepted'='true'
          and consent.evidence->>'paidAgreementAccepted'='false' and consent.evidence->>'chargeAuthorized'='false'))
$$;
revoke all on function private.ruined_registration_legal_complete(uuid) from public,anon,authenticated;

-- Keep all identity, eligibility and saved-card checks. A metadata flag or
-- profile timestamp cannot bypass document review during completion/release.
create or replace function private.ruined_member_registration_ready(target_member_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog,public,private as $$
 select exists(
   select 1 from public.member_registration_access registration
   join public.ruined_members member on member.id=registration.member_id and member.deleted_at is null
   join public.people person on person.id=member.person_id and person.status='active'
   join public.member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
   join public.member_onboardings onboarding on onboarding.member_id=member.id and onboarding.profile_completed_at is not null
   left join public.person_private_profiles profile on profile.person_id=member.person_id
   where member.id=target_member_id
   and private.ruined_registration_legal_complete(member.id)
   and (registration.profile_activated_at is not null or private.ruined_registration_intake_eligibility_error(
     profile.birth_date, profile.default_fulfillment_address->>'countryCode') is null)
   and exists(select 1 from public.platform_users identity
     join public.platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
     join public.person_email_addresses email on email.person_id=identity.person_id and email.email_normalized=identity.email_normalized
       and email.verification_state='verified' and email.retired_at is null
     where identity.person_id=member.person_id and identity.status='active' and (identity.member_id is null or identity.member_id=member.id))
   and (private.ruined_member_has_complimentary_funding(member.id) or private.ruined_member_has_operator_funding(member.id)
     or exists(select 1 from public.member_payment_method_accounts account
       join public.member_payment_method_setup_attempts attempt on attempt.id=account.consent_attempt_id
         and attempt.member_id=account.member_id and attempt.stripe_account_id=account.stripe_account_id and attempt.livemode=account.livemode
       where account.member_id=member.id and account.stripe_account_id=registration.payment_setup_account_id
         and account.livemode=registration.payment_setup_livemode and account.stripe_payment_method_id is not null
         and account.saved_at is not null and account.consent_revoked_at is null and not account.cleanup_pending
         and attempt.status='saved' and attempt.consent_revoked_at is null
         and not exists(select 1 from public.member_payment_method_detachments detached
           where detached.stripe_account_id=account.stripe_account_id and detached.livemode=account.livemode
             and detached.stripe_payment_method_id=account.stripe_payment_method_id)))
 )
$$;
revoke all on function private.ruined_member_registration_ready(uuid) from public,anon,authenticated;

create function private.ruined_guard_registration_legal() returns trigger
language plpgsql set search_path=pg_catalog,public,private as $$
begin
  if tg_op='INSERT' and not new.legal_acknowledgment_required then
    raise exception 'New registrations require document acknowledgment.';
  end if;
  if tg_op='UPDATE' and new.legal_acknowledgment_required is distinct from old.legal_acknowledgment_required then
    raise exception 'The registration document requirement is immutable.';
  end if;
  if new.legal_acknowledgment_required and (
    (new.registered_at is not null and (tg_op='INSERT' or old.registered_at is null))
    or (new.profile_activated_at is not null and (tg_op='INSERT' or old.profile_activated_at is null)))
    and (tg_op='INSERT' or not private.ruined_registration_legal_complete(new.member_id)) then
    raise exception using errcode='P4302',message='Review the registration documents before completing registration.';
  end if;
  return new;
end $$;
revoke all on function private.ruined_guard_registration_legal() from public,anon,authenticated;
create trigger registration_legal before insert or update of registered_at,profile_activated_at,legal_acknowledgment_required
  on public.member_registration_access for each row execute function private.ruined_guard_registration_legal();

commit;
