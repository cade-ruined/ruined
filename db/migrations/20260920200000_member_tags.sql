begin;

-- A member chooses their tag. Existing names and completed access stay intact.
alter table public.person_profiles add column member_tag text
  constraint person_profiles_member_tag_format
  check (member_tag is null or member_tag ~ '^[a-z0-9_]{3,24}$');
create unique index person_profiles_member_tag_unique
  on public.person_profiles (member_tag) where member_tag is not null;
comment on column public.person_profiles.member_tag is 'Member-chosen canonical lowercase tag without @. Nullable for legacy profiles; not an authentication or access credential.';

commit;
