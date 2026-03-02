create table if not exists public.hero_slides (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  title text not null,
  subtitle text not null,
  cta_label text not null default 'Shop Now',
  cta_href text not null default '/products',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hero_slides enable row level security;

drop policy if exists "hero_slides_public_select" on public.hero_slides;
create policy "hero_slides_public_select" on public.hero_slides
for select using (active = true or public.is_admin());

drop policy if exists "hero_slides_admin_write" on public.hero_slides;
create policy "hero_slides_admin_write" on public.hero_slides
for all using (public.is_admin()) with check (public.is_admin());

drop trigger if exists trg_hero_slides_updated_at on public.hero_slides;
create trigger trg_hero_slides_updated_at
before update on public.hero_slides
for each row execute procedure public.set_updated_at();
