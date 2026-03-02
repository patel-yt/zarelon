do $$
begin
  if not exists (select 1 from pg_type where typname = 'drop_media_type') then
    create type public.drop_media_type as enum ('image', 'video');
  end if;
  if not exists (select 1 from pg_type where typname = 'drop_access_type') then
    create type public.drop_access_type as enum ('public', 'early', 'vip');
  end if;
end
$$;

create table if not exists public.drops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  hero_media_type public.drop_media_type not null default 'image',
  hero_media_url text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  total_stock integer not null default 0 check (total_stock >= 0),
  available_stock integer not null default 0 check (available_stock >= 0),
  access_type public.drop_access_type not null default 'public',
  minimum_spend_required numeric(12,2),
  required_loyalty_points integer,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drops_time_window_check check (start_time < end_time)
);

alter table public.products
  add column if not exists drop_id uuid references public.drops(id) on delete set null;

alter table public.users
  add column if not exists loyalty_points integer not null default 0;

create index if not exists idx_drops_active_window on public.drops(is_active, start_time, end_time);
create index if not exists idx_drops_slug on public.drops(slug);
create index if not exists idx_products_drop_id on public.products(drop_id);

alter table public.drops enable row level security;

drop policy if exists "drops_public_read_active" on public.drops;
create policy "drops_public_read_active"
on public.drops
for select
using (is_active = true or public.is_admin());

drop policy if exists "drops_admin_write" on public.drops;
create policy "drops_admin_write"
on public.drops
for all
using (public.is_admin())
with check (public.is_admin());

drop trigger if exists trg_drops_updated_at on public.drops;
create trigger trg_drops_updated_at
before update on public.drops
for each row execute procedure public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('drop-media', 'drop-media', true)
on conflict (id) do nothing;

drop policy if exists "drop_media_public_read" on storage.objects;
create policy "drop_media_public_read"
on storage.objects
for select
using (bucket_id = 'drop-media');

drop policy if exists "drop_media_admin_upload" on storage.objects;
create policy "drop_media_admin_upload"
on storage.objects
for insert
with check (
  bucket_id = 'drop-media'
  and exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
  )
);

drop policy if exists "drop_media_admin_delete" on storage.objects;
create policy "drop_media_admin_delete"
on storage.objects
for delete
using (
  bucket_id = 'drop-media'
  and exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
  )
);
