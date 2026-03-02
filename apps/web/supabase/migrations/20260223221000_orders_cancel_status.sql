alter table if exists public.orders
  add column if not exists cancel_status text not null default 'none';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_cancel_status_check'
  ) then
    alter table public.orders
      add constraint orders_cancel_status_check
      check (cancel_status in ('none','requested','processed','completed'));
  end if;
end
$$;
