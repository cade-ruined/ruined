begin;
set local lock_timeout = '10s';

-- Presentation lives here; public BYOB consent/registration IDs remain in the
-- existing community_event_registrations table and are never copied to Experiences.
create table public.community_event_listings (
  event_key text primary key check (event_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(event_key) between 1 and 80),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  eyebrow text not null default '' check (char_length(eyebrow) <= 100),
  starts_at timestamptz not null,
  timezone text not null default 'America/Denver',
  location text not null default '' check (char_length(location) <= 300),
  admission text not null default '' check (char_length(admission) <= 200),
  summary text not null default '' check (char_length(summary) <= 3000),
  image_path text,
  video_path text,
  video_poster_path text,
  publication_state text not null default 'draft' check (publication_state in ('draft', 'published', 'archived')),
  event_state text not null default 'Upcoming' check (event_state in ('Upcoming', 'Ongoing', 'Ended')),
  registration_mode text not null default 'none' check (registration_mode in ('none', 'external', 'byob')),
  registration_url text,
  registration_open boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (registration_mode <> 'byob' or (event_key = 'byob-02' and registration_url is null)),
  check ((registration_mode = 'external' and registration_url ~ '^https://[^/]+') or (registration_mode <> 'external' and registration_url is null)),
  check (registration_mode <> 'none' or not registration_open),
  check (image_path is null or (image_path like '/%' and image_path not like '//%')),
  check (video_path is null or (video_path like '/%' and video_path not like '//%')),
  check (video_poster_path is null or (video_poster_path like '/%' and video_poster_path not like '//%'))
);
create index community_event_listings_public_schedule_idx
  on public.community_event_listings(starts_at, event_key) where publication_state = 'published';

insert into public.community_event_listings (
  event_key, title, eyebrow, starts_at, timezone, location, summary,
  image_path, video_path, video_poster_path, publication_state, event_state,
  registration_mode, registration_open
) values
  ('byob-01', 'BYOB Nº 01', 'Monthly gathering', '2026-08-14T14:00:00Z', 'America/Denver',
   'Tibble Fork Reservoir · Up on the hill', 'Bring Your Own (Bell or bodyweight).',
   '/events/byob-01/gallery/01-img-8059.webp?v=1', '/events/byob-01-recap.mp4?v=2', '/events/byob-01-recap-poster.webp?v=2',
   'published', 'Ended', 'none', false),
  ('byob-02', 'BYOB Nº 02', 'Monthly gathering', '2026-09-11T14:00:00Z', 'America/Denver',
   'Tibble Fork Reservoir · Hill south of the parking lot', 'Bring Your Own (Bell or bodyweight).',
   '/events/byob-key-art.png', null, null, 'published', 'Upcoming', 'byob', true);

-- Append-only attendance corrects with another event. It does not alter a
-- registration's status, original waiver evidence, or Google Sheets row ID.
create table public.community_event_attendance_events (
  id bigint generated always as identity primary key,
  registration_id uuid not null references public.community_event_registrations(id) on delete restrict,
  attendance_state text not null check (attendance_state in ('present', 'absent', 'not_recorded')),
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id) on delete restrict,
  recorded_at timestamptz not null default statement_timestamp()
);
create index community_event_attendance_registration_idx
  on public.community_event_attendance_events(registration_id, id desc);
create index community_event_attendance_actor_idx
  on public.community_event_attendance_events(actor_auth_user_id);
create trigger community_event_attendance_append_only
  before update or delete on public.community_event_attendance_events
  for each row execute function public.ruined_reject_append_only_mutation();

alter table public.community_event_listings enable row level security;
alter table public.community_event_attendance_events enable row level security;
revoke all on table public.community_event_listings, public.community_event_attendance_events from public, anon, authenticated, service_role;
revoke all on sequence public.community_event_attendance_events_id_seq from public, anon, authenticated, service_role;
commit;
