alter table if exists public.return_requests
  add column if not exists payout_method text,
  add column if not exists payout_snapshot jsonb,
  add column if not exists pickup_address_id uuid references public.shipping_addresses(id) on delete set null,
  add column if not exists pickup_address_snapshot jsonb,
  add column if not exists customer_confirmation boolean not null default false,
  add column if not exists confirmed_at timestamptz;

alter table if exists public.return_requests
  drop constraint if exists return_requests_payout_method_check;

alter table if exists public.return_requests
  add constraint return_requests_payout_method_check
  check (payout_method is null or payout_method in ('bank', 'upi'));

create index if not exists idx_return_requests_pickup_address_id
  on public.return_requests(pickup_address_id);
