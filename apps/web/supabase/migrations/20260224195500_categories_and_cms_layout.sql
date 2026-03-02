create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text unique not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_categories_active_name
  on public.categories(is_active, name);

alter table public.categories enable row level security;

drop policy if exists "categories_public_read_active" on public.categories;
create policy "categories_public_read_active"
on public.categories
for select
using (is_active = true or public.is_admin());

drop policy if exists "categories_admin_write" on public.categories;
create policy "categories_admin_write"
on public.categories
for all
using (public.is_admin())
with check (public.is_admin());

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
before update on public.categories
for each row execute procedure public.set_updated_at();

alter table public.site_sections
  alter column text_color set default '#111111',
  alter column overlay_opacity set default 0.25;

insert into public.categories (slug, name, description)
select
  regexp_replace(lower(trim(category)), '[^a-z0-9\\s-]', '', 'g')::text as slug,
  trim(category) as name,
  null::text as description
from (
  select distinct category
  from public.products
  where category is not null and length(trim(category)) > 0
) q
where length(regexp_replace(lower(trim(category)), '[^a-z0-9\\s-]', '', 'g')) > 0
on conflict (slug) do update
set
  name = excluded.name,
  updated_at = now();
