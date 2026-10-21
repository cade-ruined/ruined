begin;

-- Baseline all existing welcomes, including pending/uncertain deliveries, out of
-- this new sequence. Only welcomes created after this migration opt in.
alter table public.member_registration_messages
  add column followup_enabled boolean not null default false,
  add column source_welcome_id uuid references public.member_registration_messages(id) on delete restrict,
  add column delivery_foundations jsonb;
alter table public.member_registration_messages alter column followup_enabled set default true;
alter table public.member_registration_messages drop constraint member_registration_messages_kind_check;
alter table public.member_registration_messages add constraint member_registration_messages_kind_check
  check (kind in ('welcome','profile_ready','pre_foundations'));
alter table public.member_registration_messages add constraint registration_followup_source
  check ((kind='pre_foundations')=(source_welcome_id is not null));
create unique index registration_followup_welcome on public.member_registration_messages(source_welcome_id)
  where source_welcome_id is not null;

create function private.ruined_guard_registration_followup() returns trigger
language plpgsql set search_path='' as $$
declare welcome public.member_registration_messages;
begin
  if tg_op='UPDATE' and (new.followup_enabled is distinct from old.followup_enabled
    or new.source_welcome_id is distinct from old.source_welcome_id) then
    raise exception 'Registration followup origin cannot change.';
  end if;
  if tg_op='UPDATE' and old.delivery_foundations is not null
    and new.delivery_foundations is distinct from old.delivery_foundations then
    raise exception 'Prepared registration calendar is immutable.';
  end if;
  if new.kind='pre_foundations' then
    select * into welcome from public.member_registration_messages where id=new.source_welcome_id;
    if welcome.id is null or welcome.kind<>'welcome' or welcome.member_id<>new.member_id
      or not welcome.followup_enabled or welcome.status<>'sent' or welcome.sent_at is null
      or new.available_at<welcome.sent_at+interval '24 hours' then
      raise exception 'Registration followup requires its delivered welcome and a full 24 hours.';
    end if;
  end if;
  return new;
end $$;
create trigger registration_followup_guard before insert or update on public.member_registration_messages
  for each row execute function private.ruined_guard_registration_followup();

create function private.ruined_queue_registration_followup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind='welcome' and new.followup_enabled and new.status='sent' and old.status<>'sent' then
    insert into public.member_registration_messages(member_id,kind,source_welcome_id,available_at)
      values(new.member_id,'pre_foundations',new.id,new.sent_at+interval '24 hours')
      on conflict(member_id,kind) do nothing;
  end if;
  return new;
end $$;
create trigger registration_followup_after_welcome after update of status on public.member_registration_messages
  for each row execute function private.ruined_queue_registration_followup();
revoke all on function private.ruined_guard_registration_followup(),private.ruined_queue_registration_followup()
  from public,anon,authenticated;
commit;
