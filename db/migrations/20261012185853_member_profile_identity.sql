begin;

alter table public.person_profiles
  add column city text check (city is null or char_length(btrim(city)) between 1 and 100),
  add column state text check (state is null or char_length(btrim(state)) between 1 and 100);

-- Retain the original label; split at its final comma for the new editor.
update public.person_profiles
set city = nullif(left(btrim(case when position(',' in location_label) > 0
      then regexp_replace(location_label, ',[^,]*$', '') else location_label end), 100), ''),
    state = case when position(',' in location_label) > 0
      then nullif(left(btrim(substring(location_label from '[^,]*$')), 100), '') end
where nullif(btrim(location_label), '') is not null;

-- Generated @tag labels become full names. Authored names are retained.
update public.person_profiles profile
set display_name = left(btrim(private_profile.legal_name), 120), updated_at = statement_timestamp()
from public.person_private_profiles private_profile
where private_profile.person_id = profile.person_id
  and nullif(btrim(private_profile.legal_name), '') is not null
  and (nullif(btrim(profile.display_name), '') is null
    or profile.display_name = '@' || profile.member_tag);

alter table public.member_directory_preferences
  alter column directory_status set default 'circle_visible',
  alter column bio_visible set default true;
update public.member_directory_preferences
set directory_status = 'circle_visible', bio_visible = true,
    version = version + 1, updated_at = statement_timestamp()
where directory_status <> 'circle_visible' or not bio_visible;

-- Existing card choices are not consent to add optional fields to invitations.
alter table public.member_public_cards
  add column invitation_customized_at timestamptz;
comment on column public.member_public_cards.invitation_customized_at is 'Explicit invitation customization consent. Null keeps invitation cards name only regardless of legacy public card selections.';

-- New tags remain claimable, but an assigned tag cannot be changed or cleared.
-- The existing unique index continues to arbitrate simultaneous first claims.
create function private.ruined_lock_member_tag()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.member_tag is not null and new.member_tag is distinct from old.member_tag then
    raise exception 'Your member tag is permanent and cannot be changed after creation.' using errcode = 'P4210';
  end if;
  return new;
end;
$$;
revoke all on function private.ruined_lock_member_tag() from public, anon, authenticated;
create trigger person_profiles_member_tag_immutable
before update of member_tag on public.person_profiles
for each row execute function private.ruined_lock_member_tag();

comment on column public.person_profiles.city is 'Profile city, separate from private fulfillment address.';
comment on column public.person_profiles.state is 'Profile state or region, separate from private fulfillment address.';
comment on column public.person_profiles.member_tag is 'Permanent member-chosen lowercase tag without @. Nullable until first creation; not an authentication credential.';

commit;
