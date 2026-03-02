import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { deleteDrop, fetchAdminDrops, fetchDropAnalytics, updateDropStock, upsertDrop } from "@/services/drops";
import { fetchAdminProducts } from "@/services/products";
import { supabase } from "@/lib/supabase";
import type { Drop } from "@/types/domain";

const defaultForm: Partial<Drop> = {
  name: "",
  slug: "",
  description: "",
  hero_media_type: "image",
  hero_media_url: "",
  start_time: "",
  end_time: "",
  total_stock: 0,
  available_stock: 0,
  access_type: "public",
  minimum_spend_required: null,
  required_loyalty_points: null,
  early_access_hours: 0,
  minimum_tier_required: null,
  is_active: false,
};

const toDateTimeLocal = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const toIso = (value: string) => (value ? new Date(value).toISOString() : "");

export const AdminDropsPage = () => {
  const flashTableEnabled = import.meta.env.VITE_ENABLE_FLASH_TABLE !== "false";
  const queryClient = useQueryClient();
  const dropsQuery = useQuery({ queryKey: ["admin-drops"], queryFn: fetchAdminDrops, refetchInterval: 15_000 });
  const productsQuery = useQuery({ queryKey: ["admin-products"], queryFn: fetchAdminProducts });
  const eliteTiersQuery = useQuery({
    queryKey: ["elite-tiers-admin-drop"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("elite_tiers")
        .select("id,name,required_valid_referrals,is_active")
        .eq("is_active", true)
        .order("required_valid_referrals", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [form, setForm] = useState<Partial<Drop>>(defaultForm);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [stockEdit, setStockEdit] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [flashScheduleText, setFlashScheduleText] = useState("");

  const flashSchedulesQuery = useQuery({
    queryKey: ["admin-drop-flash-schedule"],
    queryFn: async () => {
      if (!flashTableEnabled) return [];
      const { data, error } = await supabase
        .from("drop_flash_price_schedule")
        .select("id,drop_id,starts_at,extra_discount_percent,is_active")
        .eq("is_active", true)
        .order("starts_at", { ascending: true });
      if (error) {
        const raw = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
        const missing =
          raw.includes("drop_flash_price_schedule") ||
          raw.includes("relation") ||
          raw.includes("does not exist") ||
          raw.includes("pgrst205") ||
          raw.includes("42p01");
        if (missing) return [];
        throw error;
      }
      return data ?? [];
    },
    enabled: flashTableEnabled,
    refetchInterval: 30_000,
  });

  const assignedByDrop = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of productsQuery.data ?? []) {
      if (!p.drop_id) continue;
      const current = map.get(p.drop_id) ?? [];
      current.push(p.id);
      map.set(p.drop_id, current);
    }
    return map;
  }, [productsQuery.data]);

  const flashByDrop = useMemo(() => {
    const map = new Map<string, Array<{ starts_at: string; extra_discount_percent: number }>>();
    for (const row of flashSchedulesQuery.data ?? []) {
      const dropId = String((row as any).drop_id ?? "");
      if (!dropId) continue;
      const current = map.get(dropId) ?? [];
      current.push({
        starts_at: String((row as any).starts_at),
        extra_discount_percent: Number((row as any).extra_discount_percent ?? 0),
      });
      map.set(dropId, current);
    }
    return map;
  }, [flashSchedulesQuery.data]);
  const dropAnalyticsQueries = useQueries({
    queries: (dropsQuery.data ?? []).map((drop) => ({
      queryKey: ["drop-analytics", drop.id],
      queryFn: () => fetchDropAnalytics(drop.id),
      refetchInterval: 30_000,
    })),
  });
  const analyticsByDropId = useMemo(() => {
    const map = new Map<string, (typeof dropAnalyticsQueries)[number]["data"]>();
    (dropsQuery.data ?? []).forEach((drop, index) => {
      map.set(drop.id, dropAnalyticsQueries[index]?.data);
    });
    return map;
  }, [dropsQuery.data, dropAnalyticsQueries]);

  const saveMutation = useMutation({
    mutationFn: async (activate: boolean) => {
      setError("");
      setSuccess("");
      if (!form.name?.trim() || !form.slug?.trim()) throw new Error("Name and slug are required.");
      if (!form.hero_media_url?.trim()) throw new Error("Hero media is required.");
      if (!form.start_time || !form.end_time) throw new Error("Start and end datetime are required.");
      if (new Date(form.start_time).getTime() >= new Date(form.end_time).getTime()) {
        throw new Error("Start time must be before end time.");
      }

      const dropId = await upsertDrop(
        {
          ...form,
          is_active: activate ? true : form.is_active ?? false,
          start_time: toIso(form.start_time),
          end_time: toIso(form.end_time),
          name: form.name,
          slug: form.slug,
        } as Partial<Drop> & { name: string; slug: string },
        selectedProductIds
      );

      const scheduleRows = flashScheduleText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [startsAtRaw, discountRaw] = line.split("|").map((item) => item.trim());
          const startsAt = startsAtRaw ? new Date(startsAtRaw).toISOString() : "";
          const discount = Number(discountRaw ?? 0);
          if (!startsAt || Number.isNaN(discount) || discount < 0 || discount > 95) return null;
          return {
            drop_id: dropId,
            starts_at: startsAt,
            extra_discount_percent: discount,
            is_active: true,
          };
        })
        .filter((item): item is { drop_id: string; starts_at: string; extra_discount_percent: number; is_active: boolean } => Boolean(item));

      if (flashTableEnabled) {
        await supabase.from("drop_flash_price_schedule").delete().eq("drop_id", dropId);
        if (scheduleRows.length) {
          const insertRes = await supabase.from("drop_flash_price_schedule").insert(scheduleRows);
          if (insertRes.error) throw insertRes.error;
        }
      }

      return { dropId };
    },
    onSuccess: async (_, activate) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-drops"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      if (flashTableEnabled) {
        await queryClient.invalidateQueries({ queryKey: ["admin-drop-flash-schedule"] });
      }
      setSuccess(activate ? "Drop saved and activated." : "Drop saved.");
      setForm(defaultForm);
      setSelectedProductIds([]);
      setFlashScheduleText("");
    },
    onError: (err) => setError((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDrop,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-drops"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    },
  });

  const updateStockMutation = useMutation({
    mutationFn: ({ id, available }: { id: string; available: number }) => updateDropStock(id, available),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-drops"] });
    },
  });
  const toggleActiveMutation = useMutation({
    mutationFn: async (drop: Drop) =>
      upsertDrop(
        { ...drop, name: drop.name, slug: drop.slug, is_active: !drop.is_active },
        assignedByDrop.get(drop.id) ?? []
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-drops"] });
    },
  });

  const uploadMedia = async (file: File) => {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `drops/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}`;
    const { error } = await supabase.storage.from("drop-media").upload(path, file, {
      upsert: false,
      cacheControl: "3600",
    });
    if (error) throw error;
    return supabase.storage.from("drop-media").getPublicUrl(path).data.publicUrl;
  };

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Drop Management</h1>

      <form
        className="grid gap-3 rounded-xl border border-white/10 p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate(false);
        }}
      >
        <input
          value={form.name ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="Drop name"
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          value={form.slug ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
          placeholder="Slug"
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <textarea
          value={form.description ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          placeholder="Drop description"
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
          rows={2}
        />
        <select
          value={form.hero_media_type ?? "image"}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, hero_media_type: event.target.value as "image" | "video" }))
          }
          className="rounded-lg border-white/20 bg-black/20"
        >
          <option value="image">Hero Image</option>
          <option value="video">Hero Video</option>
        </select>
        <input
          value={form.hero_media_url ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, hero_media_url: event.target.value }))}
          placeholder="Hero media URL"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <label className="rounded-lg border border-white/15 p-3 text-xs text-white/70 md:col-span-2">
          Upload hero media
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,video/mp4,video/webm"
            className="mt-2 block"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const url = await uploadMedia(file);
                setForm((prev) => ({ ...prev, hero_media_url: url }));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </label>
        <input
          type="datetime-local"
          value={form.start_time ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, start_time: event.target.value }))}
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          type="datetime-local"
          value={form.end_time ?? ""}
          onChange={(event) => setForm((prev) => ({ ...prev, end_time: event.target.value }))}
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          type="number"
          min={0}
          value={Number(form.total_stock ?? 0)}
          onChange={(event) => setForm((prev) => ({ ...prev, total_stock: Number(event.target.value) }))}
          placeholder="Total stock"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input
          type="number"
          min={0}
          value={Number(form.available_stock ?? 0)}
          onChange={(event) => setForm((prev) => ({ ...prev, available_stock: Number(event.target.value) }))}
          placeholder="Available stock"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <select
          value={form.access_type ?? "public"}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, access_type: event.target.value as "public" | "early" | "vip" }))
          }
          className="rounded-lg border-white/20 bg-black/20"
        >
          <option value="public">Public</option>
          <option value="early">Early (logged-in)</option>
          <option value="vip">VIP</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={Boolean(form.is_active)}
            onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
          />
          Active
        </label>
        <input
          type="number"
          min={0}
          value={Number(form.early_access_hours ?? 0)}
          onChange={(event) => setForm((prev) => ({ ...prev, early_access_hours: Number(event.target.value || 0) }))}
          placeholder="Early access hours"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <select
          value={form.minimum_tier_required ?? ""}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              minimum_tier_required: event.target.value.trim() ? event.target.value : null,
            }))
          }
          className="rounded-lg border-white/20 bg-black/20"
        >
          <option value="">No elite tier gate</option>
          {(eliteTiersQuery.data ?? []).map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.name} ({tier.required_valid_referrals}+)
            </option>
          ))}
        </select>

        {form.access_type === "vip" ? (
          <>
            <input
              type="number"
              min={0}
              step={0.01}
              value={form.minimum_spend_required ?? ""}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, minimum_spend_required: event.target.value ? Number(event.target.value) : null }))
              }
              placeholder="Minimum spend required"
              className="rounded-lg border-white/20 bg-black/20"
            />
            <input
              type="number"
              min={0}
              value={form.required_loyalty_points ?? ""}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, required_loyalty_points: event.target.value ? Number(event.target.value) : null }))
              }
              placeholder="Required loyalty points"
              className="rounded-lg border-white/20 bg-black/20"
            />
          </>
        ) : null}

        <div className="md:col-span-2 rounded-lg border border-white/10 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-white/70">Assign Products</p>
          <div className="grid max-h-56 gap-2 overflow-auto pr-2 sm:grid-cols-2 lg:grid-cols-3">
            {(productsQuery.data ?? []).map((product) => {
              const checked = selectedProductIds.includes(product.id);
              return (
                <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelectedProductIds((prev) =>
                        event.target.checked ? [...new Set([...prev, product.id])] : prev.filter((id) => id !== product.id)
                      );
                    }}
                  />
                  <span className="line-clamp-1">{product.title}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-2 rounded-lg border border-white/10 p-3">
          <p className="mb-1 text-xs uppercase tracking-[0.14em] text-white/70">Hourly Flash Price Drops</p>
          <p className="mb-2 text-[11px] text-white/55">One slot per line: `YYYY-MM-DDTHH:mm|discount%`</p>
          <textarea
            value={flashScheduleText}
            onChange={(event) => setFlashScheduleText(event.target.value)}
            placeholder={"2026-03-01T14:00|10\n2026-03-01T18:00|15\n2026-03-01T21:00|20"}
            className="min-h-[92px] w-full rounded-lg border border-white/20 bg-black/20 p-2 text-xs"
          />
        </div>

        {error ? <p className="md:col-span-2 text-xs text-rose-300">{error}</p> : null}
        {success ? <p className="md:col-span-2 text-xs text-emerald-300">{success}</p> : null}

        <div className="md:col-span-2 flex gap-2">
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save Draft"}
          </Button>
          <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(true)}>
            {saveMutation.isPending ? "Saving..." : "Save & Activate"}
          </Button>
        </div>
      </form>

      <div className="space-y-3">
        {(dropsQuery.data ?? []).map((drop) => {
          const assignedCount = assignedByDrop.get(drop.id)?.length ?? 0;
          const analytics = analyticsByDropId.get(drop.id);
          return (
            <div key={drop.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg text-gold-200">{drop.name}</p>
                  <p className="text-xs text-white/65">
                    /drops/{drop.slug} | {drop.access_type} | {drop.is_active ? "active" : "inactive"}
                  </p>
                  <p className="text-xs text-white/60">
                    {new Date(drop.start_time).toLocaleString()} - {new Date(drop.end_time).toLocaleString()} | products: {assignedCount}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/drops/${drop.slug}`} target="_blank" rel="noreferrer" className="rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80">
                    Preview
                  </Link>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setForm({
                        ...drop,
                        start_time: toDateTimeLocal(drop.start_time),
                        end_time: toDateTimeLocal(drop.end_time),
                      });
                      setSelectedProductIds(assignedByDrop.get(drop.id) ?? []);
                      const scheduleText = (flashByDrop.get(drop.id) ?? [])
                        .map((slot) => `${toDateTimeLocal(slot.starts_at)}|${slot.extra_discount_percent}`)
                        .join("\n");
                      setFlashScheduleText(scheduleText);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => toggleActiveMutation.mutate(drop)}
                  >
                    {drop.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (!window.confirm("Delete this drop?")) return;
                      deleteMutation.mutate(drop.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-white/15 px-2 py-1 text-white/75">
                  Stock: {drop.available_stock}/{drop.total_stock}
                </span>
                <input
                  type="number"
                  min={0}
                  value={stockEdit[drop.id] ?? String(drop.available_stock)}
                  onChange={(event) => setStockEdit((prev) => ({ ...prev, [drop.id]: event.target.value }))}
                  className="w-28 rounded border border-white/20 bg-black/30 px-2 py-1"
                />
                <Button
                  variant="ghost"
                  onClick={() => updateStockMutation.mutate({ id: drop.id, available: Number(stockEdit[drop.id] ?? drop.available_stock) })}
                >
                  Update Stock
                </Button>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/75">
                <p className="mb-1 uppercase tracking-[0.14em] text-gold-200">Drop Analytics</p>
                <p>
                  Views: {analytics?.views ?? 0} | Add to cart: {analytics?.add_to_cart ?? 0} | Purchases:{" "}
                  {analytics?.purchases ?? 0}
                </p>
                <p>
                  Conversion: {analytics?.conversion_rate ?? 0}% | Waitlist joins: {analytics?.waitlist_join ?? 0}
                </p>
                <p>
                  Time to sell out:{" "}
                  {analytics?.time_to_sell_out_hours == null
                    ? "N/A"
                    : `${analytics.time_to_sell_out_hours}h`}
                </p>
                <p className="mt-1 text-[11px] text-white/55">
                  Stock timeline points: {analytics?.stock_timeline.length ?? 0}
                </p>
                {(flashByDrop.get(drop.id) ?? []).length ? (
                  <p className="mt-1 text-[11px] text-cyan-200">
                    Flash slots: {(flashByDrop.get(drop.id) ?? [])
                      .map((slot) => `${new Date(slot.starts_at).toLocaleString()} (${slot.extra_discount_percent}%)`)
                      .join(" | ")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
