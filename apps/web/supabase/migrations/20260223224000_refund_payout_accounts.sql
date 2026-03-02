create table if not exists public.refund_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  account_holder_name text,
  bank_account_number text,
  bank_ifsc text,
  bank_name text,
  upi_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_refund_payout_accounts_user_id
  on public.refund_payout_accounts(user_id);

alter table public.refund_payout_accounts enable row level security;

drop policy if exists "refund_payout_accounts_owner_read" on public.refund_payout_accounts;
create policy "refund_payout_accounts_owner_read"
on public.refund_payout_accounts
for select
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "refund_payout_accounts_owner_write" on public.refund_payout_accounts;
create policy "refund_payout_accounts_owner_write"
on public.refund_payout_accounts
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop trigger if exists trg_refund_payout_accounts_updated_at on public.refund_payout_accounts;
create trigger trg_refund_payout_accounts_updated_at
before update on public.refund_payout_accounts
for each row execute procedure public.set_updated_at();
