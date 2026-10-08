begin;
create table public.admin_resend_reviews (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'reviewed' check (status in ('reviewed','sending','sent','unknown','rejected')),
  provider_id text,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
  attempted_at timestamptz,
  completed_at timestamptz
);
create index admin_resend_reviews_actor_idx on public.admin_resend_reviews(actor_auth_user_id,created_at desc);
create unique index admin_resend_reviews_broadcast_claim_idx on public.admin_resend_reviews((snapshot->>'broadcastId'))
  where status in ('sending','sent','unknown') and snapshot->>'broadcastId' is not null;
create function private.ruined_guard_resend_review() returns trigger language plpgsql as $$
begin
  if new.snapshot is distinct from old.snapshot or new.actor_auth_user_id is distinct from old.actor_auth_user_id
    or new.recipient_hash is distinct from old.recipient_hash or new.expires_at is distinct from old.expires_at
    or (old.status<>'reviewed' and new.status='reviewed')
    then raise exception 'Email reviews and send claims are immutable'; end if;
  return new;
end $$;
create trigger admin_resend_review_immutable before update on public.admin_resend_reviews
  for each row execute function private.ruined_guard_resend_review();
alter table public.admin_resend_reviews enable row level security;
revoke all on table public.admin_resend_reviews from public,anon,authenticated;
revoke all on function private.ruined_guard_resend_review() from public,anon,authenticated;
commit;
