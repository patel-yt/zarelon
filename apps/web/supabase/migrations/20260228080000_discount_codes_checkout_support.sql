-- Checkout discount code support (admin-manageable)

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text,
  discount_type text not null default 'percentage',
  discount_value integer not null,
  min_order_inr integer not null default 0,
  max_discount_inr integer,
  total_usage_limit integer,
  per_user_limit integer not null default 1,
  used_count integer not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_codes_type_check check (discount_type in ('percentage', 'fixed')),
  constraint discount_codes_value_check check (discount_value > 0),
  constraint discount_codes_min_order_check check (min_order_inr >= 0),
  constraint discount_codes_max_discount_check check (max_discount_inr is null or max_discount_inr > 0),
  constraint discount_codes_total_usage_check check (total_usage_limit is null or total_usage_limit > 0),
  constraint discount_codes_per_user_check check (per_user_limit > 0),
  constraint discount_codes_date_window_check check (starts_at is null or expires_at is null or starts_at <= expires_at)
);

create index if not exists idx_discount_codes_active on public.discount_codes(active);
create index if not exists idx_discount_codes_expires_at on public.discount_codes(expires_at);
create index if not exists idx_discount_codes_code_lower on public.discount_codes((lower(code)));

create table if not exists public.discount_code_usages (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  code_snapshot text not null,
  discount_amount_inr integer not null default 0,
  created_at timestamptz not null default now(),
  constraint discount_code_usages_discount_amount_check check (discount_amount_inr >= 0)
);

create index if not exists idx_discount_code_usages_code_user on public.discount_code_usages(discount_code_id, user_id);
create unique index if not exists idx_discount_code_usages_order_unique
  on public.discount_code_usages(order_id)
  where order_id is not null;
