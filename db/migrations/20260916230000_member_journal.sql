begin;

-- Member authored entries are private to their verified owner. Circle consent
-- does not grant access. All reads and writes go through the guarded app API.
create table public.member_journal_entries (
  id uuid primary key,
  member_id uuid not null references public.ruined_members(id),
  kind text not null check (kind in ('text', 'images', 'video')),
  title text check (title is null or char_length(title) between 1 and 160),
  body text check (body is null or char_length(body) between 1 and 20000),
  saved boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  deleted_at timestamptz,
  check (kind <> 'text' or body is not null),
  unique (member_id, id)
);
create index member_journal_entries_owner_idx on public.member_journal_entries(member_id, created_at desc, id desc) where deleted_at is null;

create table public.member_journal_media (
  id uuid primary key,
  member_id uuid not null references public.ruined_members(id),
  entry_id uuid,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','video/mp4','video/webm')),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  verified_at timestamptz,
  state text not null default 'pending' check (state in ('pending','ready')),
  position integer not null default 0 check (position between 0 and 7),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (member_id, entry_id) references public.member_journal_entries(member_id, id),
  check ((state = 'pending' and entry_id is null) or (state = 'ready' and entry_id is not null))
);
create index member_journal_media_owner_idx on public.member_journal_media(member_id, created_at desc);
create index member_journal_media_entry_idx on public.member_journal_media(entry_id, position) where state = 'ready';
alter table public.member_journal_entries enable row level security;
alter table public.member_journal_media enable row level security;
revoke all on public.member_journal_entries, public.member_journal_media from public, anon, authenticated;

-- New dedicated private bucket. Never broaden the profile portrait bucket.
-- Keep this conditional so local PostgreSQL/PGlite tests need no Storage schema.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('member-journal', 'member-journal', false, 52428800,
      array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
commit;
