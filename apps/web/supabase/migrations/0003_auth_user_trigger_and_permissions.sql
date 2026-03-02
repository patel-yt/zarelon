-- 0003_auth_user_trigger_and_permissions.sql

-- 1) Auto-create public.users row after Supabase Auth signup
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case
      when lower(new.email) = 'patshahid23@gmail.com' then 'super_admin'
      else 'user'
    end
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.users.name, excluded.name),
        role = case
          when lower(excluded.email) = 'patshahid23@gmail.com' then 'super_admin'
          else public.users.role
        end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- 2) Backfill/guarantee super admin mapping for existing row
update public.users
set role = 'super_admin'
where lower(email) = 'patshahid23@gmail.com';

-- 3) RLS + restrictions for admin_permissions
alter table public.admin_permissions enable row level security;

-- reset previous policies if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'admin_permissions' AND policyname = 'admin_permissions_read'
  ) THEN
    DROP POLICY "admin_permissions_read" ON public.admin_permissions;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'admin_permissions' AND policyname = 'admin_permissions_write'
  ) THEN
    DROP POLICY "admin_permissions_write" ON public.admin_permissions;
  END IF;
END $$;

-- super_admin can read all; admin can read own permissions row
create policy "admin_permissions_select_policy"
on public.admin_permissions
for select
using (
  public.is_super_admin()
  or admin_id = auth.uid()
);

-- insert restriction: only super_admin
create policy "admin_permissions_insert_policy"
on public.admin_permissions
for insert
with check (public.is_super_admin());

-- update restriction: only super_admin
create policy "admin_permissions_update_policy"
on public.admin_permissions
for update
using (public.is_super_admin())
with check (public.is_super_admin());

-- delete restriction: only super_admin
create policy "admin_permissions_delete_policy"
on public.admin_permissions
for delete
using (public.is_super_admin());

-- 4) Secure admin permission check function
create or replace function public.check_admin_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public
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
          and case permission_name
            when 'can_manage_products' then coalesce(ap.can_manage_products, false)
            when 'can_manage_orders' then coalesce(ap.can_manage_orders, false)
            when 'can_manage_users' then coalesce(ap.can_manage_users, false)
            when 'can_refund' then coalesce(ap.can_refund, false)
            when 'can_manage_festival' then coalesce(ap.can_manage_festival, false)
            when 'can_view_analytics' then coalesce(ap.can_view_analytics, false)
            else false
          end
        )
      )
  );
$$;

-- Optional compatibility alias for existing code paths
create or replace function public.has_admin_permission(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.check_admin_permission(permission_name);
$$;
