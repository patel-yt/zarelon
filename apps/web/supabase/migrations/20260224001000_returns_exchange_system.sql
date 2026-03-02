alter table if exists public.products
  add column if not exists return_allowed boolean not null default true,
  add column if not exists exchange_allowed boolean not null default true,
  add column if not exists return_window_days integer not null default 7;

create table if not exists public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  exchange_variant_id uuid references public.product_variants(id) on delete set null,
  type text not null check (type in ('RETURN', 'EXCHANGE')),
  reason text not null,
  description text,
  photos text[] not null default '{}',
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
  admin_note text,
  admin_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_return_requests_user_id on public.return_requests(user_id);
create index if not exists idx_return_requests_order_id on public.return_requests(order_id);
create index if not exists idx_return_requests_status on public.return_requests(status);

create unique index if not exists uq_return_requests_open_unique
  on public.return_requests(order_id, product_id, user_id, type)
  where status in ('PENDING', 'APPROVED');

alter table public.return_requests enable row level security;

drop policy if exists "return_requests_owner_read" on public.return_requests;
create policy "return_requests_owner_read"
on public.return_requests
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "return_requests_owner_insert" on public.return_requests;
create policy "return_requests_owner_insert"
on public.return_requests
for insert
with check (user_id = auth.uid());

drop policy if exists "return_requests_owner_update" on public.return_requests;
create policy "return_requests_owner_update"
on public.return_requests
for update
using (user_id = auth.uid() and status = 'PENDING')
with check (user_id = auth.uid() and status = 'PENDING');

drop policy if exists "return_requests_admin_update" on public.return_requests;
create policy "return_requests_admin_update"
on public.return_requests
for update
using (public.is_admin())
with check (public.is_admin());

drop trigger if exists trg_return_requests_updated_at on public.return_requests;
create trigger trg_return_requests_updated_at
before update on public.return_requests
for each row execute procedure public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('return-requests', 'return-requests', true)
on conflict (id) do nothing;

drop policy if exists "Public read return-requests" on storage.objects;
create policy "Public read return-requests"
on storage.objects for select
using (bucket_id = 'return-requests');

drop policy if exists "Authenticated upload return-requests" on storage.objects;
create policy "Authenticated upload return-requests"
on storage.objects for insert
with check (bucket_id = 'return-requests' and auth.role() = 'authenticated');

drop policy if exists "Owner delete return-requests" on storage.objects;
create policy "Owner delete return-requests"
on storage.objects for delete
using (
  bucket_id = 'return-requests'
  and (
    owner = auth.uid()
    or exists (
      select 1 from public.users u
      where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
    )
  )
);
