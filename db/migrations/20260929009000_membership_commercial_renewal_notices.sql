begin;

alter table public.stripe_membership_renewal_notices
  add column notice_kind text not null default 'annual_renewal'
    check (notice_kind in ('annual_renewal', 'initial_term_end')),
  add column contract_id uuid references public.stripe_membership_commitments(id) on delete restrict,
  add column offer_id text,
  add constraint membership_renewal_commercial_identity check (
    (contract_id is null and offer_id is null and notice_kind = 'annual_renewal')
    or (contract_id is not null and offer_id in ('individual_monthly', 'individual_annual',
      'founding_individual_monthly', 'founding_individual_annual', 'couple_monthly', 'couple_annual'))
  );
create index membership_renewal_contract_idx on public.stripe_membership_renewal_notices(contract_id);

comment on column public.stripe_membership_renewal_notices.notice_kind is
  'Annual renewal uses the next annual period. Initial-term-end uses the immutable twelve-month contract anniversary, never the current monthly billing period.';

commit;
