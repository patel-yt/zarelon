-- Configurable early access lock window for tier-gated products.
-- Allows admin to set lock duration (24/48/72 hours) from platform settings.

alter table if exists public.platform_settings
    when coalesce(early_access_lock_hours, 72) in (24, 48, 72) then coalesce(early_access_lock_hours, 72)
    w  add column if not exists early_access_lock_hours integer not null default 72;

update public.platform_settings
set early_access_lock_hours =
  case
hen coalesce(early_access_lock_hours, 72) <= 24 then 24
    when coalesce(early_access_lock_hours, 72) <= 48 then 48
    else 72
  end;

alter table if exists public.platform_settings
  drop constraint if exists platform_settings_early_access_lock_hours_check;

alter table if exists public.platform_settings
  add constraint platform_settings_early_access_lock_hours_check
  check (early_access_lock_hours in (24, 48, 72));

create or replace function public.can_user_buy_product(p_product_id uuid, p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
as $$
declare
  p_active boolean;
  required_tier_text text;
  required_tier_id uuid;
  created_at_ts timestamptz;
  early_access_hours integer := 72;
  has_tier_access boolean := false;
begin
  if p_product_id is null then
    return false;
  end if;

  select
    p.active,
    p.minimum_required_tier,
    p.minimum_required_tier_id,
    p.created_at
  into
    p_active,
    required_tier_text,
    required_tier_id,
    created_at_ts
  from public.products p
  where p.id = p_product_id;

  if coalesce(p_active, false) = false then
    return false;
  end if;

  if p_user_id is null then
    return false;
  end if;

  if public.is_admin() then
    return true;
  end if;

  -- If royal/early-drop controls are disabled, product buy lock is skipped.
  if not public.is_feature_enabled('ambassador_program_enabled') then
    return true;
  end if;
  if not public.is_feature_enabled('early_drop_enabled') then
    return true;
  end if;

  select coalesce(ps.early_access_lock_hours, 72)
    into early_access_hours
  from public.platform_settings ps
  order by ps.updated_at desc nulls last
  limit 1;

  early_access_hours := case
    when early_access_hours in (24, 48, 72) then early_access_hours
    when early_access_hours <= 24 then 24
    when early_access_hours <= 48 then 48
    else 72
  end;

  if (required_tier_text is null or btrim(required_tier_text) = '') and required_tier_id is null then
    return true;
  end if;

  if required_tier_text is not null and btrim(required_tier_text) <> '' then
    has_tier_access := public.user_has_minimum_tier_text(required_tier_text, p_user_id);
  elsif required_tier_id is not null then
    begin
      has_tier_access := public.user_has_minimum_tier(required_tier_id);
    exception
      when others then
        has_tier_access := false;
    end;
  end if;

  if has_tier_access then
    return true;
  end if;

  if created_at_ts is null then
    return false;
  end if;

  return now() >= created_at_ts + make_interval(hours => early_access_hours);
end;
$$;
