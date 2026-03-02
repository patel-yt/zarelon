import { supabase } from "@/lib/supabase";
import type { ProductReview } from "@/types/domain";

export const fetchProductReviews = async (productId: string): Promise<ProductReview[]> => {
  const { data, error } = await supabase
    .from("product_reviews")
    .select("id,product_id,user_id,rating,title,comment,image_urls,created_at,updated_at,user:users(name,email)")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as ProductReview[];
  const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));
  if (!userIds.length) return rows;

  const eliteRes = await supabase
    .from("elite_progress")
    .select("user_id,current_tier:elite_tiers!elite_progress_current_tier_id_fkey(name)")
    .in("user_id", userIds);
  const eliteMap = new Map<string, string>();
  if (!eliteRes.error) {
    for (const row of eliteRes.data ?? []) {
      const tier = Array.isArray((row as any).current_tier) ? (row as any).current_tier[0] : (row as any).current_tier;
      eliteMap.set(String((row as any).user_id), String(tier?.name ?? ""));
    }
  }

  return rows.map((row) => ({
    ...row,
    user: {
      ...(row.user ?? {}),
      elite_tier: eliteMap.get(row.user_id) ?? null,
    },
  }));
};

export const createProductReview = async (input: {
  product_id: string;
  user_id: string;
  rating: number;
  title?: string;
  comment?: string;
  image_urls?: string[];
}): Promise<void> => {
  const { error } = await supabase.from("product_reviews").upsert(
    {
      product_id: input.product_id,
      user_id: input.user_id,
      rating: input.rating,
      title: input.title ?? null,
      comment: input.comment ?? null,
      image_urls: input.image_urls ?? [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id,user_id" }
  );
  if (error) throw error;
};
