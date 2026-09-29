begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Invitation acceptance also creates an attribution row in this table. Only a
-- real waitlist submission is evidence for the waitlist badge.
alter table public.membership_waitlist add column if not exists joined_waitlist_at timestamptz;
-- A historic attribution row can precede the actual public submission. The
-- first canonical sync request is its evidence; never backdate before that.
update public.membership_waitlist waitlist
set joined_waitlist_at = greatest(waitlist.created_at, submission.submitted_at)
from (
  select event.aggregate_id, min(event.created_at) as submitted_at
  from public.integration_outbox event
  where event.destination = 'google' and event.event_type = 'membership_waitlist.sheet_sync_requested'
    and event.aggregate_type = 'membership_waitlist'
    and event.dedupe_key = 'google:membership-waitlist:' || event.aggregate_id || ':created:v1'
  group by event.aggregate_id
) submission
where waitlist.joined_waitlist_at is null and submission.aggregate_id = waitlist.id::text;

-- Older public-site deployments do not write the new column. Their durable,
-- server-created outbox event is the same genuine-submission evidence, written
-- in the signup transaction. Invitation acceptance does not enqueue this event.
create or replace function private.ruined_waitlist_submission_evidence_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.membership_waitlist waitlist
  set joined_waitlist_at = greatest(waitlist.created_at, new.created_at)
  where waitlist.id::text = new.aggregate_id and waitlist.joined_waitlist_at is null;
  return new;
end
$$;
drop trigger if exists membership_waitlist_submission_evidence on public.integration_outbox;
create trigger membership_waitlist_submission_evidence after insert on public.integration_outbox
for each row when (
  new.destination = 'google' and new.event_type = 'membership_waitlist.sheet_sync_requested'
  and new.aggregate_type = 'membership_waitlist'
  and new.dedupe_key = 'google:membership-waitlist:' || new.aggregate_id || ':created:v1'
) execute function private.ruined_waitlist_submission_evidence_trigger();
revoke all on function private.ruined_waitlist_submission_evidence_trigger()
  from public, anon, authenticated;

comment on column public.membership_waitlist.joined_waitlist_at is
  'First genuine public waitlist submission; null for invitation-attribution-only rows.';

alter table public.stripe_invoices add column if not exists paid_at timestamptz;
-- Historical receipts did not store status_transitions.paid_at. Their verified
-- paid event is the only durable historical timestamp; new receipts use paid_at.
update public.stripe_invoices invoice set paid_at = payment.paid_at
from (
  select object_id, to_timestamp(min(stripe_created)) as paid_at
  from public.stripe_webhook_events
  where event_type = 'invoice.paid' and livemode and status = 'processed'
  group by object_id
) payment
where invoice.id = payment.object_id and invoice.paid_at is null
  and invoice.stripe_status = 'paid' and invoice.purpose = 'membership' and invoice.amount_paid > 0;

create table if not exists public.member_badge_awards (
  member_id uuid not null references public.ruined_members(id) on delete cascade,
  badge_key text not null check (badge_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  earned_at timestamptz not null check (isfinite(earned_at)),
  source_event_id text not null,
  source_invoice_id text,
  rule_version integer not null check (rule_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  primary key (member_id, badge_key)
);
alter table public.member_badge_awards enable row level security;
revoke all on public.member_badge_awards from public, anon, authenticated;
comment on table public.member_badge_awards is
  'Idempotent server-awarded badges with auditable event evidence. Clients cannot grant awards.';

-- Award backfill belongs to the following early-cohort migration, where the
-- immutable assignment and CURRENT paid/complimentary entitlement are checked.
-- Creating the badge table must never award solely from an old paid invoice.

commit;
