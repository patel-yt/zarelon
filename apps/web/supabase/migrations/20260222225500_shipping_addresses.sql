create table if not exists public.shipping_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  label text,
  full_name text not null,
  phone text not null,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  postal_code text not null,
  country text not null default 'India',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipping_addresses_user_idx on public.shipping_addresses(user_id);
create unique index if not exists shipping_addresses_default_unique
  on public.shipping_addresses(user_id)
  where is_default = true;

alter table public.shipping_addresses enable row level security;

drop policy if exists "shipping_addresses_owner_select" on public.shipping_addresses;
create policy "shipping_addresses_owner_select" on public.shipping_addresses
for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "shipping_addresses_owner_write" on public.shipping_addresses;
create policy "shipping_addresses_owner_write" on public.shipping_addresses
for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_shipping_addresses_updated_at on public.shipping_addresses;
create trigger trg_shipping_addresses_updated_at
before update on public.shipping_addresses
for each row execute procedure public.set_updated_at();
