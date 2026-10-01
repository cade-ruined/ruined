begin;

-- New membership registration is currently open to US adults. Use one server
-- predicate for intake, completion and release, including complimentary entries.
-- reference_date makes the birthday boundary deterministic in offline tests.
create function private.ruined_registration_intake_eligibility_error(
  birth_date date, country_code text, reference_date date default current_date
) returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when birth_date is null or reference_date is null
      or birth_date > (reference_date - interval '18 years')::date
      then 'Membership registration is for adults 18 and over.'
    when upper(btrim(coalesce(country_code,''))) <> 'US'
      then 'Membership registration is currently available in the United States.'
    else null
  end
$$;
revoke all on function private.ruined_registration_intake_eligibility_error(date,text,date)
  from public,anon,authenticated;

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

-- A stale or manually imported intake record cannot bypass eligibility when a
-- later worker completes registration or an administrator opens its profile.
create function private.ruined_guard_registration_eligibility() returns trigger
language plpgsql set search_path = pg_catalog,public,private as $$
declare eligibility_error text;
begin
  if (new.registered_at is not null and (tg_op='INSERT' or old.registered_at is null))
    or (new.profile_activated_at is not null and (tg_op='INSERT' or old.profile_activated_at is null)) then
    select private.ruined_registration_intake_eligibility_error(profile.birth_date,
      profile.default_fulfillment_address->>'countryCode') into eligibility_error
    from public.ruined_members member
    left join public.person_private_profiles profile on profile.person_id=member.person_id
    where member.id=new.member_id;
    if eligibility_error is not null then
      raise exception using errcode='P4301', message=eligibility_error;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.ruined_guard_registration_eligibility() from public,anon,authenticated;
create trigger registration_eligibility before insert or update of registered_at,profile_activated_at
  on public.member_registration_access for each row execute function private.ruined_guard_registration_eligibility();

commit;
