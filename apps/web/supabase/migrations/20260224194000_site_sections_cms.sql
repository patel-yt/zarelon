create table if not exists public.site_sections (
  id uuid primary key default gen_random_uuid(),
  section_key text not null,
  page_location text not null,
  title text,
  subtitle text,
  description text,
  media_type text not null default 'image' check (media_type in ('image', 'video')),
  media_url text,
  button_text text,
  button_link text,
  text_color text not null default '#F8F5F2',
  text_alignment text not null default 'left' check (text_alignment in ('left', 'center', 'right')),
  overlay_opacity numeric(3,2) not null default 0.30 check (overlay_opacity >= 0 and overlay_opacity <= 1),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_site_sections_location_active_order
  on public.site_sections(page_location, is_active, display_order);
create index if not exists idx_site_sections_key
  on public.site_sections(section_key);

alter table public.site_sections enable row level security;

drop policy if exists "site_sections_public_read_active" on public.site_sections;
create policy "site_sections_public_read_active"
on public.site_sections
for select
using (is_active = true or public.is_admin());

drop policy if exists "site_sections_admin_write" on public.site_sections;
create policy "site_sections_admin_write"
on public.site_sections
for all
using (public.is_admin())
with check (public.is_admin());

drop trigger if exists trg_site_sections_updated_at on public.site_sections;
create trigger trg_site_sections_updated_at
before update on public.site_sections
for each row execute procedure public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('site-sections', 'site-sections', true)
on conflict (id) do nothing;

drop policy if exists "site_sections_bucket_public_read" on storage.objects;
create policy "site_sections_bucket_public_read"
on storage.objects
for select
using (bucket_id = 'site-sections');

drop policy if exists "site_sections_bucket_admin_upload" on storage.objects;
create policy "site_sections_bucket_admin_upload"
on storage.objects
for insert
with check (
  bucket_id = 'site-sections'
  and exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
  )
);

drop policy if exists "site_sections_bucket_admin_delete" on storage.objects;
create policy "site_sections_bucket_admin_delete"
on storage.objects
for delete
using (
  bucket_id = 'site-sections'
  and exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('admin', 'super_admin')
  )
);
