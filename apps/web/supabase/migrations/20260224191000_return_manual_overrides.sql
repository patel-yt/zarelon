alter table if exists public.order_items
  add column if not exists refund_allowed_override boolean not null default false,
  add column if not exists exchange_allowed_override boolean not null default false,
  add column if not exists manual_override_reason text,
  add column if not exists manual_override_admin_id uuid references public.users(id) on delete set null,
  add column if not exists manual_override_at timestamptz;

create index if not exists idx_order_items_manual_override_admin_id
  on public.order_items(manual_override_admin_id);
