import { publicSupabase } from "@/lib/publicSupabase";
import { supabase } from "@/lib/supabase";
import { scarcityDropApi } from "@/lib/apiClient";
import type { Drop, Product } from "@/types/domain";

export type DropWithProducts = Drop & { products: Product[] };
export type DropAnalytics = {
  views: number;
  add_to_cart: number;
  waitlist_join: number;
  purchases: number;
  conversion_rate: number;
  stock_timeline: Array<{ time: string; available_stock: number }>;
  time_to_sell_out_hours: number | null;
};

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const normalizeDrop = (row: any): Drop => ({
  ...row,
  description: row?.description ?? null,
  minimum_spend_required:
    row?.minimum_spend_required == null
      ? null
      : typeof row.minimum_spend_required === "number"
      ? row.minimum_spend_required
      : Number(row.minimum_spend_required),
  early_access_hours: Number(row?.early_access_hours ?? 0),
  minimum_tier_required: row?.minimum_tier_required ?? null,
});

const safeProductQuery = async (dropId: string): Promise<Product[]> => {
  const primary = await publicSupabase
    .from("products")
    .select("*")
    .eq("drop_id", dropId)
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (!primary.error) return (primary.data ?? []) as Product[];

  const fallback = await supabase
    .from("products")
    .select("*")
    .eq("drop_id", dropId)
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as Product[];
};

export const fetchActiveDrops = async (): Promise<Drop[]> => {
  const primary = await publicSupabase
    .from("drops")
    .select("*")
    .eq("is_active", true)
    .order("start_time", { ascending: false });
  if (!primary.error) return (primary.data ?? []).map(normalizeDrop) as Drop[];

  const fallback = await supabase
    .from("drops")
    .select("*")
    .eq("is_active", true)
    .order("start_time", { ascending: false });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map(normalizeDrop) as Drop[];
};

export const fetchDropsByIds = async (dropIds: string[]): Promise<Drop[]> => {
  const ids = Array.from(new Set(dropIds.filter(Boolean)));
  if (!ids.length) return [];
  const primary = await publicSupabase.from("drops").select("*").in("id", ids);
  if (!primary.error) return (primary.data ?? []).map(normalizeDrop) as Drop[];

  const fallback = await supabase.from("drops").select("*").in("id", ids);
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []).map(normalizeDrop) as Drop[];
};

export const fetchDropBySlug = async (slug: string): Promise<DropWithProducts | null> => {
  const normalized = toSlug(slug);
  const primary = await publicSupabase
    .from("drops")
    .select("*")
    .eq("slug", normalized)
    .eq("is_active", true)
    .maybeSingle();

  let drop: Drop | null = null;
  if (!primary.error) {
    drop = primary.data ? normalizeDrop(primary.data) : null;
  } else {
    const fallback = await supabase
      .from("drops")
      .select("*")
      .eq("slug", normalized)
      .eq("is_active", true)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    drop = fallback.data ? normalizeDrop(fallback.data) : null;
  }

  if (!drop) return null;
  let products = await safeProductQuery(drop.id);
  try {
    const serverDrop = await scarcityDropApi.getDropProducts(drop.id);
    if (serverDrop.access?.allowed) {
      products = (serverDrop.products ?? [])
        .map((row: any) => (Array.isArray(row.product) ? row.product[0] : row.product))
        .filter(Boolean) as Product[];
    } else {
      products = [];
    }
  } catch {
    // fallback to direct product fetch
  }
  try {
    const soldRes = await supabase.rpc("get_drop_sold_quantity", { p_drop_id: drop.id });
    if (!soldRes.error) {
      const sold = Number(soldRes.data ?? 0);
      drop.available_stock = Math.max(0, drop.total_stock - sold);
    }
  } catch {
    // no-op; fallback to persisted stock
  }
  return { ...drop, products };
};

export const fetchAdminDrops = async (): Promise<Drop[]> => {
  const { data, error } = await supabase.from("drops").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeDrop) as Drop[];
};

export const upsertDrop = async (
  input: Partial<Drop> & { name: string; slug: string },
  productIds: string[]
): Promise<string> => {
  const payload = {
    name: input.name.trim(),
    slug: toSlug(input.slug),
    description: input.description?.trim() ?? null,
    hero_media_type: input.hero_media_type ?? "image",
    hero_media_url: input.hero_media_url?.trim() ?? "",
    start_time: input.start_time,
    end_time: input.end_time,
    total_stock: Math.max(0, Number(input.total_stock ?? 0)),
    available_stock: Math.max(0, Number(input.available_stock ?? 0)),
    access_type: input.access_type ?? "public",
    minimum_spend_required:
      input.minimum_spend_required == null || input.minimum_spend_required === ("" as unknown as number)
        ? null
        : Number(input.minimum_spend_required),
    required_loyalty_points:
      input.required_loyalty_points == null || input.required_loyalty_points === ("" as unknown as number)
        ? null
        : Math.max(0, Number(input.required_loyalty_points)),
    early_access_hours: Math.max(0, Number(input.early_access_hours ?? 0)),
    minimum_tier_required: input.minimum_tier_required ?? null,
    is_active: input.is_active ?? false,
    updated_at: new Date().toISOString(),
  };

  let dropId = input.id;
  if (dropId) {
    const { error } = await supabase.from("drops").update(payload).eq("id", dropId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from("drops").insert(payload).select("id").single();
    if (error || !data) throw error ?? new Error("Could not create drop");
    dropId = data.id as string;
  }

  const current = await supabase.from("products").select("id").eq("drop_id", dropId);
  if (current.error) throw current.error;
  const currentlyAssigned = (current.data ?? []).map((row) => row.id as string);
  const selected = Array.from(new Set(productIds.filter(Boolean)));

  const toUnassign = currentlyAssigned.filter((id) => !selected.includes(id));
  if (toUnassign.length) {
    const { error } = await supabase.from("products").update({ drop_id: null }).in("id", toUnassign);
    if (error) throw error;
  }

  if (selected.length) {
    const { error } = await supabase.from("products").update({ drop_id: dropId }).in("id", selected);
    if (error) throw error;
  }

  return dropId;
};

export const deleteDrop = async (dropId: string) => {
  await supabase.from("products").update({ drop_id: null }).eq("drop_id", dropId);
  const { error } = await supabase.from("drops").delete().eq("id", dropId);
  if (error) throw error;
};

export const updateDropStock = async (dropId: string, availableStock: number) => {
  const { error } = await supabase
    .from("drops")
    .update({ available_stock: Math.max(0, Math.floor(availableStock)), updated_at: new Date().toISOString() })
    .eq("id", dropId);
  if (error) throw error;
};

export const claimDropStock = async (dropId: string, quantity: number) => {
  const { data, error } = await supabase.rpc("claim_drop_stock", { p_drop_id: dropId, p_quantity: quantity });
  if (error) throw error;
  return Boolean(data);
};

export const releaseDropStock = async (dropId: string, quantity: number) => {
  const { data, error } = await supabase.rpc("release_drop_stock", { p_drop_id: dropId, p_quantity: quantity });
  if (error) throw error;
  return Boolean(data);
};

export const joinDropWaitlist = async (input: { dropId: string; email: string; userId?: string | null }) => {
  const payload = {
    drop_id: input.dropId,
    email: input.email.trim().toLowerCase(),
    user_id: input.userId ?? null,
  };
  const { error } = await supabase.from("drop_waitlist").upsert(payload, { onConflict: "drop_id,email" });
  if (error) throw error;
};

export const trackDropEvent = async (input: {
  dropId: string;
  eventType: "view" | "add_to_cart" | "waitlist_join" | "purchase";
  userId?: string | null;
  meta?: Record<string, unknown>;
}) => {
  try {
    await supabase.from("drop_events").insert({
      drop_id: input.dropId,
      user_id: input.userId ?? null,
      event_type: input.eventType,
      meta: input.meta ?? {},
    });
  } catch {
    // best-effort analytics
  }
};

export const fetchDropAnalytics = async (dropId: string): Promise<DropAnalytics> => {
  const [eventsRes, dropRes] = await Promise.all([
    supabase.from("drop_events").select("event_type,created_at,meta").eq("drop_id", dropId).order("created_at", { ascending: true }),
    supabase.from("drops").select("created_at,end_time,total_stock,available_stock").eq("id", dropId).maybeSingle(),
  ]);

  const events = eventsRes.error ? [] : eventsRes.data ?? [];
  const views = events.filter((e) => e.event_type === "view").length;
  const add_to_cart = events.filter((e) => e.event_type === "add_to_cart").length;
  const waitlist_join = events.filter((e) => e.event_type === "waitlist_join").length;
  const purchases = events.filter((e) => e.event_type === "purchase").length;
  const conversion_rate = views > 0 ? Number(((purchases / views) * 100).toFixed(2)) : 0;

  const drop = dropRes.error ? null : dropRes.data;
  const stock_timeline = events
    .filter((e) => e.event_type === "add_to_cart" || e.event_type === "purchase")
    .slice(-24)
    .map((e, index) => ({
      time: e.created_at,
      available_stock: Math.max(0, Number(drop?.available_stock ?? 0) - (events.length - index - 1)),
    }));

  let time_to_sell_out_hours: number | null = null;
  if (drop && Number(drop.available_stock) <= 0) {
    const first = new Date(drop.created_at).getTime();
    const soldOutAt = events
      .slice()
      .reverse()
      .find((e) => e.event_type === "purchase" || e.event_type === "add_to_cart")?.created_at;
    if (soldOutAt) {
      time_to_sell_out_hours = Number((((new Date(soldOutAt).getTime() - first) / (1000 * 60 * 60))).toFixed(2));
    }
  }

  return { views, add_to_cart, waitlist_join, purchases, conversion_rate, stock_timeline, time_to_sell_out_hours };
};

export const computeDropDerivedStock = (drop: Drop, products: Product[]): number => {
  const sumProducts = products.reduce((sum, item) => sum + Math.max(0, Number(item.stock ?? 0)), 0);
  if (drop.available_stock <= 0) return sumProducts;
  if (sumProducts <= 0) return drop.available_stock;
  return Math.min(drop.available_stock, sumProducts);
};

export const evaluateDropAccess = async (
  drop: Drop,
  _userId?: string | null
): Promise<{ allowed: boolean; reason: string | null }> => {
  try {
    const response = await scarcityDropApi.getDropProducts(drop.id);
    return {
      allowed: Boolean(response.access?.allowed),
      reason: response.access?.reason ?? null,
    };
  } catch {
    return { allowed: false, reason: "Access check unavailable." };
  }
};
