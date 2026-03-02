alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('user', 'admin', 'super_admin'));

create table if not exists public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid unique not null references public.users(id) on delete cascade,
  can_manage_products boolean not null default false,
  can_manage_orders boolean not null default false,
  can_manage_users boolean not null default false,
  can_refund boolean not null default false,
  can_manage_festival boolean not null default false,
  can_view_analytics boolean not null default false
);

create table if not exists public.festivals (
  id uuid primary key default gen_random_uuid(),
  festival_name text not null,
  slug text unique not null,
  banner_image text not null,
  start_date timestamptz not null,
  end_date timestamptz not null,
  active boolean not null default false,
  festival_discount integer not null default 0 check (festival_discount between 0 and 90),
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  payment_gateway_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists discount_price integer;
alter table public.products add column if not exists festival_tag text;
alter table public.products add column if not exists image_url text;

alter table public.orders add column if not exists total_amount integer;
alter table public.orders add column if not exists razorpay_payment_id text;
alter table public.orders add column if not exists refund_status text default 'none';

update public.orders set total_amount = total_inr where total_amount is null;
update public.users set role = 'super_admin' where lower(email) = 'patshahid23@gmail.com';
insert into public.admin_permissions (admin_id)
select id from public.users where role = 'admin'
on conflict (admin_id) do nothing;

alter table public.admin_permissions enable row level security;
alter table public.festivals enable row level security;
alter table public.platform_settings enable row level security;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role = 'super_admin'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin', 'super_admin')
  );
$$;

create or replace function public.has_admin_permission(permission_name text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.users u
    left join public.admin_permissions ap on ap.admin_id = u.id
    where u.id = auth.uid()
      and (
        u.role = 'super_admin'
        or (
          u.role = 'admin'
          and (
            (permission_name = 'can_manage_products' and ap.can_manage_products)
            or (permission_name = 'can_manage_orders' and ap.can_manage_orders)
            or (permission_name = 'can_manage_users' and ap.can_manage_users)
            or (permission_name = 'can_refund' and ap.can_refund)
            or (permission_name = 'can_manage_festival' and ap.can_manage_festival)
            or (permission_name = 'can_view_analytics' and ap.can_view_analytics)
          )
        )
      )
  );
$$;

drop policy if exists "users_select_self_or_admin" on public.users;
create policy "users_select_self_or_admin" on public.users
for select using (id = auth.uid() or public.is_admin());

drop policy if exists "products_public_select" on public.products;
create policy "products_public_select" on public.products
for select using (active = true or public.is_admin());

drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write" on public.products
for all using (public.has_admin_permission('can_manage_products'))
with check (public.has_admin_permission('can_manage_products'));

create policy "admin_permissions_read" on public.admin_permissions
for select using (public.is_super_admin() or admin_id = auth.uid());

create policy "admin_permissions_write" on public.admin_permissions
for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy "festivals_public_select" on public.festivals
for select using (active = true or public.is_admin());

create policy "festivals_admin_write" on public.festivals
for all using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

create policy "users_manage_by_permission" on public.users
for update using (public.has_admin_permission('can_manage_users'))
with check (public.has_admin_permission('can_manage_users'));

create policy "platform_settings_read_admin" on public.platform_settings
for select using (public.is_admin());

create policy "platform_settings_write_super_admin" on public.platform_settings
for all using (public.is_super_admin()) with check (public.is_super_admin());

create or replace function public.seed_super_admin_permissions()
returns trigger
language plpgsql
security definer
as $$
begin
  if NEW.role = 'admin' then
    insert into public.admin_permissions (admin_id)
    values (NEW.id)
    on conflict (admin_id) do nothing;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_seed_admin_permissions on public.users;
create trigger trg_seed_admin_permissions
after insert or update of role on public.users
for each row execute function public.seed_super_admin_permissions();

insert into public.platform_settings (payment_gateway_enabled)
select true
where not exists (select 1 from public.platform_settings);
