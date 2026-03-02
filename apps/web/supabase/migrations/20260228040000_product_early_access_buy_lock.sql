-- Product early-access purchase lock:
-- 1) Keep products visible to all active users.
-- 2) Restrict add-to-cart during first 72 hours for tier-gated products.

create or replace function public.can_user_buy_product(p_product_id uuid, p_user_id uuid default auth.uid())
returns boolean
language plpgsql
stable
security definer
as $$
declare
  p_active boolean;
  required_tier_text text;
  required_tier_id uuid;
  created_at_ts timestamptz;
  early_access_hours integer := 72;
  has_tier_access boolean := false;
begin
  if p_product_id is null then
    return false;
  end if;

  select
    p.active,
    p.minimum_required_tier,
    p.minimum_required_tier_id,
    p.created_at
  into
    p_active,
    required_tier_text,
    required_tier_id,
    created_at_ts
  from public.products p
  where p.id = p_product_id;

  if coalesce(p_active, false) = false then
    return false;
  end if;

  if p_user_id is null then
    return false;
  end if;

  if public.is_admin() then
    return true;
  end if;

  -- If royal/early-drop controls are disabled, product buy lock is skipped.
  if not public.is_feature_enabled('ambassador_program_enabled') then
    return true;
  end if;
  if not public.is_feature_enabled('early_drop_enabled') then
    return true;
  end if;

  if (required_tier_text is null or btrim(required_tier_text) = '') and required_tier_id is null then
    return true;
  end if;

  if required_tier_text is not null and btrim(required_tier_text) <> '' then
    has_tier_access := public.user_has_minimum_tier_text(required_tier_text, p_user_id);
  elsif required_tier_id is not null then
    begin
      has_tier_access := public.user_has_minimum_tier(required_tier_id);
    exception
      when others then
        has_tier_access := false;
    end;
  end if;

  if has_tier_access then
    return true;
  end if;

  if created_at_ts is null then
    return false;
  end if;

  -- After 72 hours, buying opens for everyone.
  return now() >= created_at_ts + make_interval(hours => early_access_hours);
end;
$$;

drop policy if exists "products_public_select" on public.products;
create policy "products_public_select"
on public.products
for select
using (
  active = true
  or public.is_admin()
);

drop policy if exists "cart_items_owner" on public.cart_items;
drop policy if exists "cart_items_owner_select" on public.cart_items;
drop policy if exists "cart_items_owner_insert" on public.cart_items;
drop policy if exists "cart_items_owner_update" on public.cart_items;
drop policy if exists "cart_items_owner_delete" on public.cart_items;

create policy "cart_items_owner_select"
on public.cart_items
for select
using (
  exists (
    select 1
    from public.carts c
    where c.id = cart_id
      and c.user_id = auth.uid()
  )
);

create policy "cart_items_owner_insert"
on public.cart_items
for insert
with check (
  exists (
    select 1
    from public.carts c
    where c.id = cart_id
      and c.user_id = auth.uid()
  )
  and public.can_user_buy_product(product_id, auth.uid())
);

create policy "cart_items_owner_update"
on public.cart_items
for update
using (
  exists (
    select 1
    from public.carts c
    where c.id = cart_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.carts c
    where c.id = cart_id
      and c.user_id = auth.uid()
  )
);

create policy "cart_items_owner_delete"
on public.cart_items
for delete
using (
  exists (
    select 1
    from public.carts c
    where c.id = cart_id
      and c.user_id = auth.uid()
  )
);
