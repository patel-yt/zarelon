-- Royal system unification: role-based Super Royal, feature flags, and content controls

alter table if exists public.users
  add column if not exists role text default 'user',
  add column if not exists royal_crown_unlocked boolean not null default false,
  add column if not exists royal_access_active boolean not null default false,
  add column if not exists royal_access_expires_at timestamptz;

alter table if exists public.users
  drop constraint if exists users_role_check;

alter table if exists public.users
  add constraint users_role_check
  check (role in ('user', 'admin', 'super_admin'));

alter table if exists public.elite_tiers
  add column if not exists early_access_hours integer not null default 0,
  add column if not exists vault_access boolean not null default false,
  add column if not exists leaderboard_access boolean not null default false;

alter table if exists public.platform_settings
  add column if not exists ambassador_program_enabled boolean not null default true,
  add column if not exists paid_ambassador_enabled boolean not null default false,
  add column if not exists referral_program_enabled boolean not null default true,
  add column if not exists royal_access_price_inr integer not null default 399;

update public.platform_settings
set
  ambassador_program_enabled = coalesce(ambassador_program_enabled, true),
  paid_ambassador_enabled = coalesce(paid_ambassador_enabled, false),
  referral_program_enabled = coalesce(referral_program_enabled, true),
  royal_access_price_inr = greatest(1, coalesce(royal_access_price_inr, 399))
where true;

create table if not exists public.feature_flags (
  feature_key text primary key,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.feature_flags (feature_key, is_enabled)
values
  ('ambassador_program_enabled', true),
  ('royal_crown_enabled', true),
  ('royal_access_enabled', true),
  ('creator_program_enabled', true),
  ('leaderboard_enabled', true),
  ('vault_enabled', true),
  ('early_drop_enabled', true),
  ('priority_checkout_enabled', true)
on conflict (feature_key) do update
set is_enabled = excluded.is_enabled,
    updated_at = now();

create table if not exists public.content_blocks (
  key text primary key,
  title text,
  description text,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.content_blocks (key, title, description, is_enabled)
values
  ('royal_landing_hero', 'Royal Landing Hero', 'Hero block for royal landing page.', true),
  ('royal_benefits_section', 'Royal Benefits', 'Benefits and perks section.', true),
  ('royal_leaderboard_section', 'Royal Leaderboard', 'Leaderboard section on royal landing.', true),
  ('royal_progress_section', 'Royal Progress', 'Progress section for referral status.', true)
on conflict (key) do update
set title = excluded.title,
    description = excluded.description,
    is_enabled = excluded.is_enabled,
    updated_at = now();

alter table if exists public.products
  add column if not exists minimum_required_tier text;

alter table if exists public.drops
  add column if not exists early_access_tier text,
  add column if not exists early_access_hours integer not null default 0;

create or replace function public.is_feature_enabled(p_key text)
returns boolean
language sql
stable
security definer
as $$
  select coalesce((
    select f.is_enabled
    from public.feature_flags f
    where f.feature_key = p_key
  ), true);
$$;

create or replace function public.resolve_user_tier(p_user_id uuid)
returns text
language plpgsql
stable
security definer
as $$
declare
  u_role text;
  u_crown boolean;
  u_access boolean;
  u_access_exp timestamptz;
  progress_crown boolean;
  has_active_pass boolean;
begin
  if p_user_id is null then
    return 'NORMAL_USER';
  end if;

  select
    lower(coalesce(u.role, 'user')),
    coalesce(u.royal_crown_unlocked, false),
    coalesce(u.royal_access_active, false),
    u.royal_access_expires_at
  into
    u_role,
    u_crown,
    u_access,
    u_access_exp
  from public.users u
  where u.id = p_user_id;

  if u_role in ('admin', 'super_admin') then
    return 'SUPER_ROYAL';
  end if;

  select coalesce(ep.royal_crown_unlocked, false)
    into progress_crown
  from public.elite_progress ep
  where ep.user_id = p_user_id;

  if coalesce(u_crown, false) or coalesce(progress_crown, false) then
    return 'ROYAL_CROWN';
  end if;

  select exists(
    select 1
    from public.royal_access_passes rap
    where rap.user_id = p_user_id
      and rap.is_active = true
      and (rap.expires_at is null or rap.expires_at > now())
  ) into has_active_pass;

  if (coalesce(u_access, false) and (u_access_exp is null or u_access_exp > now())) or coalesce(has_active_pass, false) then
    return 'ROYAL_ACCESS';
  end if;

  return 'NORMAL_USER';
end;
$$;

create or replace function public.user_has_minimum_tier_text(required_tier text, p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
as $$
declare
  resolved text;
  required_rank integer;
  user_rank integer;
  required_norm text;
begin
  if required_tier is null or btrim(required_tier) = '' then
    return true;
  end if;

  if p_user_id is null then
    return false;
  end if;

  resolved := public.resolve_user_tier(p_user_id);
  required_norm := upper(replace(btrim(required_tier), ' ', '_'));

  required_rank := case required_norm
    when 'ROYAL_ACCESS' then 1
    when 'ROYAL_CROWN' then 2
    when 'SUPER_ROYAL' then 3
    else 0
  end;

  user_rank := case upper(coalesce(resolved, 'NORMAL_USER'))
    when 'ROYAL_ACCESS' then 1
    when 'ROYAL_CROWN' then 2
    when 'SUPER_ROYAL' then 3
    else 0
  end;

  return user_rank >= required_rank;
end;
$$;

-- Compatibility: some environments may not have the legacy uuid-based tier checker.
create or replace function public.user_has_minimum_tier(required_tier_id uuid)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  required_count integer;
  current_count integer;
  current_role text;
begin
  if required_tier_id is null then return true; end if;
  if auth.uid() is null then return false; end if;

  select role
    into current_role
  from public.users
  where id = auth.uid();

  if lower(coalesce(current_role, 'user')) in ('admin', 'super_admin') then
    return true;
  end if;

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
    and (
      minimum_required_tier is null
      or (
        public.is_feature_enabled('vault_enabled')
        and public.user_has_minimum_tier_text(minimum_required_tier)
      )
    )
  )
  or public.is_admin()
);
