begin;

-- Preserve stable permission IDs and historical assignments while changing
-- the current vocabulary. Signup cohorts (including Builders) are separate.
update public.platform_roles set display_name = 'Circle Supporter'
where role_slug = 'circle_leader';
update public.platform_roles set display_name = 'Legacy Circle support'
where role_slug = 'guide';

update public.membership_progression_levels
set status = 'retired', updated_at = statement_timestamp()
where slug in ('builder', 'author', 'partner');
update public.membership_progression_levels
set display_name = 'Circle Supporter', updated_at = statement_timestamp()
where slug = 'shaper';

-- Existing assignments remain historical evidence; retired titles cannot be
-- assigned again. Membership number cohorts do not use this table.
create or replace function private.ruined_require_active_progression_title()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.membership_progression_levels
                 where slug = new.progression_level_slug and status = 'active') then
    raise exception 'This leadership title is retired.';
  end if;
  return new;
end;
$$;
revoke all on function private.ruined_require_active_progression_title() from public, anon, authenticated;
create trigger member_progression_assignments_active_title
before insert on public.member_progression_assignments
for each row execute function private.ruined_require_active_progression_title();

commit;
