begin;

-- No backfill: existing pilot and complimentary members have no paid commitment.
create table if not exists public.stripe_membership_commitments (
  id uuid primary key,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  checkout_attempt_id uuid not null unique references public.stripe_checkout_attempts(id) on delete restrict,
  agreement_acceptance_id uuid not null references public.membership_agreement_acceptances(id) on delete restrict,
  stripe_subscription_id text not null,
  stripe_customer_id text not null,
  livemode boolean not null,
  terms_snapshot jsonb not null check (jsonb_typeof(terms_snapshot) = 'object'),
  terms_sha256 text not null check (terms_sha256 ~ '^[a-f0-9]{64}$'),
  ledger_revision integer not null default 0 check (ledger_revision >= 0),
  status text not null default 'active' check (status in ('active', 'exit_pending', 'ended', 'manual_review')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (livemode, stripe_subscription_id),
  check (terms_snapshot->>'billingTermsVersion' = 'membership-billing-v2'),
  check (terms_snapshot->>'currency' = 'usd'),
  check (terms_snapshot->>'billingPlan' in ('monthly', 'annual'))
);

-- Each reconciliation is an immutable audit snapshot, including principal
-- allocations, refunds and credit notes. Individual invoice.paid events are not
-- enough evidence to collect a buyout.
create table if not exists public.stripe_membership_commitment_ledgers (
  id uuid primary key,
  contract_id uuid not null references public.stripe_membership_commitments(id) on delete restrict,
  revision integer not null check (revision > 0),
  state text not null check (state in ('unknown', 'complete', 'review_required')),
  reconciled_at timestamptz not null,
  invoices jsonb not null check (jsonb_typeof(invoices) = 'array'),
  source_evidence jsonb not null check (jsonb_typeof(source_evidence) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  unique (contract_id, revision)
);

create table if not exists public.stripe_membership_cancellations (
  id uuid primary key,
  contract_id uuid not null references public.stripe_membership_commitments(id) on delete restrict,
  requested_by_member_id uuid not null references public.ruined_members(id) on delete restrict,
  intent text not null check (intent in ('disable_renewal', 'early_exit')),
  quote_snapshot jsonb not null check (jsonb_typeof(quote_snapshot) = 'object'),
  quote_sha256 text not null check (quote_sha256 ~ '^[a-f0-9]{64}$'),
  ledger_revision integer not null check (ledger_revision >= 0),
  buyout_dues bigint not null check (buyout_dues between 0 and 150000),
  effective_at timestamptz not null,
  status text not null default 'requested'
    check (status in ('requested', 'billing_stopped', 'collection_in_flight', 'completed', 'manual_review', 'abandoned')),
  provider_idempotency_key text not null unique,
  billing_stop_evidence jsonb,
  billing_stopped_at timestamptz,
  first_collection_attempt_at timestamptz,
  replacement_invoice_id text unique,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (intent <> 'disable_renewal' or buyout_dues = 0),
  check (billing_stop_evidence is null or jsonb_typeof(billing_stop_evidence) = 'object'),
  check (status not in ('billing_stopped', 'collection_in_flight', 'completed') or billing_stopped_at is not null),
  check (status <> 'collection_in_flight' or first_collection_attempt_at is not null),
  check (status <> 'completed' or buyout_dues = 0 or replacement_invoice_id is not null)
);
create unique index if not exists stripe_membership_cancellations_one_pending_idx
  on public.stripe_membership_cancellations(contract_id, intent)
  where status in ('requested', 'billing_stopped', 'collection_in_flight', 'manual_review');
create index if not exists stripe_membership_cancellations_status_idx
  on public.stripe_membership_cancellations(status, updated_at);
create index if not exists stripe_membership_commitments_member_idx
  on public.stripe_membership_commitments(member_id);

create or replace function private.ruined_preserve_commitment_terms()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.member_id is distinct from new.member_id
    or old.checkout_attempt_id is distinct from new.checkout_attempt_id
    or old.agreement_acceptance_id is distinct from new.agreement_acceptance_id
    or old.stripe_subscription_id is distinct from new.stripe_subscription_id
    or old.stripe_customer_id is distinct from new.stripe_customer_id
    or old.livemode is distinct from new.livemode
    or old.terms_snapshot is distinct from new.terms_snapshot or old.terms_sha256 is distinct from new.terms_sha256 then
    raise exception 'Accepted membership commitment terms are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists stripe_membership_commitment_terms_immutable on public.stripe_membership_commitments;
create trigger stripe_membership_commitment_terms_immutable before update on public.stripe_membership_commitments
  for each row execute function private.ruined_preserve_commitment_terms();

create or replace function private.ruined_preserve_commitment_ledger()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Membership commitment reconciliation evidence is append only';
end;
$$;
drop trigger if exists stripe_membership_commitment_ledger_immutable on public.stripe_membership_commitment_ledgers;
create trigger stripe_membership_commitment_ledger_immutable before update or delete on public.stripe_membership_commitment_ledgers
  for each row execute function private.ruined_preserve_commitment_ledger();

create or replace function private.ruined_preserve_cancellation_quote()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.contract_id is distinct from new.contract_id
    or old.requested_by_member_id is distinct from new.requested_by_member_id
    or old.intent is distinct from new.intent or old.quote_snapshot is distinct from new.quote_snapshot
    or old.quote_sha256 is distinct from new.quote_sha256 or old.ledger_revision is distinct from new.ledger_revision
    or old.buyout_dues is distinct from new.buyout_dues or old.effective_at is distinct from new.effective_at
    or old.provider_idempotency_key is distinct from new.provider_idempotency_key
    or (old.replacement_invoice_id is not null and old.replacement_invoice_id is distinct from new.replacement_invoice_id)
    or (old.first_collection_attempt_at is not null and old.first_collection_attempt_at is distinct from new.first_collection_attempt_at) then
    raise exception 'Confirmed membership cancellation authorization is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists stripe_membership_cancellation_quote_immutable on public.stripe_membership_cancellations;
create trigger stripe_membership_cancellation_quote_immutable before update on public.stripe_membership_cancellations
  for each row execute function private.ruined_preserve_cancellation_quote();

alter table public.stripe_membership_commitments enable row level security;
alter table public.stripe_membership_commitment_ledgers enable row level security;
alter table public.stripe_membership_cancellations enable row level security;
revoke all on table public.stripe_membership_commitments, public.stripe_membership_commitment_ledgers,
  public.stripe_membership_cancellations from anon, authenticated;

commit;
