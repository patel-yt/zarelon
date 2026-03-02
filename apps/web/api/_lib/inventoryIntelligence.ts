import { adminClient } from "./server.js";

type CartLine = {
  quantity: number;
  variant_id?: string | null;
  product: { id: string; stock: number; title?: string | null } | null;
  variant?: { id: string; stock: number; active?: boolean | null } | null;
};

const getPlatformSettings = async () => {
  const { data } = await adminClient
    .from("platform_settings")
    .select("low_stock_threshold,reservation_hold_minutes,high_value_cod_threshold_inr")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    lowStockThreshold: data?.low_stock_threshold ?? 5,
    reservationHoldMinutes: data?.reservation_hold_minutes ?? 15,
    highValueCodThresholdInr: data?.high_value_cod_threshold_inr ?? 150000,
  };
};

const insertAdminNotification = async (
  type: string,
  severity: "info" | "warning" | "critical",
  title: string,
  message: string,
  meta: Record<string, unknown>
) => {
  await adminClient.from("admin_notifications").insert({
    type,
    severity,
    title,
    message,
    meta,
  });
};

const updateProductStockAndState = async (productId: string, stock: number) => {
  const nextStock = Math.max(0, stock);
  await adminClient
    .from("products")
    .update({
      stock: nextStock,
      active: nextStock > 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId);
};

const recalcProductStockFromVariants = async (productId: string) => {
  const { data: variants, error } = await adminClient
    .from("product_variants")
    .select("stock")
    .eq("product_id", productId)
    .eq("active", true);
  if (error) throw new Error(error.message || "Could not read product variants");

  const total = (variants ?? []).reduce((sum, item) => sum + (item.stock ?? 0), 0);
  await updateProductStockAndState(productId, total);
  return total;
};

const maybeEmitLowStockAlerts = async (productId: string, currentStock: number) => {
  const settings = await getPlatformSettings();
  if (currentStock <= 0) {
    await insertAdminNotification(
      "inventory_out_of_stock",
      "critical",
      "Product is now out of stock",
      "A product was automatically disabled because stock reached zero.",
      { product_id: productId, stock: 0 }
    );
    return;
  }

  if (currentStock <= settings.lowStockThreshold) {
    await insertAdminNotification(
      "inventory_low_stock",
      "warning",
      "Low stock alert",
      `Stock dropped to ${currentStock}.`,
      { product_id: productId, stock: currentStock, threshold: settings.lowStockThreshold }
    );
  }
};

const moveLineStock = async (
  item: { productId: string; variantId?: string | null; quantity: number },
  mode: "reserve" | "restore"
) => {
  const delta = mode === "reserve" ? -item.quantity : item.quantity;
  if (item.variantId) {
    const { data: variant, error: variantReadError } = await adminClient
      .from("product_variants")
      .select("id,product_id,stock")
      .eq("id", item.variantId)
      .maybeSingle();
    if (variantReadError || !variant) throw new Error(variantReadError?.message || "Variant not found");

    const nextVariantStock = Math.max(0, (variant.stock ?? 0) + delta);
    if (mode === "reserve" && nextVariantStock + item.quantity !== (variant.stock ?? 0)) {
      throw new Error("Insufficient stock for one or more items");
    }

    const { error: variantUpdateError } = await adminClient
      .from("product_variants")
      .update({ stock: nextVariantStock, updated_at: new Date().toISOString() })
      .eq("id", variant.id);
    if (variantUpdateError) throw new Error(variantUpdateError.message || "Could not update variant stock");

    const productStock = await recalcProductStockFromVariants(variant.product_id);
    await maybeEmitLowStockAlerts(variant.product_id, productStock);
    return;
  }

  const { data: product, error: productReadError } = await adminClient
    .from("products")
    .select("id,stock")
    .eq("id", item.productId)
    .maybeSingle();
  if (productReadError || !product) throw new Error(productReadError?.message || "Product not found");

  const nextProductStock = Math.max(0, (product.stock ?? 0) + delta);
  if (mode === "reserve" && nextProductStock + item.quantity !== (product.stock ?? 0)) {
    throw new Error("Insufficient stock for one or more items");
  }

  await updateProductStockAndState(product.id, nextProductStock);
  await maybeEmitLowStockAlerts(product.id, nextProductStock);
};

const loadReservationItems = async (reservationId: string) => {
  const { data, error } = await adminClient
    .from("inventory_reservation_items")
    .select("product_id,variant_id,quantity")
    .eq("reservation_id", reservationId);
  if (error) throw new Error(error.message || "Could not load reservation items");
  return data ?? [];
};

export const cleanupExpiredReservations = async () => {
  const now = new Date().toISOString();
  const { data: reservations, error } = await adminClient
    .from("inventory_reservations")
    .select("id")
    .eq("status", "active")
    .lte("expires_at", now)
    .limit(100);
  if (error) throw new Error(error.message || "Could not load expired reservations");

  for (const reservation of reservations ?? []) {
    const items = await loadReservationItems(reservation.id);
    for (const item of items) {
      await moveLineStock(
        {
          productId: item.product_id,
          variantId: item.variant_id,
          quantity: item.quantity,
        },
        "restore"
      );
    }

    await adminClient
      .from("inventory_reservations")
      .update({ status: "expired", updated_at: now })
      .eq("id", reservation.id);
  }
};

export const releaseReservationByOrderId = async (orderId: string, reason: string) => {
  const { data: reservation } = await adminClient
    .from("inventory_reservations")
    .select("id,status")
    .eq("order_id", orderId)
    .eq("status", "active")
    .maybeSingle();
  if (!reservation) return false;

  const items = await loadReservationItems(reservation.id);
  for (const item of items) {
    await moveLineStock(
      {
        productId: item.product_id,
        variantId: item.variant_id,
        quantity: item.quantity,
      },
      "restore"
    );
  }

  await adminClient
    .from("inventory_reservations")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservation.id);

  await adminClient.from("payments_audit").insert({
    order_id: orderId,
    event_type: "inventory_reservation_released",
    provider_payload: { reason },
  });

  return true;
};

export const consumeReservationForOrder = async (orderId: string) => {
  const { data: reservation } = await adminClient
    .from("inventory_reservations")
    .select("id,status")
    .eq("order_id", orderId)
    .eq("status", "active")
    .maybeSingle();
  if (!reservation) return false;

  await adminClient
    .from("inventory_reservations")
    .update({
      status: "consumed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservation.id);
  return true;
};

export const reserveInventoryForCart = async (userId: string, cartId: string) => {
  await cleanupExpiredReservations();

  const settings = await getPlatformSettings();
  const expiresAt = new Date(Date.now() + settings.reservationHoldMinutes * 60 * 1000).toISOString();

  const { data: existingReservations } = await adminClient
    .from("inventory_reservations")
    .select("id")
    .eq("user_id", userId)
    .eq("cart_id", cartId)
    .eq("status", "active");

  for (const activeReservation of existingReservations ?? []) {
    const items = await loadReservationItems(activeReservation.id);
    for (const item of items) {
      await moveLineStock(
        {
          productId: item.product_id,
          variantId: item.variant_id,
          quantity: item.quantity,
        },
        "restore"
      );
    }

    await adminClient
      .from("inventory_reservations")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", activeReservation.id);
  }

  let cartRows:
    | {
        quantity: number;
        variant_id?: string | null;
        product: any;
        variant?: any;
      }[]
    | null = null;
  const primary = await adminClient
    .from("cart_items")
    .select("quantity,variant_id,product:products(id,stock),variant:product_variants(id,stock,active)")
    .eq("cart_id", cartId);
  cartRows = primary.data as any[] | null;
  if (primary.error) {
    const fallback = await adminClient
      .from("cart_items")
      .select("quantity,product:products(id,stock)")
      .eq("cart_id", cartId);
    cartRows = fallback.data as any[] | null;
    if (fallback.error) throw new Error(fallback.error.message || "Could not read cart items");
  }

  const cartItems: CartLine[] = (cartRows ?? []).map((row: any) => ({
    quantity: row.quantity,
    variant_id: row.variant_id ?? null,
    product: Array.isArray(row.product) ? row.product[0] : row.product,
    variant: Array.isArray(row.variant) ? row.variant[0] : row.variant,
  }));

  if (!cartItems.length) throw new Error("Cart is empty");

  const { data: reservation, error: reservationError } = await adminClient
    .from("inventory_reservations")
    .insert({
      user_id: userId,
      cart_id: cartId,
      status: "active",
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (reservationError || !reservation) throw new Error(reservationError?.message || "Could not create reservation");

  const moved: Array<{ productId: string; variantId?: string | null; quantity: number }> = [];
  try {
    for (const item of cartItems) {
      if (!item.product?.id) throw new Error("Product missing in cart");
      if (item.variant_id && (!item.variant || item.variant.active === false)) {
        throw new Error("One or more selected variants are unavailable");
      }

      const line = {
        productId: item.product.id,
        variantId: item.variant_id ?? null,
        quantity: item.quantity,
      };
      await moveLineStock(line, "reserve");
      moved.push(line);
    }

    const rows = moved.map((item) => ({
      reservation_id: reservation.id,
      product_id: item.productId,
      variant_id: item.variantId ?? null,
      quantity: item.quantity,
    }));
    const { error: rowsError } = await adminClient.from("inventory_reservation_items").insert(rows);
    if (rowsError) throw new Error(rowsError.message || "Could not save reservation items");
  } catch (error) {
    for (const item of moved) {
      await moveLineStock(item, "restore");
    }
    await adminClient
      .from("inventory_reservations")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", reservation.id);
    throw error;
  }

  return {
    reservationId: reservation.id,
    expiresAt,
    holdMinutes: settings.reservationHoldMinutes,
    highValueCodThresholdInr: settings.highValueCodThresholdInr,
  };
};
