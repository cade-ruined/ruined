begin;
create table public.admin_email_generation_limits (
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 30),
  primary key (actor_auth_user_id,window_started_at)
);
alter table public.admin_email_generation_limits enable row level security;
revoke all on table public.admin_email_generation_limits from public,anon,authenticated;
commit;
