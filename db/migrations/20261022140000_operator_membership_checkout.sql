begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Sponsorship changes the accepting/paying actor, never the membership owner.
-- No existing self-service agreement or payment consent is rewritten.
create function private.ruined_require_operator_membership_actor(actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform identity.auth_user_id from public.platform_users identity
    join public.platform_role_grants role_grant on role_grant.auth_user_id=identity.auth_user_id
      and role_grant.role_slug='ops_admin' and role_grant.revoked_at is null
    where identity.auth_user_id=actor and identity.status='active'
    for share of identity,role_grant;
  if not found then raise exception 'Administrator access is required for delegated membership checkout.'; end if;
end $$;

create function private.ruined_operator_membership_target_ready(target uuid, minimum_age integer)
returns boolean language sql stable security invoker set search_path='' as $$
 select minimum_age between 18 and 120 and exists(
   select 1 from public.ruined_members member
   join public.people person on person.id=member.person_id and person.status='active'
   join public.member_lifecycle lifecycle on lifecycle.member_id=member.id
   join public.member_onboardings onboarding on onboarding.member_id=member.id and onboarding.profile_completed_at is not null
   join public.person_private_profiles profile on profile.person_id=member.person_id
   where member.id=target and member.deleted_at is null and member.membership_state='pending'
     and lifecycle.account_state='active' and lifecycle.billing_state='pending'
     and lifecycle.standing_state='pre_active' and lifecycle.program_state in ('prospect','onboarding')
     and nullif(btrim(profile.legal_name),'') is not null
     and profile.birth_date <= current_date-make_interval(years=>minimum_age)
     and profile.default_fulfillment_address->>'countryCode'='US'
     and private.ruined_member_paid_activation_ready(member.id)
     and private.ruined_registration_legal_complete(member.id)
     and exists(select 1 from public.platform_users owner
       join public.platform_role_grants role_grant on role_grant.auth_user_id=owner.auth_user_id
         and role_grant.role_slug='member' and role_grant.revoked_at is null
       join public.person_email_addresses email on email.person_id=owner.person_id
         and email.email_normalized=owner.email_normalized and email.verification_state='verified' and email.retired_at is null
       where owner.member_id=member.id and owner.person_id=member.person_id and owner.status='active'
         and owner.email_normalized=member.email_normalized)
     and not private.ruined_member_has_complimentary_funding(member.id)
     and not private.ruined_member_has_operator_funding(member.id)
     and not private.ruined_member_has_couple_funding(member.id)
     and not exists(select 1 from public.platform_users owner join public.platform_role_grants role_grant
       on role_grant.auth_user_id=owner.auth_user_id and role_grant.role_slug in ('ops_admin','ops_support') and role_grant.revoked_at is null
       where owner.member_id=member.id and owner.status='active')
     and not exists(select 1 from public.membership_couple_authorizations couple
       where (couple.payer_member_id=member.id or couple.partner_member_id=member.id)
         and couple.accepted_at is not null and couple.revoked_at is null and couple.expires_at>statement_timestamp())
     and not exists(select 1 from public.membership_commercial_reservations quote
       where quote.payer_member_id=member.id and quote.kind='couple' and quote.status in ('reserved','activated'))
     and not exists(select 1 from public.stripe_subscriptions subscription where subscription.member_id=member.id
       and subscription.stripe_status not in ('canceled','incomplete_expired'))
     and not exists(select 1 from public.stripe_checkout_attempts attempt where attempt.member_id=member.id and attempt.status='completed'
       and (attempt.stripe_subscription_id is null or not exists(select 1 from public.stripe_subscriptions subscription where subscription.id=attempt.stripe_subscription_id)))
 )
$$;

create table public.operator_membership_authorizations (
 id uuid primary key,
 member_id uuid not null references public.ruined_members(id) on delete restrict,
 person_id uuid not null references public.people(id) on delete restrict,
 actor_auth_user_id uuid not null references public.platform_users(auth_user_id) on delete restrict,
 actor_name_snapshot text not null check(length(btrim(actor_name_snapshot)) between 1 and 180),
 actor_email_snapshot text not null,
 member_name_snapshot text not null check(length(btrim(member_name_snapshot)) between 1 and 180),
 member_email_snapshot text not null,
 agreement_version_id uuid not null references public.membership_agreement_versions(id) on delete restrict,
 agreement_content_sha256 text not null check(agreement_content_sha256 ~ '^[a-f0-9]{64}$'),
 reservation_id uuid not null unique references public.membership_commercial_reservations(id) on delete restrict,
 billing_plan text not null check(billing_plan in ('monthly','annual')),
 authority_version text not null check(authority_version='operator-membership-authority-v1'),
 authority_text text not null check(authority_text='I have this member’s authorization to accept the Ruined Membership Agreement on their behalf. I am the cardholder and authorize the payment shown and recurring renewals on this card under these terms.'),
 minimum_age integer not null check(minimum_age between 18 and 120),
 origin text not null,
 user_agent text,
 authorized_at timestamptz not null default statement_timestamp(),
 created_at timestamptz not null default statement_timestamp(),
 foreign key(member_id,person_id) references public.ruined_members(id,person_id) on delete restrict,
 check(id=reservation_id)
);
alter table public.operator_membership_authorizations enable row level security;
revoke all on public.operator_membership_authorizations from public,anon,authenticated;
grant select,insert on public.operator_membership_authorizations to service_role;

alter table public.membership_agreement_acceptances add column operator_authorization_id uuid unique
 references public.operator_membership_authorizations(id) on delete restrict;
alter table public.stripe_checkout_attempts add column operator_authorization_id uuid
 references public.operator_membership_authorizations(id) on delete restrict;

create function private.ruined_validate_operator_membership_authorization()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform private.ruined_require_operator_membership_actor(new.actor_auth_user_id);
 if not private.ruined_operator_membership_target_ready(new.member_id,new.minimum_age) then
   raise exception 'This member is not eligible for delegated membership checkout.';
 end if;
 if new.authorized_at > statement_timestamp() or not exists(
   select 1 from public.membership_commercial_reservations quote
   join public.membership_agreement_versions agreement on agreement.id=new.agreement_version_id
     and agreement.agreement_key='ruined_membership' and agreement.status='published'
     and agreement.version>=2 and agreement.content_sha256=new.agreement_content_sha256
     and agreement.published_at<=new.authorized_at and (agreement.effective_at is null or agreement.effective_at<=new.authorized_at)
   where quote.id=new.reservation_id and quote.id=new.id and quote.payer_member_id=new.member_id
     and quote.kind='individual' and quote.billing_plan=new.billing_plan and quote.status='reserved'
     and quote.expires_at>statement_timestamp() and quote.stripe_price_id is not null
 ) then raise exception 'Operator delegation must match an available membership offer and published agreement.'; end if;
 if not exists(select 1 from public.platform_users actor
   join public.people person on person.id=actor.person_id
   left join public.person_private_profiles profile on profile.person_id=person.id
   left join public.person_profiles public_profile on public_profile.person_id=person.id
   where actor.auth_user_id=new.actor_auth_user_id and actor.email_normalized=new.actor_email_snapshot
     and coalesce(nullif(btrim(profile.legal_name),''),nullif(btrim(public_profile.display_name),''),actor.email_normalized)=new.actor_name_snapshot
 ) or not exists(select 1 from public.ruined_members member
   join public.person_private_profiles profile on profile.person_id=member.person_id
   where member.id=new.member_id and member.person_id=new.person_id
     and member.email_normalized=new.member_email_snapshot and btrim(profile.legal_name)=new.member_name_snapshot
 ) then raise exception 'Operator and beneficiary identity snapshots must match their own accounts.'; end if;
 return new;
end $$;
create trigger operator_membership_authorizations_validate before insert on public.operator_membership_authorizations
 for each row execute function private.ruined_validate_operator_membership_authorization();
create trigger operator_membership_authorizations_immutable before update or delete on public.operator_membership_authorizations
 for each row execute function public.ruined_reject_append_only_mutation();

create or replace function private.ruined_validate_agreement_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  agreement_record public.membership_agreement_versions%rowtype;
  accepting_person_id uuid;
  attestation_member_id uuid;
  attestation_type text;
  attestation_decision text;
  delegation public.operator_membership_authorizations%rowtype;
begin
  select agreement.*
  into agreement_record
  from public.membership_agreement_versions agreement
  where agreement.id = new.agreement_version_id;

  if agreement_record.id is null or agreement_record.status <> 'published' then
    raise exception 'Only a published agreement version may be accepted.';
  end if;

  if new.accepted_at < agreement_record.published_at
     or (
       agreement_record.effective_at is not null
       and new.accepted_at < agreement_record.effective_at
     ) then
    raise exception 'The agreement was not effective at the acceptance time.';
  end if;

  if new.agreement_key_snapshot <> agreement_record.agreement_key
     or new.agreement_version_snapshot <> agreement_record.version
     or new.agreement_title_snapshot <> agreement_record.title
     or new.agreement_content_sha256 <> agreement_record.content_sha256
     or new.agreement_body_snapshot <> agreement_record.body_text then
    raise exception 'Agreement acceptance snapshot does not match the published version.';
  end if;

  select platform_user.person_id
  into accepting_person_id
  from public.platform_users platform_user
  where platform_user.auth_user_id = new.accepted_by_auth_user_id
    and platform_user.status = 'active';

  if new.operator_authorization_id is null then
    if accepting_person_id is distinct from new.person_id then
      raise exception 'The accepting authentication identity does not belong to this Person.';
    end if;
  else
    select * into delegation from public.operator_membership_authorizations
      where id=new.operator_authorization_id;
    perform private.ruined_require_operator_membership_actor(new.accepted_by_auth_user_id);
    if delegation.id is null or delegation.member_id is distinct from new.member_id
      or delegation.person_id is distinct from new.person_id
      or delegation.actor_auth_user_id is distinct from new.accepted_by_auth_user_id
      or delegation.agreement_version_id is distinct from new.agreement_version_id
      or delegation.agreement_content_sha256 is distinct from new.agreement_content_sha256
      or delegation.actor_name_snapshot is distinct from new.signer_name_snapshot
      or delegation.actor_email_snapshot is distinct from new.signer_email_snapshot
      or new.accepted_at < delegation.authorized_at
      or new.age_attestation_id is null
      or new.affirmative_action <> 'checkbox_and_submit'
      or new.acceptance_context <> 'initial_membership'
      or not private.ruined_operator_membership_target_ready(new.member_id,delegation.minimum_age) then
      raise exception 'Delegated agreement acceptance does not match its operator delegation.';
    end if;
    if not exists(select 1 from public.member_consents age_consent
      where age_consent.id=new.age_attestation_id and age_consent.member_id=new.member_id
        and age_consent.consent_type='age_attestation' and age_consent.decision='accepted'
        and age_consent.source='ops' and age_consent.actor_auth_user_id=new.accepted_by_auth_user_id
        and age_consent.evidence->>'operatorAuthorizationId'=delegation.id::text
        and age_consent.evidence->>'basis'='verified_registration_birth_date'
        and age_consent.evidence->>'minimumAge'=delegation.minimum_age::text) then
      raise exception 'Delegated acceptance requires the operator age verification record.';
    end if;
  end if;

  if new.age_attestation_id is not null then
    select consent.member_id, consent.consent_type, consent.decision
    into attestation_member_id, attestation_type, attestation_decision
    from public.member_consents consent
    where consent.id = new.age_attestation_id;

    if attestation_member_id is distinct from new.member_id
       or attestation_type is distinct from 'age_attestation'
       or attestation_decision is distinct from 'accepted' then
      raise exception 'The linked age attestation is not an accepted attestation for this member.';
    end if;
  end if;

  return new;
end;
$$;


-- The bound operator cannot be swapped on retry, and delegated acceptance can
-- never be used as if the member personally completed self-service checkout.
create function private.ruined_validate_operator_membership_checkout()
returns trigger language plpgsql security invoker set search_path='' as $$
declare delegation public.operator_membership_authorizations%rowtype; acceptance public.membership_agreement_acceptances%rowtype;
begin
 if tg_op='UPDATE' then
   if new.operator_authorization_id is distinct from old.operator_authorization_id then
     raise exception 'Checkout operator delegation is immutable.';
   end if;
   if new.operator_authorization_id is null and exists(select 1 from public.membership_agreement_acceptances
     where id=new.agreement_acceptance_id and operator_authorization_id is not null) then
     raise exception 'Delegated acceptance requires its operator checkout delegation.';
   end if;
   if old.operator_authorization_id is not null and row(new.id,new.member_id,new.email_normalized,
     new.agreement_acceptance_id,new.billing_consent_auth_user_id,new.commercial_reservation_id,new.billing_plan,new.billing_consent_source)
     is distinct from row(old.id,old.member_id,old.email_normalized,old.agreement_acceptance_id,old.billing_consent_auth_user_id,
       old.commercial_reservation_id,old.billing_plan,old.billing_consent_source) then
     raise exception 'Checkout operator delegation binding is immutable.';
   end if;
   return new;
 end if;
 select * into acceptance from public.membership_agreement_acceptances where id=new.agreement_acceptance_id;
 if new.operator_authorization_id is null then
   if acceptance.operator_authorization_id is not null then raise exception 'Delegated acceptance requires its operator checkout delegation.'; end if;
   return new;
 end if;
 select * into delegation from public.operator_membership_authorizations where id=new.operator_authorization_id;
 perform private.ruined_require_operator_membership_actor(new.billing_consent_auth_user_id);
 if delegation.id is null or delegation.id is distinct from new.id
   or delegation.reservation_id is distinct from new.commercial_reservation_id
   or delegation.member_id is distinct from new.member_id
   or delegation.member_email_snapshot is distinct from new.email_normalized
   or delegation.actor_auth_user_id is distinct from new.billing_consent_auth_user_id
   or delegation.billing_plan is distinct from new.billing_plan
   or acceptance.operator_authorization_id is distinct from delegation.id
   or acceptance.accepted_by_auth_user_id is distinct from delegation.actor_auth_user_id
   or new.billing_consent_source <> 'stripe_checkout'
   or new.recurring_payment_accepted_at is not null or new.billing_consent_evidence is not null
   or not private.ruined_operator_membership_target_ready(new.member_id,delegation.minimum_age) then
   raise exception 'Checkout does not match its delegated operator delegation.';
 end if;
 return new;
end $$;
create trigger stripe_checkout_operator_authorization before insert or update on public.stripe_checkout_attempts
 for each row execute function private.ruined_validate_operator_membership_checkout();

revoke all on function private.ruined_require_operator_membership_actor(uuid),
 private.ruined_operator_membership_target_ready(uuid,integer),
 private.ruined_validate_operator_membership_authorization(),
 private.ruined_validate_operator_membership_checkout()
 from public,anon,authenticated;
grant execute on function private.ruined_require_operator_membership_actor(uuid),
 private.ruined_operator_membership_target_ready(uuid,integer) to service_role;
commit;
