create table if not exists public.social_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discount_amount integer not null default 500 check (discount_amount > 0),
  min_followers integer not null default 200 check (min_followers >= 0),
  min_views integer not null default 1000 check (min_views >= 0),
  min_days_live integer not null default 5 check (min_days_live >= 0),
  required_hashtags text[] not null default '{}'::text[],
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.social_campaigns(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'youtube')),
  video_url text not null,
  followers_count integer not null check (followers_count >= 0),
  views_snapshot integer not null default 0 check (views_snapshot >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  verified_at timestamptz,
  coupon_code text,
  coupon_generated boolean not null default false,
  coupon_expires_at timestamptz,
  coupon_discount_amount integer,
  coupon_min_order_amount integer not null default 1000,
  coupon_excluded_product_ids uuid[] not null default '{}'::uuid[],
  coupon_usage_limit integer not null default 1,
  coupon_used_count integer not null default 0
);

create unique index if not exists idx_social_submissions_video_url_unique
  on public.social_submissions ((lower(trim(video_url))));

create index if not exists idx_social_submissions_user_submitted_at
  on public.social_submissions (user_id, submitted_at desc);

create index if not exists idx_social_submissions_status_submitted_at
  on public.social_submissions (status, submitted_at desc);

create unique index if not exists idx_social_submissions_coupon_code_unique
  on public.social_submissions (coupon_code)
  where coupon_code is not null;

create unique index if not exists idx_social_campaigns_single_active
  on public.social_campaigns ((is_active))
  where is_active = true;

alter table public.social_campaigns enable row level security;
alter table public.social_submissions enable row level security;

drop policy if exists "social_campaigns_public_read_active" on public.social_campaigns;
create policy "social_campaigns_public_read_active"
on public.social_campaigns
for select
using (
  is_active = true
  or public.has_admin_permission('can_manage_festival')
);

drop policy if exists "social_campaigns_admin_write" on public.social_campaigns;
create policy "social_campaigns_admin_write"
on public.social_campaigns
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

drop policy if exists "social_submissions_user_read_own" on public.social_submissions;
create policy "social_submissions_user_read_own"
on public.social_submissions
for select
using (
  auth.uid() = user_id
  or public.has_admin_permission('can_manage_orders')
  or public.has_admin_permission('can_manage_festival')
);

drop policy if exists "social_submissions_user_insert_own" on public.social_submissions;
create policy "social_submissions_user_insert_own"
on public.social_submissions
for insert
with check (auth.uid() = user_id);

drop policy if exists "social_submissions_admin_update" on public.social_submissions;
create policy "social_submissions_admin_update"
on public.social_submissions
for update
using (
  public.has_admin_permission('can_manage_orders')
  or public.has_admin_permission('can_manage_festival')
)
with check (
  public.has_admin_permission('can_manage_orders')
  or public.has_admin_permission('can_manage_festival')
);

create or replace function public.trg_social_campaigns_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_social_campaigns_updated_at on public.social_campaigns;
create trigger trg_social_campaigns_updated_at
before update on public.social_campaigns
for each row execute function public.trg_social_campaigns_set_updated_at();

insert into public.social_campaigns (
  name,
  discount_amount,
  min_followers,
  min_views,
  min_days_live,
  required_hashtags,
  is_active
)
select
  'Royal Creator Boost',
  500,
  200,
  1000,
  5,
  array['#ZARELON', '#RoyalCreatorBoost'],
  true
where not exists (select 1 from public.social_campaigns);
