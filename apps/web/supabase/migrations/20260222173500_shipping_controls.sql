alter table if exists public.products
add column if not exists requires_shipping boolean not null default true;

alter table if exists public.platform_settings
add column if not exists shipping_flat_inr integer not null default 9900;

update public.platform_settings
set shipping_flat_inr = coalesce(shipping_flat_inr, 9900)
where shipping_flat_inr is null;
