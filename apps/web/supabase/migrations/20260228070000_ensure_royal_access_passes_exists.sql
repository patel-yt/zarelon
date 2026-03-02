-- Hotfix: ensure royal_access_passes exists in environments
-- where older royal migrations were skipped.

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

alter table public.royal_access_passes enable row level security;

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

-- Force PostgREST schema cache refresh in case relation existed only after this migration.
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when undefined_function then
    -- ignore in environments where pg_notify hook is not available
    null;
end
$$;

