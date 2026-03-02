alter table if exists public.products
add column if not exists requires_cod boolean not null default true;
