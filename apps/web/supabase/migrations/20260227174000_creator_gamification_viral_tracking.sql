create table if not exists public.creator_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  min_approved_submissions integer not null default 0 check (min_approved_submissions >= 0),
  min_total_views integer not null default 0 check (min_total_views >= 0),
  badge_color text,
  reward_bonus integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.users
  add column if not exists creator_tier_id uuid references public.creator_tiers(id) on delete set null,
  add column if not exists total_creator_views integer not null default 0,
  add column if not exists total_approved_submissions integer not null default 0;

create table if not exists public.monthly_contests (
  id uuid primary key default gen_random_uuid(),
  month integer not null check (month between 1 and 12),
  year integer not null check (year between 2000 and 2200),
  prize_description text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(month, year)
);

create table if not exists public.creator_referrals (
  creator_id uuid primary key references public.users(id) on delete cascade,
  creator_code text not null,
  click_count integer not null default 0,
  purchase_count integer not null default 0,
  revenue_generated numeric(12,2) not null default 0,
  bonus_reward_total integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.creator_referral_events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users(id) on delete cascade,
  referral_code text not null,
  event_type text not null check (event_type in ('click','purchase')),
  user_id uuid references public.users(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  order_amount numeric(12,2),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_creator_referral_purchase_order_unique
  on public.creator_referral_events (creator_id, order_id)
  where event_type = 'purchase' and order_id is not null;

create index if not exists idx_creator_referral_click_ip_window
  on public.creator_referral_events (creator_id, ip_address, created_at desc)
  where event_type = 'click';

create index if not exists idx_creator_referrals_updated_at
  on public.creator_referrals (updated_at desc);

alter table public.creator_tiers enable row level security;
alter table public.monthly_contests enable row level security;
alter table public.creator_referrals enable row level security;
alter table public.creator_referral_events enable row level security;

drop policy if exists "creator_tiers_public_read" on public.creator_tiers;
create policy "creator_tiers_public_read"
on public.creator_tiers
for select
using (is_active = true or public.has_admin_permission('can_manage_orders'));

drop policy if exists "creator_tiers_admin_write" on public.creator_tiers;
create policy "creator_tiers_admin_write"
on public.creator_tiers
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "monthly_contests_public_read" on public.monthly_contests;
create policy "monthly_contests_public_read"
on public.monthly_contests
for select
using (is_active = true or public.has_admin_permission('can_manage_orders'));

drop policy if exists "monthly_contests_admin_write" on public.monthly_contests;
create policy "monthly_contests_admin_write"
on public.monthly_contests
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "creator_referrals_owner_or_admin_read" on public.creator_referrals;
create policy "creator_referrals_owner_or_admin_read"
on public.creator_referrals
for select
using (auth.uid() = creator_id or public.has_admin_permission('can_manage_orders'));

drop policy if exists "creator_referrals_admin_write" on public.creator_referrals;
create policy "creator_referrals_admin_write"
on public.creator_referrals
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "creator_referral_events_owner_or_admin_read" on public.creator_referral_events;
create policy "creator_referral_events_owner_or_admin_read"
on public.creator_referral_events
for select
using (
  auth.uid() = creator_id
  or auth.uid() = user_id
  or public.has_admin_permission('can_manage_orders')
);

drop policy if exists "creator_referral_events_admin_write" on public.creator_referral_events;
create policy "creator_referral_events_admin_write"
on public.creator_referral_events
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

insert into public.creator_tiers (name, min_approved_submissions, min_total_views, badge_color, reward_bonus, is_active)
values
  ('Bronze', 1, 1000, '#CD7F32', null, true),
  ('Silver', 3, 5000, '#C0C0C0', 50, true),
  ('Gold', 7, 25000, '#D4AF37', 100, true),
  ('Royal Elite', 15, 100000, '#7C3AED', 250, true)
on conflict (name) do update
set min_approved_submissions = excluded.min_approved_submissions,
    min_total_views = excluded.min_total_views,
    badge_color = excluded.badge_color,
    reward_bonus = excluded.reward_bonus,
    is_active = excluded.is_active;

insert into public.monthly_contests (month, year, prize_description, is_active)
select extract(month from now())::int, extract(year from now())::int, 'Top 3 creators win bonus vouchers and homepage spotlight.', true
where not exists (
  select 1 from public.monthly_contests
  where month = extract(month from now())::int
    and year = extract(year from now())::int
);
