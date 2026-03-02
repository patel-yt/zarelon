alter table if exists public.users
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_referral_code_unique'
  ) then
    alter table public.users add constraint users_referral_code_unique unique (referral_code);
  end if;
end $$;

create table if not exists public.referral_config (
  id uuid primary key default gen_random_uuid(),
  min_purchase_amount integer not null default 1000 check (min_purchase_amount > 0),
  referrer_reward integer not null default 200 check (referrer_reward > 0),
  friend_reward integer not null default 150 check (friend_reward > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_referral_config_single_active
  on public.referral_config((is_active))
  where is_active = true;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  referral_code text not null,
  purchase_amount integer,
  reward_given boolean not null default false,
  created_at timestamptz not null default now(),
  reward_given_at timestamptz,
  friend_coupon_code text,
  friend_coupon_expires_at timestamptz,
  referrer_coupon_code text,
  referrer_coupon_expires_at timestamptz,
  coupon_usage_limit integer not null default 1,
  coupon_used_count integer not null default 0,
  signup_ip text,
  device_fingerprint text
);

create unique index if not exists idx_referrals_referred_user_unique
  on public.referrals(referred_user_id);

create index if not exists idx_referrals_referrer_created
  on public.referrals(referrer_id, created_at desc);

create unique index if not exists idx_referrals_friend_coupon_unique
  on public.referrals(friend_coupon_code)
  where friend_coupon_code is not null;

create unique index if not exists idx_referrals_referrer_coupon_unique
  on public.referrals(referrer_coupon_code)
  where referrer_coupon_code is not null;

create index if not exists idx_referrals_signup_ip
  on public.referrals(signup_ip);

alter table public.referral_config enable row level security;
alter table public.referrals enable row level security;

drop policy if exists "referral_config_public_read" on public.referral_config;
create policy "referral_config_public_read"
on public.referral_config
for select
using (is_active = true or public.has_admin_permission('can_manage_orders'));

drop policy if exists "referral_config_admin_write" on public.referral_config;
create policy "referral_config_admin_write"
on public.referral_config
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

drop policy if exists "referrals_user_read_own" on public.referrals;
create policy "referrals_user_read_own"
on public.referrals
for select
using (
  auth.uid() = referrer_id
  or auth.uid() = referred_user_id
  or public.has_admin_permission('can_manage_orders')
);

drop policy if exists "referrals_admin_write" on public.referrals;
create policy "referrals_admin_write"
on public.referrals
for all
using (public.has_admin_permission('can_manage_orders'))
with check (public.has_admin_permission('can_manage_orders'));

create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := 'AUR-';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.users where referral_code = code);
  end loop;
  return code;
end;
$$;

update public.users
set referral_code = public.generate_referral_code()
where referral_code is null;

create or replace function public.set_referral_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_referral_config_updated_at on public.referral_config;
create trigger trg_referral_config_updated_at
before update on public.referral_config
for each row execute function public.set_referral_updated_at();

insert into public.referral_config (min_purchase_amount, referrer_reward, friend_reward, is_active)
select 1000, 200, 150, true
where not exists (select 1 from public.referral_config);
