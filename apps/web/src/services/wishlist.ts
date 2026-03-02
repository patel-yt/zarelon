import { supabase } from "@/lib/supabase";

const ensureWishlist = async (userId: string): Promise<string> => {
  const { data: existing } = await supabase.from("wishlists").select("id").eq("user_id", userId).maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("wishlists")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
};

export const getWishlist = async (userId: string) => {
  const wishlistId = await ensureWishlist(userId);
  const { data, error } = await supabase
    .from("wishlist_items")
    .select("id, product:products(*)")
    .eq("wishlist_id", wishlistId);
  if (error) throw error;
  return data ?? [];
};

export const toggleWishlistItem = async (userId: string, productId: string) => {
  const wishlistId = await ensureWishlist(userId);
  const { data: existing } = await supabase
    .from("wishlist_items")
    .select("id")
    .eq("wishlist_id", wishlistId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from("wishlist_items").delete().eq("id", existing.id);
    return false;
  }

  await supabase.from("wishlist_items").insert({ wishlist_id: wishlistId, product_id: productId });
  return true;
};
