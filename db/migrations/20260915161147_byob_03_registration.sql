begin;
set local lock_timeout = '10s';

-- Extend the configured native routes; all Nº 02 registrations, waiver versions,
-- and Google Sheets jobs retain their original event key and contents.
alter table public.community_event_listings
  drop constraint if exists community_event_listings_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_event_listings'::regclass
      and conname = 'community_event_listings_native_registration_check'
  ) then
    alter table public.community_event_listings
      add constraint community_event_listings_native_registration_check
      check (registration_mode <> 'byob' or (
        event_key in ('byob-02', 'byob-03') and registration_url is null
      ));
  end if;
end
$$;

insert into public.community_event_waiver_versions (
  event_key, version, title, body, content_sha256
) values (
  'byob-03',
  'byob-03-risk-acknowledgment-v1',
  'Participation release and risk acknowledgment',
  'BYOB Nº 03 is a voluntary outdoor gathering involving strenuous movement, cold or open water, steep or uneven terrain, changing weather, equipment, transportation or carpooling, other participants, and risks of injury, illness, death, or property loss. I confirm that I am able to participate safely, will use equipment responsibly, and will stop when needed. I knowingly and voluntarily assume the inherent and other risks of my participation. To the fullest extent permitted by Utah law, I release and covenant not to sue The Ruined Project LLC; the United States of America, acting through the U.S. Department of Agriculture, Forest Service, including the Uinta-Wasatch-Cache National Forest and Pleasant Grove Ranger District; and North Utah County Water Conservancy District, together with their respective officials, members, managers, officers, directors, employees, agents, volunteers, contractors, successors, and assigns, for claims arising from my participation, including claims based on ordinary negligence. This release does not apply to gross negligence or reckless, willful, or wanton misconduct. Carpooling is voluntary and privately arranged; drivers and passengers are responsible for lawful operation, insurance, seat belts, and vehicle safety, and the released parties do not select or control drivers or vehicles. I confirm that I am at least 18 years old and am registering and accepting this acknowledgment only for myself.',
  '8f13e06c3fc769d6b5cd437d81beb689775154360cb6ca71d62abb1bcc1987f6'
)
on conflict (event_key, version) do nothing;

-- One adult accepts the exact displayed version for themselves. Historical
-- Nº 02 evidence and its existing validation constraints are unchanged.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.community_event_registrations'::regclass
      and conname = 'community_event_registrations_byob03_participant_check'
  ) then
    alter table public.community_event_registrations
      add constraint community_event_registrations_byob03_participant_check
      check (
        not (event_key = 'byob-03' and waiver_version = 'byob-03-risk-acknowledgment-v1')
        or (
          registrant_first_name is not null
          and registrant_last_name is not null
          and waiver_acceptance_evidence @> '{
            "affirmative_action": "required_checkbox",
            "scope": "registrant_only",
            "participant": "registrant",
            "age_confirmation": "18_or_older",
            "carpool_disclosure_presented": true,
            "waiver_sha256": "8f13e06c3fc769d6b5cd437d81beb689775154360cb6ca71d62abb1bcc1987f6"
          }'::jsonb
          and not (waiver_acceptance_evidence ?| array[
            'guest_acknowledgment_required', 'guest_count', 'guest_scope'
          ])
        )
      );
  end if;
end
$$;

-- Operators publish the new listing after the matching route is deployed.
-- A pre-existing Nº 03 listing is preserved for review in the operator editor.
insert into public.community_event_listings (
  event_key, title, eyebrow, starts_at, timezone, location, summary,
  image_path, publication_state, event_state, registration_mode, registration_open
) values (
  'byob-03', 'BYOB Nº 03', 'Monthly gathering', '2026-10-09T14:00:00Z',
  'America/Denver', 'Tibble Fork Reservoir · Hill south of the parking lot',
  'Bring Your Own (Bell or bodyweight).', '/events/byob-key-art.png',
  'draft', 'Upcoming', 'byob', true
)
on conflict (event_key) do nothing;

-- Keep attendee details and consent evidence accessible only through the
-- existing guarded server repositories, never through the browser Data API.
alter table public.community_event_waiver_versions enable row level security;
alter table public.community_event_registrations enable row level security;
revoke all on table public.community_event_waiver_versions,
  public.community_event_registrations from public, anon, authenticated, service_role;

commit;
