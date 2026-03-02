-- Dynamic homepage CMS
create table if not exists public.home_pages (
  id uuid primary key default gen_random_uuid(),
  layout_type text not null default 'nike' check (layout_type in ('nike','polo','rolex')),
  is_active boolean not null default false,
  smart_layout_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_home_pages_single_active
  on public.home_pages((is_active)) where is_active = true;

create table if not exists public.home_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.home_pages(id) on delete cascade,
  section_key text not null,
  section_type text not null check (section_type in ('hero','featured','category','product_grid','custom_block')),
  display_order integer not null default 0,
  is_visible boolean not null default true,
  config_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(page_id, section_key)
);

create index if not exists idx_home_sections_page_order on public.home_sections(page_id, display_order asc);

alter table public.home_pages enable row level security;
alter table public.home_sections enable row level security;

drop policy if exists "home_pages_public_read_active" on public.home_pages;
create policy "home_pages_public_read_active"
on public.home_pages
for select
using (is_active = true);

drop policy if exists "home_pages_admin_write" on public.home_pages;
create policy "home_pages_admin_write"
on public.home_pages
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

drop policy if exists "home_sections_public_read" on public.home_sections;
create policy "home_sections_public_read"
on public.home_sections
for select
using (
  exists (
    select 1 from public.home_pages p
    where p.id = home_sections.page_id
      and p.is_active = true
  )
);

drop policy if exists "home_sections_admin_write" on public.home_sections;
create policy "home_sections_admin_write"
on public.home_sections
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

-- Festival master expansion
alter table public.festivals
  add column if not exists theme_type text,
  add column if not exists primary_color text,
  add column if not exists secondary_color text,
  add column if not exists festival_tagline text,
  add column if not exists festival_discount_text text,
  add column if not exists countdown_enabled boolean not null default true,
  add column if not exists early_access_enabled boolean not null default false,
  add column if not exists ticker_messages text[] not null default '{}'::text[];

-- Drop-festival linking (compatible with existing drops table)
alter table public.drops
  add column if not exists festival_id uuid references public.festivals(id) on delete set null,
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists stock_limit integer,
  add column if not exists drop_start timestamptz,
  add column if not exists drop_end timestamptz,
  add column if not exists early_access_hours integer not null default 0;

-- VIP level expansion
alter table public.users
  add column if not exists vip_level text not null default 'normal' check (vip_level in ('normal','vip','elite')),
  add column if not exists most_viewed_category text,
  add column if not exists most_clicked_banner text,
  add column if not exists recent_visits jsonb not null default '[]'::jsonb;

-- Private collection control
alter table public.products
  add column if not exists required_vip_level text not null default 'normal' check (required_vip_level in ('normal','vip','elite'));

-- Currency + region override
create table if not exists public.currencies (
  code text primary key,
  symbol text not null,
  exchange_rate numeric(12,6) not null default 1,
  country text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.festival_region_overrides (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references public.festivals(id) on delete cascade,
  region_code text not null,
  region_discount numeric(5,2) not null default 0,
  theme_override jsonb not null default '{}'::jsonb,
  unique(festival_id, region_code)
);

alter table public.currencies enable row level security;
alter table public.festival_region_overrides enable row level security;

drop policy if exists "currencies_public_read" on public.currencies;
create policy "currencies_public_read"
on public.currencies
for select
using (is_active = true);

drop policy if exists "currencies_admin_write" on public.currencies;
create policy "currencies_admin_write"
on public.currencies
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

drop policy if exists "festival_region_overrides_public_read" on public.festival_region_overrides;
create policy "festival_region_overrides_public_read"
on public.festival_region_overrides
for select
using (true);

drop policy if exists "festival_region_overrides_admin_write" on public.festival_region_overrides;
create policy "festival_region_overrides_admin_write"
on public.festival_region_overrides
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

-- updated_at trigger utility
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_home_pages_updated_at on public.home_pages;
create trigger trg_home_pages_updated_at
before update on public.home_pages
for each row execute function public.set_updated_at();

drop trigger if exists trg_home_sections_updated_at on public.home_sections;
create trigger trg_home_sections_updated_at
before update on public.home_sections
for each row execute function public.set_updated_at();

drop trigger if exists trg_currencies_updated_at on public.currencies;
create trigger trg_currencies_updated_at
before update on public.currencies
for each row execute function public.set_updated_at();

-- Auto activate/deactivate festivals by date window
create or replace function public.sync_festival_activity()
returns void
language plpgsql
security definer
as $$
begin
  update public.festivals
  set active = (now() between start_date and end_date);
end;
$$;

grant execute on function public.sync_festival_activity() to anon, authenticated;

insert into public.currencies (code, symbol, exchange_rate, country, is_active)
values
  ('INR', 'Rs', 1, 'IN', true),
  ('USD', '$', 0.012, 'US', true),
  ('EUR', '€', 0.011, 'EU', true)
on conflict (code) do update set
  symbol = excluded.symbol,
  exchange_rate = excluded.exchange_rate,
  country = excluded.country,
  is_active = excluded.is_active;
