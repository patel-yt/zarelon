alter table if exists public.platform_settings
  add column if not exists ambassador_program_enabled boolean not null default true,
  add column if not exists paid_ambassador_enabled boolean not null default false,
  add column if not exists referral_program_enabled boolean not null default true,
  add column if not exists royal_access_price_inr integer not null default 2999,
  add column if not exists referral_min_order_value integer not null default 1000;

update public.platform_settings
set
  ambassador_program_enabled = coalesce(ambassador_program_enabled, true),
  paid_ambassador_enabled = coalesce(paid_ambassador_enabled, false),
  referral_program_enabled = coalesce(referral_program_enabled, true),
  royal_access_price_inr = greatest(1, coalesce(royal_access_price_inr, 2999)),
  referral_min_order_value = greatest(1, coalesce(referral_min_order_value, 1000))
where true;

create table if not exists public.elite_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  required_valid_referrals integer not null check (required_valid_referrals >= 0),
  badge_style jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elite_progress (
  user_id uuid primary key references public.users(id) on delete cascade,
  valid_referral_count integer not null default 0 check (valid_referral_count >= 0),
  current_tier_id uuid references public.elite_tiers(id) on delete set null,
  highest_tier_id uuid references public.elite_tiers(id) on delete set null,
  royal_crown_unlocked boolean not null default false,
  unlocked_at timestamptz,
  tier_locked boolean not null default false,
  permanent_royal_crown boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.royal_access_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  amount_paid integer not null check (amount_paid >= 1),
  payment_ref text,
  is_active boolean not null default true,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_royal_access_user_active
  on public.royal_access_passes(user_id, is_active, expires_at);

alter table public.elite_tiers enable row level security;
alter table public.elite_progress enable row level security;
alter table public.royal_access_passes enable row level security;

drop policy if exists "elite_tiers_public_read" on public.elite_tiers;
create policy "elite_tiers_public_read"
on public.elite_tiers
for select
using (is_active = true or public.has_admin_permission('can_manage_orders'));

drop policy if exists "elite_tiers_admin_write" on public.elite_tiers;
create policy "elite_tiers_admin_write"
on public.elite_tiers
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "elite_progress_user_read_own" on public.elite_progress;
create policy "elite_progress_user_read_own"
on public.elite_progress
for select
using (auth.uid() = user_id or public.has_admin_permission('can_manage_orders'));

drop policy if exists "elite_progress_admin_write" on public.elite_progress;
create policy "elite_progress_admin_write"
on public.elite_progress
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "royal_access_user_read_own" on public.royal_access_passes;
create policy "royal_access_user_read_own"
on public.royal_access_passes
for select
using (auth.uid() = user_id or public.has_admin_permission('can_manage_orders'));

drop policy if exists "royal_access_admin_write" on public.royal_access_passes;
create policy "royal_access_admin_write"
on public.royal_access_passes
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_elite_tiers_updated_at on public.elite_tiers;
create trigger trg_elite_tiers_updated_at
before update on public.elite_tiers
for each row execute function public.touch_updated_at();

drop trigger if exists trg_elite_progress_updated_at on public.elite_progress;
create trigger trg_elite_progress_updated_at
before update on public.elite_progress
for each row execute function public.touch_updated_at();

create or replace function public.user_has_minimum_tier(required_tier_id uuid)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  required_count integer;
  current_count integer;
begin
  if required_tier_id is null then return true; end if;
  if auth.uid() is null then return false; end if;

  select required_valid_referrals
    into required_count
  from public.elite_tiers
  where id = required_tier_id;

  if required_count is null then
    return true;
  end if;

  select valid_referral_count
    into current_count
  from public.elite_progress
  where user_id = auth.uid();

  return coalesce(current_count, 0) >= required_count;
end;
$$;

create or replace function public.refresh_elite_progress_for_user(p_user_id uuid)
returns public.elite_progress
language plpgsql
security definer
as $$
declare
  min_value integer := 1000;
  valid_count integer := 0;
  matched_tier_id uuid;
  matched_required integer := 0;
  prev public.elite_progress;
  prev_required integer := 0;
  highest_tier uuid;
  highest_required integer := 0;
  matched_name text := '';
  out_row public.elite_progress;
begin
  select coalesce(min_purchase_amount, 1000)
    into min_value
  from public.referral_config
  where is_active = true
  order by updated_at desc
  limit 1;

  select count(*)
    into valid_count
  from public.referrals r
  where r.referrer_id = p_user_id
    and r.reward_given = true
    and coalesce(r.purchase_amount, min_value) >= min_value;

  select id, required_valid_referrals, name
    into matched_tier_id, matched_required, matched_name
  from public.elite_tiers
  where is_active = true
    and required_valid_referrals <= valid_count
  order by required_valid_referrals desc
  limit 1;

  select *
    into prev
  from public.elite_progress
  where user_id = p_user_id;

  if found and prev.current_tier_id is not null then
    select required_valid_referrals into prev_required
    from public.elite_tiers
    where id = prev.current_tier_id;
  end if;

  highest_tier := coalesce(prev.highest_tier_id, matched_tier_id);
  highest_required := greatest(coalesce(prev_required, 0), coalesce(matched_required, 0));
  if highest_required = coalesce(matched_required, 0) then
    highest_tier := matched_tier_id;
  end if;

  insert into public.elite_progress (
    user_id,
    valid_referral_count,
    current_tier_id,
    highest_tier_id,
    royal_crown_unlocked,
    unlocked_at,
    tier_locked,
    permanent_royal_crown
  )
  values (
    p_user_id,
    valid_count,
    matched_tier_id,
    highest_tier,
    (lower(coalesce(matched_name, '')) = 'royal crown'),
    case when lower(coalesce(matched_name, '')) = 'royal crown' then now() else null end,
    false,
    false
  )
  on conflict (user_id)
  do update set
    valid_referral_count = excluded.valid_referral_count,
    current_tier_id = case
      when public.elite_progress.tier_locked then public.elite_progress.current_tier_id
      when public.elite_progress.permanent_royal_crown then public.elite_progress.current_tier_id
      else excluded.current_tier_id
    end,
    highest_tier_id = case
      when coalesce((
        select t.required_valid_referrals from public.elite_tiers t where t.id = public.elite_progress.highest_tier_id
      ), 0) > coalesce((
        select t.required_valid_referrals from public.elite_tiers t where t.id = excluded.highest_tier_id
      ), 0) then public.elite_progress.highest_tier_id
      else excluded.highest_tier_id
    end,
    royal_crown_unlocked = public.elite_progress.royal_crown_unlocked
      or public.elite_progress.permanent_royal_crown
      or (lower(coalesce(matched_name, '')) = 'royal crown'),
    unlocked_at = case
      when public.elite_progress.unlocked_at is not null then public.elite_progress.unlocked_at
      when lower(coalesce(matched_name, '')) = 'royal crown' then now()
      else public.elite_progress.unlocked_at
    end;

  select *
    into out_row
  from public.elite_progress
  where user_id = p_user_id;

  return out_row;
end;
$$;

drop policy if exists "products_public_select" on public.products;
create policy "products_public_select"
on public.products
for select
using (
  (
    active = true
    and (
      minimum_required_tier_id is null
      or public.user_has_minimum_tier(minimum_required_tier_id)
    )
  )
  or public.is_admin()
);

insert into public.elite_tiers (name, required_valid_referrals, badge_style, is_active)
values
  ('Silver Circle', 50, '{"theme":"silver","accent":"#A6ACB8"}'::jsonb, true),
  ('Gold Society', 200, '{"theme":"gold","accent":"#C8A951"}'::jsonb, true),
  ('Platinum Council', 500, '{"theme":"platinum","accent":"#E5E4E2"}'::jsonb, true),
  ('Diamond Order', 800, '{"theme":"diamond","accent":"#B9F2FF"}'::jsonb, true),
  ('Royal Crown', 1000, '{"theme":"royal","accent":"#D4AF37","aura":"gold_ring"}'::jsonb, true)
on conflict (name) do update
set required_valid_referrals = excluded.required_valid_referrals,
    badge_style = excluded.badge_style,
    is_active = excluded.is_active;
