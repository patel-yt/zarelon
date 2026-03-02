create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  color text,
  size text,
  sku text,
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_variants_product_idx on public.product_variants(product_id);
create unique index if not exists product_variants_unique_combo
  on public.product_variants (
    product_id,
    coalesce(lower(color), '__no_color__'),
    coalesce(lower(size), '__no_size__')
  );

alter table if exists public.cart_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null;

alter table if exists public.cart_items
  drop constraint if exists cart_items_cart_id_product_id_key;

drop index if exists public.cart_items_cart_id_product_id_key;
create unique index if not exists cart_items_unique_product_variant
  on public.cart_items (
    cart_id,
    product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table if exists public.order_items
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists variant_label text,
  add column if not exists selected_color text,
  add column if not exists selected_size text;

alter table public.product_variants enable row level security;

drop policy if exists "product_variants_public_select" on public.product_variants;
create policy "product_variants_public_select" on public.product_variants
for select using (
  exists (
    select 1
    from public.products p
    where p.id = product_id
      and p.active = true
  )
);

drop policy if exists "product_variants_admin_write" on public.product_variants;
create policy "product_variants_admin_write" on public.product_variants
for all using (public.has_admin_permission('can_manage_products'))
with check (public.has_admin_permission('can_manage_products'));

drop trigger if exists trg_product_variants_updated_at on public.product_variants;
create trigger trg_product_variants_updated_at
before update on public.product_variants
for each row execute procedure public.set_updated_at();
