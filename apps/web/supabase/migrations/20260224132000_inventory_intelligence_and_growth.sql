alter table if exists public.platform_settings
  add column if not exists low_stock_threshold integer not null default 5,
  add column if not exists reservation_hold_minutes integer not null default 15,
  add column if not exists abandoned_cart_first_minutes integer not null default 60,
  add column if not exists abandoned_cart_second_hours integer not null default 24,
  add column if not exists high_value_cod_threshold_inr integer not null default 150000;

create table if not exists public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cart_id uuid not null references public.carts(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'consumed', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_reservations_user_id on public.inventory_reservations(user_id);
create index if not exists idx_inventory_reservations_cart_id on public.inventory_reservations(cart_id);
create index if not exists idx_inventory_reservations_status_expires on public.inventory_reservations(status, expires_at);

create table if not exists public.inventory_reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.inventory_reservations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_reservation_items_reservation_id
  on public.inventory_reservation_items(reservation_id);

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_notifications_created_at on public.admin_notifications(created_at desc);
create index if not exists idx_admin_notifications_is_read on public.admin_notifications(is_read);

create table if not exists public.payment_risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  event_type text not null,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high')),
  ip_address text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_risk_events_created_at on public.payment_risk_events(created_at desc);
create index if not exists idx_payment_risk_events_type on public.payment_risk_events(event_type);

create table if not exists public.abandoned_cart_reminders (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null unique references public.carts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  first_reminder_sent_at timestamptz,
  second_reminder_sent_at timestamptz,
  coupon_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_abandoned_cart_reminders_user_id on public.abandoned_cart_reminders(user_id);

alter table public.inventory_reservations enable row level security;
alter table public.inventory_reservation_items enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.payment_risk_events enable row level security;
alter table public.abandoned_cart_reminders enable row level security;

drop policy if exists "inventory_reservations_owner_read" on public.inventory_reservations;
create policy "inventory_reservations_owner_read" on public.inventory_reservations
for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "inventory_reservations_admin_write" on public.inventory_reservations;
create policy "inventory_reservations_admin_write" on public.inventory_reservations
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "inventory_reservation_items_owner_read" on public.inventory_reservation_items;
create policy "inventory_reservation_items_owner_read" on public.inventory_reservation_items
for select using (
  exists (
    select 1 from public.inventory_reservations r
    where r.id = reservation_id and (r.user_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "inventory_reservation_items_admin_write" on public.inventory_reservation_items;
create policy "inventory_reservation_items_admin_write" on public.inventory_reservation_items
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_notifications_read" on public.admin_notifications;
create policy "admin_notifications_read" on public.admin_notifications
for select using (public.is_admin());

drop policy if exists "admin_notifications_update" on public.admin_notifications;
create policy "admin_notifications_update" on public.admin_notifications
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin_notifications_insert" on public.admin_notifications;
create policy "admin_notifications_insert" on public.admin_notifications
for insert with check (public.is_admin());

drop policy if exists "payment_risk_events_read_admin" on public.payment_risk_events;
create policy "payment_risk_events_read_admin" on public.payment_risk_events
for select using (public.is_admin());

drop policy if exists "payment_risk_events_write_admin" on public.payment_risk_events;
create policy "payment_risk_events_write_admin" on public.payment_risk_events
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "abandoned_cart_reminders_owner_read" on public.abandoned_cart_reminders;
create policy "abandoned_cart_reminders_owner_read" on public.abandoned_cart_reminders
for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "abandoned_cart_reminders_admin_write" on public.abandoned_cart_reminders;
create policy "abandoned_cart_reminders_admin_write" on public.abandoned_cart_reminders
for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.sync_product_active_with_stock()
returns trigger
language plpgsql
as $$
begin
  if NEW.stock <= 0 then
    NEW.active := false;
  elsif OLD.stock <= 0 and NEW.stock > 0 and NEW.active is null then
    NEW.active := true;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_products_sync_active_with_stock on public.products;
create trigger trg_products_sync_active_with_stock
before update of stock, active on public.products
for each row execute function public.sync_product_active_with_stock();

drop trigger if exists trg_inventory_reservations_updated_at on public.inventory_reservations;
create trigger trg_inventory_reservations_updated_at
before update on public.inventory_reservations
for each row execute procedure public.set_updated_at();

drop trigger if exists trg_abandoned_cart_reminders_updated_at on public.abandoned_cart_reminders;
create trigger trg_abandoned_cart_reminders_updated_at
before update on public.abandoned_cart_reminders
for each row execute procedure public.set_updated_at();
