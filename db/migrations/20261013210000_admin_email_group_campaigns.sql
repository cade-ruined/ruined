begin;
create table public.admin_email_group_campaigns (
 id uuid primary key default gen_random_uuid(), revision integer not null default 1 check(revision>0),
 actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
 name text not null,group_id uuid not null,group_revision integer not null check(group_revision>0),
 purpose text not null check(purpose in ('general_updates','membership_updates')),
 draft jsonb not null check(jsonb_typeof(draft)='object'),
 status text not null default 'draft' check(status in ('draft','queued','completed','attention')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.admin_email_group_campaign_reviews (
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.admin_email_group_campaigns(id),
 campaign_revision integer not null,actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),recipient_hash text not null,
 expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',consumed_at timestamptz,
 created_at timestamptz not null default clock_timestamp()
);
create table public.admin_email_group_deliveries (
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.admin_email_group_campaigns(id),
 review_id uuid not null references public.admin_email_group_campaign_reviews(id),email_normalized text not null,recipient_name text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','cancelled','failed','unknown')),
 unsubscribe_hash text unique,payload_hash text,provider_id text,safe_reason text,
 attempted_at timestamptz,completed_at timestamptz,created_at timestamptz not null default clock_timestamp(),
 unique(campaign_id,email_normalized),check(email_normalized=lower(btrim(email_normalized)))
);
create index admin_email_group_delivery_pending_idx on public.admin_email_group_deliveries(status,created_at);
create table public.admin_email_group_withdrawals (
 email_normalized text not null,purpose text not null check(purpose in ('general_updates','membership_updates')),
 created_at timestamptz not null default clock_timestamp(),primary key(email_normalized,purpose),
 check(email_normalized=lower(btrim(email_normalized)))
);
create function private.guard_email_group_campaign() returns trigger language plpgsql as $$
begin
 if old.status<>'draft' and (new.draft is distinct from old.draft or new.revision<>old.revision or new.group_id<>old.group_id
   or new.group_revision<>old.group_revision or new.purpose<>old.purpose or new.actor_auth_user_id<>old.actor_auth_user_id or new.status='draft') then
   raise exception 'Queued campaign approvals are immutable';
 end if;return new;
end $$;
create trigger guard_email_group_campaign before update on public.admin_email_group_campaigns for each row execute function private.guard_email_group_campaign();
create function private.guard_email_group_review() returns trigger language plpgsql as $$
begin
 if new.snapshot is distinct from old.snapshot or new.campaign_id<>old.campaign_id or new.campaign_revision<>old.campaign_revision
   or new.actor_auth_user_id<>old.actor_auth_user_id or new.recipient_hash<>old.recipient_hash or new.expires_at<>old.expires_at
   or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at) then raise exception 'Campaign reviews are immutable';end if;
 return new;
end $$;
create trigger guard_email_group_review before update on public.admin_email_group_campaign_reviews for each row execute function private.guard_email_group_review();
create function private.guard_email_group_delivery() returns trigger language plpgsql as $$
begin
 if new.campaign_id<>old.campaign_id or new.review_id<>old.review_id or new.email_normalized<>old.email_normalized or new.recipient_name<>old.recipient_name
   or (old.status<>'pending' and new.status='pending')
   or (old.attempted_at is not null and (new.attempted_at is distinct from old.attempted_at or new.unsubscribe_hash is distinct from old.unsubscribe_hash or new.payload_hash is distinct from old.payload_hash)) then
   raise exception 'Campaign delivery claims are immutable';end if;return new;
end $$;
create trigger guard_email_group_delivery before update on public.admin_email_group_deliveries for each row execute function private.guard_email_group_delivery();
alter table public.admin_email_group_campaigns enable row level security;
alter table public.admin_email_group_campaign_reviews enable row level security;
alter table public.admin_email_group_deliveries enable row level security;
alter table public.admin_email_group_withdrawals enable row level security;
revoke all on public.admin_email_group_campaigns,public.admin_email_group_campaign_reviews,public.admin_email_group_deliveries,public.admin_email_group_withdrawals from public,anon,authenticated;
revoke all on function private.guard_email_group_campaign(),private.guard_email_group_review(),private.guard_email_group_delivery() from public,anon,authenticated;
commit;
