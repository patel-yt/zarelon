alter table public.home_pages
  add column if not exists smart_auto_apply boolean not null default false;

create table if not exists public.home_layout_recommendations (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.home_pages(id) on delete cascade,
  proposed_order jsonb not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','applied')),
  created_by uuid null references public.users(id) on delete set null,
  approved_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_home_layout_reco_page_created on public.home_layout_recommendations(page_id, created_at desc);

alter table public.home_layout_recommendations enable row level security;

drop policy if exists "home_layout_reco_admin_read" on public.home_layout_recommendations;
create policy "home_layout_reco_admin_read"
on public.home_layout_recommendations
for select
using (public.has_admin_permission('can_manage_festival'));

drop policy if exists "home_layout_reco_admin_write" on public.home_layout_recommendations;
create policy "home_layout_reco_admin_write"
on public.home_layout_recommendations
for all
using (public.has_admin_permission('can_manage_festival'))
with check (public.has_admin_permission('can_manage_festival'));

drop trigger if exists trg_home_layout_recommendations_updated_at on public.home_layout_recommendations;
create trigger trg_home_layout_recommendations_updated_at
before update on public.home_layout_recommendations
for each row execute function public.set_updated_at();
