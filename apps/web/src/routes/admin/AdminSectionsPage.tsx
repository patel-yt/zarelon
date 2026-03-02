import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { LayoutPreview } from "@/components/ui/LayoutPreview";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { supabase } from "@/lib/supabase";
import { deleteSiteSection, fetchAdminSiteSections, reorderSiteSections, upsertSiteSection } from "@/services/siteSections";
import type { SiteSection } from "@/types/domain";

const keySuggestions = [
  "home_hero",
  "home_nav_1",
  "home_nav_2",
  "home_nav_3",
  "home_nav_4",
  "home_nav_5",
  "home_shopby_1",
  "home_shopby_2",
  "home_shopby_3",
  "home_featured_1",
  "home_featured_2",
  "home_featured_3",
  "home_featured_4",
  "home_spotlight",
  "home_explore_1",
  "home_explore_2",
  "home_explore_3",
  "home_top_notice",
  "home_mobile_labels",
  "home_spotlight_banner",
  "signin_bg",
  "signin_copy",
  "signup_bg",
  "signup_copy",
  "category_hero",
  "category_top_notice",
  "category_meta",
  "page_hero",
  "collections_default",
  "collections:premium",
  "collections:festive",
  "collections:summer",
  "page_featured_title",
  "page_filter_title",
  "page_grid_title",
  "footer_link_1",
  "footer_link_2",
  "footer_link_3",
] as const;

const locationSuggestions = [
  "home",
  "auth",
  "products",
  "new-in",
  "men",
  "women",
  "collections",
  "collections:premium",
  "collections:festive",
  "collections:summer",
  "global",
  "category:men",
  "category:women",
] as const;

const layoutTemplateSuggestions = [
  "home-mixed",
  "men-performance",
  "women-editorial",
  "collection-premium",
  "collection-minimal",
  "collection-story",
] as const;

const layoutTemplateOptions: Array<{ value: (typeof layoutTemplateSuggestions)[number]; label: string }> = [
  { value: "home-mixed", label: "Home Mixed" },
  { value: "men-performance", label: "Men Performance" },
  { value: "women-editorial", label: "Women Editorial" },
  { value: "collection-premium", label: "Collection Premium" },
  { value: "collection-minimal", label: "Collection Minimal" },
  { value: "collection-story", label: "Collection Story" },
];

const pagePresetOptions = [
  { label: "Home", page_location: "home", section_key: "page_hero", layout_template: "home-mixed" },
  { label: "Men", page_location: "men", section_key: "page_hero", layout_template: "men-performance" },
  { label: "Women", page_location: "women", section_key: "page_hero", layout_template: "women-editorial" },
  {
    label: "Collections",
    page_location: "collections",
    section_key: "collections_default",
    layout_template: "collection-premium",
  },
  { label: "Auth Sign In", page_location: "auth", section_key: "signin_bg", layout_template: "home-mixed" },
  { label: "Auth Sign Up", page_location: "auth", section_key: "signup_bg", layout_template: "home-mixed" },
] as const;

const defaultForm: Partial<SiteSection> = {
  section_key: "home_hero",
  page_location: "home",
  media_type: "image",
  text_alignment: "left",
  text_color: "#111111",
  overlay_opacity: 0.28,
  display_order: 0,
  is_active: true,
};

const resolveDefaultTemplate = (pageLocation?: string | null) => {
  if (pageLocation === "men") return "men-performance";
  if (pageLocation === "women") return "women-editorial";
  if ((pageLocation ?? "").startsWith("collections")) return "collection-premium";
  return "home-mixed";
};

const previewAlignClass: Record<"left" | "center" | "right", string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

export const AdminSectionsPage = () => {
  const { user, profile, hasPermission } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManage = isSuperAdmin || hasPermission("can_manage_festival");

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState("all");
  const [form, setForm] = useState<Partial<SiteSection>>(defaultForm);
  const [previewViewport, setPreviewViewport] = useState<"desktop" | "mobile">("desktop");

  const query = useQuery({
    queryKey: ["admin-site-sections"],
    queryFn: fetchAdminSiteSections,
  });

  const filtered = useMemo(() => {
    const rows = query.data ?? [];
    if (locationFilter === "all") return rows;
    return rows.filter((section) => section.page_location === locationFilter);
  }, [query.data, locationFilter]);

  const previewTemplate = useMemo(() => {
    const chosen = form.layout_template ?? "";
    if (layoutTemplateSuggestions.includes(chosen as (typeof layoutTemplateSuggestions)[number])) {
      return chosen;
    }
    return resolveDefaultTemplate(form.page_location);
  }, [form.layout_template, form.page_location]);

  if (!canManage) return <p className="text-sm text-white/70">You do not have section CMS access.</p>;

  const uploadMedia = async (file: File) => {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${form.page_location}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
    const { error } = await supabase.storage.from("site-sections").upload(path, file, {
      upsert: false,
      cacheControl: "3600",
    });
    if (error) throw error;
    return supabase.storage.from("site-sections").getPublicUrl(path).data.publicUrl;
  };

  const onDropReorder = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;

    const list = [...filtered];
    const from = list.findIndex((item) => item.id === draggingId);
    const to = list.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;

    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);

    try {
      setSaving(true);
      await reorderSiteSections(list.map((item) => item.id));
      await query.refetch();
      setSuccessMessage("Display order updated.");
    } catch (error) {
      setErrorMessage((error as Error)?.message ?? "Reorder failed");
    } finally {
      setSaving(false);
      setDraggingId(null);
    }
  };

  const onSaveTemplate = async () => {
    if (!form.page_location) {
      setErrorMessage("page_location is required before saving template.");
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");

    try {
      setSaving(true);
      const fallbackSectionKey = form.page_location.startsWith("collections") ? "collections_default" : "page_hero";
      const targetSectionKey = form.section_key?.trim() || fallbackSectionKey;
      const existingById = form.id ? (query.data ?? []).find((item) => item.id === form.id) : null;
      const existingByKey = (query.data ?? []).find(
        (item) => item.page_location === form.page_location && item.section_key === targetSectionKey
      );
      const existing = existingById ?? existingByKey ?? null;

      await upsertSiteSection({
        ...(existing ?? {}),
        id: existing?.id,
        section_key: targetSectionKey,
        page_location: form.page_location,
        layout_template: previewTemplate,
        title: existing?.title ?? form.title ?? form.page_location.toUpperCase(),
        subtitle: existing?.subtitle ?? form.subtitle ?? "Premium Section",
        description: existing?.description ?? form.description ?? "Template-driven layout section",
        media_type: existing?.media_type ?? form.media_type ?? "image",
        text_alignment: existing?.text_alignment ?? form.text_alignment ?? "left",
        text_color: existing?.text_color ?? form.text_color ?? "#111111",
        overlay_opacity: existing?.overlay_opacity ?? Number(form.overlay_opacity ?? 0.3),
        display_order: existing?.display_order ?? Number(form.display_order ?? 0),
        is_active: existing?.is_active ?? true,
      });

      await query.refetch();
      setForm((prev) => ({ ...prev, section_key: targetSectionKey }));
      setSuccessMessage(existing ? "Layout template saved." : "Layout template saved and page section auto-created.");
    } catch (error) {
      setErrorMessage((error as Error)?.message ?? "Template save failed");
    } finally {
      setSaving(false);
    }
  };

  const applyPagePreset = (preset: (typeof pagePresetOptions)[number]) => {
    setForm((prev) => ({
      ...prev,
      page_location: preset.page_location,
      section_key: preset.section_key,
      layout_template: preset.layout_template,
    }));
    setSuccessMessage(`Preset applied: ${preset.label}`);
    setErrorMessage("");
  };

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl text-gold-200">Section Manager</h1>

      <form
        className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setErrorMessage("");
          setSuccessMessage("");
          if (!form.section_key || !form.page_location) {
            setErrorMessage("section_key and page_location are required.");
            return;
          }
          try {
            setSaving(true);
            await upsertSiteSection({
              id: form.id,
              section_key: form.section_key,
              page_location: form.page_location,
              layout_template: form.layout_template ?? null,
              title: form.title ?? "",
              subtitle: form.subtitle ?? "",
              description: form.description ?? "",
              media_type: form.media_type ?? "image",
              media_url: form.media_url ?? "",
              button_text: form.button_text ?? "",
              button_link: form.button_link ?? "",
              text_color: form.text_color ?? "#111111",
              text_alignment: form.text_alignment ?? "left",
              overlay_opacity: Number(form.overlay_opacity ?? 0.3),
              display_order: Number(form.display_order ?? 0),
              is_active: Boolean(form.is_active),
            });
            await query.refetch();
            setSuccessMessage(form.id ? "Section updated." : "Section created.");
            setForm(defaultForm);
          } catch (error) {
            setErrorMessage((error as Error)?.message ?? "Save failed");
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <input
              value={form.page_location ?? "home"}
              onChange={(event) => setForm((prev) => ({ ...prev, page_location: event.target.value }))}
              placeholder="page_location (e.g. home, auth, category:men)"
              list="page-location-suggestions"
              className="w-full rounded-lg border-white/20 bg-black/20"
            />
            <datalist id="page-location-suggestions">
              {locationSuggestions.map((loc) => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
          </div>
          <div>
            <input
              value={form.section_key ?? "home_hero"}
              onChange={(event) => setForm((prev) => ({ ...prev, section_key: event.target.value }))}
              placeholder="section_key"
              list="section-key-suggestions"
              className="w-full rounded-lg border-white/20 bg-black/20"
            />
            <datalist id="section-key-suggestions">
              {keySuggestions.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
          </div>
          <select
            value={form.media_type ?? "image"}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, media_type: event.target.value as "image" | "video" }))
            }
            className="rounded-lg border-white/20 bg-black/20"
          >
            <option value="image">image</option>
            <option value="video">video</option>
          </select>
        </div>

        <div className="rounded-xl border border-white/15 bg-black/25 p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-gold-200">Quick Presets</p>
          <div className="flex flex-wrap gap-2">
            {pagePresetOptions.map((preset) => (
              <Button key={preset.label} type="button" variant="ghost" onClick={() => applyPagePreset(preset)}>
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        <input
          value={form.title ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="Title"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <select
          value={previewTemplate}
          onChange={(event) => setForm((prev) => ({ ...prev, layout_template: event.target.value }))}
          className="rounded-lg border-white/20 bg-black/20"
        >
          {layoutTemplateOptions.map((template) => (
            <option key={template.value} value={template.value}>
              {template.label}
            </option>
          ))}
        </select>
        <input
          value={form.subtitle ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, subtitle: event.target.value }))}
          placeholder="Subtitle"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <textarea
          value={form.description ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          placeholder="Description"
          rows={3}
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input
          value={form.media_url ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, media_url: event.target.value }))}
          placeholder="Media URL"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <label className="rounded-lg border border-white/15 p-3 text-xs text-white/70">
          Upload media (image/video)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm"
            className="mt-2 block"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                setSaving(true);
                setErrorMessage("");
                const url = await uploadMedia(file);
                setForm((prev) => ({ ...prev, media_url: url }));
              } catch (error) {
                setErrorMessage((error as Error)?.message ?? "Upload failed");
              } finally {
                setSaving(false);
              }
            }}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <input
            value={form.button_text ?? ""}
            onChange={(event) => setForm((prev) => ({ ...prev, button_text: event.target.value }))}
            placeholder="Button text"
            className="rounded-lg border-white/20 bg-black/20"
          />
          <input
            value={form.button_link ?? ""}
            onChange={(event) => setForm((prev) => ({ ...prev, button_link: event.target.value }))}
            placeholder="Button link"
            className="rounded-lg border-white/20 bg-black/20"
          />
          <input
            type="color"
            value={form.text_color ?? "#111111"}
            onChange={(event) => setForm((prev) => ({ ...prev, text_color: event.target.value }))}
            className="h-11 rounded-lg border-white/20 bg-black/20"
          />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <select
            value={form.text_alignment ?? "left"}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, text_alignment: event.target.value as "left" | "center" | "right" }))
            }
            className="rounded-lg border-white/20 bg-black/20"
          >
            <option value="left">left</option>
            <option value="center">center</option>
            <option value="right">right</option>
          </select>
          <label className="rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80">
            Overlay opacity: {Number(form.overlay_opacity ?? 0.3).toFixed(2)}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={Number(form.overlay_opacity ?? 0.3)}
              onChange={(event) => setForm((prev) => ({ ...prev, overlay_opacity: Number(event.target.value) }))}
              className="mt-1 w-full"
            />
          </label>
          <input
            type="number"
            value={Number(form.display_order ?? 0)}
            onChange={(event) => setForm((prev) => ({ ...prev, display_order: Number(event.target.value) }))}
            placeholder="Display order"
            className="rounded-lg border-white/20 bg-black/20"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={Boolean(form.is_active)}
            onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
          />
          Active
        </label>

        <div className="rounded-xl border border-white/15 bg-black/25 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-[0.16em] text-gold-200">Preview Mode</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={previewViewport === "desktop" ? "gold" : "ghost"}
                onClick={() => setPreviewViewport("desktop")}
              >
                Desktop Preview
              </Button>
              <Button
                type="button"
                variant={previewViewport === "mobile" ? "gold" : "ghost"}
                onClick={() => setPreviewViewport("mobile")}
              >
                Mobile Preview
              </Button>
            </div>
          </div>
          <div className="max-h-[620px] overflow-auto rounded-xl border border-white/10 bg-[#ECE9E3] p-3">
            <div
              className={`mx-auto transition-all duration-300 ${previewViewport === "mobile" ? "max-w-[390px]" : "max-w-full"}`}
            >
              <LayoutPreview template={previewTemplate} />
              <div className="mt-3 overflow-hidden rounded-xl border border-black/10 bg-white">
                <div className="relative">
                  {form.media_url ? (
                    form.media_type === "video" ? (
                      <video
                        src={form.media_url}
                        className="h-[220px] w-full object-cover"
                        muted
                        loop
                        autoPlay
                        playsInline
                      />
                    ) : (
                      <img
                        src={form.media_url}
                        alt={form.title ?? form.section_key ?? "Preview media"}
                        className="h-[220px] w-full object-cover"
                      />
                    )
                  ) : (
                    <div className="grid h-[220px] w-full place-items-center bg-black/5 text-xs text-[#666666]">
                      No media selected
                    </div>
                  )}
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: `rgba(0,0,0,${Math.max(0, Math.min(1, Number(form.overlay_opacity ?? 0.3)))})`,
                    }}
                  />
                  <div
                    className={`absolute inset-0 flex flex-col justify-end gap-1 p-4 ${
                      previewAlignClass[(form.text_alignment ?? "left") as "left" | "center" | "right"]
                    }`}
                    style={{ color: form.text_color ?? "#111111" }}
                  >
                    {form.subtitle ? <p className="text-[10px] uppercase tracking-[0.16em]">{form.subtitle}</p> : null}
                    <p className="text-xl font-semibold">{form.title || form.section_key || "Section title preview"}</p>
                    {form.description ? <p className="max-w-2xl text-xs">{form.description}</p> : null}
                    {form.button_text ? (
                      <span className="mt-1 inline-flex rounded-full border border-current px-3 py-1 text-xs">
                        {form.button_text}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {errorMessage ? <p className="text-xs text-rose-300">{errorMessage}</p> : null}
        {successMessage ? <p className="text-xs text-emerald-300">{successMessage}</p> : null}

        <div className="flex gap-2">
          <Button type="button" disabled={saving} onClick={() => void onSaveTemplate()}>
            {saving ? "Saving..." : "Save Template"}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : form.id ? "Update Section" : "Create Section"}
          </Button>
          {form.id ? (
            <Button type="button" variant="ghost" onClick={() => setForm(defaultForm)}>
              Cancel Edit
            </Button>
          ) : null}
        </div>
      </form>

      <div className="flex items-center gap-2">
        <span className="text-xs text-white/70">Filter:</span>
        <select
          value={locationFilter}
          onChange={(event) => setLocationFilter(event.target.value)}
          className="rounded-lg border-white/20 bg-black/20 text-sm"
        >
          <option value="all">all</option>
          {[...new Set((query.data ?? []).map((section) => section.page_location))].map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
        <span className="text-xs text-white/60">Drag and drop cards to reorder display.</span>
      </div>

      <div className="space-y-3">
        {filtered.map((section) => (
          <div
            key={section.id}
            draggable
            onDragStart={() => setDraggingId(section.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => void onDropReorder(section.id)}
            className="cursor-move rounded-xl border border-white/10 bg-black/20 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gold-200">
                  {section.page_location} | {section.section_key}
                </p>
                <p className="text-xs text-white/65">
                  order: {section.display_order} | layout: {section.layout_template ?? "default"} |{" "}
                  {section.is_active ? "active" : "inactive"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setForm(section)}>
                  Edit
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!window.confirm("Delete this section?")) return;
                    await deleteSiteSection(section.id);
                    await query.refetch();
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            {section.media_url ? (
              section.media_type === "video" ? (
                <video src={section.media_url} className="mt-3 h-36 w-full rounded-lg object-cover" muted loop autoPlay playsInline />
              ) : (
                <img src={section.media_url} alt={section.title ?? section.section_key} className="mt-3 h-36 w-full rounded-lg object-cover" />
              )
            ) : (
              <div className="mt-3 rounded-lg border border-white/10 p-3 text-xs text-white/55">No media</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
