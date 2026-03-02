import { supabase } from "@/lib/supabase";
import type { Festival } from "@/types/domain";
import { fetchActiveSiteFestival } from "@/services/siteFestivals";

export const fetchActiveFestival = async (): Promise<Festival | null> => {
  try {
    const siteFestival = await fetchActiveSiteFestival();
    if (siteFestival) {
      return {
        id: siteFestival.id,
        festival_name: siteFestival.festival_name,
        slug: siteFestival.slug,
        banner_image: siteFestival.hero_image_url,
        start_date: siteFestival.start_date,
        end_date: siteFestival.end_date,
        active: siteFestival.is_active,
        festival_discount: siteFestival.discount_percent,
        created_at: siteFestival.created_at,
      };
    }
  } catch {
    // Fall back to legacy festivals table if dynamic site festival fetch fails.
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("festivals")
    .select("*")
    .eq("active", true)
    .lte("start_date", now)
    .gte("end_date", now)
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (error) throw error;
  return data;
};

export const fetchFestivals = async (): Promise<Festival[]> => {
  const { data, error } = await supabase
    .from("festivals")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
};
