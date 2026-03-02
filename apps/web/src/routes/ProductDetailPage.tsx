import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { DropHoldTimer } from "@/components/ui/DropHoldTimer";
import { ProductCard } from "@/components/ui/ProductCard";
import { useAuth } from "@/features/auth/AuthContext";
import { eliteApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import { calculateEffectivePrice, formatINR } from "@/lib/utils";
import { addToCart, fetchUserCartReservationMap } from "@/services/cart";
import { startDropHold } from "@/services/dropHold";
import { fetchActiveFestival } from "@/services/festivals";
import {
  applyExtraDiscount,
  fetchDropFlashSchedule,
  fetchLivePurchasePulse,
  getActiveFlashDiscount,
  getSmartUrgencyText,
} from "@/services/royalDropEngine";
import { trackCartAdd, trackProductView } from "@/services/personalization";
import { fetchDropsByIds } from "@/services/drops";
import { fetchProductBySlug, fetchProducts } from "@/services/products";
import { pushRecentlyViewed } from "@/services/recentlyViewed";
import { fetchActiveSiteFestival, getCachedActiveSiteFestival } from "@/services/siteFestivals";
import { toggleWishlistItem } from "@/services/wishlist";

const tierRank = (tier: string | null | undefined): number => {
  const normalized = String(tier ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (normalized === "ROYAL_ACCESS") return 1;
  if (normalized === "ROYAL_CROWN") return 2;
  if (normalized === "SUPER_ROYAL") return 3;
  return 0;
};

const countdownLabel = (targetMs: number, nowMs: number) => {
  const diff = Math.max(0, targetMs - nowMs);
  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${String(days).padStart(2, "0")}d ${String(hours).padStart(2, "0")}h ${String(mins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
};

export const ProductDetailPage = () => {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [cartError, setCartError] = useState<string>("");
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    console.info("[route] Rendering ProductDetailPage route (/products/:slug)", slug);
  }, [slug]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const query = useQuery({ queryKey: ["product", slug], queryFn: () => fetchProductBySlug(slug) });
  const festivalQuery = useQuery({ queryKey: ["festival-active"], queryFn: fetchActiveFestival });
  const siteFestivalQuery = useQuery({
    queryKey: ["site-festival-active"],
    queryFn: fetchActiveSiteFestival,
    staleTime: 5 * 60 * 1000,
    initialData: () => getCachedActiveSiteFestival(),
  });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const eliteStatusQuery = useQuery({
    queryKey: ["elite-my-status", user?.id],
    queryFn: eliteApi.getMyStatus,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
  const resolvedTierQuery = useQuery({
    queryKey: ["resolved-tier", user?.id],
    queryFn: async () => {
      if (!user?.id) return "NORMAL_USER";
      const { data, error } = await supabase.rpc("resolve_user_tier", { p_user_id: user.id });
      if (error) return "NORMAL_USER";
      return String(data ?? "NORMAL_USER");
    },
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
  const dropQuery = useQuery({
    queryKey: ["product-drop", query.data?.drop_id ?? ""],
    queryFn: async () => {
      if (!query.data?.drop_id) return null;
      const rows = await fetchDropsByIds([query.data.drop_id]);
      return rows[0] ?? null;
    },
    enabled: Boolean(query.data?.drop_id),
    refetchInterval: 15_000,
  });
  const flashScheduleQuery = useQuery({
    queryKey: ["drop-flash-schedule", query.data?.drop_id ?? ""],
    queryFn: () => fetchDropFlashSchedule(query.data!.drop_id as string),
    enabled: Boolean(query.data?.drop_id),
    refetchInterval: 30_000,
  });
  const reservationQuery = useQuery({
    queryKey: ["product-reservation", user?.id, query.data?.id ?? ""],
    queryFn: () => fetchUserCartReservationMap(user!.id, [query.data!.id]),
    enabled: Boolean(user?.id && query.data?.drop_id && query.data?.id),
    refetchInterval: 5_000,
  });

  const product = query.data ?? null;
  const galleryImages = useMemo(
    () =>
      (product?.product_images ?? [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [product]
  );

  useEffect(() => {
    const primary = product?.product_images?.find((img) => img.is_primary) ?? product?.product_images?.[0];
    setSelectedImageUrl(primary?.image_url ?? product?.image_url ?? null);
    setSelectedColor("");
    setSelectedSize("");
  }, [product?.id, product?.image_url, product?.product_images]);

  useEffect(() => {
    if (!product?.id) return;
    pushRecentlyViewed(product.id);
    void trackProductView({
      userId: user?.id,
      productId: product.id,
      categorySlug: product.category_slug ?? product.category,
      gender: product.gender ?? null,
      priceInr: product.price_inr,
    });
  }, [product?.id, product?.category_slug, product?.category, product?.gender, product?.price_inr, user?.id]);

  const variants = (product?.product_variants ?? []).filter((item) => item.active !== false);
  const colorOptions = useMemo(
    () => Array.from(new Set(variants.map((item) => item.color).filter((v): v is string => Boolean(v)))),
    [variants]
  );
  const sizeOptions = useMemo(() => {
    const scoped = selectedColor ? variants.filter((item) => item.color === selectedColor) : variants;
    return Array.from(new Set(scoped.map((item) => item.size).filter((v): v is string => Boolean(v))));
  }, [variants, selectedColor]);
  const selectedVariant = useMemo(
    () =>
      variants.find(
        (item) =>
          (selectedColor ? item.color === selectedColor : true) && (selectedSize ? item.size === selectedSize : true)
      ) ?? null,
    [variants, selectedColor, selectedSize]
  );

  const baseEffectivePrice = calculateEffectivePrice(
    product?.discount_price ?? product?.price_inr ?? 0,
    product?.discount_percent ?? 0,
    festivalQuery.data?.festival_discount ?? 0
  );
  const flashPricing = getActiveFlashDiscount(flashScheduleQuery.data ?? [], nowTick);
  const tierExtra = profile?.access_tier === "vip" || profile?.access_tier === "elite" ? 5 : 0;
  const effectivePrice = applyExtraDiscount(baseEffectivePrice, flashPricing.percent + tierExtra);
  const showPreviousPrice = typeof product?.previous_price_inr === "number" && product.previous_price_inr > effectivePrice;
  const canAddToCart = variants.length ? Boolean(selectedVariant && selectedVariant.stock > 0) : (product?.stock ?? 0) > 0;
  const requiredTierName = String(product?.minimum_required_tier ?? "").trim();
  const hasTierGate = Boolean(requiredTierName || product?.minimum_required_tier_id);
  const lockFeatureEnabled =
    (eliteStatusQuery.data?.feature_flags?.ambassador_program_enabled ?? true) &&
    (eliteStatusQuery.data?.feature_flags?.early_drop_enabled ?? true);
  const earlyAccessLockHours = Number(eliteStatusQuery.data?.settings?.early_access_lock_hours ?? 72);
  const earlyUnlockAtMs =
    hasTierGate && product?.created_at ? new Date(product.created_at).getTime() + earlyAccessLockHours * 60 * 60 * 1000 : 0;
  const earlyWindowActive = Boolean(hasTierGate && lockFeatureEnabled && earlyUnlockAtMs > nowTick);
  const requiredRank = requiredTierName ? tierRank(requiredTierName) : 1;
  const userRank = tierRank(resolvedTierQuery.data ?? "NORMAL_USER");
  const hasEarlyAccess = userRank >= requiredRank;
  const isBuyLocked = Boolean(earlyWindowActive && !hasEarlyAccess);
  const countdownText = earlyUnlockAtMs > nowTick ? countdownLabel(earlyUnlockAtMs, nowTick) : "00d 00h 00m 00s";
  const stockLeft = Math.max(0, Number(dropQuery.data?.available_stock ?? product?.stock ?? 0));
  const totalStock = Math.max(1, Number(dropQuery.data?.total_stock ?? product?.stock ?? 1));
  const soldPercent = Math.min(100, Math.max(0, Math.round(((totalStock - stockLeft) / totalStock) * 100)));
  const stockBarColor = soldPercent > 70 ? "#D92D20" : soldPercent > 40 ? "#F79009" : "#111111";
  const localViewedCount = Number(
    typeof window !== "undefined" ? localStorage.getItem(`zarelon_view_count_${product?.id ?? ""}`) ?? "0" : "0"
  );
  const urgencyLine = getSmartUrgencyText({
    stockLeft,
    msRemaining: Math.max(0, new Date(dropQuery.data?.end_time ?? Date.now()).getTime() - nowTick),
    localViewCount: localViewedCount,
  });
  const pulseQuery = useQuery({
    queryKey: ["product-pulse", product?.id ?? "", dropQuery.data?.id ?? "", stockLeft],
    queryFn: () => fetchLivePurchasePulse(product!.id, dropQuery.data?.id ?? null, stockLeft),
    enabled: Boolean(product?.id),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!product?.id) return;
    const key = `zarelon_view_count_${product.id}`;
    const current = Number(localStorage.getItem(key) ?? "0");
    localStorage.setItem(key, String(current + 1));
  }, [product?.id]);

  const relatedProducts = useMemo(() => {
    const all = productsQuery.data ?? [];
    if (!product?.id) return [];
    const sameCategory = all.filter((item) => item.id !== product.id && item.category === product.category);
    if (sameCategory.length) return sameCategory.slice(0, 8);
    return all.filter((item) => item.id !== product.id).slice(0, 8);
  }, [productsQuery.data, product?.id, product?.category]);

  const addMutation = useMutation({
    mutationFn: async () => {
      setCartError("");
      if (!user || !product) throw new Error("Sign in to add item");
      if (variants.length && !selectedVariant) throw new Error("Select size/color first");
      await addToCart(user.id, product.id, 1, selectedVariant?.id ?? null);
      if (product.drop_id) startDropHold(user.id, product.drop_id);
      await trackCartAdd({
        userId: user.id,
        productId: product.id,
        categorySlug: product.category_slug ?? product.category,
        gender: product.gender ?? null,
        amountInr: effectivePrice,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cart"] });
      navigate("/cart");
    },
    onError: (error) => {
      setCartError((error as Error)?.message ?? "Could not add item to cart.");
    },
  });

  const buyNowMutation = useMutation({
    mutationFn: async () => {
      setCartError("");
      if (!user || !product) throw new Error("Sign in to continue");
      if (variants.length && !selectedVariant) throw new Error("Select size/color first");
      await addToCart(user.id, product.id, 1, selectedVariant?.id ?? null);
      if (product.drop_id) startDropHold(user.id, product.drop_id);
      await trackCartAdd({
        userId: user.id,
        productId: product.id,
        categorySlug: product.category_slug ?? product.category,
        gender: product.gender ?? null,
        amountInr: effectivePrice,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cart"] });
      navigate("/checkout");
    },
    onError: (error) => {
      setCartError((error as Error)?.message ?? "Could not proceed to checkout.");
    },
  });

  const wishlistMutation = useMutation({
    mutationFn: async () => {
      if (!user || !product) throw new Error("Sign in to manage wishlist");
      await toggleWishlistItem(user.id, product.id);
    },
  });

  if (query.isLoading) return <div className="rounded-2xl bg-white p-6 text-[#111]">Loading product...</div>;
  if (!product) return <div className="rounded-2xl bg-white p-6 text-[#111]">Product not found.</div>;

  return (
    <div className="-mx-5 min-h-[70vh] bg-white px-5 py-6 pb-28 text-[#111] md:-mx-8 md:px-8 md:py-8 md:pb-8">
      <div className="mx-auto w-full max-w-[1320px] space-y-8">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-none border border-black/10 bg-[#f3f3f3] shadow-none md:rounded-3xl md:bg-white md:shadow-[0_20px_44px_rgba(0,0,0,0.08)]">
              {selectedImageUrl ? (
                <img src={selectedImageUrl} alt={product.title} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-96 place-items-center text-sm text-black/50">No product image</div>
              )}
            </div>
            {galleryImages.length > 1 ? (
              <div className="grid grid-cols-4 gap-3 md:grid-cols-5">
                {galleryImages.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setSelectedImageUrl(image.image_url)}
                    className={`overflow-hidden rounded-xl border ${
                      selectedImageUrl === image.image_url ? "border-black" : "border-black/15 hover:border-black/45"
                    }`}
                  >
                    <img src={image.image_url} alt={image.alt_text ?? product.title} className="h-20 w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-none border border-black/10 bg-white p-4 md:rounded-3xl md:bg-[#fafafa] md:p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-black/55">{product.category}</p>
            <h1 className="font-heading text-4xl text-[#111] md:text-5xl">{product.title}</h1>
            <div>
              <p className="text-3xl text-[#111]">{formatINR(effectivePrice)}</p>
              {showPreviousPrice ? (
                <p className="text-sm text-black/45 line-through">{formatINR(product.previous_price_inr as number)}</p>
              ) : null}
            </div>
            {siteFestivalQuery.data ? (
              <p className="inline-flex rounded-full border border-[#C8A951]/40 bg-[#1A1308] px-3 py-1 text-xs uppercase tracking-[0.16em] text-[#E9C97E]">
                {siteFestivalQuery.data.urgency_text || "Limited Time Offer"}
              </p>
            ) : null}
            {product.drop_id ? (
              <div className="space-y-2 rounded-xl border border-black/12 bg-white p-3">
                <div className="flex items-center justify-between text-xs text-black/75">
                  <span>{soldPercent}% Sold</span>
                  <span>Only {stockLeft} left in stock</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${soldPercent}%`, backgroundColor: stockBarColor }} />
                </div>
                <p className="text-xs text-black/70">{urgencyLine}</p>
                <div className="grid gap-1 text-xs text-black/70 sm:grid-cols-3">
                  <p>{pulseQuery.data?.viewers ?? 0} people are viewing this</p>
                  <p>{pulseQuery.data?.soldLast10Min ?? 0} sold in last 10 min</p>
                  <p>Only {pulseQuery.data?.stockLeft ?? stockLeft} left</p>
                </div>
                {flashPricing.nextSlot ? (
                  <p className="text-xs text-black/70">
                    Next price drop in{" "}
                    <span className="font-semibold">
                      {Math.max(0, new Date(flashPricing.nextSlot.starts_at).getTime() - nowTick) > 0
                        ? new Date(Math.max(0, new Date(flashPricing.nextSlot.starts_at).getTime() - nowTick))
                            .toISOString()
                            .slice(11, 19)
                        : "00:00:00"}
                    </span>
                  </p>
                ) : null}
                {flashPricing.percent > 0 || tierExtra > 0 ? (
                  <p className="text-xs font-semibold text-black">
                    Live extra discount: {flashPricing.percent}% flash + {tierExtra}% {profile?.access_tier?.toUpperCase() ?? "VIP"} access
                  </p>
                ) : null}
                {product.drop_id && user ? (
                  <DropHoldTimer expiresAt={reservationQuery.data?.get(product.id) ?? null} />
                ) : null}
              </div>
            ) : null}
            {hasTierGate ? (
              <div className="space-y-3 rounded-xl border border-black/12 bg-white p-3">
                {isBuyLocked ? (
                  <>
                    <p className="inline-flex w-fit rounded-full border border-[#d4af37]/50 bg-[#1b1508] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f1d488]">
                      Early Access Live
                    </p>
                    <p className="text-sm font-semibold text-[#111]">
                      Members are shopping first. Public checkout opens in <span className="text-[#9f6f00]">{countdownText}</span>.
                    </p>
                    <p className="text-xs text-black/70">
                      You can view all details now. Checkout unlocks automatically when the countdown ends.
                    </p>
                    <Link
                      to="/royal"
                      className="inline-flex rounded-lg border border-black/20 px-3 py-1.5 text-xs font-semibold text-[#111] hover:bg-black/5"
                    >
                      Unlock Early Access
                    </Link>
                  </>
                ) : earlyWindowActive ? (
                  <p className="inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    Premium early access unlocked for your account.
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="leading-relaxed text-black/75">{product.description}</p>

            {variants.length ? (
              <div className="space-y-3 rounded-xl border border-black/12 bg-white p-3">
                <p className="text-xs uppercase tracking-wider text-black/65">Choose Variant</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs text-black/70">Color</p>
                    <select
                      value={selectedColor}
                      onChange={(event) => setSelectedColor(event.target.value)}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm text-[#111]"
                    >
                      <option value="">Select color</option>
                      {colorOptions.map((color) => (
                        <option key={color} value={color}>
                          {color}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-black/70">Size</p>
                    <select
                      value={selectedSize}
                      onChange={(event) => setSelectedSize(event.target.value)}
                      className="w-full rounded-lg border border-black/20 bg-white px-3 py-2 text-sm text-[#111]"
                    >
                      <option value="">Select size</option>
                      {sizeOptions.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-black/70">
                  {selectedVariant
                    ? selectedVariant.stock > 0
                      ? `${selectedVariant.stock} in stock`
                      : "Selected variant is out of stock"
                    : "Pick color and size"}
                </p>
              </div>
            ) : null}

            <div className="hidden flex-wrap gap-3 md:flex">
              <Button
                className="!rounded-xl !bg-black !px-6 !py-2.5 !text-white hover:!bg-black/85"
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending || buyNowMutation.isPending || !canAddToCart || isBuyLocked}
              >
                {!canAddToCart
                  ? "Out of stock"
                  : isBuyLocked
                  ? `Coming Soon ${countdownText}`
                  : addMutation.isPending
                  ? "Adding..."
                  : "Add to Cart"}
              </Button>
              <Button
                variant="ghost"
                className="!rounded-xl !border-black/25 !text-black hover:!bg-black/5"
                onClick={() => wishlistMutation.mutate()}
                disabled={wishlistMutation.isPending}
              >
                {wishlistMutation.isPending ? "Saving..." : "Add to Wishlist"}
              </Button>
              <Button
                className="!rounded-xl !border !border-black/25 !bg-white !px-6 !py-2.5 !text-black hover:!bg-black/5"
                onClick={() => buyNowMutation.mutate()}
                disabled={addMutation.isPending || buyNowMutation.isPending || !canAddToCart || isBuyLocked}
              >
                {buyNowMutation.isPending ? "Processing..." : "Buy Now"}
              </Button>
            </div>
            {cartError ? <p className="text-xs text-rose-600">{cartError}</p> : null}
          </div>
        </div>

        {relatedProducts.length ? (
          <section className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <h2 className="font-heading text-3xl text-[#111]">You May Also Like</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {relatedProducts.map((related) => (
                <ProductCard key={related.id} product={related} festivalDiscount={festivalQuery.data?.festival_discount ?? 0} />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 p-3 backdrop-blur-sm md:hidden">
        <div className="mx-auto flex w-full max-w-[1320px] gap-2">
          <Button
            className="!h-11 !flex-1 !rounded-none !bg-[#0d5c2a] !text-white hover:!bg-[#0b4d23]"
            onClick={() => addMutation.mutate()}
            disabled={addMutation.isPending || buyNowMutation.isPending || !canAddToCart || isBuyLocked}
          >
            {addMutation.isPending ? "ADDING..." : !canAddToCart ? "OUT OF STOCK" : isBuyLocked ? "COMING SOON" : "ADD TO CART"}
          </Button>
          <Button
            className="!h-11 !flex-1 !rounded-none !border !border-[#0d5c2a] !bg-white !text-black hover:!bg-[#f4faf6]"
            onClick={() => buyNowMutation.mutate()}
            disabled={addMutation.isPending || buyNowMutation.isPending || !canAddToCart || isBuyLocked}
          >
            {buyNowMutation.isPending ? "PROCESSING..." : "BUY NOW"}
          </Button>
        </div>
      </div>
    </div>
  );
};
