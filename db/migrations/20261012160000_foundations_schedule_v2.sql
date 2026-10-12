begin;

-- Correct future December call calendars without changing accepted snapshots.
-- v1 remains valid exactly as disclosed; v2 changes only its final call date.
-- Service start, cutoff, prepaid coverage, renewal and commitment dates are unchanged.
create or replace function private.ruined_valid_prepaid_schedule(schedule jsonb, plan text)
returns boolean language plpgsql immutable set search_path='' as $$
declare call_at timestamptz; previous_call timestamptz; start_at timestamptz; through_at timestamptz;
  key text; value text; cohort_start date; first_thursday date; call_index integer:=0; expected_call_date date;
begin
  if schedule is null then return true; end if;
  if jsonb_typeof(schedule) is distinct from 'object' or (schedule->>'version' is null or schedule->>'version' not in ('foundations-prepaid-v1','foundations-prepaid-v2'))
    or schedule->>'timeZone' is distinct from 'America/Denver' or schedule->>'cohortMonth' is null or schedule->>'cohortMonth' !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or (select count(*) from jsonb_object_keys(schedule))<>9
    or jsonb_typeof(schedule->'callStartsAt') is distinct from 'array' or jsonb_array_length(schedule->'callStartsAt')<>4
    or plan is null or plan not in ('monthly','annual') or schedule->>'cohortMonth'<'2026-11' or schedule->>'cohortMonth'>'9998-12' then return false; end if;
  foreach key in array array['cutoffAt','serviceStartsAt','prepaidThrough','nextChargeAt','initialTermEndsAt'] loop
    value:=schedule->>key;
    if value is null or value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.000)?Z$' or not isfinite(value::timestamptz) then return false; end if;
  end loop;
  start_at:=(schedule->>'serviceStartsAt')::timestamptz;
  through_at:=(schedule->>'prepaidThrough')::timestamptz;
  if (schedule->>'cutoffAt')::timestamptz>=start_at or through_at<=start_at
    or (schedule->>'nextChargeAt')::timestamptz<>through_at
    or (schedule->>'initialTermEndsAt')::timestamptz<=start_at
    or through_at>(schedule->>'initialTermEndsAt')::timestamptz
    or start_at<>(schedule->'callStartsAt'->>0)::timestamptz
    or (schedule->>'cutoffAt')::timestamptz<>start_at-interval '24 hours'
    or through_at<>((start_at at time zone 'UTC')+case when plan='annual' then interval '12 months' else interval '1 month' end) at time zone 'UTC'
    or (schedule->>'initialTermEndsAt')::timestamptz<>((start_at at time zone 'UTC')+interval '12 months') at time zone 'UTC'
  then return false; end if;
  cohort_start:=((schedule->>'cohortMonth')||'-01')::date;
  first_thursday:=cohort_start+((4-extract(dow from cohort_start)::integer+7)%7);
  for value in select jsonb_array_elements_text(schedule->'callStartsAt') loop
    if value is null or value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.000)?Z$' then return false; end if;
    call_at:=value::timestamptz;
    expected_call_date:=case when call_index=3 and schedule->>'cohortMonth'='2026-11' then date '2026-11-30'
      when call_index=3 and schedule->>'cohortMonth'='2026-12' then
        case when schedule->>'version'='foundations-prepaid-v1' then date '2026-12-30' else date '2026-12-31' end else first_thursday+call_index*7 end;
    if not isfinite(call_at) or call_at<start_at or (previous_call is not null and call_at<=previous_call)
      or call_at<>(expected_call_date+time '15:00') at time zone 'America/Denver' then return false; end if;
    previous_call:=call_at;call_index:=call_index+1;
  end loop;
  return true;
exception when others then return false;
end $$;

-- CREATE OR REPLACE retains the existing function privileges. All immutable
-- reservation, Checkout and contract guards continue to apply unchanged.
commit;
