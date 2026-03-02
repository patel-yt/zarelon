-- Enforce a single Super Admin identity and strict role promotion rules.
-- Requirement:
-- 1) Only patshahid23@gmail.com can be super_admin
-- 2) Only that super_admin can promote users to admin/super_admin (for authenticated app users)

do $$
begin
  -- Normalize existing role data first so new constraints can be applied safely.
  update public.users
  set role = 'admin'
  where role = 'super_admin'
    and lower(coalesce(email, '')) <> 'patshahid23@gmail.com';

  update public.users
  set role = 'super_admin'
  where lower(coalesce(email, '')) = 'patshahid23@gmail.com';
end
$$;

alter table if exists public.users
  drop constraint if exists users_super_admin_email_check;

alter table if exists public.users
  add constraint users_super_admin_email_check
  check (
    role <> 'super_admin'
    or lower(coalesce(email, '')) = 'patshahid23@gmail.com'
  );

drop index if exists idx_single_super_admin;
create unique index idx_single_super_admin
  on public.users (role)
  where role = 'super_admin';

create or replace function public.guard_user_role_assignment()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  actor_email text;
  actor_is_owner_super_admin boolean := false;
begin
  -- Super admin identity must always be the fixed owner email.
  if new.role = 'super_admin' and lower(coalesce(new.email, '')) <> 'patshahid23@gmail.com' then
    raise exception 'Only patshahid23@gmail.com can be super_admin';
  end if;

  -- If role is changing to admin/super_admin from another role, enforce actor permissions.
  if tg_op = 'UPDATE'
     and coalesce(old.role, 'user') <> coalesce(new.role, 'user')
     and new.role in ('admin', 'super_admin') then
    -- Service role / SQL editor maintenance path can bypass actor checks.
    if actor_id is null then
      return new;
    end if;

    select lower(coalesce(role, 'user')), lower(coalesce(email, ''))
      into actor_role, actor_email
    from public.users
    where id = actor_id;

    actor_is_owner_super_admin := (actor_role = 'super_admin' and actor_email = 'patshahid23@gmail.com');

    if not actor_is_owner_super_admin then
      raise exception 'Only super admin can assign admin roles';
    end if;
  end if;

  if tg_op = 'INSERT' and new.role in ('admin', 'super_admin') then
    if actor_id is null then
      return new;
    end if;

    select lower(coalesce(role, 'user')), lower(coalesce(email, ''))
      into actor_role, actor_email
    from public.users
    where id = actor_id;

    actor_is_owner_super_admin := (actor_role = 'super_admin' and actor_email = 'patshahid23@gmail.com');

    if not actor_is_owner_super_admin then
      raise exception 'Only super admin can create admin users';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_user_role_assignment on public.users;
create trigger trg_guard_user_role_assignment
before insert or update on public.users
for each row execute function public.guard_user_role_assignment();
