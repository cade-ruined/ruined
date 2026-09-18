begin;

-- Separate, affirmative public consent. Existing Circle preferences grant nothing.
-- Portrait and location are pinned to the version seen when the member saves.
create table public.member_public_cards (
  member_id uuid primary key references public.ruined_members(id),
  public_token text not null unique check (public_token ~ '^[A-Za-z0-9_-]{43}$'),
  wear_seed text not null check (wear_seed ~ '^[0-9a-f]{24}$'),
  public_enabled boolean not null default false,
  public_name text not null check (char_length(btrim(public_name)) between 1 and 64),
  card_bio text not null default '' check (char_length(card_bio) <= 180),
  card_building text not null default '' check (char_length(card_building) <= 100),
  public_website text not null default '' check (char_length(public_website) <= 300),
  public_portrait_url text,
  public_location text,
  show_portrait boolean not null default false,
  show_member_since boolean not null default false,
  show_location boolean not null default false,
  show_bio boolean not null default false,
  show_building boolean not null default false,
  show_website boolean not null default false,
  label_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(label_ids) = 'array' and jsonb_array_length(label_ids) <= 2),
  public_labels jsonb not null default '[]'::jsonb check (jsonb_typeof(public_labels) = 'array' and jsonb_array_length(public_labels) <= 2),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);
alter table public.member_public_cards enable row level security;
revoke all on public.member_public_cards from public, anon, authenticated;
comment on table public.member_public_cards is 'Owner-only settings. Public reads require current publication and active membership and return an explicit field projection.';
commit;
