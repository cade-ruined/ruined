begin;

-- Preserve the original combined name for existing exports while recording
-- first and last names separately for every v2 BYOB Nº 02 registration.
alter table community_event_registrations
  add column if not exists registrant_first_name text,
  add column if not exists registrant_last_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'community_event_registrations'::regclass
      and conname = 'community_event_registrations_name_parts_check'
  ) then
    alter table community_event_registrations
      add constraint community_event_registrations_name_parts_check
      check (
        (
          registrant_first_name is null
          and registrant_last_name is null
        )
        or (
          registrant_first_name = btrim(registrant_first_name)
          and char_length(registrant_first_name) between 1 and 80
          and registrant_last_name = btrim(registrant_last_name)
          and char_length(registrant_last_name) between 1 and 80
          and char_length(registrant_first_name || ' ' || registrant_last_name)
            between 3 and 120
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'community_event_registrations'::regclass
      and conname = 'community_event_registrations_v2_name_parts_required_check'
  ) then
    alter table community_event_registrations
      add constraint community_event_registrations_v2_name_parts_required_check
      check (
        not (
          event_key = 'byob-02'
          and waiver_version = 'byob-02-risk-acknowledgment-v2'
        )
        or (
          registrant_first_name is not null
          and registrant_last_name is not null
        )
      );
  end if;
end
$$;

-- A guest name is a roster entry, not assent. Every adult guest remains
-- individually responsible for accepting the release before participation.
alter table community_event_registration_guests
  add column if not exists waiver_acknowledgment_status text
    not null default 'individual_required',
  add column if not exists waiver_acknowledged_at timestamptz,
  add column if not exists waiver_acceptance_evidence jsonb
    not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'community_event_registration_guests'::regclass
      and conname = 'community_event_registration_guests_waiver_status_check'
  ) then
    alter table community_event_registration_guests
      add constraint community_event_registration_guests_waiver_status_check
      check (
        waiver_acknowledgment_status in (
          'individual_required',
          'acknowledged',
          'guardian_acknowledged'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'community_event_registration_guests'::regclass
      and conname = 'community_event_registration_guests_waiver_evidence_check'
  ) then
    alter table community_event_registration_guests
      add constraint community_event_registration_guests_waiver_evidence_check
      check (
        jsonb_typeof(waiver_acceptance_evidence) = 'object'
        and (
          (
            waiver_acknowledgment_status = 'individual_required'
            and waiver_acknowledged_at is null
            and waiver_acceptance_evidence = '{}'::jsonb
          )
          or (
            waiver_acknowledgment_status = 'acknowledged'
            and waiver_acknowledged_at is not null
            and waiver_acceptance_evidence @> '{"affirmative_action":"guest_acceptance","actor":"guest"}'::jsonb
          )
          or (
            waiver_acknowledgment_status = 'guardian_acknowledged'
            and waiver_acknowledged_at is not null
            and waiver_acceptance_evidence @> '{"affirmative_action":"guardian_acceptance","actor":"guardian"}'::jsonb
          )
        )
      );
  end if;
end
$$;

create index if not exists community_event_registration_guests_waiver_status_idx
  on community_event_registration_guests(
    waiver_acknowledgment_status,
    registration_id
  );

insert into community_event_waiver_versions (
  event_key,
  version,
  title,
  body,
  content_sha256
) values (
  'byob-02',
  'byob-02-risk-acknowledgment-v2',
  'Participation release and risk acknowledgment',
  'BYOB Nº 02 is a voluntary outdoor gathering involving strenuous movement, cold or open water, steep or uneven terrain, changing weather, equipment, transportation or carpooling, other participants, and risks of injury, illness, death, or property loss. I confirm that I am able to participate safely, will use equipment responsibly, and will stop when needed. I knowingly and voluntarily assume the inherent and other risks of my participation. To the fullest extent permitted by Utah law, I release and covenant not to sue The Ruined Project LLC; the United States of America, acting through the U.S. Department of Agriculture, Forest Service, including the Uinta-Wasatch-Cache National Forest and Pleasant Grove Ranger District; and North Utah County Water Conservancy District, together with their respective officials, members, managers, officers, directors, employees, agents, volunteers, contractors, successors, and assigns, for claims arising from my participation, including claims based on ordinary negligence. This release does not apply to gross negligence or reckless, willful, or wanton misconduct. Carpooling is voluntary and privately arranged; drivers and passengers are responsible for lawful operation, insurance, seat belts, and vehicle safety, and the released parties do not select or control drivers or vehicles. I will share this acknowledgment with every guest. Each adult guest must accept it for themselves before participating. A parent or legal guardian must provide consent and acknowledge the risks for any guest under 18. Listing a guest does not sign for them.',
  '2ebe0e0eeaf274e48956111c0757a50362ec6c186d7a72ab4d322d6387181c9e'
)
on conflict (event_key, version) do nothing;

alter table community_event_waiver_versions enable row level security;
alter table community_event_registrations enable row level security;
alter table community_event_registration_guests enable row level security;

revoke all on table
  community_event_waiver_versions,
  community_event_registrations,
  community_event_registration_guests
from public, anon, authenticated, service_role;

commit;
