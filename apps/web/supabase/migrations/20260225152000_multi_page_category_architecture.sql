do $$
begin
  if not exists (select 1 from pg_type where typname = 'product_gender') then
    create type public.product_gender as enum ('men', 'women', 'unisex');
  end if;
end
$$;

alter table public.products
  add column if not exists gender public.product_gender not null default 'unisex',
  add column if not exists show_on_home boolean not null default false,
  add column if not exists show_on_new_in boolean not null default false,
  add column if not exists show_on_collection boolean not null default false,
  add column if not exists collection_slug text,
  add column if not exists category_slug text;

update public.products
set
  show_on_home = coalesce(featured, false),
  category_slug = coalesce(
    nullif(category_slug, ''),
    regexp_replace(lower(trim(category)), '[^a-z0-9\\s-]', '', 'g')
  ),
  collection_slug = nullif(collection_slug, '')
where true;

alter table public.categories
  add column if not exists parent_slug text,
  add column if not exists image_url text,
  add column if not exists gender public.product_gender,
  add column if not exists display_order integer not null default 0;

create index if not exists idx_products_gender_category_slug on public.products(gender, category_slug);
create index if not exists idx_products_collection_slug on public.products(collection_slug);
create index if not exists idx_products_show_flags on public.products(show_on_home, show_on_new_in, show_on_collection);
create index if not exists idx_categories_gender_order on public.categories(gender, display_order, name);
