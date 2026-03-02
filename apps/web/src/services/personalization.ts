import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/domain";

type BehaviorEventType = "view_product" | "add_to_cart" | "search";

type BehaviorEventInsert = {
  user_id: string;
  event_type: BehaviorEventType;
  product_id?: string | null;
  category_slug?: string | null;
  gender?: "men" | "women" | "unisex" | null;
  search_term?: string | null;
  amount_inr?: number | null;
  meta?: Record<string, unknown>;
};

type LocalBehaviorState = {
  categoryViews: Record<string, number>;
  genderViews: Record<string, number>;
  searchTerms: Record<string, number>;
  cartAdds: number;
  totalCartValue: number;
  premiumSignals: number;
  lastViewedCategories: string[];
};

export type BehaviorProfile = {
  favoriteCategorySlug: string | null;
  preferredGender: "men" | "women" | "unisex" | null;
  watchLover: boolean;
  highSpender: boolean;
  recentCategories: string[];
  topSearchTerms: string[];
  personalizedHeroKey: "men" | "women" | "watch" | "premium" | "default";
};

const LOCAL_KEY = "zarelon_behavior_v1";
const MAX_RECENT_CATEGORIES = 8;
const MAX_SEARCH_TERMS = 20;
const REMOTE_SAMPLE_LIMIT = 180;

const emptyLocalState = (): LocalBehaviorState => ({
  categoryViews: {},
  genderViews: {},
  searchTerms: {},
  cartAdds: 0,
  totalCartValue: 0,
  premiumSignals: 0,
  lastViewedCategories: [],
});

const normalizeSlug = (value?: string | null) => (value ?? "").trim().toLowerCase();

const readLocalState = (): LocalBehaviorState => {
  if (typeof window === "undefined") return emptyLocalState();
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return emptyLocalState();
    const parsed = JSON.parse(raw) as LocalBehaviorState;
    if (!parsed || typeof parsed !== "object") return emptyLocalState();
    return {
      categoryViews: parsed.categoryViews ?? {},
      genderViews: parsed.genderViews ?? {},
      searchTerms: parsed.searchTerms ?? {},
      cartAdds: Number(parsed.cartAdds ?? 0),
      totalCartValue: Number(parsed.totalCartValue ?? 0),
      premiumSignals: Number(parsed.premiumSignals ?? 0),
      lastViewedCategories: Array.isArray(parsed.lastViewedCategories) ? parsed.lastViewedCategories.slice(0, MAX_RECENT_CATEGORIES) : [],
    };
  } catch {
    return emptyLocalState();
  }
};

const writeLocalState = (state: LocalBehaviorState) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    LOCAL_KEY,
    JSON.stringify({
      ...state,
      lastViewedCategories: state.lastViewedCategories.slice(0, MAX_RECENT_CATEGORIES),
      searchTerms: Object.fromEntries(Object.entries(state.searchTerms).slice(0, MAX_SEARCH_TERMS)),
    })
  );
};

const syncUserBehaviorSnapshot = async (userId: string, state: LocalBehaviorState) => {
  try {
    const mostViewedCategory = Object.entries(state.categoryViews).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    await supabase
      .from("users")
      .update({
        most_viewed_category: mostViewedCategory,
        recent_visits: state.lastViewedCategories,
      })
      .eq("id", userId);
  } catch {
    // best-effort only
  }
};

const bump = (map: Record<string, number>, key: string, inc = 1) => {
  if (!key) return;
  map[key] = (map[key] ?? 0) + inc;
};

const pushRecentCategory = (list: string[], slug: string) => {
  const normalized = normalizeSlug(slug);
  if (!normalized) return list;
  const next = [normalized, ...list.filter((item) => item !== normalized)];
  return next.slice(0, MAX_RECENT_CATEGORIES);
};

const trackRemoteEvent = async (payload: BehaviorEventInsert) => {
  try {
    await supabase.from("user_behavior_events").insert({
      user_id: payload.user_id,
      event_type: payload.event_type,
      product_id: payload.product_id ?? null,
      category_slug: normalizeSlug(payload.category_slug),
      gender: payload.gender ?? null,
      search_term: payload.search_term?.trim().toLowerCase() ?? null,
      amount_inr: payload.amount_inr ?? null,
      meta: payload.meta ?? {},
    });
  } catch {
    // Tracking is best-effort only.
  }
};

export const trackProductView = async (params: {
  userId?: string | null;
  productId?: string | null;
  categorySlug?: string | null;
  gender?: "men" | "women" | "unisex" | null;
  priceInr?: number | null;
}) => {
  const state = readLocalState();
  const categorySlug = normalizeSlug(params.categorySlug);
  if (categorySlug) {
    bump(state.categoryViews, categorySlug, 1);
    state.lastViewedCategories = pushRecentCategory(state.lastViewedCategories, categorySlug);
  }
  if (params.gender) bump(state.genderViews, params.gender, 1);
  if ((params.priceInr ?? 0) >= 10000) state.premiumSignals += 1;
  writeLocalState(state);
  if (params.userId) void syncUserBehaviorSnapshot(params.userId, state);

  if (params.userId) {
    await trackRemoteEvent({
      user_id: params.userId,
      event_type: "view_product",
      product_id: params.productId ?? null,
      category_slug: categorySlug,
      gender: params.gender ?? null,
      amount_inr: params.priceInr ?? null,
    });
  }
};

export const trackCartAdd = async (params: {
  userId?: string | null;
  productId?: string | null;
  categorySlug?: string | null;
  gender?: "men" | "women" | "unisex" | null;
  amountInr?: number | null;
}) => {
  const state = readLocalState();
  state.cartAdds += 1;
  state.totalCartValue += Math.max(0, Number(params.amountInr ?? 0));
  const categorySlug = normalizeSlug(params.categorySlug);
  if (categorySlug) {
    bump(state.categoryViews, categorySlug, 2);
    state.lastViewedCategories = pushRecentCategory(state.lastViewedCategories, categorySlug);
  }
  if (params.gender) bump(state.genderViews, params.gender, 1);
  if ((params.amountInr ?? 0) >= 12000) state.premiumSignals += 2;
  writeLocalState(state);
  if (params.userId) void syncUserBehaviorSnapshot(params.userId, state);

  if (params.userId) {
    await trackRemoteEvent({
      user_id: params.userId,
      event_type: "add_to_cart",
      product_id: params.productId ?? null,
      category_slug: categorySlug,
      gender: params.gender ?? null,
      amount_inr: params.amountInr ?? null,
    });
  }
};

export const trackSearchTerm = async (params: { userId?: string | null; query: string }) => {
  const query = params.query.trim().toLowerCase();
  if (!query || query.length < 2) return;

  const state = readLocalState();
  bump(state.searchTerms, query, 1);
  if (query.includes("watch")) state.premiumSignals += 1;
  writeLocalState(state);
  if (params.userId) void syncUserBehaviorSnapshot(params.userId, state);

  if (params.userId) {
    await trackRemoteEvent({
      user_id: params.userId,
      event_type: "search",
      search_term: query,
    });
  }
};

const mergeBehaviorState = (base: LocalBehaviorState, incoming: LocalBehaviorState) => {
  const out = emptyLocalState();
  for (const [k, v] of Object.entries(base.categoryViews)) bump(out.categoryViews, k, v);
  for (const [k, v] of Object.entries(incoming.categoryViews)) bump(out.categoryViews, k, v);
  for (const [k, v] of Object.entries(base.genderViews)) bump(out.genderViews, k, v);
  for (const [k, v] of Object.entries(incoming.genderViews)) bump(out.genderViews, k, v);
  for (const [k, v] of Object.entries(base.searchTerms)) bump(out.searchTerms, k, v);
  for (const [k, v] of Object.entries(incoming.searchTerms)) bump(out.searchTerms, k, v);
  out.cartAdds = base.cartAdds + incoming.cartAdds;
  out.totalCartValue = base.totalCartValue + incoming.totalCartValue;
  out.premiumSignals = base.premiumSignals + incoming.premiumSignals;
  out.lastViewedCategories = [...incoming.lastViewedCategories, ...base.lastViewedCategories]
    .filter((item, idx, arr) => Boolean(item) && arr.indexOf(item) === idx)
    .slice(0, MAX_RECENT_CATEGORIES);
  return out;
};

const toProfile = (state: LocalBehaviorState): BehaviorProfile => {
  const favoriteCategorySlug = Object.entries(state.categoryViews).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const preferredGender = (Object.entries(state.genderViews).sort((a, b) => b[1] - a[1])[0]?.[0] as
    | "men"
    | "women"
    | "unisex"
    | undefined) ?? null;

  const topSearchTerms = Object.entries(state.searchTerms)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  const watchLover =
    favoriteCategorySlug?.includes("watch") === true ||
    state.lastViewedCategories.some((item) => item.includes("watch")) ||
    topSearchTerms.some((term) => term.includes("watch"));

  const avgCartValue = state.cartAdds ? state.totalCartValue / state.cartAdds : 0;
  const highSpender = avgCartValue >= 5000 || state.premiumSignals >= 4;

  let personalizedHeroKey: BehaviorProfile["personalizedHeroKey"] = "default";
  if (highSpender) personalizedHeroKey = "premium";
  else if (watchLover) personalizedHeroKey = "watch";
  else if (preferredGender === "men") personalizedHeroKey = "men";
  else if (preferredGender === "women") personalizedHeroKey = "women";

  return {
    favoriteCategorySlug,
    preferredGender,
    watchLover,
    highSpender,
    recentCategories: state.lastViewedCategories,
    topSearchTerms,
    personalizedHeroKey,
  };
};

export const fetchBehaviorProfile = async (userId?: string | null): Promise<BehaviorProfile> => {
  const local = readLocalState();
  if (!userId) return toProfile(local);

  try {
    const remoteQuery = await supabase
      .from("user_behavior_events")
      .select("event_type, category_slug, gender, search_term, amount_inr")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(REMOTE_SAMPLE_LIMIT);

    if (remoteQuery.error) return toProfile(local);

    const remote = emptyLocalState();
    for (const row of remoteQuery.data ?? []) {
      const category = normalizeSlug((row as { category_slug?: string | null }).category_slug);
      const gender = (row as { gender?: "men" | "women" | "unisex" | null }).gender;
      const eventType = (row as { event_type?: BehaviorEventType }).event_type;
      const amount = Number((row as { amount_inr?: number | null }).amount_inr ?? 0);
      const searchTerm = (row as { search_term?: string | null }).search_term?.trim().toLowerCase() ?? "";

      if (category) {
        bump(remote.categoryViews, category, eventType === "add_to_cart" ? 2 : 1);
        remote.lastViewedCategories = pushRecentCategory(remote.lastViewedCategories, category);
      }
      if (gender) bump(remote.genderViews, gender, 1);
      if (searchTerm) bump(remote.searchTerms, searchTerm, 1);

      if (eventType === "add_to_cart") {
        remote.cartAdds += 1;
        remote.totalCartValue += Math.max(0, amount);
      }

      if (amount >= 10000 || searchTerm.includes("watch")) remote.premiumSignals += 1;
    }

    return toProfile(mergeBehaviorState(local, remote));
  } catch {
    return toProfile(local);
  }
};

export const rankProductsForProfile = <T extends Product>(products: T[], profile: BehaviorProfile): T[] => {
  const scored = products.map((product) => {
    let score = 0;

    if (profile.favoriteCategorySlug && normalizeSlug(product.category_slug ?? product.category).includes(profile.favoriteCategorySlug)) {
      score += 8;
    }
    if (profile.watchLover && normalizeSlug(product.category_slug ?? product.category).includes("watch")) {
      score += 7;
    }
    if (profile.highSpender && ((product.price_inr ?? 0) >= 7000 || (product.collection_slug ?? "").includes("premium"))) {
      score += 6;
    }
    if (profile.preferredGender && (product.gender === profile.preferredGender || product.gender === "unisex")) {
      score += 4;
    }
    if (profile.recentCategories.some((slug) => normalizeSlug(product.category_slug ?? product.category).includes(slug))) {
      score += 3;
    }

    return { product, score };
  });

  return scored.sort((a, b) => b.score - a.score).map((item) => item.product);
};

export const getPersonalizedHeroContent = (profile: BehaviorProfile) => {
  const variants: Record<BehaviorProfile["personalizedHeroKey"], { subtitle: string; title: string; description: string; buttonText: string; buttonLink: string; image: string }> = {
    default: {
      subtitle: "ZARELON",
      title: "Premium Editorial Store",
      description: "Luxury essentials designed for modern, elevated everyday style.",
      buttonText: "Shop Now",
      buttonLink: "/products",
      image: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1800&q=80",
    },
    men: {
      subtitle: "For You",
      title: "Men's Performance Edit",
      description: "Bold staples and performance silhouettes selected from your activity.",
      buttonText: "Shop Men",
      buttonLink: "/men",
      image: "https://images.unsplash.com/photo-1617137968427-85924c800a22?auto=format&fit=crop&w=1800&q=80",
    },
    women: {
      subtitle: "For You",
      title: "Women's Editorial Picks",
      description: "Modern fashion-led pieces tailored to your browsing pattern.",
      buttonText: "Shop Women",
      buttonLink: "/women",
      image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1800&q=80",
    },
    watch: {
      subtitle: "For Watch Lovers",
      title: "Precision Watch Collection",
      description: "You explored watches, so we moved top timepieces to the front.",
      buttonText: "Shop Watches",
      buttonLink: "/products?q=watch",
      image: "https://images.unsplash.com/photo-1508057198894-247b23fe5ade?auto=format&fit=crop&w=1800&q=80",
    },
    premium: {
      subtitle: "Premium Access",
      title: "Luxury Signature Collection",
      description: "High-value curation tailored for premium shoppers.",
      buttonText: "View Premium",
      buttonLink: "/collections/premium",
      image: "https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=1800&q=80",
    },
  };

  return variants[profile.personalizedHeroKey] ?? variants.default;
};

export const getBehaviorSummaryLabel = (profile: BehaviorProfile): string => {
  if (profile.highSpender) return "Premium picks tuned to your spend pattern";
  if (profile.watchLover) return "Watch-focused picks based on your activity";
  if (profile.preferredGender === "men") return "Men-first curation from your browsing";
  if (profile.preferredGender === "women") return "Women-first curation from your browsing";
  return "Trending picks selected for you";
};
