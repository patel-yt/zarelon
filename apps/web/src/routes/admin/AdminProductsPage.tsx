import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { adminApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import { fetchAdminProducts } from "@/services/products";
import type { Product, ProductImage, ProductVariant } from "@/types/domain";

type ProductWithImages = Product & { product_images?: ProductImage[]; product_variants?: ProductVariant[] };
type VariantDraft = { id: string; color: string; size: string; sku: string; stock: string; active: boolean };

type ImageItem = {
  id: string;
  kind: "url" | "file";
  url: string;
  file?: File;
};

export const AdminProductsPage = () => {
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManageProducts = isSuperAdmin || hasPermission("can_manage_products");

  if (isLoading) {
    return <p className="text-sm text-white/70">Loading product management access...</p>;
  }

  if (!canManageProducts && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen products once.</p>;
  }

  if (!canManageProducts) {
    return <p className="text-sm text-white/70">You do not have product management access.</p>;
  }

  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin-products"], queryFn: fetchAdminProducts });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [gender, setGender] = useState<"men" | "women" | "unisex">("unisex");
  const [showOnHome, setShowOnHome] = useState(false);
  const [showOnNewIn, setShowOnNewIn] = useState(false);
  const [showOnCollection, setShowOnCollection] = useState(false);
  const [collectionSlug, setCollectionSlug] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [dropId, setDropId] = useState("");
  const [minimumRequiredTierId, setMinimumRequiredTierId] = useState("");
  const [price, setPrice] = useState("");
  const [discountPrice, setDiscountPrice] = useState("");
  const [initialPrice, setInitialPrice] = useState("");
  const [initialDiscountPrice, setInitialDiscountPrice] = useState("");
  const [stock, setStock] = useState("");
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [requiresShipping, setRequiresShipping] = useState(true);
  const [requiresCod, setRequiresCod] = useState(true);
  const [returnAllowed, setReturnAllowed] = useState(true);
  const [exchangeAllowed, setExchangeAllowed] = useState(true);
  const [returnWindowDays, setReturnWindowDays] = useState("7");
  const [isActive, setIsActive] = useState(true);
  const [festivalTag, setFestivalTag] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [bundleWithInput, setBundleWithInput] = useState("");
  const [sizeChartJson, setSizeChartJson] = useState("");
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [saveError, setSaveError] = useState<string>("");
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    at: string;
    mode?: "api" | "fallback";
    productId?: string;
    durationMs?: number;
    payload?: Record<string, unknown>;
    error?: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_desc");

  useEffect(() => {
    return () => {
      imageItems.forEach((item) => {
        if (item.kind === "file" && item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
      });
    };
  }, [imageItems]);

  const toItemId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const uploadToBucket = async (bucket: string, file: File): Promise<string> => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      cacheControl: "3600",
    });
    if (error) throw error;
    return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  };

  const resetForm = () => {
    imageItems.forEach((item) => {
      if (item.kind === "file" && item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
    });
    setEditingId(null);
    setTitle("");
    setDescription("");
    setCategory("");
    setGender("unisex");
    setShowOnHome(false);
    setShowOnNewIn(false);
    setShowOnCollection(false);
    setCollectionSlug("");
    setCategorySlug("");
    setDropId("");
    setMinimumRequiredTierId("");
    setPrice("");
    setDiscountPrice("");
    setInitialPrice("");
    setInitialDiscountPrice("");
    setStock("");
    setVariants([]);
    setRequiresShipping(true);
    setRequiresCod(true);
    setReturnAllowed(true);
    setExchangeAllowed(true);
    setReturnWindowDays("7");
    setIsActive(true);
    setFestivalTag("");
    setUrlInput("");
    setImageItems([]);
    setVideoFile(null);
    setVideoUrl("");
    setBundleWithInput("");
    setSizeChartJson("");
    setDragIndex(null);
  };

  const startEdit = (product: ProductWithImages) => {
    imageItems.forEach((item) => {
      if (item.kind === "file" && item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
    });
    setEditingId(product.id);
    setTitle(product.title ?? "");
    setDescription(product.description ?? "");
    setCategory(product.category ?? "");
    setGender(product.gender ?? "unisex");
    setShowOnHome(Boolean(product.show_on_home || product.featured));
    setShowOnNewIn(Boolean(product.show_on_new_in));
    setShowOnCollection(Boolean(product.show_on_collection));
    setCollectionSlug(product.collection_slug ?? "");
    setCategorySlug(product.category_slug ?? "");
    setDropId(product.drop_id ?? "");
    setMinimumRequiredTierId((product as any).minimum_required_tier_id ?? "");
    const nextPrice = String((product.price_inr ?? 0) / 100);
    const nextDiscount = product.discount_price ? String(product.discount_price / 100) : "";
    setPrice(nextPrice);
    setDiscountPrice(nextDiscount);
    setInitialPrice(nextPrice);
    setInitialDiscountPrice(nextDiscount);
    setStock(String(product.stock ?? 0));
    setVariants(
      (product.product_variants ?? []).map((item) => ({
        id: item.id,
        color: item.color ?? "",
        size: item.size ?? "",
        sku: item.sku ?? "",
        stock: String(item.stock ?? 0),
        active: item.active ?? true,
      }))
    );
    setRequiresShipping(product.requires_shipping ?? true);
    setRequiresCod(product.requires_cod ?? true);
    setReturnAllowed(product.return_allowed ?? true);
    setExchangeAllowed(product.exchange_allowed ?? true);
    setReturnWindowDays(String(product.return_window_days ?? 7));
    setIsActive(product.active ?? true);
    setFestivalTag(product.festival_tag ?? "");
    setBundleWithInput((product.bundle_with ?? []).join(","));
    setSizeChartJson(
      product.size_chart && Array.isArray(product.size_chart) && product.size_chart.length
        ? JSON.stringify(product.size_chart, null, 2)
        : ""
    );
    const existingGallery = (product.product_images ?? [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((img: any) => img.image_url)
      .filter(Boolean);
    if (!existingGallery.length && product.image_url) existingGallery.push(product.image_url);
    setImageItems(
      existingGallery.map((url) => ({
        id: toItemId(),
        kind: "url",
        url,
      }))
    );
    setVideoUrl(product.video_url ?? "");
    setVideoFile(null);
  };

  const addGalleryUrl = () => {
    const value = urlInput.trim();
    if (!value) return;
    setImageItems((prev) => [...prev, { id: toItemId(), kind: "url", url: value }]);
    setUrlInput("");
  };

  const removeImageAt = (index: number) => {
    setImageItems((prev) => {
      const target = prev[index];
      if (target?.kind === "file" && target.url.startsWith("blob:")) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const onDropImage = (dropIndex: number) => {
    if (dragIndex === null || dragIndex === dropIndex) return;
    setImageItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
  };

  const setPrimary = (index: number) => {
    if (index <= 0) return;
    setImageItems((prev) => {
      const next = [...prev];
      const [picked] = next.splice(index, 1);
      next.unshift(picked);
      return next;
    });
  };

  const handleImageFileSelect = (files: FileList | null) => {
    if (!files?.length) return;
    const nextItems = Array.from(files).map((file) => ({
      id: toItemId(),
      kind: "file" as const,
      file,
      url: URL.createObjectURL(file),
    }));
    setImageItems((prev) => [...prev, ...nextItems]);
  };

  const allProducts = query.data ?? [];
  const featuredProducts = useMemo(
    () => allProducts.filter((p) => p.featured || p.show_on_home),
    [allProducts]
  );
  const categories = useMemo(() => {
    const values = Array.from(new Set(allProducts.map((p) => p.category).filter(Boolean)));
    values.sort((a, b) => a.localeCompare(b));
    return values;
  }, [allProducts]);

  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = allProducts.filter((p) => {
      const matchesSearch =
        !term ||
        p.title.toLowerCase().includes(term) ||
        p.slug.toLowerCase().includes(term) ||
        (p.category ?? "").toLowerCase().includes(term);
      const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });

    const list = [...filtered];
    if (sortBy === "created_asc") {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else if (sortBy === "title_asc") {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "price_asc") {
      list.sort((a, b) => a.price_inr - b.price_inr);
    } else if (sortBy === "price_desc") {
      list.sort((a, b) => b.price_inr - a.price_inr);
    } else if (sortBy === "stock_desc") {
      list.sort((a, b) => b.stock - a.stock);
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [allProducts, categoryFilter, search, sortBy]);

  const mutation = useMutation({
    mutationFn: async () => {
      setSaveMessage("");
      setSaveError("");
      const startedAt = Date.now();
      const parsedPrice = Math.round(Number(price) * 100);
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        throw new Error("Enter a valid price.");
      }

      const parsedDiscount =
        discountPrice.trim() === "" ? null : Math.round(Number(discountPrice) * 100);
      if (parsedDiscount !== null && (!Number.isFinite(parsedDiscount) || parsedDiscount <= 0)) {
        throw new Error("Enter a valid discount price or keep it empty.");
      }

      // If base price changed but discount field wasn't touched, clear stale discount override.
      const autoClearDiscount =
        Boolean(editingId) && price.trim() !== initialPrice.trim() && discountPrice.trim() === initialDiscountPrice.trim();
      const finalDiscountPrice = autoClearDiscount ? null : parsedDiscount;

      const mergedImageUrls: string[] = [];
      for (const item of imageItems) {
        if (item.kind === "file" && item.file) {
          mergedImageUrls.push(await uploadToBucket("product-images", item.file));
        } else {
          mergedImageUrls.push(item.url);
        }
      }
      const primaryImage = mergedImageUrls[0] ?? undefined;

      let resolvedVideoUrl = videoUrl || undefined;
      if (videoFile) {
        resolvedVideoUrl = await uploadToBucket("product-videos", videoFile);
      }

      const payload = {
        id: editingId ?? undefined,
        title,
        description: description || undefined,
        category,
        gender,
        show_on_home: showOnHome,
        show_on_new_in: showOnNewIn,
        show_on_collection: showOnCollection,
        collection_slug: collectionSlug.trim() || undefined,
        category_slug:
          categorySlug.trim() ||
          category
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-"),
        drop_id: dropId.trim() || undefined,
        minimum_required_tier_id: minimumRequiredTierId.trim() || undefined,
        price_inr: parsedPrice,
        discount_price: finalDiscountPrice === null ? undefined : finalDiscountPrice,
        stock: Number(stock),
        requires_shipping: requiresShipping,
        requires_cod: requiresCod,
        return_allowed: returnAllowed,
        exchange_allowed: exchangeAllowed,
        return_window_days: Math.max(1, Math.min(30, Number(returnWindowDays) || 7)),
        discount_percent: 0,
        festival_tag: festivalTag || undefined,
        image_url: primaryImage,
        image_urls: mergedImageUrls,
        video_url: resolvedVideoUrl,
        bundle_with: bundleWithInput
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        size_chart: sizeChartJson.trim() ? JSON.parse(sizeChartJson) : undefined,
        variants: variants.map((item) => ({
          color: item.color || undefined,
          size: item.size || undefined,
          sku: item.sku || undefined,
          stock: Number(item.stock) || 0,
          active: item.active,
        })),
        featured: showOnHome,
        active: isActive,
      };
      const result = await adminApi.upsertProduct(payload);
      if (debugEnabled) {
        setDebugInfo({
          at: new Date().toISOString(),
          mode: result.mode,
          productId: result.productId,
          durationMs: Date.now() - startedAt,
          payload: {
            ...payload,
            image_urls_count: mergedImageUrls.length,
            video_file_attached: Boolean(videoFile),
          },
        });
      }
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["featured-products"] });
      const isEdit = Boolean(editingId);
      const message = isEdit ? "Product updated successfully." : "Product added successfully.";
      if (!isEdit) {
        resetForm();
      }
      setSaveMessage(message);
    },
    onError: (error) => {
      setSaveError((error as Error)?.message ?? "Could not save product.");
      if (debugEnabled) {
        setDebugInfo({
          at: new Date().toISOString(),
          durationMs: undefined,
          error: (error as Error)?.message ?? "Unknown save error",
        });
      }
    },
  });

  const setActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => adminApi.setProductActive(id, active),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["featured-products"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteProduct(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["featured-products"] });
    },
  });

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Product Management</h1>
      {!!featuredProducts.length && (
        <div className="rounded-xl border border-gold-400/20 bg-gold-500/5 p-3 text-xs text-gold-100">
          Home Featured: {featuredProducts.map((p) => p.title).join(", ")}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
        className="grid gap-3 rounded-xl border border-white/10 p-4 md:grid-cols-2"
      >
        <p className="md:col-span-2 text-xs uppercase tracking-widest text-gold-300">
          {editingId ? "Edit Product" : "Add Product"}
        </p>
        <label className="md:col-span-2 flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={debugEnabled}
            onChange={(event) => setDebugEnabled(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          Enable save debug panel
        </label>
        {saveError ? <p className="md:col-span-2 text-xs text-rose-300">{saveError}</p> : null}
        {saveMessage ? <p className="md:col-span-2 text-xs text-emerald-300">{saveMessage}</p> : null}
        {debugEnabled && debugInfo ? (
          <div className="md:col-span-2 rounded-lg border border-white/10 bg-black/30 p-3 text-[11px] text-white/75">
            <p className="mb-1 font-medium text-gold-200">Live Save Debug</p>
            <p>Time: {debugInfo.at}</p>
            {debugInfo.mode ? <p>Path: {debugInfo.mode}</p> : null}
            {debugInfo.productId ? <p>Product ID: {debugInfo.productId}</p> : null}
            {typeof debugInfo.durationMs === "number" ? <p>Duration: {debugInfo.durationMs} ms</p> : null}
            {debugInfo.error ? <p className="text-rose-300">Error: {debugInfo.error}</p> : null}
            {debugInfo.payload ? (
              <pre className="mt-2 max-h-40 overflow-auto rounded border border-white/10 bg-black/40 p-2 text-[10px]">
                {JSON.stringify(debugInfo.payload, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" className="rounded-lg border-white/20 bg-black/20" required />
        <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Category" className="rounded-lg border-white/20 bg-black/20" required />
        <select
          value={gender}
          onChange={(event) => setGender(event.target.value as "men" | "women" | "unisex")}
          className="rounded-lg border-white/20 bg-black/20"
        >
          <option value="unisex">Unisex</option>
          <option value="men">Men</option>
          <option value="women">Women</option>
        </select>
        <input
          value={categorySlug}
          onChange={(event) => setCategorySlug(event.target.value)}
          placeholder="Category Slug (watches, shoes...)"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input
          value={collectionSlug}
          onChange={(event) => setCollectionSlug(event.target.value)}
          placeholder="Collection Slug (premium, festive...)"
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
        />
        <input
          value={dropId}
          onChange={(event) => setDropId(event.target.value)}
          placeholder="Drop ID (optional)"
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
        />
        <input
          value={minimumRequiredTierId}
          onChange={(event) => setMinimumRequiredTierId(event.target.value)}
          placeholder="Minimum Elite Tier ID (optional)"
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
        />
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description" className="rounded-lg border-white/20 bg-black/20 md:col-span-2" rows={3} />
        <input value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Price INR" className="rounded-lg border-white/20 bg-black/20" required />
        <input value={discountPrice} onChange={(event) => setDiscountPrice(event.target.value)} placeholder="Discount Price INR (optional)" className="rounded-lg border-white/20 bg-black/20" />
        <input value={stock} onChange={(event) => setStock(event.target.value)} placeholder="Base Stock (used when no variants)" className="rounded-lg border-white/20 bg-black/20" required />
        <div className="md:col-span-2 rounded-lg border border-white/10 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-white/70">Variants (Color / Size / Stock)</p>
            <Button
              type="button"
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() =>
                setVariants((prev) => [
                  ...prev,
                  { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, color: "", size: "", sku: "", stock: "0", active: true },
                ])
              }
            >
              + Add Variant
            </Button>
          </div>
          <div className="space-y-2">
            {variants.map((variant) => (
              <div key={variant.id} className="grid gap-2 rounded border border-white/10 bg-black/20 p-2 md:grid-cols-6">
                <input
                  value={variant.color}
                  onChange={(event) =>
                    setVariants((prev) => prev.map((item) => (item.id === variant.id ? { ...item, color: event.target.value } : item)))
                  }
                  placeholder="Color (White)"
                  className="rounded border border-white/20 bg-black/30 px-2 py-1 text-xs"
                />
                <input
                  value={variant.size}
                  onChange={(event) =>
                    setVariants((prev) => prev.map((item) => (item.id === variant.id ? { ...item, size: event.target.value } : item)))
                  }
                  placeholder="Size (M/L/XL)"
                  className="rounded border border-white/20 bg-black/30 px-2 py-1 text-xs"
                />
                <input
                  value={variant.sku}
                  onChange={(event) =>
                    setVariants((prev) => prev.map((item) => (item.id === variant.id ? { ...item, sku: event.target.value } : item)))
                  }
                  placeholder="SKU (optional)"
                  className="rounded border border-white/20 bg-black/30 px-2 py-1 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={variant.stock}
                  onChange={(event) =>
                    setVariants((prev) => prev.map((item) => (item.id === variant.id ? { ...item, stock: event.target.value } : item)))
                  }
                  placeholder="Stock"
                  className="rounded border border-white/20 bg-black/30 px-2 py-1 text-xs"
                />
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={variant.active}
                    onChange={(event) =>
                      setVariants((prev) => prev.map((item) => (item.id === variant.id ? { ...item, active: event.target.checked } : item)))
                    }
                  />
                  Active
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  onClick={() => setVariants((prev) => prev.filter((item) => item.id !== variant.id))}
                >
                  Remove
                </Button>
              </div>
            ))}
            {!variants.length ? <p className="text-xs text-white/50">No variants added. Product will use base stock.</p> : null}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={requiresShipping}
            onChange={(event) => setRequiresShipping(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          Shipping applicable on this product
        </label>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={requiresCod}
            onChange={(event) => setRequiresCod(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          COD available on this product
        </label>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={returnAllowed}
            onChange={(event) => setReturnAllowed(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          Return allowed
        </label>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={exchangeAllowed}
            onChange={(event) => setExchangeAllowed(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          Exchange allowed
        </label>
        <input
          type="number"
          min={1}
          max={30}
          value={returnWindowDays}
          onChange={(event) => setReturnWindowDays(event.target.value)}
          placeholder="Return Window Days (1-30)"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <input value={festivalTag} onChange={(event) => setFestivalTag(event.target.value)} placeholder="Festival Tag (optional)" className="rounded-lg border-white/20 bg-black/20" />
        <input
          value={bundleWithInput}
          onChange={(event) => setBundleWithInput(event.target.value)}
          placeholder="Bundle With Product IDs (comma separated, optional)"
          className="rounded-lg border-white/20 bg-black/20"
        />
        <textarea
          value={sizeChartJson}
          onChange={(event) => setSizeChartJson(event.target.value)}
          placeholder='Size Chart JSON (optional), e.g. [{"Size":"M","Chest":"38"}]'
          className="rounded-lg border-white/20 bg-black/20 md:col-span-2"
          rows={3}
        />
        <div className="md:col-span-2 flex gap-2">
          <input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="Paste image URL and click Add"
            className="flex-1 rounded-lg border-white/20 bg-black/20"
          />
          <Button type="button" variant="ghost" onClick={addGalleryUrl}>
            Add URL
          </Button>
        </div>
        <div className="md:col-span-2 rounded-lg border border-white/10 p-3">
          <p className="mb-2 text-xs text-white/70">Image order (drag to reorder). First image becomes primary.</p>
          <div className="space-y-2">
            {imageItems.map((item, index) => (
              <div
                key={item.id}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => onDropImage(index)}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <img src={item.url} alt={`Preview ${index + 1}`} className="h-10 w-10 rounded border border-white/10 object-cover" />
                  <span className="truncate">
                    {index + 1}. {item.kind === "file" ? `${item.file?.name ?? "uploaded image"} (new)` : item.url}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 py-1 text-[11px]"
                    onClick={() => setPrimary(index)}
                    disabled={index === 0}
                  >
                    {index === 0 ? "Primary" : "Set Primary"}
                  </Button>
                  <Button type="button" variant="ghost" className="px-2 py-1 text-[11px]" onClick={() => removeImageAt(index)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            {!imageItems.length && <p className="text-xs text-white/50">No gallery images yet.</p>}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 p-3 md:col-span-2">
          <p className="mb-2 text-xs text-white/70">Upload Product Images (multiple)</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            multiple
            onChange={(event) => handleImageFileSelect(event.target.files)}
            className="text-xs"
          />
        </div>
        <input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="Video URL (optional)" className="rounded-lg border-white/20 bg-black/20 md:col-span-2" />
        <div className="rounded-lg border border-white/10 p-3 md:col-span-2">
          <p className="mb-2 text-xs text-white/70">Upload Small Product Video (optional)</p>
          <input
            type="file"
            accept="video/mp4,video/webm"
            onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
            className="text-xs"
          />
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/80 md:col-span-2">
          <p className="font-semibold text-white">Homepage Section Placement</p>
          <p className="mt-1 text-white/70">
            `Show on Home` = Home Featured + Home Spotlight me product dikhaya jayega.
          </p>
          <p className="mt-1 text-white/70">
            `Show on New In` = New In section me dikhaya jayega.
          </p>
          <p className="mt-1 text-white/70">
            `Show in Collections` = Collections pages me dikhaya jayega.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={showOnHome}
            onChange={(event) => {
              setShowOnHome(event.target.checked);
            }}
            className="rounded border-white/20 bg-black/20"
          />
          Show on Home (Featured + Spotlight)
        </label>
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/75 md:col-span-2">
          This product will appear in:
          <span className="ml-1 text-white">
            {[
              showOnHome ? "Home Featured" : null,
              showOnHome ? "Home Spotlight" : null,
              showOnNewIn ? "New In" : null,
              showOnCollection ? "Collections" : null,
            ]
              .filter(Boolean)
              .join(" � ") || "Only product pages (not in home/new-in/collections)"}
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={showOnNewIn}
            onChange={(event) => setShowOnNewIn(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          Show on New In
        </label>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={showOnCollection}
            onChange={(event) => setShowOnCollection(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          Show in Collections
        </label>
        <label className="flex items-center gap-2 text-xs text-white/75">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="rounded border-white/20 bg-black/20"
          />
          Product is listed on website
        </label>
        <div className="md:col-span-2 flex gap-2">
          <Button type="submit" className="flex-1">{mutation.isPending ? "Saving..." : editingId ? "Update Product" : "Add Product"}</Button>
          {editingId && (
            <Button type="button" variant="ghost" onClick={resetForm}>
              Cancel Edit
            </Button>
          )}
        </div>
      </form>

      <div className="space-y-3">
        <div className="rounded-xl border border-white/10 p-3">
          <div className="grid gap-2 md:grid-cols-4">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title / slug / category"
              className="rounded-lg border-white/20 bg-black/20"
            />
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm"
            >
              <option value="all">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm"
            >
              <option value="created_desc">Newest</option>
              <option value="created_asc">Oldest</option>
              <option value="title_asc">Title A-Z</option>
              <option value="price_asc">Price Low-High</option>
              <option value="price_desc">Price High-Low</option>
              <option value="stock_desc">Stock High-Low</option>
            </select>
            <div className="grid place-items-center rounded-lg border border-white/10 text-xs text-white/70">
              Showing {visibleProducts.length} / {allProducts.length}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wider text-white/70">
              <tr>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Audience</th>
                <th className="px-3 py-2">Price</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2">Shipping</th>
                <th className="px-3 py-2">COD</th>
                <th className="px-3 py-2">Returns</th>
                <th className="px-3 py-2">Media</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleProducts.map((product) => (
                <tr key={product.id} className="border-t border-white/10">
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium">{product.title}</p>
                    <p className="text-xs text-white/60">{product.slug}</p>
                    {product.featured || product.show_on_home ? (
                      <span className="mt-1 inline-block rounded-full border border-gold-300/40 bg-gold-500/10 px-2 py-0.5 text-[11px] text-gold-200">
                        Featured on Home
                      </span>
                    ) : null}
                    {!product.active ? (
                      <span className="mt-1 ml-2 inline-block rounded-full border border-white/25 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                        Unlisted
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top text-white/80">{product.category}</td>
                  <td className="px-3 py-2 align-top text-white/80">
                    <p className="capitalize">{product.gender ?? "unisex"}</p>
                    <p className="text-[11px] text-white/55">{product.category_slug ?? "-"}</p>
                    <p className="text-[11px] text-gold-200">{product.collection_slug ?? "-"}</p>
                    <p className="text-[11px] text-cyan-200">{product.drop_id ?? "-"}</p>
                  </td>
                  <td className="px-3 py-2 align-top text-white/80">Rs {(product.price_inr / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 align-top text-white/80">
                    {product.stock}
                    {(product.product_variants?.length ?? 0) > 0 ? (
                      <p className="text-[11px] text-gold-200">{product.product_variants?.length} variants</p>
                    ) : null}
                    {product.stock <= 0 ? (
                      <p className="text-[11px] uppercase tracking-wider text-rose-300">Out</p>
                    ) : product.stock <= 5 ? (
                      <p className="text-[11px] uppercase tracking-wider text-amber-200">Low</p>
                    ) : (
                      <p className="text-[11px] uppercase tracking-wider text-emerald-300">Healthy</p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-white/80">
                    {product.requires_shipping ? "Shipping" : "No Shipping"}
                  </td>
                  <td className="px-3 py-2 align-top text-white/80">
                    {product.requires_cod ? "COD On" : "COD Off"}
                  </td>
                  <td className="px-3 py-2 align-top text-white/80">
                    <p>{product.return_allowed ? "Return On" : "Return Off"}</p>
                    <p>{product.exchange_allowed ? "Exchange On" : "Exchange Off"}</p>
                    <p className="text-[11px] text-gold-200">{product.return_window_days ?? 7} days</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full border border-white/15 px-2 py-0.5 text-white/70">
                        Gallery: {product.product_images?.length ?? 0}
                      </span>
                      {product.video_url ? (
                        <span className="rounded-full border border-gold-300/40 bg-gold-500/10 px-2 py-0.5 text-gold-200">
                          Has video
                        </span>
                      ) : (
                        <span className="rounded-full border border-white/15 px-2 py-0.5 text-white/60">
                          No video
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {product.product_images?.[0]?.image_url ? (
                        <img
                          src={product.product_images[0].image_url}
                          alt={product.title}
                          className="h-12 w-12 rounded-lg border border-white/10 object-cover"
                        />
                      ) : null}
                      {product.video_url ? (
                        <video
                          src={product.video_url}
                          muted
                          autoPlay
                          loop
                          playsInline
                          preload="metadata"
                          poster={product.product_images?.[0]?.image_url ?? product.image_url ?? undefined}
                          className="h-12 w-20 rounded-lg border border-white/10 bg-black/40 object-cover"
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      <Button type="button" variant="ghost" onClick={() => startEdit(product)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setActiveMutation.mutate({ id: product.id, active: !product.active })}
                        disabled={setActiveMutation.isPending}
                      >
                        {product.active ? "Unlist" : "List"}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => {
                          if (!window.confirm("Delete this product permanently?")) return;
                          deleteMutation.mutate(product.id);
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!visibleProducts.length ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-sm text-white/60">
                    No products found for current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

