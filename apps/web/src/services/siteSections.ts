import { supabase } from "@/lib/supabase";
import { publicSupabase } from "@/lib/publicSupabase";
import type { SiteSection } from "@/types/domain";

const withTimeout = async <T>(promise: PromiseLike<T> | Promise<T>, ms = 8000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Request timeout")), ms);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const fetchSiteSectionsByLocation = async (pageLocation: string): Promise<SiteSection[]> => {
  try {
    const primary = await withTimeout<{ data: SiteSection[] | null; error: { message?: string } | null }>(
      publicSupabase
        .from("site_sections")
        .select("*")
        .eq("page_location", pageLocation)
        .eq("is_active", true)
        .order("display_order", { ascending: true }) as unknown as Promise<{
          data: SiteSection[] | null;
          error: { message?: string } | null;
        }>
    );

    if (!primary.error) return (primary.data ?? []) as SiteSection[];

    const fallback = await withTimeout<{ data: SiteSection[] | null; error: { message?: string } | null }>(
      supabase
        .from("site_sections")
        .select("*")
        .eq("page_location", pageLocation)
        .eq("is_active", true)
        .order("display_order", { ascending: true }) as unknown as Promise<{
          data: SiteSection[] | null;
          error: { message?: string } | null;
        }>
    );
    if (fallback.error) throw fallback.error;
    return (fallback.data ?? []) as SiteSection[];
  } catch (error) {
    console.warn(`[site_sections] fetch failed for page_location='${pageLocation}', returning empty list.`, error);
    return [];
  }
};

export const fetchAdminSiteSections = async (): Promise<SiteSection[]> => {
  const { data, error } = await supabase
    .from("site_sections")
    .select("*")
    .order("page_location", { ascending: true })
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SiteSection[];
};

export const upsertSiteSection = async (input: Partial<SiteSection> & { id?: string }) => {
  const payload = {
    section_key: input.section_key ?? "",
    page_location: input.page_location ?? "",
    layout_template: input.layout_template?.trim() || null,
    title: input.title ?? null,
    subtitle: input.subtitle ?? null,
    description: input.description ?? null,
    media_type: input.media_type ?? "image",
    media_url: input.media_url ?? null,
    button_text: input.button_text ?? null,
    button_link: input.button_link ?? null,
    text_color: input.text_color ?? "#F8F5F2",
    text_alignment: input.text_alignment ?? "left",
    overlay_opacity: input.overlay_opacity ?? 0.3,
    display_order: input.display_order ?? 0,
    is_active: input.is_active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await supabase.from("site_sections").update(payload).eq("id", input.id);
    if (error) throw error;
    return input.id;
  }

  const { data, error } = await supabase.from("site_sections").insert(payload).select("id").single();
  if (error) throw error;
  return data.id as string;
};

export const deleteSiteSection = async (id: string) => {
  const { error } = await supabase.from("site_sections").delete().eq("id", id);
  if (error) throw error;
};

export const reorderSiteSections = async (orderedIds: string[]) => {
  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index];
    const { error } = await supabase
      .from("site_sections")
      .update({ display_order: index, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }
};
