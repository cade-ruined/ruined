begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Freeze optional stored customer selection before paid provider creation. A retry
-- must not switch customers if a setup webhook or detach lands in between.
alter table public.stripe_checkout_attempts
  add column payment_setup_customer_checked boolean not null default false,
  add column payment_setup_customer_id text,
  add column payment_setup_account_id text,
  add column payment_setup_livemode boolean;

create function private.ruined_payment_setup_checkout_choice_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.payment_setup_customer_checked and row(new.payment_setup_customer_checked,new.payment_setup_customer_id,new.payment_setup_account_id,new.payment_setup_livemode)
    is distinct from row(old.payment_setup_customer_checked,old.payment_setup_customer_id,old.payment_setup_account_id,old.payment_setup_livemode) then
    raise exception 'Checkout payment customer selection is immutable';
  end if;
  return new;
end $$;
create trigger stripe_checkout_setup_customer_immutable before update on public.stripe_checkout_attempts
  for each row execute function private.ruined_payment_setup_checkout_choice_immutable();
revoke all on function private.ruined_payment_setup_checkout_choice_immutable() from public, anon, authenticated;

-- Deliberately separate from paid Checkout, membership agreements, and offer reservations.
create table public.member_payment_method_accounts (
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null,
  stripe_customer_id text check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  consent_attempt_id uuid,
  consent_revoked_at timestamptz,
  cleanup_pending boolean not null default false,
  stripe_payment_method_id text check (stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
  payment_method_display jsonb,
  saved_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (member_id, stripe_account_id, livemode),
  unique (stripe_account_id, livemode, stripe_customer_id),
  check ((stripe_payment_method_id is null) = (payment_method_display is null)),
  check (payment_method_display is null or (jsonb_typeof(payment_method_display) = 'object'
    and payment_method_display - array['type','label','brand','last4','expMonth','expYear'] = '{}'::jsonb))
);
create table public.member_payment_method_setup_attempts (
  id uuid primary key,
  member_id uuid not null,
  stripe_account_id text not null,
  livemode boolean not null,
  consent_auth_user_id uuid not null references public.platform_users(auth_user_id) on delete restrict,
  consent_version text not null check (consent_version = 'save-payment-method-v1'),
  consent_text text not null,
  return_origin text not null check (return_origin ~ '^https?://[^/]+$'),
  consent_accepted_at timestamptz not null default clock_timestamp(),
  consent_revoked_at timestamptz,
  stripe_session_id text,
  stripe_setup_intent_id text,
  status text not null default 'creating' check (status in ('creating','open','saved','expired','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (member_id,stripe_account_id,livemode)
    references public.member_payment_method_accounts(member_id,stripe_account_id,livemode) on delete restrict,
  unique (stripe_account_id,livemode,stripe_session_id),
  unique (stripe_account_id,livemode,stripe_setup_intent_id)
);
create unique index member_payment_setup_one_pending on public.member_payment_method_setup_attempts(member_id,stripe_account_id,livemode)
  where status in ('creating','open');
create table public.member_payment_method_detachments (
  stripe_account_id text not null,
  livemode boolean not null,
  stripe_payment_method_id text not null,
  detached_at timestamptz not null default clock_timestamp(),
  primary key (stripe_account_id,livemode,stripe_payment_method_id)
);
-- Retain the accepted storage-only language even after withdrawal. No billing consent is implied.
create function private.ruined_payment_setup_consent_immutable() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if row(new.member_id,new.stripe_account_id,new.livemode,new.consent_auth_user_id,new.consent_version,new.consent_text,new.consent_accepted_at,new.return_origin)
    is distinct from row(old.member_id,old.stripe_account_id,old.livemode,old.consent_auth_user_id,old.consent_version,old.consent_text,old.consent_accepted_at,old.return_origin) then
    raise exception 'Payment storage consent is immutable';
  end if;
  return new;
end $$;
create trigger member_payment_setup_consent_immutable before update on public.member_payment_method_setup_attempts
  for each row execute function private.ruined_payment_setup_consent_immutable();
alter table public.member_payment_method_accounts enable row level security;
alter table public.member_payment_method_setup_attempts enable row level security;
alter table public.member_payment_method_detachments enable row level security;
revoke all on public.member_payment_method_accounts, public.member_payment_method_setup_attempts,
 public.member_payment_method_detachments from public, anon, authenticated;
revoke all on function private.ruined_payment_setup_consent_immutable() from public, anon, authenticated;
create function private.ruined_revoke_closed_member_payment_setup() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare target uuid;
begin
  if tg_table_name = 'ruined_members' then
    if new.deleted_at is null then return new; end if;
    target := new.id;
  else
    if new.account_state not in ('closed','suspended') then return new; end if;
    target := new.member_id;
  end if;
  update public.member_payment_method_accounts set consent_revoked_at=coalesce(consent_revoked_at,clock_timestamp()),
    cleanup_pending=true,updated_at=clock_timestamp() where member_id=target and stripe_customer_id is not null;
  update public.member_payment_method_setup_attempts set consent_revoked_at=coalesce(consent_revoked_at,clock_timestamp()),
    status='revoked',updated_at=clock_timestamp() where member_id=target and status in ('creating','open','saved');
  return new;
end $$;
create trigger revoke_closed_member_payment_setup after update of account_state on public.member_lifecycle
  for each row execute function private.ruined_revoke_closed_member_payment_setup();
create trigger revoke_deleted_member_payment_setup after update of deleted_at on public.ruined_members
  for each row execute function private.ruined_revoke_closed_member_payment_setup();
revoke all on function private.ruined_revoke_closed_member_payment_setup() from public, anon, authenticated;
commit;
