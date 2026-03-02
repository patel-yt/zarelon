-- Protect owner super-admin identity from accidental or malicious changes.
-- Guarantees for patshahid23@gmail.com:
-- 1) email cannot be changed
-- 2) account cannot be blocked
-- 3) role cannot be downgraded from super_admin
-- 4) row cannot be deleted

do $$
begin
  update public.users
  set
    role = 'super_admin',
    is_blocked = false
  where lower(coalesce(email, '')) = 'patshahid23@gmail.com';
end
$$;

create or replace function public.guard_owner_super_admin_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and lower(coalesce(old.email, '')) = 'patshahid23@gmail.com' then
    if lower(coalesce(new.email, '')) <> 'patshahid23@gmail.com' then
      raise exception 'Owner email is immutable';
    end if;

    if coalesce(new.is_blocked, false) = true then
      raise exception 'Owner super_admin account cannot be blocked';
    end if;

    if lower(coalesce(new.role, 'user')) <> 'super_admin' then
      raise exception 'Owner super_admin role cannot be downgraded';
    end if;
  end if;

  if tg_op = 'DELETE' and lower(coalesce(old.email, '')) = 'patshahid23@gmail.com' then
    raise exception 'Owner super_admin row cannot be deleted';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_owner_super_admin_identity_update on public.users;
create trigger trg_guard_owner_super_admin_identity_update
before update on public.users
for each row
execute function public.guard_owner_super_admin_identity();

drop trigger if exists trg_guard_owner_super_admin_identity_delete on public.users;
create trigger trg_guard_owner_super_admin_identity_delete
before delete on public.users
for each row
execute function public.guard_owner_super_admin_identity();

