import { supabase } from "@/lib/supabase";
import type { SiteFestival } from "@/types/domain";

const CACHE_KEY = "site-festival-cache:v1";
const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedFestival = {
  fetchedAt: number;
  festival: SiteFestival | null;
};

const isActiveNow = (festival: SiteFestival | null, now = Date.now()): festival is SiteFestival => {
  if (!festival) return false;
  const start = new Date(festival.start_date).getTime();
  const end = new Date(festival.end_date).getTime();
  return festival.is_active && now >= start && now <= end;
};

const readCache = (): CachedFestival | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFestival;
    if (!parsed || typeof parsed.fetchedAt !== "number" || !("festival" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (festival: SiteFestival | null) => {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedFestival = { fetchedAt: Date.now(), festival };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore localStorage write failures in private/restricted mode.
  }
};

const normalizeFestival = (input: any): SiteFestival => ({
  id: input.id,
  festival_name: input.festival_name,
  slug: input.slug,
  is_active: Boolean(input.is_active),
  theme_primary: input.theme_primary ?? "#C8A951",
  theme_secondary: input.theme_secondary ?? "#111111",
  hero_image_url: input.hero_image_url ?? "",
  hero_video_url: input.hero_video_url ?? null,
  discount_text: input.discount_text ?? "",
  promo_text: input.promo_text ?? "",
  urgency_text: input.urgency_text ?? "",
  discount_percent: Number(input.discount_percent ?? 0),
  promo_messages: Array.isArray(input.promo_messages)
    ? input.promo_messages.map((v: unknown) => String(v).trim()).filter(Boolean)
    : [],
  start_date: input.start_date,
  end_date: input.end_date,
  created_at: input.created_at,
  updated_at: input.updated_at,
});

export const getCachedActiveSiteFestival = (): SiteFestival | null => {
  const cached = readCache();
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null;
  return isActiveNow(cached.festival) ? cached.festival : null;
};

export const fetchActiveSiteFestival = async (): Promise<SiteFestival | null> => {
  const now = Date.now();
  const cached = readCache();
  if (cached && now - cached.fetchedAt <= CACHE_TTL_MS && isActiveNow(cached.festival, now)) {
    return cached.festival;
  }

  try {
    // Best-effort auto-revert for expired windows.
    await supabase.rpc("deactivate_expired_site_festivals");
  } catch {
    // Ignore: users without admin rights may not be able to update rows directly.
  }

  try {
    const rpc = await supabase.rpc("get_active_site_festival");
    const fromRpc = Array.isArray(rpc.data) ? rpc.data[0] : null;
    if (!rpc.error && fromRpc) {
      const normalized = normalizeFestival(fromRpc);
      writeCache(normalized);
      return normalized;
    }
  } catch {
    // Fall through to direct select.
  }

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("site_festivals")
      .select("*")
      .eq("is_active", true)
      .lte("start_date", nowIso)
      .gte("end_date", nowIso)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      const normalized = normalizeFestival(data);
      writeCache(normalized);
      return normalized;
    }
    if (!error) {
      writeCache(null);
      return null;
    }
  } catch {
    // Use cache fallback below.
  }

  if (cached && isActiveNow(cached.festival, now)) return cached.festival;
  return null;
};

export const fetchAdminSiteFestivals = async (): Promise<SiteFestival[]> => {
  const { data, error } = await supabase.from("site_festivals").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalizeFestival);
};

export const upsertSiteFestival = async (input: Partial<SiteFestival> & Record<string, unknown>) => {
  const payload = {
    id: input.id ?? undefined,
    festival_name: String(input.festival_name ?? "").trim(),
    slug: String(input.slug ?? "").trim(),
    is_active: Boolean(input.is_active),
    theme_primary: String(input.theme_primary ?? "#C8A951").trim(),
    theme_secondary: String(input.theme_secondary ?? "#111111").trim(),
    hero_image_url: String(input.hero_image_url ?? "").trim(),
    hero_video_url: String(input.hero_video_url ?? "").trim() || null,
    discount_text: String(input.discount_text ?? "").trim(),
    promo_text: String(input.promo_text ?? "").trim(),
    urgency_text: String(input.urgency_text ?? "").trim(),
    discount_percent: Number(input.discount_percent ?? 0),
    promo_messages: Array.isArray(input.promo_messages)
      ? input.promo_messages.map((v) => String(v).trim()).filter(Boolean)
      : [],
    start_date: input.start_date,
    end_date: input.end_date,
  };

  if (!payload.festival_name || !payload.slug || !payload.hero_image_url || !payload.start_date || !payload.end_date) {
    throw new Error("Festival name, slug, hero image, start date, and end date are required");
  }

  const query = supabase.from("site_festivals");
  const { data, error } = payload.id
    ? await query.update(payload).eq("id", payload.id).select("*").single()
    : await query.insert(payload).select("*").single();
  if (error) throw error;
  const normalized = normalizeFestival(data);
  writeCache(normalized.is_active ? normalized : null);
  return normalized;
};

export const setSiteFestivalActive = async (festivalId: string, active: boolean) => {
  if (!active) {
    const { error } = await supabase.from("site_festivals").update({ is_active: false }).eq("id", festivalId);
    if (error) throw error;
    writeCache(null);
    return;
  }

  const nowIso = new Date().toISOString();
  const { data: existing, error: readError } = await supabase
    .from("site_festivals")
    .select("start_date,end_date")
    .eq("id", festivalId)
    .maybeSingle();
  if (readError || !existing) throw readError ?? new Error("Festival not found");

  const patch: Record<string, unknown> = { is_active: true };
  if (new Date(existing.start_date).getTime() > Date.now()) {
    patch.start_date = nowIso;
  }
  if (new Date(existing.end_date).getTime() <= Date.now()) {
    patch.end_date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  const { error } = await supabase.from("site_festivals").update(patch).eq("id", festivalId);
  if (error) throw error;
  writeCache(null);
};

export const endSiteFestivalNow = async (festivalId: string) => {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("site_festivals")
    .update({ is_active: false, end_date: nowIso })
    .eq("id", festivalId);
  if (error) throw error;
  writeCache(null);
};
