alter table if exists public.drops
  add column if not exists stock_limit integer not null default 0,
  add column if not exists early_access_tier_required text,
  add column if not exists drop_priority integer not null default 0,
  add column if not exists countdown_enabled boolean not null default true,
  add column if not exists exclusive_private_drop boolean not null default false;

create table if not exists public.drop_products (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.drops(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  stock_remaining integer not null default 0 check (stock_remaining >= 0),
  sold_count integer not null default 0 check (sold_count >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'sold_out')),
  price_at_drop integer,
  exclusive_badge text,
  created_at timestamptz not null default now(),
  unique(drop_id, product_id)
);

create table if not exists public.drop_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  drop_id uuid not null references public.drops(id) on delete cascade,
  access_granted boolean not null default false,
  access_mode text not null default 'tier' check (access_mode in ('vip', 'tier', 'invite_code')),
  generated_token text,
  token_expires_at timestamptz,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  unique(user_id, drop_id)
);

create table if not exists public.user_behavior (
  user_id uuid primary key references public.users(id) on delete cascade,
  most_viewed_category text,
  most_viewed_product_ids uuid[] not null default '{}'::uuid[],
  recent_searches text[] not null default '{}'::text[],
  last_visit_at timestamptz,
  viewed_sections text[] not null default '{}'::text[],
  purchase_history_ids uuid[] not null default '{}'::uuid[],
  engagement_score integer not null default 0,
  predicted_interest text
);

create table if not exists public.ai_homepage_templates (
  id uuid primary key default gen_random_uuid(),
  layout_name text not null,
  section_configuration_json jsonb not null default '{}'::jsonb,
  predicted_performance_score numeric(8,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_homepage_variant (
  user_id uuid primary key references public.users(id) on delete cascade,
  variant_id uuid not null references public.ai_homepage_templates(id) on delete cascade,
  last_served_at timestamptz not null default now(),
  interaction_score integer not null default 0,
  performance_metrics jsonb not null default '{}'::jsonb
);

create table if not exists public.secret_launch_access (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  drop_id uuid not null references public.drops(id) on delete cascade,
  assigned_user_id uuid references public.users(id) on delete set null,
  usage_count integer not null default 0,
  max_usage integer not null default 1,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tier_checkout_benefits (
  tier_id uuid primary key references public.elite_tiers(id) on delete cascade,
  fast_checkout_enabled boolean not null default false,
  preferred_shipping_enabled boolean not null default false,
  free_gift_threshold integer,
  stepper_animation_style text not null default 'standard'
);

create index if not exists idx_drop_products_drop_status on public.drop_products(drop_id, status);
create index if not exists idx_drop_access_requests_drop_requested on public.drop_access_requests(drop_id, requested_at desc);
create index if not exists idx_drop_access_requests_user_drop on public.drop_access_requests(user_id, drop_id);
create index if not exists idx_user_behavior_last_visit on public.user_behavior(last_visit_at desc);
create index if not exists idx_ai_homepage_templates_score on public.ai_homepage_templates(predicted_performance_score desc);
create index if not exists idx_secret_launch_access_drop_active on public.secret_launch_access(drop_id, is_active);

alter table public.drop_products enable row level security;
alter table public.drop_access_requests enable row level security;
alter table public.user_behavior enable row level security;
alter table public.ai_homepage_templates enable row level security;
alter table public.user_homepage_variant enable row level security;
alter table public.secret_launch_access enable row level security;
alter table public.tier_checkout_benefits enable row level security;

drop policy if exists "drop_products_public_read" on public.drop_products;
create policy "drop_products_public_read"
on public.drop_products
for select
using (true);

drop policy if exists "drop_products_admin_write" on public.drop_products;
create policy "drop_products_admin_write"
on public.drop_products
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "drop_access_requests_owner_read" on public.drop_access_requests;
create policy "drop_access_requests_owner_read"
on public.drop_access_requests
for select
using (auth.uid() = user_id or public.has_admin_permission('can_manage_orders'));

drop policy if exists "drop_access_requests_owner_insert" on public.drop_access_requests;
create policy "drop_access_requests_owner_insert"
on public.drop_access_requests
for insert
with check (auth.uid() = user_id);

drop policy if exists "drop_access_requests_admin_write" on public.drop_access_requests;
create policy "drop_access_requests_admin_write"
on public.drop_access_requests
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "user_behavior_owner_rw" on public.user_behavior;
create policy "user_behavior_owner_rw"
on public.user_behavior
for all
using (auth.uid() = user_id or public.has_admin_permission('can_manage_orders'))
with check (auth.uid() = user_id or public.has_admin_permission('can_manage_orders'));

drop policy if exists "ai_homepage_templates_public_read" on public.ai_homepage_templates;
create policy "ai_homepage_templates_public_read"
on public.ai_homepage_templates
for select
using (true);

drop policy if exists "ai_homepage_templates_admin_write" on public.ai_homepage_templates;
create policy "ai_homepage_templates_admin_write"
on public.ai_homepage_templates
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

drop policy if exists "user_homepage_variant_owner_rw" on public.user_homepage_variant;
create policy "user_homepage_variant_owner_rw"
on public.user_homepage_variant
for all
using (auth.uid() = user_id or public.has_admin_permission('can_manage_orders'))
with check (auth.uid() = user_id or public.has_admin_permission('can_manage_orders'));

drop policy if exists "secret_launch_access_admin_rw" on public.secret_launch_access;
create policy "secret_launch_access_admin_rw"
on public.secret_launch_access
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "tier_checkout_benefits_public_read" on public.tier_checkout_benefits;
create policy "tier_checkout_benefits_public_read"
on public.tier_checkout_benefits
for select
using (true);

drop policy if exists "tier_checkout_benefits_admin_write" on public.tier_checkout_benefits;
create policy "tier_checkout_benefits_admin_write"
on public.tier_checkout_benefits
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop trigger if exists trg_ai_homepage_templates_updated_at on public.ai_homepage_templates;
create trigger trg_ai_homepage_templates_updated_at
before update on public.ai_homepage_templates
for each row execute function public.set_updated_at();

insert into public.ai_homepage_templates (layout_name, section_configuration_json, predicted_performance_score)
select 'Nike Sport Core', '{"focus_categories":["shoes","sportswear","running"],"cta":"Shop Men"}'::jsonb, 84.5
where not exists (select 1 from public.ai_homepage_templates where layout_name = 'Nike Sport Core');

insert into public.ai_homepage_templates (layout_name, section_configuration_json, predicted_performance_score)
select 'Watch Authority', '{"focus_categories":["watches","premium","collections"],"cta":"Explore Watches"}'::jsonb, 89.2
where not exists (select 1 from public.ai_homepage_templates where layout_name = 'Watch Authority');

insert into public.ai_homepage_templates (layout_name, section_configuration_json, predicted_performance_score)
select 'Festival Urgency', '{"focus_categories":["festival","limited","drop"],"cta":"Claim Drop"}'::jsonb, 86.8
where not exists (select 1 from public.ai_homepage_templates where layout_name = 'Festival Urgency');
