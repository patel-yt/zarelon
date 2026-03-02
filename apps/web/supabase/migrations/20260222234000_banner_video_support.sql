alter table public.banners
  add column if not exists video_url text;

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array['image/png','image/jpeg','image/webp','video/mp4','video/webm']::text[]
where id = 'festival-banners';
