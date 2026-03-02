-- Create storage buckets
insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),
  ('festival-banners', 'festival-banners', true)
on conflict (id) do update
set public = excluded.public;

-- Remove old policies if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read product-images'
  ) THEN
    DROP POLICY "Public read product-images" ON storage.objects;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read festival-banners'
  ) THEN
    DROP POLICY "Public read festival-banners" ON storage.objects;
  END IF;

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
END $$;

-- Public read policies
create policy "Public read product-images"
on storage.objects
for select
using (bucket_id = 'product-images');

create policy "Public read festival-banners"
on storage.objects
for select
using (bucket_id = 'festival-banners');

-- Authenticated upload-only policies
create policy "Authenticated upload product-images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'product-images');

create policy "Authenticated upload festival-banners"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'festival-banners');
