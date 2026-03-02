import { supabase } from "@/lib/supabase";

export type CartReservation = {
  id: string;
  user_id: string;
  product_id: string;
  expires_at: string;
  created_at: string;
};

export type DropFlashSchedule = {
  id: string;
  drop_id: string;
  starts_at: string;
  extra_discount_percent: number;
  is_active: boolean;
};

export type LivePurchasePulse = {
  viewers: number;
  soldLast10Min: number;
  stockLeft: number;
};

const DISABLE_FLASH_KEY = "zarelon:disable_drop_flash_schedule";
const DISABLE_CART_RESERVATION_KEY = "zarelon:disable_cart_reservations";
const FLASH_TABLE_ENABLED = import.meta.env.VITE_ENABLE_FLASH_TABLE !== "false";
const CART_RES_TABLE_ENABLED = import.meta.env.VITE_ENABLE_CART_RESERVATIONS !== "false";

const readDisabledFlag = (key: string): boolean => {
  void key;
  return false;
};

let flashScheduleDisabled = !FLASH_TABLE_ENABLED || readDisabledFlag(DISABLE_FLASH_KEY);
let cartReservationsDisabled = !CART_RES_TABLE_ENABLED || readDisabledFlag(DISABLE_CART_RESERVATION_KEY);
let loggedFlashDisable = false;
let loggedCartDisable = false;

const markDisabled = (key: string) => {
  void key;
};

const isMissingRelationError = (error: { code?: string; message?: string; details?: string } | null | undefined, relation: string) => {
  const raw = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return (
    raw.includes(relation) ||
    raw.includes("relation") ||
    raw.includes("does not exist") ||
    raw.includes("pgrst205") ||
    raw.includes("42p01")
  );
};

export const upsertCartReservation = async (userId: string, productId: string, minutes = 10): Promise<string> => {
  if (cartReservationsDisabled) return "";
  const { data, error } = await supabase.rpc("upsert_cart_reservation", {
    p_user_id: userId,
    p_product_id: productId,
    p_minutes: minutes,
  });
  if (error) {
    if (isMissingRelationError(error, "cart_reservations") || isMissingRelationError(error, "upsert_cart_reservation")) {
      cartReservationsDisabled = true;
      markDisabled(DISABLE_CART_RESERVATION_KEY);
      if (!loggedCartDisable) {
        loggedCartDisable = true;
        console.info("[drops] cart_reservations not found. Reservation layer disabled.");
      }
      return "";
    }
    throw error;
  }
  return String(data);
};

export const fetchCartReservations = async (userId: string, productIds: string[]): Promise<CartReservation[]> => {
  if (cartReservationsDisabled) return [];
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (!ids.length) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("cart_reservations")
    .select("id,user_id,product_id,expires_at,created_at")
    .eq("user_id", userId)
    .in("product_id", ids)
    .gt("expires_at", nowIso);
  if (error) {
    if (isMissingRelationError(error, "cart_reservations")) {
      cartReservationsDisabled = true;
      markDisabled(DISABLE_CART_RESERVATION_KEY);
      if (!loggedCartDisable) {
        loggedCartDisable = true;
        console.info("[drops] cart_reservations not found. Reservation layer disabled.");
      }
      return [];
    }
    throw error;
  }
  return (data ?? []) as CartReservation[];
};

export const purgeExpiredCartReservations = async (userId: string): Promise<string[]> => {
  if (cartReservationsDisabled) return [];
  const nowIso = new Date().toISOString();
  const { data: expired, error: fetchError } = await supabase
    .from("cart_reservations")
    .select("id,product_id")
    .eq("user_id", userId)
    .lte("expires_at", nowIso);
  if (fetchError) {
    if (isMissingRelationError(fetchError, "cart_reservations")) {
      cartReservationsDisabled = true;
      markDisabled(DISABLE_CART_RESERVATION_KEY);
      if (!loggedCartDisable) {
        loggedCartDisable = true;
        console.info("[drops] cart_reservations not found. Reservation layer disabled.");
      }
      return [];
    }
    throw fetchError;
  }
  if (!expired?.length) return [];

  const ids = expired.map((row) => row.id as string);
  const { error: deleteError } = await supabase.from("cart_reservations").delete().in("id", ids);
  if (deleteError) {
    if (isMissingRelationError(deleteError, "cart_reservations")) {
      cartReservationsDisabled = true;
      markDisabled(DISABLE_CART_RESERVATION_KEY);
      if (!loggedCartDisable) {
        loggedCartDisable = true;
        console.info("[drops] cart_reservations not found. Reservation layer disabled.");
      }
      return [];
    }
    throw deleteError;
  }

  return expired.map((row) => String(row.product_id));
};

export const removeCartReservation = async (userId: string, productId: string): Promise<void> => {
  if (cartReservationsDisabled) return;
  const { error } = await supabase.from("cart_reservations").delete().eq("user_id", userId).eq("product_id", productId);
  if (error) {
    if (isMissingRelationError(error, "cart_reservations")) {
      cartReservationsDisabled = true;
      markDisabled(DISABLE_CART_RESERVATION_KEY);
      if (!loggedCartDisable) {
        loggedCartDisable = true;
        console.info("[drops] cart_reservations not found. Reservation layer disabled.");
      }
      return;
    }
    throw error;
  }
};

export const getReservationRemainingMs = (expiresAtIso?: string | null): number => {
  if (!expiresAtIso) return 0;
  return Math.max(0, new Date(expiresAtIso).getTime() - Date.now());
};

export const fetchDropFlashSchedule = async (dropId: string): Promise<DropFlashSchedule[]> => {
  if (flashScheduleDisabled) return [];
  if (!dropId) return [];
  const { data, error } = await supabase
    .from("drop_flash_price_schedule")
    .select("id,drop_id,starts_at,extra_discount_percent,is_active")
    .eq("drop_id", dropId)
    .eq("is_active", true)
    .order("starts_at", { ascending: true });
  if (error) {
    if (isMissingRelationError(error, "drop_flash_price_schedule")) {
      flashScheduleDisabled = true;
      markDisabled(DISABLE_FLASH_KEY);
      if (!loggedFlashDisable) {
        loggedFlashDisable = true;
        console.info("[drops] drop_flash_price_schedule not found. Flash schedule disabled.");
      }
      return [];
    }
    throw error;
  }
  return (data ?? []).map((row) => ({
    ...(row as DropFlashSchedule),
    extra_discount_percent: Number((row as any).extra_discount_percent ?? 0),
  }));
};

export const getActiveFlashDiscount = (
  schedule: DropFlashSchedule[],
  now = Date.now()
): { percent: number; activeSlot: DropFlashSchedule | null; nextSlot: DropFlashSchedule | null } => {
  if (!schedule.length) return { percent: 0, activeSlot: null, nextSlot: null };

  const sorted = schedule.slice().sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  let activeSlot: DropFlashSchedule | null = null;
  let nextSlot: DropFlashSchedule | null = null;

  for (const slot of sorted) {
    const slotTime = new Date(slot.starts_at).getTime();
    if (slotTime <= now) activeSlot = slot;
    if (slotTime > now && !nextSlot) nextSlot = slot;
  }

  return {
    percent: Number(activeSlot?.extra_discount_percent ?? 0),
    activeSlot,
    nextSlot,
  };
};

export const applyExtraDiscount = (basePrice: number, extraPercent: number): number => {
  const safeBase = Math.max(0, Number(basePrice ?? 0));
  const safePercent = Math.min(95, Math.max(0, Number(extraPercent ?? 0)));
  return Math.round(safeBase * (1 - safePercent / 100));
};

export const fetchLivePurchasePulse = async (
  productId: string,
  dropId: string | null,
  stockLeft: number
): Promise<LivePurchasePulse> => {
  let soldLast10Min = 0;

  if (dropId) {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("drop_events")
      .select("id")
      .eq("drop_id", dropId)
      .in("event_type", ["purchase", "add_to_cart"])
      .gte("created_at", since);
    soldLast10Min = data?.length ?? 0;
  }

  const jitterSeed = Math.abs(hashCode(`${productId}:${Math.floor(Date.now() / 15000)}`));
  const viewers = Math.max(3, Math.min(28, 6 + soldLast10Min * 2 + (jitterSeed % 11)));

  return {
    viewers,
    soldLast10Min,
    stockLeft: Math.max(0, stockLeft),
  };
};

const hashCode = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};

export const getSmartUrgencyText = (params: {
  stockLeft: number;
  msRemaining: number;
  localViewCount?: number;
}): string => {
  const { stockLeft, msRemaining, localViewCount = 0 } = params;
  const hoursRemaining = msRemaining / (1000 * 60 * 60);

  if (stockLeft > 0 && stockLeft <= 5) return "Last chance to own this drop.";
  if (hoursRemaining > 0 && hoursRemaining <= 1.2) return "Ends in under 1 hour. Do not miss out.";
  if (localViewCount >= 3) return "You have been eyeing this. Stock is moving quickly.";
  if (stockLeft <= 15) return `Only ${stockLeft} left in stock.`;
  return "Limited window. Premium drop demand is rising.";
};

export const trackExperienceEvent = async (input: {
  userId?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  path?: string | null;
  scrollDepth?: number | null;
  meta?: Record<string, unknown>;
}) => {
  try {
    await supabase.from("experience_events").insert({
      user_id: input.userId ?? null,
      event_type: input.eventType,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      path: input.path ?? (typeof window !== "undefined" ? window.location.pathname : null),
      scroll_depth: input.scrollDepth ?? null,
      meta: input.meta ?? {},
    });
    if (input.userId && input.eventType === "banner_click" && input.targetId) {
      void supabase.from("users").update({ most_clicked_banner: input.targetId }).eq("id", input.userId);
    }
  } catch {
    // Best-effort analytics.
  }
};

export const fetchRoyalDropInsights = async () => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("experience_events")
    .select("event_type,target_type,target_id")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = data ?? [];
  const countBy = (targetType: string, eventType: string) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if ((row as any).target_type !== targetType) continue;
      if ((row as any).event_type !== eventType) continue;
      const key = String((row as any).target_id ?? "");
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  const topBanners = countBy("banner", "banner_click");
  const topCategories = countBy("category", "category_click");
  const topProducts = countBy("product", "product_click");

  return { topBanners, topCategories, topProducts };
};

export const getSmartLayoutSuggestion = (insights: {
  topCategories: Array<{ id: string; count: number }>;
  topProducts: Array<{ id: string; count: number }>;
}) => {
  const firstCategory = insights.topCategories[0]?.id?.toLowerCase() ?? "";
  const menSignal = firstCategory.includes("men") || firstCategory.includes("running") || firstCategory.includes("training");
  const watchSignal = insights.topCategories.some((item) => item.id.toLowerCase().includes("watch"));

  if (watchSignal) {
    return {
      layout: "nike",
      summary: "Watches are trending. Move watch spotlight above best sellers.",
      highlight: "watch",
    } as const;
  }

  if (menSignal) {
    return {
      layout: "nike",
      summary: "Men/sport traffic is leading. Keep Men section near top for conversion.",
      highlight: "men",
    } as const;
  }

  return {
    layout: "polo",
    summary: "Balanced traffic pattern. Keep default ordering with featured narrative first.",
    highlight: "balanced",
  } as const;
};
