alter table if exists public.social_submissions
  drop constraint if exists social_submissions_platform_check;

alter table if exists public.social_submissions
  drop constraint if exists social_submissions_platform_allowed_check;

alter table if exists public.social_submissions
  add constraint social_submissions_platform_allowed_check
  check (platform in ('instagram', 'youtube', 'tiktok', 'facebook'));
