import { supabase } from "@/lib/supabase";
import { consumeExpiredDropHolds } from "@/services/dropHold";
import { startDropHold } from "@/services/dropHold";
import { claimDropStock, releaseDropStock } from "@/services/drops";
import {
  fetchCartReservations,
  purgeExpiredCartReservations,
  removeCartReservation,
  upsertCartReservation,
} from "@/services/royalDropEngine";
import type { Cart } from "@/types/domain";

const ensureCart = async (userId: string): Promise<string> => {
  const { data: existing, error: fetchError } = await supabase
    .from("carts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (existing?.id) return existing.id;

  const { data: created, error: createError } = await supabase
    .from("carts")
    .insert({ user_id: userId })
    .select("id")
    .single();

  if (createError) throw createError;
  return created.id;
};

export const getCart = async (userId: string): Promise<Cart | null> => {
  const cartId = await ensureCart(userId);

  const primary = await supabase
    .from("carts")
    .select("id, user_id, cart_items(id, product_id, variant_id, quantity, product:products(*), variant:product_variants(*))")
    .eq("id", cartId)
    .single();

  let data = primary.data as any;
  let error = primary.error;
  if (error) {
    const fallback = await supabase
      .from("carts")
      .select("id, user_id, cart_items(id, product_id, quantity, product:products(*))")
      .eq("id", cartId)
      .single();
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error) throw error;
  const normalizedItems =
    data?.cart_items?.map((item: any) => ({
      ...item,
      product: Array.isArray(item.product) ? item.product[0] : item.product,
      variant: Array.isArray(item.variant) ? item.variant[0] : item.variant,
    })) ?? [];

  return {
    id: data.id,
    user_id: data.user_id,
    cart_items: normalizedItems,
  } as Cart;
};

export const addToCart = async (
  userId: string,
  productId: string,
  quantity = 1,
  variantId?: string | null
): Promise<void> => {
  const cartId = await ensureCart(userId);
  const { data: productInfo } = await supabase
    .from("products")
    .select("id,drop_id")
    .eq("id", productId)
    .maybeSingle();
  const dropId = (productInfo as { drop_id?: string | null } | null)?.drop_id ?? null;

  if (dropId) {
    const claimed = await claimDropStock(dropId, quantity);
    if (!claimed) {
      throw new Error("Drop stock sold out. Join waitlist.");
    }
  }

  let existingQuery = supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_id", cartId)
    .eq("product_id", productId);

  existingQuery = variantId ? existingQuery.eq("variant_id", variantId) : existingQuery.is("variant_id", null);

  const { data: existing } = await existingQuery.maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: existing.quantity + quantity })
      .eq("id", existing.id);
    if (error) {
      if (dropId) await releaseDropStock(dropId, quantity);
      const lowered = String((error as any)?.message ?? "").toLowerCase();
      if (lowered.includes("permission denied") || lowered.includes("row-level security")) {
        throw new Error("This product is in early access right now. Public buying opens after the countdown.");
      }
      throw error;
    }
    if (dropId) {
      startDropHold(userId, dropId);
      await upsertCartReservation(userId, productId, 10);
    }
    return;
  }

  const { error } = await supabase.from("cart_items").insert({
    cart_id: cartId,
    product_id: productId,
    variant_id: variantId ?? null,
    quantity,
  });

  if (error) {
    if (dropId) await releaseDropStock(dropId, quantity);
    const lowered = String((error as any)?.message ?? "").toLowerCase();
    if (lowered.includes("permission denied") || lowered.includes("row-level security")) {
      throw new Error("This product is in early access right now. Public buying opens after the countdown.");
    }
    throw error;
  }

  if (dropId) {
    startDropHold(userId, dropId);
    await upsertCartReservation(userId, productId, 10);
  }
};

export const updateCartQuantity = async (cartItemId: string, quantity: number): Promise<void> => {
  const { data: itemRes, error: itemError } = await supabase
    .from("cart_items")
    .select("id, quantity, cart: carts(user_id), product_id, product:products(drop_id)")
    .eq("id", cartItemId)
    .maybeSingle();
  if (itemError) throw itemError;
  const currentQty = Number((itemRes as any)?.quantity ?? 0);
  const productId = String((itemRes as any)?.product_id ?? "");
  const userId = Array.isArray((itemRes as any)?.cart)
    ? (itemRes as any)?.cart?.[0]?.user_id
    : (itemRes as any)?.cart?.user_id;
  const dropId = ((itemRes as any)?.product?.drop_id ?? (Array.isArray((itemRes as any)?.product) ? (itemRes as any).product[0]?.drop_id : null)) as
    | string
    | null;

  if (quantity <= 0) {
    const { error } = await supabase.from("cart_items").delete().eq("id", cartItemId);
    if (error) throw error;
    if (dropId && currentQty > 0) {
      await releaseDropStock(dropId, currentQty);
    }
    if (userId && productId) {
      await removeCartReservation(String(userId), productId);
    }
    return;
  }

  if (dropId && quantity > currentQty) {
    const claimQty = quantity - currentQty;
    const claimed = await claimDropStock(dropId, claimQty);
    if (!claimed) throw new Error("Drop stock sold out. Reduce quantity or join waitlist.");
  }

  const { error } = await supabase.from("cart_items").update({ quantity }).eq("id", cartItemId);
  if (error) {
    if (dropId && quantity > currentQty) {
      await releaseDropStock(dropId, quantity - currentQty);
    }
    throw error;
  }
  if (dropId && quantity < currentQty) {
    await releaseDropStock(dropId, currentQty - quantity);
  }

  if (dropId && userId && productId) {
    await upsertCartReservation(String(userId), productId, 10);
  }
};

export const releaseExpiredDropItems = async (userId: string): Promise<number> => {
  const expiredProductIds = await purgeExpiredCartReservations(userId);
  const expired = consumeExpiredDropHolds(userId);
  if (!expired.length && !expiredProductIds.length) return 0;

  const cart = await getCart(userId);
  if (!cart?.cart_items?.length) return 0;

  let removed = 0;
  for (const hold of expired) {
    const items = cart.cart_items.filter((item) => item.product?.drop_id === hold.drop_id);
    for (const item of items) {
      await supabase.from("cart_items").delete().eq("id", item.id);
      await releaseDropStock(hold.drop_id, item.quantity);
      removed += 1;
    }
  }

  if (expiredProductIds.length) {
    const expiredSet = new Set(expiredProductIds);
    const dropItems = cart.cart_items.filter((item) => expiredSet.has(item.product_id) && item.product?.drop_id);
    for (const item of dropItems) {
      await supabase.from("cart_items").delete().eq("id", item.id);
      if (item.product?.drop_id) await releaseDropStock(item.product.drop_id, item.quantity);
      removed += 1;
    }
  }

  return removed;
};

export const fetchUserCartReservationMap = async (userId: string, productIds: string[]) => {
  const rows = await fetchCartReservations(userId, productIds);
  return new Map(rows.map((row) => [row.product_id, row.expires_at]));
};
