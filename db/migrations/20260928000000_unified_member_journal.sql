begin;

set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Serialize the backfill with old application writers. After this transaction,
-- the journal is the only writable entry source; no write can miss the import.
lock table public.member_timeline_entries, public.member_timeline_entry_versions
  in share row exclusive mode;

alter table public.member_journal_entries
  alter column id set default gen_random_uuid(),
  drop constraint member_journal_entries_title_check,
  drop constraint member_journal_entries_body_check,
  drop constraint member_journal_entries_check,
  add constraint member_journal_entries_title_check check (title is null or char_length(title) between 1 and 200),
  add constraint member_journal_entries_body_check check (body is null or char_length(body) <= 20000),
  add constraint member_journal_entries_text_content_check check (kind <> 'text' or title is not null or (body is not null and char_length(body) > 0)),
  add column event_year integer check (event_year between 1900 and 2200),
  add column event_month integer,
  add column event_day integer,
  add column include_on_timeline boolean not null default false,
  add column timeline_position integer check (timeline_position > 0),
  add column current_version integer not null default 1 check (current_version > 0),
  add column updated_by_auth_user_id uuid references public.platform_users(auth_user_id) on delete set null,
  add constraint member_journal_entries_event_month_check
    check (event_month is null or (event_year is not null and event_month between 1 and 12)),
  add constraint member_journal_entries_event_day_check check (
    event_day is null or case when event_year between 1900 and 2200 and event_month between 1 and 12
      then event_day between 1 and extract(day from (make_date(event_year, event_month, 1) + interval '1 month - 1 day'))::integer
      else false end
  ),
  add constraint member_journal_entries_timeline_date_check
    check (not include_on_timeline or (event_year is not null and nullif(btrim(title), '') is not null));

alter table public.member_journal_media add column removed_at timestamptz;
create index member_journal_entries_timeline_idx
  on public.member_journal_entries(member_id, event_year, event_month, event_day, timeline_position, id)
  where deleted_at is null and include_on_timeline;

-- Do not silently skip a collision, even though both sources use UUIDs.
do $$ begin
  if exists(select 1 from public.member_journal_entries j join public.member_timeline_entries t on t.id = j.id) then
    raise exception 'Journal and Timeline entry IDs overlap. The merge requires review.';
  end if;
end $$;

insert into public.member_journal_entries (
  id, member_id, kind, title, body, saved, created_at, updated_at, deleted_at,
  event_year, event_month, include_on_timeline, timeline_position, current_version, updated_by_auth_user_id
)
select id, member_id, 'text', title, details, false, created_at, updated_at, deleted_at,
  entry_year, entry_month, true, position, current_version, updated_by_auth_user_id
from public.member_timeline_entries;

-- Original timeline rows and every original version remain byte-for-byte
-- unchanged. These snapshots establish the unified stream's starting point.
create table public.member_journal_entry_versions (
  id bigint generated always as identity primary key,
  journal_entry_id uuid not null,
  member_id uuid not null references public.ruined_members(id) on delete restrict,
  version integer not null check (version > 0),
  action text not null check (action in ('created', 'updated', 'deleted')),
  kind text not null check (kind in ('text', 'images', 'video')),
  title text check (title is null or char_length(title) between 1 and 200),
  body text check (body is null or char_length(body) <= 20000),
  saved boolean not null,
  event_year integer check (event_year between 1900 and 2200),
  event_month integer,
  event_day integer,
  include_on_timeline boolean not null,
  timeline_position integer check (timeline_position > 0),
  media_ids uuid[] not null default '{}',
  actor_auth_user_id uuid references public.platform_users(auth_user_id) on delete set null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (journal_entry_id, version),
  foreign key (member_id, journal_entry_id) references public.member_journal_entries(member_id, id) on delete restrict,
  check (kind <> 'text' or title is not null or (body is not null and char_length(body) > 0)),
  check (event_month is null or (event_year is not null and event_month between 1 and 12)),
  check (event_day is null or case when event_year between 1900 and 2200 and event_month between 1 and 12
    then event_day between 1 and extract(day from (make_date(event_year, event_month, 1) + interval '1 month - 1 day'))::integer
    else false end),
  check (not include_on_timeline or (event_year is not null and nullif(btrim(title), '') is not null))
);
create index member_journal_entry_versions_member_idx on public.member_journal_entry_versions(member_id, id desc);
create index member_journal_entry_versions_actor_idx on public.member_journal_entry_versions(actor_auth_user_id);
alter table public.member_journal_entry_versions enable row level security;
revoke all on public.member_journal_entry_versions from public, anon, authenticated;
revoke all on sequence public.member_journal_entry_versions_id_seq from public, anon, authenticated;

-- All pre-release revision tokens are numeric timeline history IDs. Start the
-- new sequence above their global maximum, so none can match a new snapshot.
select setval(pg_get_serial_sequence('public.member_journal_entry_versions', 'id'),
  (select coalesce(max(id), 0) + 1 from public.member_timeline_entry_versions), false);
insert into public.member_journal_entry_versions (
  journal_entry_id, member_id, version, action, kind, title, body, saved,
  event_year, event_month, event_day, include_on_timeline, timeline_position,
  media_ids, actor_auth_user_id, occurred_at
)
select j.id, j.member_id, j.current_version,
  case when j.deleted_at is not null then 'deleted' when j.current_version > 1 then 'updated' else 'created' end,
  j.kind, j.title, j.body, j.saved, j.event_year, j.event_month, j.event_day,
  j.include_on_timeline, j.timeline_position,
  coalesce((select array_agg(m.id order by m.position, m.id) from public.member_journal_media m
    where m.member_id = j.member_id and m.entry_id = j.id and m.state = 'ready' and m.removed_at is null), '{}'::uuid[]),
  j.updated_by_auth_user_id, j.updated_at
from public.member_journal_entries j order by j.member_id, j.created_at, j.id;

create function private.ruined_version_journal_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.member_id is distinct from old.member_id or new.created_at is distinct from old.created_at then
      raise exception 'Journal entry identity fields are immutable.';
    end if;
    if old.deleted_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'A deleted journal entry is immutable.';
    end if;
    if row(new.kind,new.title,new.body,new.saved,new.event_year,new.event_month,new.event_day,new.include_on_timeline,new.timeline_position,new.deleted_at,new.current_version)
      is not distinct from row(old.kind,old.title,old.body,old.saved,old.event_year,old.event_month,old.event_day,old.include_on_timeline,old.timeline_position,old.deleted_at,old.current_version) then
      new.updated_at := old.updated_at;
      new.updated_by_auth_user_id := old.updated_by_auth_user_id;
      return new;
    end if;
    new.current_version := old.current_version + 1;
    new.updated_at := statement_timestamp();
  end if;
  return new;
end; $$;

create function private.ruined_record_journal_entry_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.current_version = old.current_version then return new; end if;
  insert into public.member_journal_entry_versions (
    journal_entry_id,member_id,version,action,kind,title,body,saved,event_year,event_month,event_day,
    include_on_timeline,timeline_position,media_ids,actor_auth_user_id,occurred_at
  ) values (
    new.id,new.member_id,new.current_version,
    case when new.deleted_at is not null then 'deleted' when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.kind,new.title,new.body,new.saved,new.event_year,new.event_month,new.event_day,new.include_on_timeline,new.timeline_position,
    coalesce((select array_agg(m.id order by m.position,m.id) from public.member_journal_media m
      where m.member_id = new.member_id and m.entry_id = new.id and m.state = 'ready' and m.removed_at is null), '{}'::uuid[]),
    new.updated_by_auth_user_id,new.updated_at
  );
  return new;
end; $$;

create function private.ruined_record_journal_media_change() returns trigger
language plpgsql set search_path = '' as $$
declare prior_entry uuid; next_entry uuid; target uuid; actor uuid;
begin
  if tg_op <> 'INSERT' and old.state = 'ready' and old.removed_at is null then prior_entry := old.entry_id; end if;
  if tg_op <> 'DELETE' and new.state = 'ready' and new.removed_at is null then next_entry := new.entry_id; end if;
  if tg_op = 'UPDATE' and row(new.entry_id,new.state,new.removed_at,new.position)
    is not distinct from row(old.entry_id,old.state,old.removed_at,old.position) then return new; end if;
  if private.ruined_member_deletion_authorized(case when tg_op = 'DELETE' then old.member_id else new.member_id end) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  actor := nullif(current_setting('app.journal_actor_auth_user_id', true), '')::uuid;
  for target in select distinct entry_id from unnest(array[prior_entry,next_entry]) entry_id where entry_id is not null order by entry_id loop
    update public.member_journal_entries set current_version = current_version + 1,
      updated_by_auth_user_id = coalesce(actor, updated_by_auth_user_id) where id = target;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end; $$;

create trigger member_journal_entries_00_version before update on public.member_journal_entries
  for each row execute function private.ruined_version_journal_entry();
create trigger member_journal_entries_90_record_version after insert or update on public.member_journal_entries
  for each row execute function private.ruined_record_journal_entry_version();
create trigger member_journal_media_90_record_version after insert or update or delete on public.member_journal_media
  for each row execute function private.ruined_record_journal_media_change();
create trigger member_journal_entry_versions_append_only before update or delete on public.member_journal_entry_versions
  for each row execute function public.ruined_reject_append_only_mutation();
create trigger member_journal_entry_versions_deleted_account_guard before insert or update on public.member_journal_entry_versions
  for each row execute function private.ruined_guard_erased_account_write();

create function private.ruined_fence_legacy_timeline_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and private.ruined_member_deletion_authorized(old.member_id) then return old; end if;
  raise exception using errcode = 'PT409', message = 'Journal and Timeline now share entries. Reload before saving; your unfinished draft has not been changed.';
end; $$;
create trigger member_timeline_entries_00_unified_read_only before insert or update or delete on public.member_timeline_entries
  for each row execute function private.ruined_fence_legacy_timeline_write();
create trigger member_timeline_entry_versions_00_unified_read_only before insert or update or delete on public.member_timeline_entry_versions
  for each row execute function private.ruined_fence_legacy_timeline_write();

revoke all on function private.ruined_version_journal_entry(), private.ruined_record_journal_entry_version(),
  private.ruined_record_journal_media_change(), private.ruined_fence_legacy_timeline_write() from public, anon, authenticated;

-- Existing requirement receipts and their versions remain unchanged. Future
-- completions consult the canonical, private timeline selection.
create or replace function private.ruined_validate_foundation_requirement_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare enrollment_member_id uuid;
begin
  select enrollment.member_id into enrollment_member_id from public.foundation_enrollments enrollment
    where enrollment.id = new.foundation_enrollment_id;
  if enrollment_member_id is distinct from new.member_id then
    raise exception 'Foundation requirement completion does not belong to the enrollment member.';
  end if;
  if new.requirement_slug = 'timeline' and new.state = 'completed' and not exists (
    select 1 from public.member_journal_entries entry where entry.member_id = new.member_id
      and entry.deleted_at is null and entry.include_on_timeline
  ) then raise exception 'At least one active Timeline entry is required for Timeline completion.'; end if;
  if new.state = 'revoked' and new.supersedes_completion_id is null then
    raise exception 'A revoked requirement marker must supersede a completion.';
  end if;
  if new.supersedes_completion_id is not null and not exists (
    select 1 from public.member_foundation_requirement_completions prior
    where prior.id = new.supersedes_completion_id and prior.member_id = new.member_id
      and prior.foundation_enrollment_id = new.foundation_enrollment_id
      and prior.requirement_slug = new.requirement_slug and prior.completion_version < new.completion_version
  ) then raise exception 'The superseded requirement marker is incompatible.'; end if;
  return new;
end; $$;

create or replace function public.ruined_reject_append_only_mutation() returns trigger
language plpgsql set search_path = '' as $$
declare target uuid;
begin
  if tg_table_schema = 'public' and tg_table_name in ('member_timeline_entry_versions', 'member_journal_entry_versions') and tg_op = 'DELETE' then
    if private.ruined_member_deletion_authorized(old.member_id) then return old; end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'foundation_submissions' and tg_op = 'UPDATE' then
    select member_id into target from public.foundation_enrollments where id = old.enrollment_id;
    if private.ruined_member_deletion_authorized(target) and new.payload = '{}'::jsonb
      and (to_jsonb(new) - 'payload') = (to_jsonb(old) - 'payload') then return new; end if;
  end if;
  raise exception '% is append-only; % is not permitted.', tg_table_name, tg_op;
end; $$;

create or replace function private.ruined_delete_member(actor uuid, member uuid, expected_version bigint, confirmation_email text, reason text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  target public.ruined_members%rowtype;
  decision jsonb;
  identities uuid[];
  cleanup_id uuid;
  token uuid := gen_random_uuid();
  removed_at timestamptz := statement_timestamp();
  paths jsonb;
begin
  perform 1 from public.platform_users where auth_user_id = actor for update;
  perform 1 from public.platform_role_grants where auth_user_id = actor order by id for update;
  if not exists(select 1 from public.platform_users u join public.platform_role_grants g on g.auth_user_id = u.auth_user_id
    where u.auth_user_id = actor and u.status = 'active' and g.role_slug = 'ops_admin' and g.revoked_at is null)
    then raise exception using errcode = 'PT403', message = 'An active administrator is required.'; end if;
  select * into target from public.ruined_members where id = member;
  if not found then raise exception using errcode = 'PT404', message = 'Member not found.'; end if;
  perform pg_advisory_xact_lock(hashtext(target.email_normalized), 1);
  select * into target from public.ruined_members where id = member for update;
  perform 1 from public.member_lifecycle where member_id = member for update;
  if target.deleted_at is not null then
    select id into cleanup_id from private.member_deletion_jobs where member_id = member;
    if cleanup_id is null then raise exception using errcode = 'PT409', message = 'Historical account cleanup requires review.'; end if;
    return jsonb_build_object('deleted',true,'cleanupId',cleanup_id);
  end if;
  perform 1 from public.people where id = target.person_id for update;
  perform 1 from public.platform_users where member_id = member or person_id = target.person_id order by auth_user_id for update;
  perform 1 from public.platform_role_grants where auth_user_id in (select auth_user_id from public.platform_users where member_id = member or person_id = target.person_id) order by id for update;
  perform 1 from public.stripe_subscriptions where member_id = member order by id for update;
  perform 1 from public.stripe_checkout_sessions where member_id = member order by id for update;
  perform 1 from public.stripe_checkout_attempts where member_id = member order by id for update;
  perform 1 from public.stripe_invoices where member_id = member order by id for update;
  perform 1 from public.circle_member_assignments where member_id = member for update;
  perform 1 from public.accountability_partner_assignments where member_one_id = member or member_two_id = member for update;
  perform 1 from public.experience_registrations where member_id = member or person_id = target.person_id for update;
  perform 1 from public.community_event_registrations where person_id = target.person_id or email_normalized = target.email_normalized for update;
  perform 1 from public.artifact_jobs where member_id = member for update;
  perform 1 from public.artifact_awards where member_id = member for update;
  perform 1 from public.workflow_actions a join public.domain_events e on e.id = a.domain_event_id
    where e.member_id = member or e.person_id = target.person_id or a.target_id in (member::text,target.person_id::text) for update of a;
  decision := private.ruined_member_deletion_eligibility(actor,member);
  if not (decision->>'allowed')::boolean then raise exception using errcode = 'PT409', message = 'Resolve this member’s active or shared records before deleting the account.'; end if;
  if expected_version is null or expected_version is distinct from (decision->>'lifecycleVersion')::bigint
    then raise exception using errcode = 'PT409', message = 'The member changed. Reload before deleting.'; end if;
  if confirmation_email is null or lower(btrim(confirmation_email)) is distinct from decision->>'confirmationEmail'
    then raise exception using errcode = 'PT400', message = 'Enter the exact member email to confirm deletion.'; end if;
  if reason is null or reason not in ('test_account','duplicate_account','account_removal','member_request')
    then raise exception using errcode = 'PT400', message = 'Choose a deletion reason.'; end if;
  select coalesce(array_agg(auth_user_id), '{}'::uuid[]) into identities from public.platform_users where member_id = member or person_id = target.person_id;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'path',path)), '[]') into paths from (
    select distinct 'member-portraits' as bucket, replace(avatar,'/api/member-photos/','') as path from (
      select avatar_storage_path as avatar from public.person_profiles where person_id = target.person_id
      union select avatar_storage_path from public.user_profiles where auth_user_id = any(identities)
      union select public_portrait_url from public.member_public_cards where member_id = member
    ) portraits where avatar ~ ('^/api/member-photos/' || member::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$')
    union select 'member-journal',storage_path from public.member_journal_media where member_id = member
  ) objects;
  insert into private.member_deletion_jobs(member_id,person_id,actor_auth_user_id,reason,transaction_id,authorization_token,auth_user_ids,storage_objects)
    values(member,target.person_id,actor,reason,txid_current(),token,identities,paths) returning id into cleanup_id;
  perform set_config('ruined.member_deletion_token',token::text,true);
  insert into private.member_deletion_records(member_id,person_id,display_name,member_tag,member_number,joined_at,deleted_at,reason,actor_auth_user_id)
    select member,target.person_id,decision->>'memberName',p.member_tag,target.member_number,
      coalesce(l.access_started_at,o.completed_at,target.membership_activated_at),removed_at,reason,actor
    from public.member_lifecycle l left join public.member_onboardings o on o.member_id = l.member_id
    left join public.person_profiles p on p.person_id = target.person_id where l.member_id = member;
  update public.ruined_members set deleted_at = removed_at, email = 'deleted+' || member::text || '@members.invalid',
    email_normalized = 'deleted+' || member::text || '@members.invalid',updated_at = removed_at where id = member;
  -- Closing is part of the same authorized transaction as account erasure.
  -- Keep the original state and actor in append-only history, exactly once.
  insert into public.member_state_history(member_id,dimension,previous_state,next_state,reason_code,source,
    actor_auth_user_id,metadata,dedupe_key,occurred_at)
    select member,'account',l.account_state,'closed','member_account_deleted','ops',actor,
      jsonb_build_object('cleanupId',cleanup_id,'reason',reason),'member.account_deleted:' || member::text || ':account',removed_at
    from public.member_lifecycle l where l.member_id = member and l.account_state <> 'closed';
  update public.member_lifecycle set account_state = 'closed',standing_state = 'inactive',program_state = 'withdrawn',
    version = version + 1,updated_at = removed_at where member_id = member;
  delete from public.member_journal_media where member_id = member;
  delete from public.member_journal_entry_versions where member_id = member;
  delete from public.member_journal_entries where member_id = member;
  delete from public.member_timeline_entry_versions where member_id = member;
  delete from public.member_timeline_entries where member_id = member;
  update public.foundation_submissions set payload = '{}' where enrollment_id in (select id from public.foundation_enrollments where member_id = member);
  delete from public.member_public_cards where member_id = member;
  delete from public.member_invitations where member_id = member;
  delete from public.member_private_profiles where member_id = member;
  update public.platform_role_grants set revoked_at = removed_at,revoke_reason = 'Member account deleted'
    where auth_user_id = any(identities) and revoked_at is null;
  update public.passwordless_account_invites set revoked_at = removed_at where member_id = member and revoked_at is null;
  delete from public.user_profiles where auth_user_id = any(identities);
  update public.platform_users set member_id = null,status = 'disabled',
    email_normalized = 'deleted+' || auth_user_id::text || '@members.invalid',invited_at = null,activated_at = null,
    suspended_at = null,last_signed_in_at = null,updated_at = removed_at where auth_user_id = any(identities);
  delete from public.person_email_addresses where person_id = target.person_id;
  delete from public.person_profiles where person_id = target.person_id;
  delete from public.person_private_profiles where person_id = target.person_id;
  update public.people set status = 'erased',updated_at = removed_at where id = target.person_id;
  insert into public.operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,member_id,reason,metadata,dedupe_key)
    values(actor,'member.account_deleted','member',member::text,member,reason,jsonb_build_object('cleanupId',cleanup_id),'member.account_deleted:' || member::text);
  perform set_config('ruined.member_deletion_token','',true);
  return jsonb_build_object('deleted',true,'cleanupId',cleanup_id);
exception when foreign_key_violation or restrict_violation then
  raise exception using errcode = 'PT409', message = 'Linked content requires review before this account can be deleted.';
end; $$;

revoke all on function private.ruined_validate_foundation_requirement_completion(),
  private.ruined_delete_member(uuid,uuid,bigint,text,text) from public, anon, authenticated;

commit;
