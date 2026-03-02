alter table public.drops
  add column if not exists description text;

create table if not exists public.drop_waitlist (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.drops(id) on delete cascade,
  user_id uuid null references public.users(id) on delete set null,
  email text not null,
  notified_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(drop_id, email)
);

create table if not exists public.drop_events (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.drops(id) on delete cascade,
  user_id uuid null references public.users(id) on delete set null,
  event_type text not null check (event_type in ('view', 'add_to_cart', 'waitlist_join', 'purchase')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_drop_events_drop_created on public.drop_events(drop_id, created_at desc);
create index if not exists idx_drop_events_type on public.drop_events(event_type, created_at desc);

alter table public.drop_waitlist enable row level security;
alter table public.drop_events enable row level security;

drop policy if exists "drop_waitlist_owner_read" on public.drop_waitlist;
create policy "drop_waitlist_owner_read"
on public.drop_waitlist
for select
using (public.is_admin() or auth.uid() = user_id);

drop policy if exists "drop_waitlist_insert_any" on public.drop_waitlist;
create policy "drop_waitlist_insert_any"
on public.drop_waitlist
for insert
with check (true);

drop policy if exists "drop_waitlist_admin_write" on public.drop_waitlist;
create policy "drop_waitlist_admin_write"
on public.drop_waitlist
for all
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "drop_events_public_insert" on public.drop_events;
create policy "drop_events_public_insert"
on public.drop_events
for insert
with check (true);

drop policy if exists "drop_events_admin_read" on public.drop_events;
create policy "drop_events_admin_read"
on public.drop_events
for select
using (public.is_admin());

create or replace function public.get_drop_sold_quantity(p_drop_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  sold_qty integer;
begin
  select coalesce(sum(oi.quantity), 0)
    into sold_qty
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where p.drop_id = p_drop_id
    and o.status in ('confirmed', 'shipped', 'delivered');

  return coalesce(sold_qty, 0);
end;
$$;

grant execute on function public.get_drop_sold_quantity(uuid) to anon, authenticated;

create or replace function public.claim_drop_stock(p_drop_id uuid, p_quantity integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_stock integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    return false;
  end if;

  select available_stock into current_stock from public.drops where id = p_drop_id for update;
  if current_stock is null then
    return false;
  end if;
  if current_stock < p_quantity then
    return false;
  end if;

  update public.drops
  set available_stock = greatest(0, available_stock - p_quantity),
      updated_at = now()
  where id = p_drop_id;

  return true;
end;
$$;

grant execute on function public.claim_drop_stock(uuid, integer) to authenticated;

create or replace function public.release_drop_stock(p_drop_id uuid, p_quantity integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity is null or p_quantity <= 0 then
    return false;
  end if;

  update public.drops
  set available_stock = least(total_stock, available_stock + p_quantity),
      updated_at = now()
  where id = p_drop_id;

  return found;
end;
$$;

grant execute on function public.release_drop_stock(uuid, integer) to authenticated;
