alter table if exists public.return_requests
  add column if not exists pickup_status text not null default 'none',
  add column if not exists pickup_awb text,
  add column if not exists pickup_tracking_number text,
  add column if not exists pickup_tracking_url text,
  add column if not exists refund_id text,
  add column if not exists refund_status text not null default 'none',
  add column if not exists refund_amount_inr integer,
  add column if not exists refunded_at timestamptz;

alter table if exists public.return_requests
  drop constraint if exists return_requests_status_check;

alter table if exists public.return_requests
  add constraint return_requests_status_check
  check (
    status in (
      'PENDING',
      'APPROVED',
      'PICKUP_SCHEDULED',
      'PICKED_UP',
      'DELIVERED_TO_ORIGIN',
      'REFUND_PENDING',
      'REFUND_COMPLETED',
      'REFUND_FAILED',
      'REJECTED',
      'COMPLETED'
    )
  );

alter table if exists public.return_requests
  drop constraint if exists return_requests_pickup_status_check;

alter table if exists public.return_requests
  add constraint return_requests_pickup_status_check
  check (pickup_status in ('none', 'scheduled', 'picked_up', 'delivered_to_origin', 'failed'));

alter table if exists public.return_requests
  drop constraint if exists return_requests_refund_status_check;

alter table if exists public.return_requests
  add constraint return_requests_refund_status_check
  check (refund_status in ('none', 'pending', 'processed', 'failed'));

create table if not exists public.return_events (
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid not null references public.return_requests(id) on delete cascade,
  event_type text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_return_events_request_id on public.return_events(return_request_id);
create index if not exists idx_return_events_created_at on public.return_events(created_at desc);

alter table public.return_events enable row level security;

drop policy if exists "return_events_owner_read" on public.return_events;
create policy "return_events_owner_read" on public.return_events
for select using (
  exists (
    select 1
    from public.return_requests rr
    where rr.id = return_request_id
      and (rr.user_id = auth.uid() or public.is_admin())
  )
);

drop policy if exists "return_events_admin_write" on public.return_events;
create policy "return_events_admin_write" on public.return_events
for all using (public.is_admin())
with check (public.is_admin());
