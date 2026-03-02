alter table if exists public.order_items
  add column if not exists refund_attempts integer not null default 0,
  add column if not exists exchange_attempts integer not null default 0,
  add column if not exists refund_completed boolean not null default false,
  add column if not exists exchange_completed boolean not null default false,
  add column if not exists refund_locked boolean not null default false,
  add column if not exists exchange_locked boolean not null default false,
  add column if not exists active_request boolean not null default false;
