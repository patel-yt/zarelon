import { supabase } from "@/lib/supabase";
import type { HomePageConfig, HomeSection } from "@/types/domain";
import { fetchBehaviorProfile } from "@/services/personalization";
import { fetchRoyalDropInsights, getSmartLayoutSuggestion } from "@/services/royalDropEngine";

const homePageFallback: HomePageConfig = {
  id: "fallback",
  layout_type: "nike",
  is_active: true,
  smart_layout_mode: false,
  smart_auto_apply: false,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const normalizeHomePage = (row: any): HomePageConfig => ({
  id: String(row.id),
  layout_type: (row.layout_type ?? "nike") as HomePageConfig["layout_type"],
  is_active: Boolean(row.is_active),
  smart_layout_mode: Boolean(row.smart_layout_mode),
  smart_auto_apply: Boolean(row.smart_auto_apply),
  created_at: String(row.created_at ?? new Date().toISOString()),
  updated_at: String(row.updated_at ?? new Date().toISOString()),
});

const normalizeHomeSection = (row: any): HomeSection => ({
  id: String(row.id),
  page_id: String(row.page_id),
  section_key: String(row.section_key),
  section_type: (row.section_type ?? "custom_block") as HomeSection["section_type"],
  display_order: Number(row.display_order ?? 0),
  is_visible: Boolean(row.is_visible),
  config_json: (row.config_json ?? {}) as Record<string, unknown>,
  created_at: String(row.created_at ?? new Date().toISOString()),
  updated_at: String(row.updated_at ?? new Date().toISOString()),
});

export const fetchActiveHomeCms = async () => {
  try {
    const pageRes = await supabase.from("home_pages").select("*").eq("is_active", true).maybeSingle();
    const page = pageRes.error || !pageRes.data ? homePageFallback : normalizeHomePage(pageRes.data);

    const sectionsRes =
      page.id === "fallback"
        ? { data: [], error: null as any }
        : await supabase.from("home_sections").select("*").eq("page_id", page.id).eq("is_visible", true).order("display_order", { ascending: true });

    const sections = sectionsRes.error ? [] : (sectionsRes.data ?? []).map(normalizeHomeSection);

    return {
      page,
      sections,
      fromFallback: Boolean(pageRes.error),
    };
  } catch {
    return {
      page: homePageFallback,
      sections: [] as HomeSection[],
      fromFallback: true,
    };
  }
};

export const fetchAdminHomePages = async (): Promise<HomePageConfig[]> => {
  const { data, error } = await supabase.from("home_pages").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeHomePage);
};

export const fetchAdminHomeSections = async (pageId: string): Promise<HomeSection[]> => {
  const { data, error } = await supabase
    .from("home_sections")
    .select("*")
    .eq("page_id", pageId)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normalizeHomeSection);
};

export const upsertHomePage = async (input: Partial<HomePageConfig> & { layout_type: HomePageConfig["layout_type"] }) => {
  const payload = {
    id: input.id ?? undefined,
    layout_type: input.layout_type,
    is_active: Boolean(input.is_active),
    smart_layout_mode: Boolean(input.smart_layout_mode),
    smart_auto_apply: Boolean(input.smart_auto_apply),
  };

  if (payload.is_active) {
    await supabase.from("home_pages").update({ is_active: false }).eq("is_active", true);
  }

  const { data, error } = payload.id
    ? await supabase.from("home_pages").update(payload).eq("id", payload.id).select("*").single()
    : await supabase.from("home_pages").insert(payload).select("*").single();
  if (error) throw error;
  return normalizeHomePage(data);
};

export const upsertHomeSection = async (input: Partial<HomeSection> & { page_id: string; section_key: string; section_type: HomeSection["section_type"] }) => {
  const payload = {
    id: input.id ?? undefined,
    page_id: input.page_id,
    section_key: input.section_key.trim(),
    section_type: input.section_type,
    display_order: Number(input.display_order ?? 0),
    is_visible: Boolean(input.is_visible ?? true),
    config_json: input.config_json ?? {},
  };

  const { data, error } = payload.id
    ? await supabase.from("home_sections").update(payload).eq("id", payload.id).select("*").single()
    : await supabase.from("home_sections").insert(payload).select("*").single();
  if (error) throw error;
  return normalizeHomeSection(data);
};

export const deleteHomeSection = async (id: string) => {
  const { error } = await supabase.from("home_sections").delete().eq("id", id);
  if (error) throw error;
};

export const reorderHomeSections = async (orderedIds: string[]) => {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { error } = await supabase.from("home_sections").update({ display_order: i }).eq("id", orderedIds[i]);
    if (error) throw error;
  }
};

export const applySmartHomeLayout = async (input: {
  sections: HomeSection[];
  userId?: string | null;
  smartMode: boolean;
}) => {
  const ordered = input.sections.slice().sort((a, b) => a.display_order - b.display_order);
  if (!input.smartMode) return ordered;

  const [profile, insights] = await Promise.all([
    fetchBehaviorProfile(input.userId),
    fetchRoyalDropInsights().catch(() => ({ topBanners: [], topCategories: [], topProducts: [] })),
  ]);

  const suggestion = getSmartLayoutSuggestion({
    topCategories: insights.topCategories,
    topProducts: insights.topProducts,
  });

  const score = (section: HomeSection) => {
    const config = section.config_json ?? {};
    const key = `${section.section_key} ${String(config["title"] ?? "")} ${String(config["category"] ?? "")}`.toLowerCase();
    let points = 0;

    if (profile.preferredGender === "men" && key.includes("men")) points += 7;
    if (profile.preferredGender === "women" && key.includes("women")) points += 7;
    if (profile.watchLover && key.includes("watch")) points += 9;
    if (profile.highSpender && (key.includes("premium") || key.includes("vip"))) points += 6;
    if (suggestion.highlight === "men" && key.includes("men")) points += 5;
    if (suggestion.highlight === "watch" && key.includes("watch")) points += 5;
    if (section.section_type === "hero") points += 4;

    return points;
  };

  return ordered
    .map((section, idx) => ({ section, score: score(section), idx }))
    .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
    .map((item) => item.section);
};

export const generateFestivalBannerText = (input: {
  festivalName: string;
  discountPercent: number;
  categoryFocus: string;
  tone: "sporty" | "luxury" | "bold" | "emotional";
}) => {
  const f = input.festivalName.trim() || "Royal Drop Fest";
  const d = Math.max(0, Math.round(input.discountPercent || 0));
  const c = input.categoryFocus.trim() || "signature styles";

  const bank = {
    sporty: {
      headline: `${f} is Live. Move Fast.`,
      subtitle: `${d}% OFF on ${c} built for performance days.`,
      cta: "Shop the Drop",
      urgency: "Limited stock. Speed wins.",
    },
    luxury: {
      headline: `${f}: Curated Luxury, Limited Window`,
      subtitle: `Enjoy up to ${d}% OFF on ${c} with premium finish.`,
      cta: "Explore Collection",
      urgency: "Exclusive pieces. Limited timeline.",
    },
    bold: {
      headline: `${f} Starts Now`,
      subtitle: `${d}% OFF on ${c}. No second window.`,
      cta: "Claim Offer",
      urgency: "Ends soon. Own it before it is gone.",
    },
    emotional: {
      headline: `Celebrate ${f} in Signature Style`,
      subtitle: `Save ${d}% on ${c} and gift your best moments.`,
      cta: "Celebrate & Shop",
      urgency: "Moments pass fast. Offer ends soon.",
    },
  } as const;

  return bank[input.tone];
};

export const suggestHomeSectionOrder = async (sections: HomeSection[]) => {
  const insights = await fetchRoyalDropInsights().catch(() => ({ topBanners: [], topCategories: [], topProducts: [] }));
  const sorted = sections
    .slice()
    .sort((a, b) => {
      const aKey = a.section_key.toLowerCase();
      const bKey = b.section_key.toLowerCase();
      const aHit = insights.topCategories.some((item) => aKey.includes(item.id.toLowerCase())) ? 1 : 0;
      const bHit = insights.topCategories.some((item) => bKey.includes(item.id.toLowerCase())) ? 1 : 0;
      return bHit - aHit || a.display_order - b.display_order;
    })
    .map((section, idx) => ({ ...section, display_order: idx }));

  return {
    suggested: sorted,
    reason: "Suggested using top category clicks and banner engagement in last 7 days.",
  };
};
