import { publicSupabase } from "@/lib/publicSupabase";
import { supabase } from "@/lib/supabase";
import type { HeroSlide } from "@/types/domain";

export const fetchHeroSlides = async (): Promise<HeroSlide[]> => {
  const primary = await publicSupabase
    .from("hero_slides")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!primary.error) return (primary.data ?? []) as HeroSlide[];

  const fallback = await supabase
    .from("hero_slides")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as HeroSlide[];
};

export const fetchAdminHeroSlides = async (): Promise<HeroSlide[]> => {
  const { data, error } = await supabase
    .from("hero_slides")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HeroSlide[];
};
