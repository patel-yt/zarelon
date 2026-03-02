alter table if exists public.products
  add column if not exists bundle_with uuid[] default '{}'::uuid[];
