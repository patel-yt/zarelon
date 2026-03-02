alter table if exists public.products
add column if not exists previous_price_inr integer;
