create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  carrier_name text not null,
  tracking_number text not null,
  awb_number text,
  carrier_status text,
  normalized_status text not null default 'placed' check (
    normalized_status in ('placed','packed','shipped','out_for_delivery','delivered','failed','rto')
  ),
  last_event_at timestamptz,
  eta timestamptz,
  tracking_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipment_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  event_time timestamptz not null default now(),
  raw_status text,
  normalized_status text not null check (
    normalized_status in ('placed','packed','shipped','out_for_delivery','delivered','failed','rto')
  ),
  location text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_shipment_events_shipment_id on public.shipment_events(shipment_id);
create index if not exists idx_shipments_order_id on public.shipments(order_id);

alter table public.shipments enable row level security;
alter table public.shipment_events enable row level security;

create policy "shipments_select_owner_or_admin"
on public.shipments
for select
using (
  public.is_admin()
  or exists (
    select 1 from public.orders o
    where o.id = shipments.order_id
      and o.user_id = auth.uid()
  )
);

create policy "shipments_admin_write"
on public.shipments
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

create policy "shipment_events_select_owner_or_admin"
on public.shipment_events
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.shipments s
    join public.orders o on o.id = s.order_id
    where s.id = shipment_events.shipment_id
      and o.user_id = auth.uid()
  )
);

create policy "shipment_events_admin_write"
on public.shipment_events
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop trigger if exists trg_shipments_updated_at on public.shipments;
create trigger trg_shipments_updated_at
before update on public.shipments
for each row execute procedure public.set_updated_at();
