alter table if exists public.products
  add column if not exists size_chart jsonb;

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  title text,
  comment text,
  image_urls text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, user_id)
);

create index if not exists product_reviews_product_idx on public.product_reviews(product_id);
create index if not exists product_reviews_user_idx on public.product_reviews(user_id);

alter table public.product_reviews enable row level security;

drop policy if exists "product_reviews_public_select" on public.product_reviews;
create policy "product_reviews_public_select" on public.product_reviews
for select using (true);

drop policy if exists "product_reviews_owner_insert" on public.product_reviews;
create policy "product_reviews_owner_insert" on public.product_reviews
for insert with check (user_id = auth.uid());

drop policy if exists "product_reviews_owner_update" on public.product_reviews;
create policy "product_reviews_owner_update" on public.product_reviews
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "product_reviews_owner_delete" on public.product_reviews;
create policy "product_reviews_owner_delete" on public.product_reviews
for delete using (user_id = auth.uid() or public.is_admin());

drop trigger if exists trg_product_reviews_updated_at on public.product_reviews;
create trigger trg_product_reviews_updated_at
before update on public.product_reviews
for each row execute procedure public.set_updated_at();
