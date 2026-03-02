create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_notifications_user_created
  on public.user_notifications(user_id, created_at desc);

create table if not exists public.referral_reminders (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  referrer_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_referral_reminders_referral_created
  on public.referral_reminders(referral_id, created_at desc);

alter table public.user_notifications enable row level security;
alter table public.referral_reminders enable row level security;

drop policy if exists "user_notifications_owner_read" on public.user_notifications;
create policy "user_notifications_owner_read"
on public.user_notifications
for select
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "user_notifications_owner_update" on public.user_notifications;
create policy "user_notifications_owner_update"
on public.user_notifications
for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

drop policy if exists "user_notifications_admin_or_service_insert" on public.user_notifications;
create policy "user_notifications_admin_or_service_insert"
on public.user_notifications
for insert
with check (public.is_admin() or auth.uid() = user_id);

drop policy if exists "referral_reminders_owner_or_admin_read" on public.referral_reminders;
create policy "referral_reminders_owner_or_admin_read"
on public.referral_reminders
for select
using (auth.uid() = referrer_id or auth.uid() = referred_user_id or public.is_admin());

drop policy if exists "referral_reminders_owner_insert" on public.referral_reminders;
create policy "referral_reminders_owner_insert"
on public.referral_reminders
for insert
with check (auth.uid() = referrer_id or public.is_admin());
