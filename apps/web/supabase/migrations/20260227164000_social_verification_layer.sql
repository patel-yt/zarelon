alter table if exists public.social_submissions
  add column if not exists caption text,
  add column if not exists submitted_url_public boolean not null default false,
  add column if not exists precheck_errors jsonb not null default '[]'::jsonb,
  add column if not exists recheck_scheduled_at timestamptz,
  add column if not exists recheck_completed boolean not null default false,
  add column if not exists still_live boolean,
  add column if not exists recheck_views_snapshot integer,
  add column if not exists flagged_for_review boolean not null default false,
  add column if not exists is_invalid boolean not null default false,
  add column if not exists coupon_revoked_at timestamptz,
  add column if not exists is_featured boolean not null default false,
  add column if not exists featured_order integer;

create index if not exists idx_social_submissions_recheck_due
  on public.social_submissions (recheck_scheduled_at)
  where recheck_completed = false and status = 'approved';

create index if not exists idx_social_submissions_featured
  on public.social_submissions (is_featured, featured_order)
  where is_featured = true;

drop policy if exists "social_submissions_user_read_own" on public.social_submissions;
create policy "social_submissions_user_read_own"
on public.social_submissions
for select
using (
  auth.uid() = user_id
  or public.has_admin_permission('can_manage_orders')
  or public.has_admin_permission('can_manage_festival')
  or (
    status = 'approved'
    and coalesce(still_live, true) = true
    and is_invalid = false
  )
);
