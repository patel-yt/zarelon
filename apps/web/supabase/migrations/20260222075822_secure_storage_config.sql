-- Enforce secure bucket configuration
update storage.buckets
set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','image/avif']::text[]
where id = 'product-images';

update storage.buckets
set
  public = true,
  file_size_limit = 3145728,
  allowed_mime_types = array['image/png','image/jpeg','image/webp']::text[]
where id = 'festival-banners';

-- Drop old policies if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated upload product-images'
  ) THEN
    DROP POLICY "Authenticated upload product-images" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated upload festival-banners'
  ) THEN
    DROP POLICY "Authenticated upload festival-banners" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admin delete product-images'
  ) THEN
    DROP POLICY "Admin delete product-images" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Admin delete festival-banners'
  ) THEN
    DROP POLICY "Admin delete festival-banners" ON storage.objects;
  END IF;
END $$;

-- Upload policies: authenticated users only
create policy "Authenticated upload product-images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and auth.role() = 'authenticated'
);

create policy "Authenticated upload festival-banners"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'festival-banners'
  and auth.role() = 'authenticated'
);

-- Delete policies: admin/super_admin only
create policy "Admin delete product-images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin','super_admin')
  )
);

create policy "Admin delete festival-banners"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'festival-banners'
  and exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin','super_admin')
  )
);
