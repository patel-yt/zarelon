import { supabase } from "@/lib/supabase";

export const fetchPurchasedProductIds = async (userId: string): Promise<string[]> => {
  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (orderError) throw orderError;
  const orderIds = (orders ?? []).map((item) => item.id);
  if (!orderIds.length) return [];

  const { data: items, error: itemError } = await supabase
    .from("order_items")
    .select("product_id")
    .in("order_id", orderIds);
  if (itemError) throw itemError;
  return Array.from(new Set((items ?? []).map((item) => item.product_id).filter(Boolean)));
};
