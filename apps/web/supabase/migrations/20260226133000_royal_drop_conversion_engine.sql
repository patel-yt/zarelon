create table if not exists public.cart_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(user_id, product_id)
);

create index if not exists idx_cart_reservations_user_expires
  on public.cart_reservations(user_id, expires_at asc);

alter table public.cart_reservations enable row level security;

drop policy if exists "cart_reservations_owner_read" on public.cart_reservations;
create policy "cart_reservations_owner_read"
on public.cart_reservations
for select
using (auth.uid() = user_id);

drop policy if exists "cart_reservations_owner_write" on public.cart_reservations;
create policy "cart_reservations_owner_write"
on public.cart_reservations
for insert
with check (auth.uid() = user_id);

drop policy if exists "cart_reservations_owner_delete" on public.cart_reservations;
create policy "cart_reservations_owner_delete"
on public.cart_reservations
for delete
using (auth.uid() = user_id);

drop policy if exists "cart_reservations_admin_write" on public.cart_reservations;
create policy "cart_reservations_admin_write"
on public.cart_reservations
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

create or replace function public.upsert_cart_reservation(
  p_user_id uuid,
  p_product_id uuid,
  p_minutes integer default 10
)
returns timestamptz
language plpgsql
security definer
as $$
declare
  new_expires_at timestamptz;
begin
  if p_user_id is null or p_product_id is null then
    raise exception 'user_id and product_id are required';
  end if;

  new_expires_at := now() + make_interval(mins => greatest(1, coalesce(p_minutes, 10)));

  insert into public.cart_reservations (user_id, product_id, expires_at)
  values (p_user_id, p_product_id, new_expires_at)
  on conflict (user_id, product_id)
  do update set expires_at = excluded.expires_at;

  return new_expires_at;
end;
$$;

grant execute on function public.upsert_cart_reservation(uuid, uuid, integer) to authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_access_tier') then
    create type public.user_access_tier as enum ('normal', 'vip', 'elite');
  end if;
end $$;

alter table public.users
  add column if not exists access_tier public.user_access_tier not null default 'normal';

create table if not exists public.drop_flash_price_schedule (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.drops(id) on delete cascade,
  starts_at timestamptz not null,
  extra_discount_percent numeric(5,2) not null check (extra_discount_percent >= 0 and extra_discount_percent <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_drop_flash_schedule_drop_time
  on public.drop_flash_price_schedule(drop_id, starts_at asc);

alter table public.drop_flash_price_schedule enable row level security;

drop policy if exists "drop_flash_public_read" on public.drop_flash_price_schedule;
create policy "drop_flash_public_read"
on public.drop_flash_price_schedule
for select
using (is_active = true);

drop policy if exists "drop_flash_admin_write" on public.drop_flash_price_schedule;
create policy "drop_flash_admin_write"
on public.drop_flash_price_schedule
for all
using (public.has_admin_permission('can_manage_products'))
with check (public.has_admin_permission('can_manage_products'));

create table if not exists public.experience_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references public.users(id) on delete set null,
  event_type text not null,
  target_type text null,
  target_id text null,
  path text null,
  scroll_depth integer null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_experience_events_created on public.experience_events(created_at desc);
create index if not exists idx_experience_events_event on public.experience_events(event_type, created_at desc);
create index if not exists idx_experience_events_target on public.experience_events(target_type, target_id, created_at desc);

alter table public.experience_events enable row level security;

drop policy if exists "experience_events_insert_any" on public.experience_events;
create policy "experience_events_insert_any"
on public.experience_events
for insert
to anon, authenticated
with check (true);

drop policy if exists "experience_events_admin_read" on public.experience_events;
create policy "experience_events_admin_read"
on public.experience_events
for select
using (public.has_admin_permission('can_view_analytics'));

create or replace function public.auto_deactivate_expired_drops()
returns void
language plpgsql
security definer
as $$
begin
  update public.drops
  set is_active = false,
      updated_at = now()
  where is_active = true
    and end_time < now();
end;
$$;

grant execute on function public.auto_deactivate_expired_drops() to anon, authenticated;
