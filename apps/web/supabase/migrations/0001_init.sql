create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key,
  name text,
  email text unique not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  price_inr integer not null,
  discount_percent integer not null default 0 check (discount_percent between 0 and 90),
  category text not null,
  stock integer not null default 0,
  featured boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false
);

create unique index if not exists product_images_primary_unique
  on public.product_images(product_id)
  where is_primary = true;

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unique(cart_id, product_id)
);

create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.users(id) on delete cascade
);

create table if not exists public.wishlist_items (
  id uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  product_id uuid not null references public.products(id),
  unique(wishlist_id, product_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  user_id uuid not null references public.users(id),
  subtotal_inr integer not null,
  shipping_inr integer not null,
  total_inr integer not null,
  status text not null check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded')),
  payment_status text not null check (payment_status in ('created', 'authorized', 'captured', 'failed', 'refunded')),
  payment_provider text not null default 'razorpay',
  payment_ref text,
  shipping_address jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  title_snapshot text not null,
  price_inr integer not null,
  quantity integer not null check (quantity > 0)
);

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  title text,
  image_url text not null,
  cta_label text,
  cta_href text,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.payments_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null,
  provider_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlists enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.banners enable row level security;
alter table public.payments_audit enable row level security;
alter table public.admin_audit_logs enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create policy "users_select_self_or_admin" on public.users
for select using (id = auth.uid() or public.is_admin());

create policy "users_update_self" on public.users
for update using (id = auth.uid()) with check (id = auth.uid());

create policy "products_public_select" on public.products
for select using (active = true or public.is_admin());

create policy "products_admin_write" on public.products
for all using (public.is_admin()) with check (public.is_admin());

create policy "product_images_public_select" on public.product_images
for select using (public.is_admin() or exists (
  select 1 from public.products p where p.id = product_id and p.active = true
));

create policy "product_images_admin_write" on public.product_images
for all using (public.is_admin()) with check (public.is_admin());

create policy "banners_public_select" on public.banners
for select using (active = true or public.is_admin());

create policy "banners_admin_write" on public.banners
for all using (public.is_admin()) with check (public.is_admin());

create policy "carts_owner" on public.carts
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "cart_items_owner" on public.cart_items
for all using (
  exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
)
with check (
  exists (select 1 from public.carts c where c.id = cart_id and c.user_id = auth.uid())
);

create policy "wishlists_owner" on public.wishlists
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "wishlist_items_owner" on public.wishlist_items
for all using (
  exists (select 1 from public.wishlists w where w.id = wishlist_id and w.user_id = auth.uid())
)
with check (
  exists (select 1 from public.wishlists w where w.id = wishlist_id and w.user_id = auth.uid())
);

create policy "orders_owner_select" on public.orders
for select using (user_id = auth.uid() or public.is_admin());

create policy "orders_owner_insert" on public.orders
for insert with check (user_id = auth.uid() or public.is_admin());

create policy "orders_admin_update" on public.orders
for update using (public.is_admin()) with check (public.is_admin());

create policy "order_items_read" on public.order_items
for select using (
  public.is_admin() or exists (
    select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()
  )
);

create policy "order_items_admin_write" on public.order_items
for all using (public.is_admin()) with check (public.is_admin());

create policy "payments_audit_admin_read" on public.payments_audit
for select using (public.is_admin());

create policy "admin_audit_logs_admin_read" on public.admin_audit_logs
for select using (public.is_admin());

create policy "payments_audit_admin_write" on public.payments_audit
for all using (public.is_admin()) with check (public.is_admin());

create policy "admin_audit_logs_admin_write" on public.admin_audit_logs
for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();
