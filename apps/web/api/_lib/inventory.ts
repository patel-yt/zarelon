import { adminClient } from "./server.js";

export const restoreOrderInventory = async (orderId: string) => {
  type InventoryLineItem = {
    product_id: string;
    quantity: number;
    variant_id: string | null;
  };

  const lineItemsRes = await adminClient
    .from("order_items")
    .select("product_id, variant_id, quantity")
    .eq("order_id", orderId);

  let lineItems: InventoryLineItem[] = [];

  if (lineItemsRes.error && String(lineItemsRes.error.message ?? "").toLowerCase().includes("variant")) {
    const fallbackRes = await adminClient.from("order_items").select("product_id, quantity").eq("order_id", orderId);
    if (fallbackRes.error) {
      throw new Error(fallbackRes.error.message || "Could not load order items for inventory restore");
    }
    lineItems = (fallbackRes.data ?? []).map((item) => ({
      product_id: item.product_id,
      quantity: Number(item.quantity ?? 0),
      variant_id: null,
    }));
  } else if (lineItemsRes.error) {
    throw new Error(lineItemsRes.error.message || "Could not load order items for inventory restore");
  } else {
    lineItems = (lineItemsRes.data ?? []).map((item) => ({
      product_id: item.product_id,
      quantity: Number(item.quantity ?? 0),
      variant_id: item.variant_id ?? null,
    }));
  }

  for (const item of lineItems) {
    if (item.variant_id) {
      const { data: variant, error: variantReadError } = await adminClient
        .from("product_variants")
        .select("stock")
        .eq("id", item.variant_id)
        .maybeSingle();
      if (variantReadError) throw new Error(variantReadError.message || "Could not read variant stock");

      const { error: variantUpdateError } = await adminClient
        .from("product_variants")
        .update({ stock: (variant?.stock ?? 0) + item.quantity })
        .eq("id", item.variant_id);
      if (variantUpdateError) throw new Error(variantUpdateError.message || "Could not restore variant stock");
    }

    const { data: product, error: productReadError } = await adminClient
      .from("products")
      .select("stock")
      .eq("id", item.product_id)
      .maybeSingle();
    if (productReadError) throw new Error(productReadError.message || "Could not read product stock");

    const { error: productUpdateError } = await adminClient
      .from("products")
      .update({
        stock: (product?.stock ?? 0) + item.quantity,
        active: (product?.stock ?? 0) + item.quantity > 0,
      })
      .eq("id", item.product_id);
    if (productUpdateError) throw new Error(productUpdateError.message || "Could not restore product stock");
  }
};
