begin;

create table public.admin_email_image_upload_limits (
  actor_auth_user_id uuid not null references public.platform_users(auth_user_id),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 30),
  primary key (actor_auth_user_id,window_started_at)
);
alter table public.admin_email_image_upload_limits enable row level security;
revoke all on table public.admin_email_image_upload_limits from public,anon,authenticated;

-- Email imagery is intentionally public. This new bucket never changes the
-- visibility or policies of any private member media bucket. An existing bucket
-- with this ID keeps its configuration; the server refuses private buckets.
-- Conditional for PostgreSQL/PGlite installations without Supabase Storage.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    values('admin-email-images','admin-email-images',true,3145728,array['image/jpeg','image/png'])
    on conflict(id) do nothing;
  end if;
  if to_regclass('storage.objects') is not null then
    -- Restrictive predicates protect this bucket even when another feature has
    -- a permissive client policy. Other buckets retain their existing access.
    create policy admin_email_images_no_client_insert on storage.objects
      as restrictive for insert to anon,authenticated
      with check(bucket_id <> 'admin-email-images');
    create policy admin_email_images_no_client_update on storage.objects
      as restrictive for update to anon,authenticated
      using(bucket_id <> 'admin-email-images') with check(bucket_id <> 'admin-email-images');
    create policy admin_email_images_no_client_delete on storage.objects
      as restrictive for delete to anon,authenticated
      using(bucket_id <> 'admin-email-images');
  end if;
end $$;

commit;
