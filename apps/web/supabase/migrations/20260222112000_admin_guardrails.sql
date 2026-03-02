-- Admin guardrails: prevent admins from blocking/modifying super admin

create or replace function public.can_manage_user_target(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select id, role
    from public.users
    where id = auth.uid()
  ),
  target as (
    select id, role
    from public.users
    where id = target_user_id
  )
  select exists (
    select 1
    from actor a
    join target t on true
    where (
      a.role = 'super_admin'
      or (
        a.role = 'admin'
        and public.check_admin_permission('can_manage_users')
        and t.role = 'user'
      )
    )
  );
$$;

-- Replace broad users update policy with target-aware policy
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_manage_by_permission'
  ) THEN
    DROP POLICY "users_manage_by_permission" ON public.users;
  END IF;
END $$;

create policy "users_manage_by_permission"
on public.users
for update
using (public.can_manage_user_target(id))
with check (public.can_manage_user_target(id));

-- Extra hard stop at row level: nobody can block super_admin account
create or replace function public.prevent_super_admin_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'super_admin' and new.is_blocked = true then
    raise exception 'super_admin account cannot be blocked';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_super_admin_block on public.users;
create trigger trg_prevent_super_admin_block
before update on public.users
for each row
execute function public.prevent_super_admin_block();
