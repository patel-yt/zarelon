alter table if exists public.users
  add column if not exists role text default 'user';

alter table if exists public.users
  drop constraint if exists users_role_check;

alter table if exists public.users
  add constraint users_role_check
  check (role in ('user', 'admin', 'super_admin'));

alter table if exists public.users
  drop column if exists is_super_royal;

alter table if exists public.elite_progress
  drop column if exists is_super_royal;

alter table if exists public.platform_settings
  drop column if exists is_super_royal;

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
