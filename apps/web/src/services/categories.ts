import { publicSupabase } from "@/lib/publicSupabase";
import { supabase } from "@/lib/supabase";
import { slugify } from "@/lib/utils";
import type { Category } from "@/types/domain";

export const fetchCategories = async (): Promise<Category[]> => {
  const primary = await publicSupabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (!primary.error) return (primary.data ?? []) as Category[];

  const fallback = await supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as Category[];
};

export const fetchCategoriesByGender = async (gender?: "men" | "women" | "unisex"): Promise<Category[]> => {
  let query = publicSupabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (gender) query = query.in("gender", [gender, "unisex"]);

  const primary = await query;
  if (!primary.error) return (primary.data ?? []) as Category[];

  let fallback = supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (gender) fallback = fallback.in("gender", [gender, "unisex"]);

  const fallbackRes = await fallback;
  if (fallbackRes.error) throw fallbackRes.error;
  return (fallbackRes.data ?? []) as Category[];
};

export const upsertCategory = async (input: Partial<Category> & { name: string; slug: string }) => {
  const payload = {
    name: input.name.trim(),
    slug: slugify(input.slug),
    parent_slug: input.parent_slug?.trim() || null,
    image_url: input.image_url?.trim() || null,
    display_image_url: input.display_image_url?.trim() || null,
    gender: input.gender ?? null,
    display_order: Number(input.display_order ?? 0),
    description: input.description?.trim() || null,
    is_active: input.is_active ?? true,
  };
  if (input.id) {
    const { error } = await supabase.from("categories").update(payload).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await supabase.from("categories").insert(payload).select("id").single();
  if (error || !data) throw error ?? new Error("Could not create category");
  return data.id as string;
};

export const deleteCategory = async (id: string) => {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
};

export const fetchCategoryBySlug = async (slug: string): Promise<Category | null> => {
  const normalized = slugify(slug);

  const primary = await publicSupabase
    .from("categories")
    .select("*")
    .eq("slug", normalized)
    .eq("is_active", true)
    .maybeSingle();
  if (!primary.error) return (primary.data as Category | null) ?? null;

  const fallback = await supabase
    .from("categories")
    .select("*")
    .eq("slug", normalized)
    .eq("is_active", true)
    .maybeSingle();
  if (fallback.error) throw fallback.error;
  return (fallback.data as Category | null) ?? null;
};
