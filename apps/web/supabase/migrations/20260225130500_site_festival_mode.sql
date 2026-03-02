create table if not exists public.site_festivals (
  id uuid primary key default gen_random_uuid(),
  festival_name text not null,
  slug text unique not null,
  is_active boolean not null default false,
  theme_primary text not null default '#C8A951',
  theme_secondary text not null default '#111111',
  hero_image_url text not null,
  hero_video_url text,
  discount_text text not null default '',
  promo_text text not null default '',
  urgency_text text not null default '',
  discount_percent integer not null default 0 check (discount_percent between 0 and 90),
  promo_messages jsonb not null default '[]'::jsonb,
  start_date timestamptz not null,
  end_date timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date)
);

create unique index if not exists idx_site_festivals_single_active
  on public.site_festivals((is_active))
  where is_active = true;

create index if not exists idx_site_festivals_active_window
  on public.site_festivals(is_active, start_date, end_date);

alter table public.site_festivals enable row level security;

drop policy if exists "site_festivals_public_active_read" on public.site_festivals;
create policy "site_festivals_public_active_read"
on public.site_festivals
for select
using (
  (is_active = true and now() between start_date and end_date)
  or public.is_admin()
);

drop policy if exists "site_festivals_admin_write" on public.site_festivals;
create policy "site_festivals_admin_write"
on public.site_festivals
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

create or replace function public.ensure_single_active_site_festival()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active then
    update public.site_festivals
    set is_active = false,
        updated_at = now()
    where id <> coalesce(new.id, gen_random_uuid())
      and is_active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_site_festivals_single_active on public.site_festivals;
create trigger trg_site_festivals_single_active
before insert or update of is_active
on public.site_festivals
for each row execute function public.ensure_single_active_site_festival();

drop trigger if exists trg_site_festivals_updated_at on public.site_festivals;
create trigger trg_site_festivals_updated_at
before update on public.site_festivals
for each row execute procedure public.set_updated_at();

create or replace function public.deactivate_expired_site_festivals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer := 0;
begin
  update public.site_festivals
  set is_active = false,
      updated_at = now()
  where is_active = true
    and end_date < now();

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

create or replace function public.get_active_site_festival()
returns setof public.site_festivals
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.deactivate_expired_site_festivals();

  return query
    select *
    from public.site_festivals
    where is_active = true
      and now() between start_date and end_date
    order by start_date desc
    limit 1;
end;
$$;

grant execute on function public.deactivate_expired_site_festivals() to anon, authenticated;
grant execute on function public.get_active_site_festival() to anon, authenticated;
