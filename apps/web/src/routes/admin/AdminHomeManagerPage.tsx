import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { adminCmsApi } from "@/lib/apiClient";
import { isOwnerEmail } from "@/lib/admin";
import {
  deleteHomeSection,
  fetchAdminHomePages,
  fetchAdminHomeSections,
  generateFestivalBannerText,
  reorderHomeSections,
  suggestHomeSectionOrder,
  upsertHomePage,
  upsertHomeSection,
} from "@/services/homeCms";
import type { HomeSection } from "@/types/domain";

const blankSection: Partial<HomeSection> = {
  section_key: "hero_main",
  section_type: "hero",
  display_order: 0,
  is_visible: true,
  config_json: {
    title: "Main headline",
    subtitle: "Subtitle",
    media: "",
    buttonText: "Shop",
    buttonUrl: "/products",
    alignment: "left",
    overlay: 0.45,
  },
};

const HERO_TITLE_MAX = 35;
const HERO_SUBTITLE_MAX = 60;

const truncateText = (value: unknown, maxLen: number) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}...`;
};

const sanitizeSectionConfig = (
  sectionType: HomeSection["section_type"] | undefined,
  configJson: Record<string, unknown>
) => {
  const next = { ...configJson };
  const notices: string[] = [];

  if (sectionType === "hero") {
    const title = truncateText(next.title, HERO_TITLE_MAX);
    const subtitle = truncateText(next.subtitle, HERO_SUBTITLE_MAX);
    if (String(next.title ?? "").trim() !== title && title) notices.push(`Hero title limited to ${HERO_TITLE_MAX} characters.`);
    if (String(next.subtitle ?? "").trim() !== subtitle && subtitle) notices.push(`Hero subtitle limited to ${HERO_SUBTITLE_MAX} characters.`);
    if (title) next.title = title;
    if (subtitle) next.subtitle = subtitle;
  }

  return { next, notices };
};

export const AdminHomeManagerPage = () => {
  const queryClient = useQueryClient();
  const { user, profile, hasPermission } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManage = isSuperAdmin || hasPermission("can_manage_festival");

  const pagesQuery = useQuery({ queryKey: ["admin-home-pages"], queryFn: fetchAdminHomePages });
  const activePage = useMemo(() => (pagesQuery.data ?? []).find((p) => p.is_active) ?? (pagesQuery.data ?? [])[0] ?? null, [pagesQuery.data]);

  const sectionsQuery = useQuery({
    queryKey: ["admin-home-sections", activePage?.id ?? ""],
    queryFn: () => fetchAdminHomeSections(activePage!.id),
    enabled: Boolean(activePage?.id),
  });

  const [layoutType, setLayoutType] = useState<"nike" | "polo" | "rolex">("nike");
  const [smartMode, setSmartMode] = useState(false);
  const [smartAutoApply, setSmartAutoApply] = useState(false);
  const [editing, setEditing] = useState<Partial<HomeSection>>(blankSection);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [previewMobile, setPreviewMobile] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingReco, setPendingReco] = useState<{ id: string; reason: string; proposed_order: Array<{ id: string; section_key: string; display_order: number }> } | null>(null);
  const [aiInput, setAiInput] = useState({ festivalName: "Royal Drop Fest", discount: 40, categoryFocus: "Watches", tone: "luxury" as const });

  const sectionRows = sectionsQuery.data ?? [];
  const previewSections = useMemo<HomeSection[]>(() => {
    const rows = [...sectionRows];
    if (!editing.section_key || !editing.section_type) return rows;

    const draft: HomeSection = {
      id: String(editing.id ?? "__draft__"),
      page_id: String(activePage?.id ?? "preview"),
      section_key: String(editing.section_key),
      section_type: editing.section_type as HomeSection["section_type"],
      display_order: Number(editing.display_order ?? rows.length),
      is_visible: Boolean(editing.is_visible ?? true),
      config_json: (editing.config_json ?? {}) as HomeSection["config_json"],
      created_at: "",
      updated_at: "",
    };

    if (editing.id) {
      const idx = rows.findIndex((row) => row.id === editing.id);
      if (idx >= 0) rows[idx] = draft;
      else rows.push(draft);
    } else {
      rows.push(draft);
    }

    return rows.sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));
  }, [sectionRows, editing, activePage?.id]);

  useEffect(() => {
    if (!activePage) return;
    setLayoutType(activePage.layout_type);
    setSmartMode(Boolean(activePage.smart_layout_mode));
    setSmartAutoApply(Boolean(activePage.smart_auto_apply));
  }, [activePage?.id]);

  const savePageMutation = useMutation({
    mutationFn: async () => {
      await upsertHomePage({
        id: activePage?.id,
        layout_type: layoutType,
        is_active: true,
        smart_layout_mode: smartMode,
        smart_auto_apply: smartAutoApply,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-home-pages"] });
      setMessage("Homepage settings saved.");
    },
  });

  const saveSectionMutation = useMutation({
    mutationFn: async () => {
      if (!activePage?.id) throw new Error("No active home page found.");
      if (!editing.section_key || !editing.section_type) throw new Error("section_key and section_type are required.");
      const rawConfig = (editing.config_json ?? {}) as Record<string, unknown>;
      const { next: sanitizedConfig, notices } = sanitizeSectionConfig(editing.section_type as HomeSection["section_type"], rawConfig);
      if (notices.length) setMessage(notices.join(" "));
      await upsertHomeSection({
        id: editing.id,
        page_id: activePage.id,
        section_key: String(editing.section_key),
        section_type: editing.section_type as HomeSection["section_type"],
        display_order: Number(editing.display_order ?? sectionRows.length),
        is_visible: Boolean(editing.is_visible ?? true),
        config_json: sanitizedConfig,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-home-sections", activePage?.id ?? ""] });
      setEditing(blankSection);
      setMessage("Section saved.");
    },
  });

  if (!canManage) return <p className="text-sm text-white/70">You do not have homepage CMS access.</p>;

  const onReorderDrop = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const next = [...sectionRows];
    const from = next.findIndex((row) => row.id === draggingId);
    const to = next.findIndex((row) => row.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await reorderHomeSections(next.map((row) => row.id));
    await queryClient.invalidateQueries({ queryKey: ["admin-home-sections", activePage?.id ?? ""] });
  };

  const applyAiText = () => {
    const run = async () => {
      try {
        const generated = await adminCmsApi.generateBannerText({
          festivalName: aiInput.festivalName,
          discountPercent: Number(aiInput.discount),
          categoryFocus: aiInput.categoryFocus,
          tone: aiInput.tone,
        });
        const existing = (editing.config_json ?? {}) as Record<string, unknown>;
        setEditing((prev) => ({
          ...prev,
          config_json: {
            ...existing,
            title: generated.headline,
            subtitle: generated.subtitle,
            buttonText: generated.cta,
            urgencyLine: generated.urgency,
          },
        }));
        setMessage(`AI banner text generated (${generated.mode}).`);
      } catch (error) {
        const generated = generateFestivalBannerText({
          festivalName: aiInput.festivalName,
          discountPercent: Number(aiInput.discount),
          categoryFocus: aiInput.categoryFocus,
          tone: aiInput.tone,
        });
        const existing = (editing.config_json ?? {}) as Record<string, unknown>;
        setEditing((prev) => ({
          ...prev,
          config_json: {
            ...existing,
            title: generated.headline,
            subtitle: generated.subtitle,
            buttonText: generated.cta,
            urgencyLine: generated.urgency,
          },
        }));
        setMessage(`AI API unavailable. Local fallback applied. ${(error as Error).message}`);
      }
    };
    void run();
  };

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Homepage Manager</h1>

      <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
        <div className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="grid gap-2 md:grid-cols-2">
            <select value={layoutType} onChange={(e) => setLayoutType(e.target.value as any)} className="rounded-lg border-white/20 bg-black/20">
              <option value="nike">ZARELON SPORT</option>
              <option value="polo">ZARELON CLASSIC</option>
              <option value="rolex">ZARELON LUXURY</option>
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80">
              <input type="checkbox" checked={smartMode} onChange={(e) => setSmartMode(e.target.checked)} />
              Smart Layout Mode
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80">
              <input type="checkbox" checked={smartAutoApply} onChange={(e) => setSmartAutoApply(e.target.checked)} />
              Smart Auto Apply
            </label>
          </div>
          <Button onClick={() => savePageMutation.mutate()} disabled={savePageMutation.isPending}>
            {savePageMutation.isPending ? "Saving..." : "Save & Publish"}
          </Button>

          <div className="rounded-lg border border-white/10 p-3">
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-white/70">AI Banner Generator</p>
            <input value={aiInput.festivalName} onChange={(e) => setAiInput((p) => ({ ...p, festivalName: e.target.value }))} className="mb-2 w-full rounded border border-white/20 bg-black/20 px-2 py-1" placeholder="Festival name" />
            <input value={aiInput.discount} onChange={(e) => setAiInput((p) => ({ ...p, discount: Number(e.target.value) }))} className="mb-2 w-full rounded border border-white/20 bg-black/20 px-2 py-1" placeholder="Discount %" type="number" />
            <input value={aiInput.categoryFocus} onChange={(e) => setAiInput((p) => ({ ...p, categoryFocus: e.target.value }))} className="mb-2 w-full rounded border border-white/20 bg-black/20 px-2 py-1" placeholder="Category focus" />
            <select value={aiInput.tone} onChange={(e) => setAiInput((p) => ({ ...p, tone: e.target.value as any }))} className="w-full rounded border border-white/20 bg-black/20 px-2 py-1">
              <option value="sporty">Sporty</option>
              <option value="luxury">Luxury</option>
              <option value="bold">Bold</option>
              <option value="emotional">Emotional</option>
            </select>
            <Button className="mt-2" variant="ghost" onClick={applyAiText}>Generate Banner Text via AI</Button>
          </div>

          <form
            className="space-y-2 rounded-lg border border-white/10 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveSectionMutation.mutate();
            }}
          >
            <p className="text-xs uppercase tracking-[0.14em] text-white/70">Section Editor</p>
            <p className="text-[11px] text-white/60">Hero validation: title max {HERO_TITLE_MAX}, subtitle max {HERO_SUBTITLE_MAX} characters.</p>
            <input value={String(editing.section_key ?? "")} onChange={(e) => setEditing((p) => ({ ...p, section_key: e.target.value }))} className="w-full rounded border border-white/20 bg-black/20 px-2 py-1" placeholder="section_key" />
            <select value={String(editing.section_type ?? "hero")} onChange={(e) => setEditing((p) => ({ ...p, section_type: e.target.value as any }))} className="w-full rounded border border-white/20 bg-black/20 px-2 py-1">
              <option value="hero">hero</option>
              <option value="category">category</option>
              <option value="featured">featured</option>
              <option value="product_grid">product_grid</option>
              <option value="custom_block">custom_block</option>
            </select>
            <textarea
              value={JSON.stringify(editing.config_json ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  setEditing((p) => ({ ...p, config_json: parsed }));
                } catch {
                  // ignore live parse errors
                }
              }}
              className="min-h-[140px] w-full rounded border border-white/20 bg-black/20 px-2 py-1 text-xs"
            />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-white/80">
                <input type="checkbox" checked={Boolean(editing.is_visible ?? true)} onChange={(e) => setEditing((p) => ({ ...p, is_visible: e.target.checked }))} />
                Visible
              </label>
              <input type="number" value={Number(editing.display_order ?? 0)} onChange={(e) => setEditing((p) => ({ ...p, display_order: Number(e.target.value) }))} className="w-24 rounded border border-white/20 bg-black/20 px-2 py-1 text-xs" />
            </div>
            <Button type="submit" disabled={saveSectionMutation.isPending}>{saveSectionMutation.isPending ? "Saving..." : "Save Section"}</Button>
          </form>

          <Button
            variant="ghost"
            onClick={async () => {
              if (!activePage?.id) return;
              try {
                const res = await adminCmsApi.suggestSmartLayout(activePage.id);
                setPendingReco(res.recommendation);
                setMessage(`Smart layout suggestion created. ${res.recommendation.reason}`);
              } catch (error) {
                const res = await suggestHomeSectionOrder(sectionRows);
                await reorderHomeSections(res.suggested.map((s) => s.id));
                await queryClient.invalidateQueries({ queryKey: ["admin-home-sections", activePage?.id ?? ""] });
                setMessage(`API unavailable, local suggestion applied. ${res.reason}. ${(error as Error).message}`);
              }
            }}
          >
            Smart Layout Suggestion
          </Button>

          {pendingReco ? (
            <div className="rounded-lg border border-white/10 p-3 text-xs text-white/80">
              <p className="font-semibold text-white">Pending Recommendation</p>
              <p className="mt-1">{pendingReco.reason}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="gold"
                  onClick={async () => {
                    if (!activePage?.id || !pendingReco?.id) return;
                    await adminCmsApi.approveSmartLayout(activePage.id, pendingReco.id);
                    await queryClient.invalidateQueries({ queryKey: ["admin-home-sections", activePage.id] });
                    setMessage("Smart layout approved and applied.");
                    setPendingReco(null);
                  }}
                >
                  Approve & Apply
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!activePage?.id || !pendingReco?.id) return;
                    await adminCmsApi.rejectSmartLayout(activePage.id, pendingReco.id);
                    setMessage("Smart layout recommendation rejected.");
                    setPendingReco(null);
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ) : null}

          {message ? <p className="text-xs text-emerald-300">{message}</p> : null}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <p className="text-sm text-white/70">Preview Mode</p>
            <div className="flex gap-2">
              <Button variant={previewMobile ? "ghost" : "gold"} onClick={() => setPreviewMobile(false)}>Desktop</Button>
              <Button variant={previewMobile ? "gold" : "ghost"} onClick={() => setPreviewMobile(true)}>Mobile</Button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-auto rounded-xl border border-white/10 bg-[#f0f0f0] p-3">
            <div className={`mx-auto space-y-3 ${previewMobile ? "max-w-[390px]" : "max-w-full"}`}>
              {previewSections.map((section) => {
                const cfg = section.config_json as Record<string, any>;
                return (
                  <div
                    key={section.id}
                    draggable
                    onDragStart={() => setDraggingId(section.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => void onReorderDrop(section.id)}
                    className="cursor-move rounded-lg border border-black/10 bg-white p-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-[0.12em] text-[#666]">{section.section_type}</p>
                      <div className="flex gap-1">
                        {section.id === "__draft__" ? (
                          <span className="rounded border border-amber-300 px-2 py-0.5 text-[10px] text-amber-700">Draft</span>
                        ) : null}
                        <button type="button" className="rounded border border-black/20 px-2 py-0.5 text-[10px]" onClick={() => setEditing(section)}>Edit</button>
                        <button
                          type="button"
                          className="rounded border border-red-300 px-2 py-0.5 text-[10px] text-red-600"
                          onClick={async () => {
                            if (section.id === "__draft__") return;
                            await deleteHomeSection(section.id);
                            await queryClient.invalidateQueries({ queryKey: ["admin-home-sections", activePage?.id ?? ""] });
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="text-base font-semibold text-[#111]">{String(cfg.title ?? section.section_key)}</p>
                    {cfg.subtitle ? <p className="text-xs text-[#666]">{String(cfg.subtitle)}</p> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
