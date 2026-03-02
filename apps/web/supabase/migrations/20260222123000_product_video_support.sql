alter table public.products add column if not exists video_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-videos',
  'product-videos',
  true,
  20971520,
  array['video/mp4','video/webm']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read product-videos'
  ) THEN
    DROP POLICY "Public read product-videos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated upload product-videos'
  ) THEN
    DROP POLICY "Authenticated upload product-videos" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admin delete product-videos'
  ) THEN
    DROP POLICY "Admin delete product-videos" ON storage.objects;
  END IF;
END $$;

create policy "Public read product-videos"
on storage.objects
for select
using (bucket_id = 'product-videos');

create policy "Authenticated upload product-videos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-videos'
  and auth.role() = 'authenticated'
);

create policy "Admin delete product-videos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-videos'
  and exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin','super_admin')
  )
);
