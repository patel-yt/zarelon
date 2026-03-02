import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { supabase } from "@/lib/supabase";
import {
  endSiteFestivalNow,
  fetchAdminSiteFestivals,
  setSiteFestivalActive,
  upsertSiteFestival,
} from "@/services/siteFestivals";
import type { SiteFestival } from "@/types/domain";

const emptyForm = {
  id: "",
  festival_name: "",
  slug: "",
  theme_primary: "#C8A951",
  theme_secondary: "#111111",
  hero_image_url: "",
  hero_video_url: "",
  discount_text: "",
  promo_text: "",
  urgency_text: "",
  discount_percent: "20",
  promo_messages_text: "",
  start_date: "",
  end_date: "",
  is_active: false,
};

export const AdminFestivalPage = () => {
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManageFestival = isSuperAdmin || hasPermission("can_manage_festival");

  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [previewMode, setPreviewMode] = useState(true);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const festivalsQuery = useQuery({
    queryKey: ["admin-site-festivals"],
    queryFn: fetchAdminSiteFestivals,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      setFormError("");
      setFormSuccess("");
      const promoMessages = form.promo_messages_text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      await upsertSiteFestival({
        id: form.id || undefined,
        festival_name: form.festival_name,
        slug: form.slug,
        is_active: form.is_active,
        theme_primary: form.theme_primary,
        theme_secondary: form.theme_secondary,
        hero_image_url: form.hero_image_url,
        hero_video_url: form.hero_video_url || null,
        discount_text: form.discount_text,
        promo_text: form.promo_text,
        urgency_text: form.urgency_text,
        discount_percent: Number(form.discount_percent || 0),
        promo_messages: promoMessages,
        start_date: form.start_date,
        end_date: form.end_date,
      });
    },
    onSuccess: async () => {
      setFormSuccess(form.id ? "Festival updated successfully." : "Festival created successfully.");
      setForm(emptyForm);
      await festivalsQuery.refetch();
    },
    onError: (error) => {
      setFormError((error as Error)?.message ?? "Could not save festival");
    },
  });

  const uploadAsset = async (file: File): Promise<string> => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `site-festivals/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
    const { error } = await supabase.storage.from("festival-banners").upload(path, file, {
      upsert: false,
      cacheControl: "3600",
    });
    if (error) throw error;
    return supabase.storage.from("festival-banners").getPublicUrl(path).data.publicUrl;
  };

  const onUploadMedia = async (file: File, target: "hero_image_url" | "hero_video_url") => {
    try {
      setUploading(true);
      setFormError("");
      const url = await uploadAsset(file);
      setForm((prev) => ({ ...prev, [target]: url }));
    } catch (error) {
      setFormError((error as Error)?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const editFestival = (festival: SiteFestival) => {
    setForm({
      id: festival.id,
      festival_name: festival.festival_name,
      slug: festival.slug,
      theme_primary: festival.theme_primary,
      theme_secondary: festival.theme_secondary,
      hero_image_url: festival.hero_image_url,
      hero_video_url: festival.hero_video_url ?? "",
      discount_text: festival.discount_text,
      promo_text: festival.promo_text,
      urgency_text: festival.urgency_text,
      discount_percent: String(festival.discount_percent ?? 0),
      promo_messages_text: (festival.promo_messages ?? []).join("\n"),
      start_date: festival.start_date.slice(0, 16),
      end_date: festival.end_date.slice(0, 16),
      is_active: festival.is_active,
    });
    setFormSuccess("");
  };

  const activeFestival = useMemo(
    () => (festivalsQuery.data ?? []).find((item) => item.is_active),
    [festivalsQuery.data]
  );

  if (isLoading) return <p className="text-sm text-white/70">Loading festival management access...</p>;
  if (!canManageFestival && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen festival once.</p>;
  }
  if (!canManageFestival) return <p className="text-sm text-white/70">You do not have festival management access.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl text-gold-200">Festival Management</h1>
        <label className="inline-flex items-center gap-2 text-xs text-white/80">
          <input
            type="checkbox"
            checked={previewMode}
            onChange={(event) => setPreviewMode(event.target.checked)}
          />
          Preview mode
        </label>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-white/10 p-4 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          await mutation.mutateAsync();
        }}
      >
        <input
          value={form.festival_name}
          onChange={(e) => setForm({ ...form, festival_name: e.target.value })}
          placeholder="Festival name (e.g. Diwali)"
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
          placeholder="Slug (e.g. diwali)"
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          value={form.theme_primary}
          onChange={(e) => setForm({ ...form, theme_primary: e.target.value })}
          placeholder="Primary theme color (#C8A951)"
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          value={form.theme_secondary}
          onChange={(e) => setForm({ ...form, theme_secondary: e.target.value })}
          placeholder="Secondary theme color (#111111)"
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          value={form.discount_text}
          onChange={(e) => setForm({ ...form, discount_text: e.target.value })}
          placeholder='Discount text (e.g. "Flat 40% OFF")'
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          value={form.discount_percent}
          onChange={(e) => setForm({ ...form, discount_percent: e.target.value })}
          placeholder="Discount % (0-90)"
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          value={form.promo_text}
          onChange={(e) => setForm({ ...form, promo_text: e.target.value })}
          placeholder='Promo text (e.g. "Celebrate the Light with Luxury")'
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
          required
        />
        <input
          value={form.urgency_text}
          onChange={(e) => setForm({ ...form, urgency_text: e.target.value })}
          placeholder='Urgency text (e.g. "Limited Time Only")'
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
          required
        />
        <textarea
          value={form.promo_messages_text}
          onChange={(e) => setForm({ ...form, promo_messages_text: e.target.value })}
          placeholder={"Sliding messages (one per line)\nHappy Diwali\nFlat 40% OFF\nLimited Stock Available"}
          className="min-h-[110px] rounded-lg border-white/20 bg-black/20 md:col-span-2"
        />
        <input
          value={form.hero_image_url}
          onChange={(e) => setForm({ ...form, hero_image_url: e.target.value })}
          placeholder="Hero image URL"
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
          required
        />
        <input
          value={form.hero_video_url}
          onChange={(e) => setForm({ ...form, hero_video_url: e.target.value })}
          placeholder="Hero video URL (optional)"
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
        />

        <label className="rounded-lg border border-white/15 p-3 text-xs text-white/70 md:col-span-2">
          Upload hero image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="mt-2 block"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              await onUploadMedia(file, "hero_image_url");
            }}
          />
        </label>
        <label className="rounded-lg border border-white/15 p-3 text-xs text-white/70 md:col-span-2">
          Upload hero video
          <input
            type="file"
            accept="video/mp4,video/webm"
            className="mt-2 block"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              await onUploadMedia(file, "hero_video_url");
            }}
          />
        </label>

        <input
          type="datetime-local"
          value={form.start_date}
          onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <input
          type="datetime-local"
          value={form.end_date}
          onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          className="rounded-lg border-white/20 bg-black/20"
          required
        />
        <label className="inline-flex items-center gap-2 text-sm text-white/80 md:col-span-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
          />
          Activate immediately after save
        </label>
        {formError ? <p className="text-xs text-rose-300 md:col-span-2">{formError}</p> : null}
        {formSuccess ? <p className="text-xs text-emerald-300 md:col-span-2">{formSuccess}</p> : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" disabled={uploading || mutation.isPending}>
            {mutation.isPending ? "Saving..." : form.id ? "Update Festival" : "Create Festival"}
          </Button>
          {form.id ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setForm(emptyForm);
                setFormError("");
                setFormSuccess("");
              }}
            >
              Clear Edit
            </Button>
          ) : null}
        </div>
      </form>

      {previewMode ? (
        <section
          className="overflow-hidden rounded-2xl border border-white/15"
          style={{ background: `linear-gradient(120deg, ${form.theme_secondary}, ${form.theme_primary})` }}
        >
          <div className="relative p-6">
            {form.hero_video_url ? (
              <video src={form.hero_video_url} className="mb-4 h-40 w-full rounded-xl object-cover" muted autoPlay loop playsInline />
            ) : form.hero_image_url ? (
              <img src={form.hero_image_url} alt="Festival preview" className="mb-4 h-40 w-full rounded-xl object-cover" />
            ) : null}
            <p className="text-xs uppercase tracking-[0.2em] text-white/70">Preview</p>
            <h2 className="font-heading text-3xl text-white">{form.festival_name || "Festival Name"}</h2>
            <p className="mt-1 text-white/80">{form.promo_text || "Promo headline preview"}</p>
            <p className="mt-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs uppercase tracking-[0.14em] text-[#FCE9BA]">
              {form.urgency_text || "Limited Time"}
            </p>
          </div>
        </section>
      ) : null}

      <div className="space-y-3">
        <h2 className="font-heading text-2xl text-gold-100">Saved Festivals</h2>
        {activeFestival ? (
          <p className="text-xs text-emerald-300">
            Active now: {activeFestival.festival_name} ({new Date(activeFestival.start_date).toLocaleString()} - {new Date(activeFestival.end_date).toLocaleString()})
          </p>
        ) : (
          <p className="text-xs text-white/60">No active festival currently.</p>
        )}
        {(festivalsQuery.data ?? []).map((festival) => (
          <div key={festival.id} className="rounded-xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-white">{festival.festival_name}</p>
                <p className="text-xs text-white/60">
                  {new Date(festival.start_date).toLocaleString()} - {new Date(festival.end_date).toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-gold-200">{festival.discount_text}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => editFestival(festival)}>
                  Edit
                </Button>
                <Button
                  type="button"
                  variant={festival.is_active ? "ghost" : "gold"}
                  onClick={async () => {
                    await setSiteFestivalActive(festival.id, !festival.is_active);
                    await festivalsQuery.refetch();
                  }}
                >
                  {festival.is_active ? "Deactivate" : "Activate"}
                </Button>
                {festival.is_active ? (
                  <Button
                    type="button"
                    variant="danger"
                    onClick={async () => {
                      await endSiteFestivalNow(festival.id);
                      await festivalsQuery.refetch();
                    }}
                  >
                    End Now
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
