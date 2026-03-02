import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { MobilePageLayout } from "@/components/mobile/MobilePageLayout";
import { MobileHeroBanner } from "@/components/mobile/MobileHeroBanner";
import { MobileSubCategoryScroll } from "@/components/mobile/MobileSubCategoryScroll";
import { MobileFeaturedSection } from "@/components/mobile/MobileFeaturedSection";
import { MobileProductHorizontal } from "@/components/mobile/MobileProductHorizontal";
import { ProductCard } from "@/components/ui/ProductCard";
import { RevealOnScroll } from "@/components/ui/RevealOnScroll";
import { formatINR } from "@/lib/utils";
import { fetchCategoryBySlug } from "@/services/categories";
import { fetchActiveFestival } from "@/services/festivals";
import { fetchProducts } from "@/services/products";
import { fetchSiteSectionsByLocation } from "@/services/siteSections";
import { slugify } from "@/lib/utils";
import type { SiteSection } from "@/types/domain";

const alignClass: Record<string, string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

const renderMedia = (section: SiteSection, className: string) => {
  if (!section.media_url) return <div className={`bg-black/10 ${className}`} />;
  if (section.media_type === "video") {
    return <video src={section.media_url} className={className} muted playsInline loop autoPlay={false} controls={false} />;
  }
  return (
    <img
      src={section.media_url}
      alt={section.title ?? section.section_key}
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
};

export const CategoryPage = () => {
  const { slug = "" } = useParams();

  const categoryQuery = useQuery({
    queryKey: ["category", slug],
    queryFn: () => fetchCategoryBySlug(slug),
    retry: 1,
  });
  const sectionsQuery = useQuery({
    queryKey: ["site-sections-category", slug],
    queryFn: () => fetchSiteSectionsByLocation(`category:${slug}`),
    retry: 1,
  });
  const productsQuery = useQuery({
    queryKey: ["category-products", slug],
    queryFn: fetchProducts,
    retry: 1,
  });
  const festivalQuery = useQuery({ queryKey: ["festival-active"], queryFn: fetchActiveFestival });

  const products = useMemo(
    () =>
      (productsQuery.data ?? []).filter((product) => slugify(product.category ?? "") === slugify(slug)),
    [productsQuery.data, slug]
  );
  const sections = useMemo(
    () => [...(sectionsQuery.data ?? [])].sort((a, b) => a.display_order - b.display_order),
    [sectionsQuery.data]
  );
  const mobileTopNotice = useMemo(() => {
    const noticeSection = sections.find((section) => section.section_key === "category_top_notice");
    const message = String(noticeSection?.title ?? noticeSection?.description ?? "").trim();
    return message || "Free Shipping | Easy Returns | Category Picks";
  }, [sections]);
  const categoryMeta = useMemo(() => {
    const metaSection = sections.find((section) => section.section_key === "category_meta");
    return {
      heroSubtitle:
        String(metaSection?.description ?? metaSection?.subtitle ?? "").trim() ||
        "Handpicked premium products for you.",
      heroCtaText: String(metaSection?.button_text ?? "").trim() || "Shop Now",
      mobileCategoryLabel: String(metaSection?.title ?? "").trim() || "Category",
      mobileFeaturedTitle: String(metaSection?.subtitle ?? "").trim() || "Featured",
      mobileBestSellersTitle: "Best Sellers",
    };
  }, [sections]);
  const heroSection = sections[0] ?? null;
  const mobileProducts = products.slice(0, 12).map((item) => ({
    id: item.id,
    slug: item.slug,
    image: item.image_url ?? null,
    title: item.title,
    category: item.category,
    priceLabel: formatINR((item.discount_price as number | null) ?? item.price_inr),
  }));
  const mobileFeatured = products.slice(0, 2).map((item) => ({
    id: item.id,
    image: item.image_url ?? null,
    title: item.title,
    subtitle: item.category,
    href: `/products/${item.slug}`,
  }));

  if (categoryQuery.isSuccess && !categoryQuery.data) {
    return <Navigate to="/products" replace />;
  }

  return (
    <div className="space-y-7 bg-white pb-10 text-[#111111] md:space-y-8 md:pb-12">
      <div className="md:hidden">
      <MobilePageLayout topNotice={mobileTopNotice}>
        <MobileHeroBanner
          imageUrl={heroSection?.media_url ?? null}
          title={String(heroSection?.title ?? categoryQuery.data?.name ?? "Category")}
          subtitle={String(heroSection?.description ?? categoryMeta.heroSubtitle)}
          ctaText={heroSection?.button_text ?? categoryMeta.heroCtaText}
          ctaUrl={heroSection?.button_link ?? `/products/c/${slugify(slug)}`}
          imagePosition={"center"}
        />
        <MobileSubCategoryScroll
          title={categoryMeta.mobileCategoryLabel}
          items={[
            { slug: "shop-all", label: "Shop All", href: "/products" },
            { slug: slug, label: String(categoryQuery.data?.name ?? slug), href: `/category/${slug}` },
          ]}
        />
        <MobileFeaturedSection title={categoryMeta.mobileFeaturedTitle} items={mobileFeatured} />
        <MobileProductHorizontal title={categoryMeta.mobileBestSellersTitle} items={mobileProducts} />
      </MobilePageLayout>
      </div>

      <div className="hidden md:block">
      {sections.map((section) => (
        <RevealOnScroll key={section.id}>
          <section className="group mx-auto w-full max-w-[1320px] overflow-hidden rounded-none border border-black/10 bg-white">
            <div className="relative">
              {renderMedia(section, "h-[260px] w-full object-cover transition duration-300 group-hover:scale-105 md:h-[360px]")}
              <div
                className="absolute inset-0"
                style={{ backgroundColor: `rgba(0,0,0,${Math.max(0, Math.min(1, section.overlay_opacity ?? 0.25))})` }}
              />
              <div className={`absolute inset-0 flex flex-col justify-end gap-2 p-6 md:p-8 ${alignClass[section.text_alignment] ?? alignClass.left}`}>
                {section.subtitle ? (
                  <p className="text-xs uppercase tracking-[0.24em]" style={{ color: section.text_color ?? "#111111" }}>
                    {section.subtitle}
                  </p>
                ) : null}
                {section.title ? (
                  <h1 className="font-heading text-[clamp(1.8rem,6vw,3.2rem)] font-bold uppercase" style={{ color: section.text_color ?? "#111111" }}>
                    {section.title}
                  </h1>
                ) : null}
                {section.description ? (
                  <p className="max-w-2xl text-sm font-medium md:text-base" style={{ color: section.text_color ?? "#555555" }}>
                    {section.description}
                  </p>
                ) : null}
                {section.button_text ? (
                  <Link
                    to={section.button_link || `/category/${slug}`}
                    className="mt-2 inline-flex rounded-full border border-[#111111] bg-[#111111] px-6 py-2.5 text-sm font-medium text-white transition hover:border-[#C8A951] hover:shadow-[0_0_0_2px_rgba(200,169,81,0.35)]"
                  >
                    {section.button_text}
                  </Link>
                ) : null}
              </div>
            </div>
          </section>
        </RevealOnScroll>
      ))}

      <RevealOnScroll>
        <section className="mx-auto w-full max-w-[1320px] px-4 md:px-8">
          <div className="grid gap-5 grid-cols-2 md:grid-cols-3 xl:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} festivalDiscount={festivalQuery.data?.festival_discount ?? 0} />
            ))}
          </div>
        </section>
      </RevealOnScroll>
      </div>
    </div>
  );
};
