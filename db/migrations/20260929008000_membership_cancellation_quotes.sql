begin;

alter table public.stripe_membership_commitments
  add column cancellation_lease_token uuid,
  add column cancellation_lease_until timestamptz;

-- Only server-produced quotes can be confirmed. A browser sends the opaque ID.
create table public.stripe_membership_cancellation_quotes (
  id uuid primary key,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  contract_id uuid not null references public.stripe_membership_commitments(id) on delete restrict,
  quote jsonb not null check (jsonb_typeof(quote) = 'object'),
  provider_evidence_sha256 text,
  fee_tax_code text,
  fee_tax_enabled boolean not null default false,
  fee_total bigint not null check (fee_total >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp()
);
alter table public.stripe_membership_cancellation_quotes enable row level security;
revoke all on public.stripe_membership_cancellation_quotes from anon, authenticated;

commit;
