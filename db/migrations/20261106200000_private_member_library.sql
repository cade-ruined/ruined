begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('ruined-platform-migration-runner'));

-- Library recordings never use a public object URL. Only the currently
-- published version and its existing member audience may issue playback URLs.
create function private.ruined_can_read_library_object(requested_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.learning_resources resource
    join public.learning_resource_versions version_record
      on version_record.id = resource.current_version_id
      and version_record.learning_resource_id = resource.id
    left join public.learning_collections collection
      on collection.id = resource.collection_id and collection.status = 'published'
    where resource.status = 'published'
      and (resource.collection_id is null or collection.id is not null)
      and version_record.published_at is not null
      and version_record.storage_bucket = 'member-library'
      and version_record.storage_path = requested_path
      and private.ruined_can_access_learning_resource(resource.id)
  )
$$;
revoke all on function private.ruined_can_read_library_object(text) from public, anon, authenticated;
grant execute on function private.ruined_can_read_library_object(text) to authenticated;

-- Conditional for local PostgreSQL/PGlite installations without Storage.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('member-library', 'member-library', false, 1073741824, array['video/mp4'])
    on conflict(id) do update set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
  if to_regclass('storage.objects') is not null then
    create policy member_library_read_published on storage.objects
      for select to authenticated
      using (bucket_id = 'member-library' and private.ruined_can_read_library_object(name));

    -- Other features may add permissive Storage policies. These restrictions
    -- keep Library recordings private and server-managed independently of them.
    create policy member_library_scoped_read on storage.objects
      as restrictive for select to authenticated
      using (bucket_id <> 'member-library' or private.ruined_can_read_library_object(name));
    create policy member_library_no_anonymous_read on storage.objects
      as restrictive for select to anon
      using (bucket_id <> 'member-library');
    create policy member_library_no_client_insert on storage.objects
      as restrictive for insert to anon, authenticated
      with check (bucket_id <> 'member-library');
    create policy member_library_no_client_update on storage.objects
      as restrictive for update to anon, authenticated
      using (bucket_id <> 'member-library') with check (bucket_id <> 'member-library');
    create policy member_library_no_client_delete on storage.objects
      as restrictive for delete to anon, authenticated
      using (bucket_id <> 'member-library');
  end if;
end $$;

commit;
