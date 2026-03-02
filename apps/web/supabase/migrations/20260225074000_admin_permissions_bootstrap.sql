-- Ensure admin users are not locked out of admin UI after role assignment.
-- Backfill permission rows and grant baseline access for existing admins.

insert into public.admin_permissions (
  admin_id,
  can_manage_products,
  can_manage_orders,
  can_manage_users,
  can_refund,
  can_manage_festival,
  can_view_analytics
)
select
  u.id,
  true,
  true,
  true,
  true,
  true,
  true
from public.users u
where u.role = 'admin'
on conflict (admin_id) do update
set
  can_manage_products = true,
  can_manage_orders = true,
  can_manage_users = true,
  can_refund = true,
  can_manage_festival = true,
  can_view_analytics = true;
