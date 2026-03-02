import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { supabase } from "@/lib/supabase";
import { fetchAdminHeroSlides } from "@/services/heroSlides";
import type { HeroSlide } from "@/types/domain";

export const AdminBannersPage = () => {
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManageBanners = isSuperAdmin || hasPermission("can_manage_festival");

  if (isLoading) {
    return <p className="text-sm text-white/70">Loading banner access...</p>;
  }

  if (!canManageBanners && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen banners once.</p>;
  }

  if (!canManageBanners) {
    return <p className="text-sm text-white/70">You do not have banner/festival access.</p>;
  }

  const query = useQuery({
    queryKey: ["admin-banners"],
    queryFn: async () => {
      const { data, error } = await supabase.from("banners").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const heroSlidesQuery = useQuery({
    queryKey: ["admin-hero-slides"],
    queryFn: fetchAdminHeroSlides,
  });

  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [actionError, setActionError] = useState("");
  const [heroError, setHeroError] = useState("");
  const [heroForm, setHeroForm] = useState({
    id: "",
    tag: "",
    title: "",
    subtitle: "",
    cta_label: "Explore Collection",
    cta_href: "/products",
    sort_order: "0",
    active: true,
  });

  const uploadToFestivalBucket = async (file: File): Promise<string> => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `banners/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
    const { error } = await supabase.storage.from("festival-banners").upload(path, file, {
      upsert: false,
      cacheControl: "3600",
    });
    if (error) throw error;
    return supabase.storage.from("festival-banners").getPublicUrl(path).data.publicUrl;
  };

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Banner Control</h1>
      <form
        className="grid gap-3 rounded-xl border border-white/10 p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaveError("");
          if (mediaType === "image" && !imageUrl.trim()) {
            setSaveError("Image URL required.");
            return;
          }
          if (mediaType === "video" && !videoUrl.trim()) {
            setSaveError("Video URL required.");
            return;
          }

          const payload = mediaType === "video"
            ? { image_url: "", video_url: videoUrl.trim(), title, active: false }
            : { image_url: imageUrl.trim(), title, active: false };

          const { error } = await supabase.from("banners").insert(payload as any);
          if (error) {
            if (String(error.message ?? "").includes("video_url")) {
              setSaveError(
                "Video banner schema not applied yet. Run latest Supabase migration, then retry."
              );
            } else {
              setSaveError(error.message);
            }
            return;
          }
          setImageUrl("");
          setVideoUrl("");
          setTitle("");
          await query.refetch();
        }}
      >
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mediaType === "image"} onChange={() => setMediaType("image")} />
            Image Banner
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mediaType === "video"} onChange={() => setMediaType("video")} />
            Video Banner (loops on home)
          </label>
        </div>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" className="rounded-lg border-white/20 bg-black/20" />
        {mediaType === "image" ? (
          <>
            <input
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="Image URL"
              className="rounded-lg border-white/20 bg-black/20"
              required
            />
            <label className="rounded-lg border border-white/15 p-3 text-xs text-white/70">
              Or upload image (png/jpeg/webp)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="mt-2 block"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    setUploading(true);
                    setSaveError("");
                    const url = await uploadToFestivalBucket(file);
                    setImageUrl(url);
                  } catch (error) {
                    setSaveError((error as Error)?.message ?? "Image upload failed");
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
          </>
        ) : (
          <>
            <input
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              placeholder="Video URL (.mp4 / .webm)"
              className="rounded-lg border-white/20 bg-black/20"
              required
            />
            <label className="rounded-lg border border-white/15 p-3 text-xs text-white/70">
              Or upload video (mp4/webm, small file)
              <input
                type="file"
                accept="video/mp4,video/webm"
                className="mt-2 block"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    setUploading(true);
                    setSaveError("");
                    const url = await uploadToFestivalBucket(file);
                    setVideoUrl(url);
                  } catch (error) {
                    setSaveError((error as Error)?.message ?? "Video upload failed");
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
          </>
        )}
        {saveError ? <p className="text-xs text-rose-300">{saveError}</p> : null}
        <Button type="submit" disabled={uploading}>
          {uploading ? "Uploading..." : "Add Banner"}
        </Button>
      </form>

      {(query.data ?? []).map((banner) => (
        <div key={banner.id} className="rounded-xl border border-white/10 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p>{banner.title ?? "Untitled banner"}</p>
              <p className="text-xs text-white/60">{banner.video_url ? "Video banner" : "Image banner"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={async () => {
                  setActionError("");
                  await supabase.from("banners").update({ active: false }).neq("id", "");
                  await supabase.from("banners").update({ active: true }).eq("id", banner.id);
                  await query.refetch();
                }}
              >
                {banner.active ? "Active" : "Activate"}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (!window.confirm("Delete this banner?")) return;
                  setActionError("");
                  const { error } = await supabase.from("banners").delete().eq("id", banner.id);
                  if (error) {
                    setActionError(error.message);
                    return;
                  }
                  await query.refetch();
                }}
              >
                Remove
              </Button>
            </div>
          </div>
          {banner.video_url ? (
            <video src={banner.video_url} className="mt-3 h-40 w-full rounded-lg object-cover" muted loop autoPlay playsInline />
          ) : banner.image_url ? (
            <img src={banner.image_url} alt={banner.title ?? "Banner"} className="mt-3 h-40 w-full rounded-lg object-cover" />
          ) : null}
        </div>
      ))}
      {actionError ? <p className="text-xs text-rose-300">{actionError}</p> : null}

      <div className="space-y-4 rounded-xl border border-white/10 p-4">
        <h2 className="font-heading text-2xl text-gold-200">Hero Slider Content</h2>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setHeroError("");
            const payload = {
              tag: heroForm.tag.trim(),
              title: heroForm.title.trim(),
              subtitle: heroForm.subtitle.trim(),
              cta_label: heroForm.cta_label.trim() || "Explore Collection",
              cta_href: heroForm.cta_href.trim() || "/products",
              sort_order: Number(heroForm.sort_order || 0),
              active: heroForm.active,
            };
            if (!payload.tag || !payload.title || !payload.subtitle) {
              setHeroError("Tag, title and subtitle are required.");
              return;
            }
            const queryTarget = supabase.from("hero_slides");
            const { error } = heroForm.id
              ? await queryTarget.update(payload).eq("id", heroForm.id)
              : await queryTarget.insert(payload);
            if (error) {
              setHeroError(error.message);
              return;
            }
            setHeroForm({
              id: "",
              tag: "",
              title: "",
              subtitle: "",
              cta_label: "Explore Collection",
              cta_href: "/products",
              sort_order: "0",
              active: true,
            });
            await heroSlidesQuery.refetch();
          }}
        >
          <input
            value={heroForm.tag}
            onChange={(event) => setHeroForm((prev) => ({ ...prev, tag: event.target.value }))}
            placeholder="Tag (e.g. New Luxury Edit)"
            className="rounded-lg border-white/20 bg-black/20"
            required
          />
          <input
            value={heroForm.title}
            onChange={(event) => setHeroForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Title"
            className="rounded-lg border-white/20 bg-black/20"
            required
          />
          <textarea
            value={heroForm.subtitle}
            onChange={(event) => setHeroForm((prev) => ({ ...prev, subtitle: event.target.value }))}
            placeholder="Subtitle"
            className="rounded-lg border-white/20 bg-black/20"
            rows={3}
            required
          />
          <div className="grid gap-3 md:grid-cols-3">
            <input
              value={heroForm.cta_label}
              onChange={(event) => setHeroForm((prev) => ({ ...prev, cta_label: event.target.value }))}
              placeholder="CTA label"
              className="rounded-lg border-white/20 bg-black/20"
            />
            <input
              value={heroForm.cta_href}
              onChange={(event) => setHeroForm((prev) => ({ ...prev, cta_href: event.target.value }))}
              placeholder="CTA href (/products)"
              className="rounded-lg border-white/20 bg-black/20"
            />
            <input
              type="number"
              value={heroForm.sort_order}
              onChange={(event) => setHeroForm((prev) => ({ ...prev, sort_order: event.target.value }))}
              placeholder="Sort order"
              className="rounded-lg border-white/20 bg-black/20"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-white/75">
            <input
              type="checkbox"
              checked={heroForm.active}
              onChange={(event) => setHeroForm((prev) => ({ ...prev, active: event.target.checked }))}
            />
            Active slide
          </label>
          <div className="flex gap-2">
            <Button type="submit">{heroForm.id ? "Update Slide" : "Add Slide"}</Button>
            {heroForm.id ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setHeroForm({
                    id: "",
                    tag: "",
                    title: "",
                    subtitle: "",
                    cta_label: "Explore Collection",
                    cta_href: "/products",
                    sort_order: "0",
                    active: true,
                  })
                }
              >
                Cancel Edit
              </Button>
            ) : null}
          </div>
          {heroError ? <p className="text-xs text-rose-300">{heroError}</p> : null}
        </form>

        {(heroSlidesQuery.data ?? []).map((slide: HeroSlide) => (
          <div key={slide.id} className="rounded-lg border border-white/10 p-3">
            <p className="text-xs uppercase tracking-wider text-gold-300">{slide.tag}</p>
            <p className="font-medium">{slide.title}</p>
            <p className="text-xs text-white/65">{slide.subtitle}</p>
            <p className="mt-1 text-[11px] text-white/55">
              CTA: {slide.cta_label} ({slide.cta_href}) | Order: {slide.sort_order} |{" "}
              {slide.active ? "Active" : "Inactive"}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  setHeroForm({
                    id: slide.id,
                    tag: slide.tag,
                    title: slide.title,
                    subtitle: slide.subtitle,
                    cta_label: slide.cta_label,
                    cta_href: slide.cta_href,
                    sort_order: String(slide.sort_order),
                    active: slide.active,
                  })
                }
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  setHeroError("");
                  const { error } = await supabase
                    .from("hero_slides")
                    .update({ active: !slide.active })
                    .eq("id", slide.id);
                  if (error) {
                    setHeroError(error.message);
                    return;
                  }
                  await heroSlidesQuery.refetch();
                }}
              >
                {slide.active ? "Deactivate" : "Activate"}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  if (!window.confirm("Delete this hero slide?")) return;
                  setHeroError("");
                  const { error } = await supabase.from("hero_slides").delete().eq("id", slide.id);
                  if (error) {
                    setHeroError(error.message);
                    return;
                  }
                  await heroSlidesQuery.refetch();
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
