begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- One deliberate assignment release per course. F1 availability already exists;
-- installing this migration does not announce it or enqueue any F1 recipients.
create table private.member_practice_release_events (
 id uuid primary key default gen_random_uuid(),
 course text unique not null check(course in ('f1','f4','time')),
 release_at timestamptz check(release_at is null or isfinite(release_at)),
 released_at timestamptz check(released_at is null or isfinite(released_at)),
 source text not null check(source in ('unreleased','operator','scheduled','expired')),
 approved_by uuid,
 copy_version integer not null default 1 check(copy_version > 0),
 created_at timestamptz not null default statement_timestamp(),
 updated_at timestamptz not null default statement_timestamp(),
 check(released_at is null or release_at is not null),
 check(source <> 'operator' or approved_by is not null)
);
insert into private.member_practice_release_events(course,release_at,source) values
 ('f1',null,'unreleased'),('f4',null,'unreleased'),('time','2026-12-01T07:00:00Z','scheduled');
comment on table private.member_practice_release_events is 'Approved assignment recap releases. TIME is scheduled for December 1 America/Denver; F1 and F4 require deliberate operator release. Never enqueue merely from a page load.';

create table private.member_practice_release_reviews (
 token uuid primary key default gen_random_uuid(), actor_auth_user_id uuid not null,
 course text not null check(course in ('f1','f2','f3','f4','time')),
 kind text not null default 'assignment' check(kind in ('assignment','deck')),
 audience_hash text not null, copy_version integer not null,
 expires_at timestamptz not null default statement_timestamp()+interval '10 minutes',
 consumed_at timestamptz, created_at timestamptz not null default statement_timestamp()
);
create table private.member_practice_release_deliveries (
 id uuid primary key default gen_random_uuid(),
 release_id uuid not null references private.member_practice_release_events(id),
 member_id uuid not null references public.ruined_members(id) on delete cascade,
 expected_email text not null, expected_consent_id bigint not null,
 status text not null default 'pending' check(status in ('pending','sending','failed','sent','cancelled','manual_review')),
 attempts integer not null default 0 check(attempts>=0),
 available_at timestamptz not null default statement_timestamp(),
 expires_at timestamptz not null default statement_timestamp()+interval '7 days',
 lock_token uuid, locked_at timestamptz, first_attempt_at timestamptz,
 payload jsonb check(payload is null or jsonb_typeof(payload)='object'),
 provider_message_id text, sent_at timestamptz, last_error text,
 created_at timestamptz not null default statement_timestamp(), updated_at timestamptz not null default statement_timestamp(),
 unique(release_id,member_id)
);
create trigger member_practice_release_00_deleted_account_guard before insert or update on private.member_practice_release_deliveries
 for each row execute function private.ruined_guard_erased_account_write();
create index member_practice_release_deliveries_pending on private.member_practice_release_deliveries(status,available_at);
alter table private.member_practice_release_events enable row level security;
alter table private.member_practice_release_reviews enable row level security;
alter table private.member_practice_release_deliveries enable row level security;
revoke all on private.member_practice_release_events,private.member_practice_release_reviews,private.member_practice_release_deliveries from public,anon,authenticated;
create function private.ruined_erase_practice_release_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from private.member_practice_release_deliveries where member_id=new.id;
 return new;
end $$;
create trigger member_practice_release_erasure after update of deleted_at on public.ruined_members for each row
 when(old.deleted_at is null and new.deleted_at is not null) execute function private.ruined_erase_practice_release_delivery();
revoke all on function private.ruined_erase_practice_release_delivery() from public,anon,authenticated;
commit;
