update storage.buckets
set
  allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm']::text[]
where id = 'festival-banners';
