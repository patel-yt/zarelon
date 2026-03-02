create table if not exists public.user_behavior_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references public.users(id) on delete set null,
  event_type text not null check (event_type in ('view_product', 'add_to_cart', 'search')),
  product_id uuid null references public.products(id) on delete set null,
  category_slug text null,
  gender public.product_gender null,
  search_term text null,
  amount_inr integer null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_behavior_events_user_created
  on public.user_behavior_events (user_id, created_at desc);

create index if not exists idx_user_behavior_events_event_type
  on public.user_behavior_events (event_type, created_at desc);

alter table public.user_behavior_events enable row level security;

drop policy if exists "Users can read their behavior events" on public.user_behavior_events;
create policy "Users can read their behavior events"
  on public.user_behavior_events
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their behavior events" on public.user_behavior_events;
create policy "Users can insert their behavior events"
  on public.user_behavior_events
  for insert
  with check (auth.uid() = user_id);
