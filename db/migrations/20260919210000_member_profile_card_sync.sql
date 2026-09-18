begin;

alter table public.person_profiles add column website_url text
  check (website_url is null or char_length(website_url) <= 300);

-- Preserve a member's existing website when moving its only editor to Profile.
update public.person_profiles profile
set website_url = card.public_website
from public.member_public_cards card join public.ruined_members member on member.id = card.member_id
where profile.person_id = member.person_id and profile.website_url is null and card.public_website <> '';

-- Legacy print-copy columns are retained for rollback, but no longer written or
-- read by the application. Profile fields are the only live text source.
alter table public.member_public_cards alter column public_name set default 'Member';
comment on table public.member_public_cards is 'Owner-only public sharing scope. Selected fields automatically use the current member profile; public reads still require opt-in and current eligibility.';

commit;
