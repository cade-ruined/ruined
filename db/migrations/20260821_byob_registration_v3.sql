begin;

-- BYOB Nº 02 now uses one registration and one acknowledgment per adult
-- participant. Historical group rosters remain intact but are never rewritten.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'community_event_registrations'::regclass
      and conname = 'community_event_registrations_v3_participant_check'
  ) then
    alter table community_event_registrations
      add constraint community_event_registrations_v3_participant_check
      check (
        not (
          event_key = 'byob-02'
          and waiver_version = 'byob-02-risk-acknowledgment-v3'
        )
        or (
          registrant_first_name is not null
          and registrant_last_name is not null
          and waiver_acceptance_evidence @> '{
            "affirmative_action": "required_checkbox",
            "scope": "registrant_only",
            "participant": "registrant",
            "age_confirmation": "18_or_older",
            "carpool_disclosure_presented": true
          }'::jsonb
          and not (
            waiver_acceptance_evidence ?| array[
              'guest_acknowledgment_required',
              'guest_count',
              'guest_scope'
            ]
          )
        )
      );
  end if;
end
$$;

insert into community_event_waiver_versions (
  event_key,
  version,
  title,
  body,
  content_sha256
) values (
  'byob-02',
  'byob-02-risk-acknowledgment-v3',
  'Participation release and risk acknowledgment',
  'BYOB Nº 02 is a voluntary outdoor gathering involving strenuous movement, cold or open water, steep or uneven terrain, changing weather, equipment, transportation or carpooling, other participants, and risks of injury, illness, death, or property loss. I confirm that I am able to participate safely, will use equipment responsibly, and will stop when needed. I knowingly and voluntarily assume the inherent and other risks of my participation. To the fullest extent permitted by Utah law, I release and covenant not to sue The Ruined Project LLC; the United States of America, acting through the U.S. Department of Agriculture, Forest Service, including the Uinta-Wasatch-Cache National Forest and Pleasant Grove Ranger District; and North Utah County Water Conservancy District, together with their respective officials, members, managers, officers, directors, employees, agents, volunteers, contractors, successors, and assigns, for claims arising from my participation, including claims based on ordinary negligence. This release does not apply to gross negligence or reckless, willful, or wanton misconduct. Carpooling is voluntary and privately arranged; drivers and passengers are responsible for lawful operation, insurance, seat belts, and vehicle safety, and the released parties do not select or control drivers or vehicles. I confirm that I am at least 18 years old and am registering and accepting this acknowledgment only for myself.',
  'da7a7bdc16508e8159ae431517c14e724de2f6a2388d3eb32482dc56c61006bd'
)
on conflict (event_key, version) do nothing;

alter table community_event_waiver_versions enable row level security;
alter table community_event_registrations enable row level security;

revoke all on table
  community_event_waiver_versions,
  community_event_registrations
from public, anon, authenticated, service_role;

commit;
