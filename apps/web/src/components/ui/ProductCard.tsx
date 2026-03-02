import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { calculateEffectivePrice, formatINR } from "@/lib/utils";
import { formatCurrencyAmount, resolveUserCurrency } from "@/services/currency";
import { trackProductView } from "@/services/personalization";
import type { Product, ProductImage } from "@/types/domain";

export const ProductCard = ({
  product,
  festivalDiscount = 0,
}: {
  product: Product & { product_images?: ProductImage[] };
  festivalDiscount?: number;
}) => {
  const { user } = useAuth();
  const currencyQuery = useQuery({ queryKey: ["currency"], queryFn: resolveUserCurrency, staleTime: 30 * 60 * 1000 });
  const image = product.product_images?.find((img) => img.is_primary) ?? product.product_images?.[0];
  const imageUrl = image?.image_url ?? product.image_url ?? null;
  const effectivePrice = calculateEffectivePrice(
    product.discount_price ?? product.price_inr,
    product.discount_percent,
    festivalDiscount
  );
  const showPreviousPrice =
    typeof product.previous_price_inr === "number" && product.previous_price_inr > effectivePrice;
  const discountPercent =
    product.price_inr > effectivePrice ? Math.round((1 - effectivePrice / product.price_inr) * 100) : 0;
  const variantColors = Array.from(
    new Set(
      (product.product_variants ?? [])
        .filter((item) => item.active !== false)
        .map((item) => (item.color ?? "").trim())
        .filter(Boolean)
    )
  ).slice(0, 5);
  const hasTierGate = Boolean((product.minimum_required_tier ?? "").trim() || product.minimum_required_tier_id);
  const earlyAccessEndsAtMs = hasTierGate ? new Date(product.created_at).getTime() + 72 * 60 * 60 * 1000 : 0;
  const isEarlyWindowActive = hasTierGate && earlyAccessEndsAtMs > Date.now();

  const trackView = () => {
    void trackProductView({
      userId: user?.id,
      productId: product.id,
      categorySlug: product.category_slug ?? product.category,
      gender: product.gender ?? null,
      priceInr: product.price_inr,
    });
  };

  return (
    <article className="group relative bg-transparent text-left">
      {discountPercent > 0 ? (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#111111] shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
          -{discountPercent}%
        </span>
      ) : null}
      {isEarlyWindowActive ? (
        <span className="absolute right-2 top-2 z-10 rounded-full border border-[#d4af37]/40 bg-[#1b1508]/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#f1d488] shadow-[0_2px_8px_rgba(0,0,0,0.15)]">
          Royal First Access
        </span>
      ) : null}

      <Link to={`/products/${product.slug}`} onClick={trackView} className="block">
        <div className="relative mb-3 aspect-[3/4] w-full overflow-hidden rounded-none bg-[#f3f3f3]">
          <span className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#111] shadow-[0_8px_16px_-12px_rgba(0,0,0,0.3)]">
            <Heart size={16} />
          </span>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={image?.alt_text ?? product.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-[450ms] ease-out group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full place-items-center text-xs text-[#555555]">No image</div>
          )}
        </div>
      </Link>

      <Link to={`/products/${product.slug}`} onClick={trackView}>
        <h4 className="product-card-title mb-1.5 line-clamp-1 font-heading text-[1.08rem] font-semibold uppercase tracking-[0.01em]">
          {product.title}
        </h4>
      </Link>

      <p className="product-card-category mb-1 text-[11px] uppercase tracking-[0.14em] text-[#666]">{product.category}</p>

      <div className="mb-2 flex items-baseline gap-2">
        <p className="product-card-price text-[1rem] font-bold">
          {currencyQuery.data ? formatCurrencyAmount(effectivePrice, currencyQuery.data) : formatINR(effectivePrice)}
        </p>
        {showPreviousPrice ? (
          <p className="text-xs text-[#555555] line-through">
            {currencyQuery.data
              ? formatCurrencyAmount(product.previous_price_inr as number, currencyQuery.data)
              : formatINR(product.previous_price_inr as number)}
          </p>
        ) : null}
      </div>

      {variantColors.length ? (
        <div className="mt-2 flex items-center gap-1.5" aria-label="Color variants">
          {variantColors.map((color) => (
            <span
              key={color}
              title={color}
              className="inline-block h-2.5 w-2.5 rounded-full border border-black/20"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
};
