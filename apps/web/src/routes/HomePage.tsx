import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RevealOnScroll } from "@/components/ui/RevealOnScroll";
import { TopNotificationBar } from "@/components/home/TopNotificationBar";
import { HeroCarousel, type HeroCarouselItem } from "@/components/home/HeroCarousel";
import { FeaturedCategoryTiles, type FeaturedTile } from "@/components/home/FeaturedCategoryTiles";
import { ShopByCategoryRow, type ShopCategoryItem } from "@/components/home/ShopByCategoryRow";
import { SpotlightSection } from "@/components/home/SpotlightSection";
import { NewArrivalsSection } from "@/components/home/NewArrivalsSection";
import { useAuth } from "@/features/auth/AuthContext";
import { homepageApi, socialRewardsApi } from "@/lib/apiClient";
import { formatINR, slugify } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { applySmartHomeLayout, fetchActiveHomeCms } from "@/services/homeCms";
import { fetchProducts, filterProductsByVipLevel } from "@/services/products";
import { fetchActiveSiteFestival, getCachedActiveSiteFestival } from "@/services/siteFestivals";
import { formatCurrencyAmount, resolveUserCurrency } from "@/services/currency";
import type { HomeSection, ProductImage } from "@/types/domain";

type HomeProduct = {
  id: string;
  slug: string;
  title: string;
  category: string;
  price_inr: number;
  discount_price: number | null;
  image_url: string | null;
  show_on_home?: boolean;
  show_on_new_in?: boolean;
  featured?: boolean;
  created_at?: string;
  required_vip_level?: "normal" | "vip" | "elite";
  product_images?: ProductImage[];
};

const fallbackHero = {
  tag: "ZARELON",
  title: "SIGNATURE LUXURY.",
  subtitle: "Crafted essentials for timeless everyday style.",
  buttonText: "Shop Collection",
  buttonUrl: "/products",
  media: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=2400&q=80&fm=webp",
  overlay: 0.45,
  alignment: "left",
};

const fallbackSections: HomeSection[] = [
  {
    id: "fallback-hero",
    page_id: "fallback",
    section_key: "hero_main",
    section_type: "hero",
    display_order: 0,
    is_visible: true,
    config_json: fallbackHero,
    created_at: "",
    updated_at: "",
  },
  {
    id: "fallback-category",
    page_id: "fallback",
    section_key: "shop_by_activity",
    section_type: "category",
    display_order: 1,
    is_visible: true,
    config_json: {
      title: "Shop By Category",
      items: [
        {
          title: "Footwear",
          link: "/products/c/footwear",
          image:
            "https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=1600&q=80&fm=webp",
        },
        {
          title: "Apparel",
          link: "/products/c/apparel",
          image:
            "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1600&q=80&fm=webp",
        },
        {
          title: "Accessories",
          link: "/products/c/accessories",
          image:
            "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1600&q=80&fm=webp",
        },
      ],
    },
    created_at: "",
    updated_at: "",
  },
  {
    id: "fallback-featured",
    page_id: "fallback",
    section_key: "featured_grid",
    section_type: "featured",
    display_order: 2,
    is_visible: true,
    config_json: {
      title: "Featured",
      source: "products",
      maxItems: 6,
    },
    created_at: "",
    updated_at: "",
  },
  {
    id: "fallback-grid",
    page_id: "fallback",
    section_key: "best_sellers",
    section_type: "product_grid",
    display_order: 3,
    is_visible: true,
    config_json: {
      title: "Best Sellers",
      source: "home",
      columns: 3,
      showPrice: true,
      showCategory: true,
      maxItems: 10,
    },
    created_at: "",
    updated_at: "",
  },
];

const countdownLabel = (targetIso?: string | null) => {
  if (!targetIso) return "00:00:00";
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const getProductImage = (product: HomeProduct) =>
  product.product_images?.find((img) => img.is_primary)?.image_url || product.product_images?.[0]?.image_url || product.image_url;
const isHomeMarked = (product: HomeProduct) => Boolean(product.show_on_home || product.featured);
const resolveCategoryLink = (title: string, link?: string) => {
  const raw = String(link ?? "").trim();
  if (raw) return raw;
  const slug = slugify(title);
  return slug ? `/products/c/${slug}` : "/products";
};

const truncateText = (value: string, maxLen: number) => {
  const text = String(value ?? "").trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
};

export const HomePage = () => {
  const { user, profile } = useAuth();
  const flashTableEnabled = import.meta.env.VITE_ENABLE_FLASH_TABLE !== "false";
  const [flashScheduleEnabled, setFlashScheduleEnabled] = useState<boolean>(() => flashTableEnabled);

  const cmsQuery = useQuery({ queryKey: ["home-cms"], queryFn: fetchActiveHomeCms, staleTime: 60_000 });
  const mobileHomeQuery = useQuery({
    queryKey: ["homepage-mobile"],
    queryFn: homepageApi.getMobile,
    staleTime: 60_000,
  });
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: fetchProducts });
  const siteFestivalQuery = useQuery({
    queryKey: ["site-festival-active"],
    queryFn: fetchActiveSiteFestival,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    initialData: () => getCachedActiveSiteFestival(),
  });
  const currencyQuery = useQuery({ queryKey: ["currency"], queryFn: resolveUserCurrency, staleTime: 30 * 60 * 1000 });

  const nextFlashQuery = useQuery({
    queryKey: ["home-next-flash-drop"],
    queryFn: async () => {
      if (!flashScheduleEnabled) return null;
      const { data, error } = await supabase
        .from("drop_flash_price_schedule")
        .select("starts_at,extra_discount_percent")
        .eq("is_active", true)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) {
        const raw = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
        const missingRelation =
          raw.includes("drop_flash_price_schedule") ||
          raw.includes("relation") ||
          raw.includes("does not exist") ||
          raw.includes("pgrst205") ||
          raw.includes("42p01");
        if (missingRelation) {
          setFlashScheduleEnabled(false);
          console.info("[home] drop_flash_price_schedule not found. Disabling flash-drop query.");
        }
        return null;
      }
      return data;
    },
    enabled: flashScheduleEnabled,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (productsQuery.isError) console.warn("[home] products fetch failed, using static fallback.");
  }, [productsQuery.isError]);

  const baseSections = useMemo(() => {
    const rows = cmsQuery.data?.sections ?? [];
    return rows.length ? rows : fallbackSections;
  }, [cmsQuery.data?.sections]);

  const smartSectionsQuery = useQuery({
    queryKey: ["home-smart-sections", user?.id ?? "guest", cmsQuery.data?.page.smart_layout_mode ?? false, baseSections.map((s) => s.id).join(",")],
    queryFn: () =>
      applySmartHomeLayout({
        sections: baseSections,
        userId: user?.id,
        smartMode: Boolean(cmsQuery.data?.page.smart_layout_mode),
      }),
    enabled: baseSections.length > 0,
  });

  const sections = smartSectionsQuery.data ?? baseSections;
  const homeTopNoticeConfig = useMemo(() => {
    const topNoticeSection = sections.find((section) => section.section_key === "home_top_notice");
    const cfg = (topNoticeSection?.config_json ?? {}) as Record<string, unknown>;
    const message = String(cfg.message ?? cfg.title ?? "").trim();
    const ctaText = String(cfg.ctaText ?? cfg.buttonText ?? "").trim();
    const ctaUrl = String(cfg.ctaUrl ?? cfg.buttonUrl ?? "").trim();
    return {
      message,
      ctaText: ctaText || "Shop Now",
      ctaUrl: ctaUrl || "/products",
    };
  }, [sections]);
  const homeMobileLabels = useMemo(() => {
    const labelSection = sections.find((section) => section.section_key === "home_mobile_labels");
    const cfg = (labelSection?.config_json ?? {}) as Record<string, unknown>;
    return {
      featuredCategoriesTitle: String(cfg.featuredCategoriesTitle ?? "Featured Categories"),
      newArrivalsTitle: String(cfg.newArrivalsTitle ?? "New Arrivals"),
      shopByCategoryTitle: String(cfg.shopByCategoryTitle ?? "Shop by Category"),
      spotlightTitle: String(cfg.spotlightTitle ?? "Spotlight"),
      creatorsSpotlightTitle: String(cfg.creatorsSpotlightTitle ?? "Royal Creators Spotlight"),
    };
  }, [sections]);
  const homeSpotlightBannerConfig = useMemo(() => {
    const bannerSection = sections.find(
      (section) => section.section_key === "home_spotlight_banner" || section.section_key === "spotlight_banner"
    );
    const cfg = (bannerSection?.config_json ?? {}) as Record<string, unknown>;
    const image = String(cfg.image ?? cfg.media ?? cfg.image_url ?? "").trim();
    const alt = String(cfg.alt ?? cfg.title ?? "Spotlight Banner").trim();
    const link = String(cfg.link ?? cfg.buttonUrl ?? "/products").trim();
    return image ? { image, alt, link } : null;
  }, [sections]);
  const pageLayout = cmsQuery.data?.page.layout_type ?? "nike";
  const isNewVisitor = !user;
  const siteFestival = siteFestivalQuery.data;
  const creatorsQuery = useQuery({
    queryKey: ["social-leaderboard-home"],
    queryFn: socialRewardsApi.getLeaderboard,
    staleTime: 60_000,
  });
  const currency = currencyQuery.data;

  const products = useMemo<HomeProduct[]>(() => {
    const all = (productsQuery.data ?? []) as HomeProduct[];
    if (!all.length) return [];
    const visible = filterProductsByVipLevel<HomeProduct>(
      all,
      (profile?.vip_level as "normal" | "vip" | "elite" | undefined) ?? "normal"
    );
    return visible.filter((item) => isHomeMarked(item)).length ? visible.filter((item) => isHomeMarked(item)) : visible;
  }, [productsQuery.data, profile?.vip_level]);

  const allVisibleProducts = useMemo<HomeProduct[]>(() => {
    const all = (productsQuery.data ?? []) as HomeProduct[];
    if (!all.length) return [];
    return filterProductsByVipLevel<HomeProduct>(
      all,
      (profile?.vip_level as "normal" | "vip" | "elite" | undefined) ?? "normal"
    );
  }, [productsQuery.data, profile?.vip_level]);

  const getHeroData = (section: HomeSection) => {
    const config = section.config_json as Record<string, any>;
    if (isNewVisitor && siteFestival) {
      return {
        tag: siteFestival.festival_name,
        title: truncateText(siteFestival.promo_text || fallbackHero.title, 35),
        subtitle: truncateText(siteFestival.urgency_text || fallbackHero.subtitle, 60),
        buttonText: "Shop Festive Collection",
        buttonUrl: `/products?festival=${encodeURIComponent(siteFestival.slug)}`,
        media: siteFestival.hero_image_url || fallbackHero.media,
        overlay: 0.52,
        alignment: "left",
        imagePosition: "center" as const,
        textColorMode: "auto" as const,
      };
    }

    return {
      tag: String(config.tag ?? config.label ?? fallbackHero.tag),
      title: truncateText(String(config.title ?? fallbackHero.title), 35),
      subtitle: truncateText(String(config.subtitle ?? fallbackHero.subtitle), 60),
      buttonText: String(config.buttonText ?? config.button_text ?? fallbackHero.buttonText),
      buttonUrl: String(config.buttonUrl ?? config.button_link ?? fallbackHero.buttonUrl),
      media: String(config.media ?? config.image ?? config.media_url ?? fallbackHero.media),
      overlay: Number(config.overlay ?? 0.42),
      alignment: String(config.alignment ?? "left"),
      imagePosition: (String(config.imagePosition ?? "center") as "center" | "top" | "bottom"),
      textColorMode: (String(config.textColorMode ?? "auto") as "light" | "dark" | "auto"),
    };
  };

  const heroMobileItems: HeroCarouselItem[] = useMemo(
    () => {
      if (mobileHomeQuery.data?.heroSections?.length) return mobileHomeQuery.data.heroSections;
      return sections
        .filter((section) => section.section_type === "hero")
        .map((section) => {
          const hero = getHeroData(section);
          return {
            id: section.id,
            imageMobile: hero.media,
            headline: hero.title,
            subText: hero.subtitle,
            ctaText: hero.buttonText,
            ctaUrl: hero.buttonUrl,
            priority: section.display_order,
            imagePosition: hero.imagePosition,
            textColorMode: hero.textColorMode,
          };
        });
    },
    [mobileHomeQuery.data?.heroSections, sections]
  );

  const featuredTiles: FeaturedTile[] = useMemo(() => {
    if (mobileHomeQuery.data?.featuredTiles?.length) {
      return mobileHomeQuery.data.featuredTiles.map((tile: any) => ({
        id: String(tile.id),
        image: String(tile.image),
        title: String(tile.title ?? "Featured"),
        subtitle: tile.subtitle ? String(tile.subtitle) : undefined,
        link: String(tile.link ?? "/products"),
      }));
    }
    const featuredSection = sections.find((section) => section.section_type === "featured");
    const config = (featuredSection?.config_json ?? {}) as Record<string, any>;
    const items = Array.isArray(config.items) ? config.items : [];
    const maxItems = Math.max(1, Number(config.maxItems ?? 6));
    const fromProducts = products
      .filter((item) => isHomeMarked(item))
      .slice(0, maxItems)
      .map((item) => ({
        id: item.id,
        image: getProductImage(item) ?? "",
        title: item.category || "Featured",
        subtitle: item.title,
        link: `/products/${item.slug}`,
      }))
      .filter((item) => item.image);

    const fromAnyProducts = products
      .slice(0, maxItems)
      .map((item) => ({
        id: `any-${item.id}`,
        image: getProductImage(item) ?? "",
        title: item.category || "Featured",
        subtitle: item.title,
        link: `/products/${item.slug}`,
      }))
      .filter((item) => item.image);

    if (fromProducts.length > 0) {
      if (fromProducts.length >= maxItems) return fromProducts;
      const remaining = maxItems - fromProducts.length;
      const fromCms = items.slice(0, remaining).map((item: any, idx: number) => ({
        id: `${featuredSection?.id ?? "featured"}-fallback-${idx}`,
        image: String(item.image ?? ""),
        title: String(item.label ?? item.title ?? "Featured"),
        subtitle: item.label && item.title ? String(item.title) : undefined,
        link: String(item.link ?? "/products"),
      }));
      return [...fromProducts, ...fromCms].filter((item) => item.image);
    }

    const fromCms = items.slice(0, 6).map((item: any, idx: number) => ({
      id: `${featuredSection?.id ?? "featured"}-${idx}`,
      image: String(item.image ?? ""),
      title: String(item.label ?? item.title ?? "Featured"),
      subtitle: item.label && item.title ? String(item.title) : undefined,
      link: String(item.link ?? "/products"),
    }));
    if (fromCms.length > 0) return fromCms;
    return fromAnyProducts;
  }, [mobileHomeQuery.data?.featuredTiles, sections, products]);

  const shopCategories: ShopCategoryItem[] = useMemo(() => {
    if (mobileHomeQuery.data?.categories?.length) return mobileHomeQuery.data.categories;
    const categorySection = sections.find((section) => section.section_type === "category");
    const config = (categorySection?.config_json ?? {}) as Record<string, any>;
    const items = Array.isArray(config.items) ? config.items : [];
    return items.map((item: any, idx: number) => ({
      id: `${categorySection?.id ?? "category"}-${idx}`,
      imageMobile: String(item.image ?? ""),
      title: String(item.title ?? "Category"),
      link: resolveCategoryLink(String(item.title ?? "Category"), item.link),
    }));
  }, [mobileHomeQuery.data?.categories, sections]);

  const mobileSpotlightProducts = useMemo(
    () => {
      if (mobileHomeQuery.data?.spotlightSections?.[0]?.products?.length) {
        return mobileHomeQuery.data.spotlightSections[0].products.map((product) => ({
          id: product.id,
          slug: product.slug,
          title: product.title,
          category: product.category,
          image: product.image,
          priceLabel: currency ? formatCurrencyAmount(product.price_inr, currency) : formatINR(product.price_inr),
        }));
      }
      return products.slice(0, 8).map((product) => ({
        id: product.id,
        slug: product.slug,
        title: product.title,
        category: product.category,
        image: getProductImage(product),
        priceLabel: currency
          ? formatCurrencyAmount((product.discount_price as number | null) ?? product.price_inr, currency)
          : formatINR((product.discount_price as number | null) ?? product.price_inr),
      }));
    },
    [mobileHomeQuery.data?.spotlightSections, products, currency]
  );
  const safeSpotlightProducts = useMemo(() => {
    if (mobileSpotlightProducts.length) return mobileSpotlightProducts;
    return featuredTiles.slice(0, 8).map((tile, index) => ({
      id: `fallback-spot-${tile.id}-${index}`,
      slug: "products",
      title: tile.subtitle || tile.title,
      category: tile.title,
      image: tile.image,
      priceLabel: "",
      href: tile.link || "/products",
    }));
  }, [mobileSpotlightProducts, featuredTiles]);

  const newArrivalsProducts = useMemo(() => {
    if (mobileHomeQuery.data?.newArrivals?.length) {
      return mobileHomeQuery.data.newArrivals.map((item) => ({
        id: String(item.id),
        slug: String(item.slug),
        title: String(item.title ?? "Product"),
        category: String(item.category ?? ""),
        image: item.image ?? null,
      }));
    }

    const marked = allVisibleProducts.filter((item) => Boolean(item.show_on_new_in));
    const source =
      marked.length > 0
        ? marked
        : [...allVisibleProducts].sort((a, b) => {
            const aTs = new Date(String(a.created_at ?? 0)).getTime();
            const bTs = new Date(String(b.created_at ?? 0)).getTime();
            return bTs - aTs;
          });

    return source.slice(0, 12).map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
      category: item.category,
      image: getProductImage(item),
    }));
  }, [mobileHomeQuery.data?.newArrivals, allVisibleProducts]);

  const mobileSpotlightBanner = useMemo(() => {
    const apiBanner = mobileHomeQuery.data?.spotlightSections?.[0]?.banner;
    if (apiBanner?.image) {
      return {
        image: apiBanner.image,
        alt: apiBanner.alt || "Spotlight Banner",
        link: apiBanner.link || "/products",
      };
    }
    if (homeSpotlightBannerConfig?.image) {
      return {
        image: homeSpotlightBannerConfig.image,
        alt: homeSpotlightBannerConfig.alt || "Spotlight Banner",
        link: homeSpotlightBannerConfig.link || "/products",
      };
    }
    return {
      image:
        "https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1600&q=80&fm=webp",
      alt: "USA Spotlight Banner",
      link: "/products",
    };
  }, [mobileHomeQuery.data?.spotlightSections, homeSpotlightBannerConfig]);

  const topNoticeMessage = mobileHomeQuery.data?.topNotice
    ? mobileHomeQuery.data.topNotice
    : homeTopNoticeConfig.message
    ? homeTopNoticeConfig.message
    : siteFestival
    ? `${siteFestival.festival_name} Live | ${siteFestival.urgency_text || siteFestival.discount_text || "Limited time offer"}`
    : "Free Delivery in 2-4 days. Easy Returns & Size Exchanges.";

  if (cmsQuery.isLoading && !cmsQuery.data) {
    return (
      <div className="space-y-4 p-4">
        <div className="h-[60vh] animate-pulse rounded-3xl bg-[#efefef]" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-44 animate-pulse rounded-2xl bg-[#efefef]" />
          <div className="h-44 animate-pulse rounded-2xl bg-[#efefef]" />
          <div className="h-44 animate-pulse rounded-2xl bg-[#efefef]" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`home-stack home-mobile-premium home-premium-motion space-y-12 bg-white pb-12 md:space-y-16 md:pb-16 lg:space-y-[72px] lg:pb-20 layout-${pageLayout}`}
      data-bg="light"
    >
      <div className="md:hidden">
        {!siteFestival ? <TopNotificationBar message={topNoticeMessage} ctaText={homeTopNoticeConfig.ctaText} ctaUrl={homeTopNoticeConfig.ctaUrl} /> : null}
        <HeroCarousel items={heroMobileItems.length ? heroMobileItems : [{ id: "fallback", imageMobile: fallbackHero.media, headline: fallbackHero.title, subText: fallbackHero.subtitle, ctaText: fallbackHero.buttonText, ctaUrl: fallbackHero.buttonUrl, priority: 0 }]} />
        <main id="home-main-content" className="space-y-4 pb-6 pt-3">
          <FeaturedCategoryTiles title={homeMobileLabels.featuredCategoriesTitle} tiles={featuredTiles} />
          <NewArrivalsSection title={homeMobileLabels.newArrivalsTitle} items={newArrivalsProducts} />
          <ShopByCategoryRow title={homeMobileLabels.shopByCategoryTitle} categories={shopCategories} />
          <SpotlightSection title={homeMobileLabels.spotlightTitle} products={safeSpotlightProducts} banner={mobileSpotlightBanner} />
        </main>
      </div>

      <div className="hidden md:block">
      {siteFestival ? (
        <div className="mx-auto mt-3 w-full max-w-[1320px] rounded-xl border border-black/10 bg-[#fafafa] px-5 py-3 text-xs uppercase tracking-[0.13em] text-[#111111] md:px-8">
          <div className="flex flex-wrap items-center justify-center gap-3 text-center">
            <span>{siteFestival.festival_name} Live</span>
            <span className="rounded-full border border-black/20 bg-white px-3 py-1">Ends in {countdownLabel(siteFestival.end_date)}</span>
            {nextFlashQuery.data ? (
              <span className="rounded-full border border-black/20 bg-white px-3 py-1">
                Next price drop {Number((nextFlashQuery.data as any).extra_discount_percent ?? 0)}% in {countdownLabel((nextFlashQuery.data as any).starts_at)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {sections
        .filter((section) => section.is_visible)
        .map((section) => {
          if (section.section_type === "hero") {
            const hero = getHeroData(section);
            const alignClass = hero.alignment === "center" ? "items-center text-center" : "items-start text-left";
            const isLightHero = hero.overlay <= 0.22;
            return (
              <section
                key={section.id}
                data-bg="dark"
                className={`hero-media-dark relative min-h-[78vh] overflow-hidden bg-[#111111] md:min-h-[86vh] ${isLightHero ? "hero-light" : ""}`}
              >
                <img
                  src={hero.media}
                  alt={hero.title}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="h-[78vh] w-full object-cover md:h-[86vh]"
                  style={{
                    objectPosition:
                      hero.imagePosition === "top"
                        ? "center top"
                        : hero.imagePosition === "bottom"
                        ? "center bottom"
                        : "center center",
                  }}
                  onError={(event) => {
                    (event.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
                <div
                  className="hero-overlay absolute inset-0"
                  style={
                    isLightHero
                      ? { background: "none" }
                      : {
                          background:
                            "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.30) 40%, rgba(0,0,0,0.10) 70%, transparent 100%)",
                        }
                  }
                />
                <div className="absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[1320px] px-5 pb-8 md:px-8 md:pb-12">
                  <div className={`hero-text-readable max-w-[70%] md:max-w-2xl ${alignClass}`}>
                    <p className="text-context-secondary text-xs uppercase tracking-[0.18em]">{hero.tag}</p>
                    <h1 className="mt-2 font-heading text-[clamp(18px,5vw,26px)] md:text-[clamp(2.5rem,8vw,5.6rem)] font-extrabold uppercase leading-[0.95]">{hero.title}</h1>
                    <p className="text-context-secondary mt-2 text-[clamp(12px,3.5vw,16px)] md:text-base">{hero.subtitle}</p>
                    <Link
                      to={hero.buttonUrl}
                      className={`premium-soft-btn mt-5 inline-flex rounded-md px-8 py-4 text-sm font-semibold transition ${
                        isLightHero
                          ? "btn-secondary-contrast hover:border-black"
                          : "bg-[linear-gradient(90deg,#d4af37,#f5d76e)] text-[#111111]"
                      }`}
                    >
                      {hero.buttonText}
                    </Link>
                  </div>
                </div>
              </section>
            );
          }

          if (section.section_type === "category") {
            const config = section.config_json as Record<string, any>;
            const items = Array.isArray(config.items) ? config.items : [];
            return (
              <RevealOnScroll key={section.id}>
                <section className="home-section home-category mx-auto w-full max-w-[1320px] px-5 md:px-8">
                  <h2 className="premium-section-title mb-8 font-heading text-3xl font-bold uppercase">{String(config.title ?? "Shop By Category")}</h2>
                  <div className="grid gap-5 md:grid-cols-3">
                    {items.map((item: any, idx: number) => (
                      <Link
                        key={`${item.title}-${idx}`}
                        to={resolveCategoryLink(String(item.title ?? "Category"), item.link)}
                        data-bg="dark"
                        className="premium-media-card group block"
                      >
                        <img src={String(item.image ?? "")} alt={String(item.title ?? "Category")} loading="lazy" className="h-[300px] w-full object-cover" />
                        <div className="absolute inset-0 bg-black/40" />
                        <p className="text-context-primary absolute bottom-4 left-4 max-w-[78%] line-clamp-2 text-[clamp(15px,3.2vw,22px)] font-bold">
                          {truncateText(String(item.title ?? "Category"), 42)}
                        </p>
                      </Link>
                    ))}
                  </div>
                </section>
              </RevealOnScroll>
            );
          }

          if (section.section_type === "featured") {
            const config = section.config_json as Record<string, any>;
            const items = Array.isArray(config.items) ? config.items : [];
            const maxItems = Math.max(1, Number(config.maxItems ?? 4));
            const fromProducts = products
              .filter((item) => isHomeMarked(item))
              .slice(0, maxItems)
              .map((item) => ({
                label: item.category,
                title: item.title,
                buttonText: "Shop",
                link: `/products/${item.slug}`,
                image: getProductImage(item) ?? "",
              }))
              .filter((item) => Boolean(item.image));

            const productItems =
              fromProducts.length > 0
                ? (() => {
                    if (fromProducts.length >= maxItems) return fromProducts;
                    const remaining = maxItems - fromProducts.length;
                    const fromCms = items.slice(0, remaining).map((item: any) => ({
                      label: item.label ?? "Featured",
                      title: item.title ?? "Featured",
                      buttonText: item.buttonText ?? "Shop",
                      link: item.link ?? "/products",
                      image: item.image ?? "",
                    }));
                    return [...fromProducts, ...fromCms].filter((item) => Boolean(item.image));
                  })()
                : items;
            return (
              <RevealOnScroll key={section.id}>
                <section className="home-section home-featured w-full">
                  <h2 className="premium-section-title mb-8 px-5 font-heading text-3xl font-bold uppercase md:px-8">
                    {String(config.title ?? "Featured")}
                  </h2>
                  <div className="featured-grid-premium grid gap-0 md:grid-cols-2">
                    {productItems.slice(0, 6).map((item: any, idx: number) => {
                      const motionClass =
                        idx === 0 || idx === 3 ? "featured-tile--front" : idx === 1 ? "featured-tile--rise" : "featured-tile--fall";
                      return (
                      <article
                        key={`${item.title}-${idx}`}
                        data-bg="dark"
                        className={`premium-media-card featured-sharp-tile featured-anim-on ${motionClass} group rounded-none`}
                      >
                        <img src={String(item.image ?? "")} alt={String(item.title ?? "Featured")} loading="lazy" className="h-[330px] w-full object-cover md:h-[380px]" />
                        <div className="absolute inset-0 bg-black/40" />
                        <div className="absolute bottom-4 left-4">
                          <p className="text-context-secondary max-w-[85%] line-clamp-1 text-[10px] uppercase tracking-[0.14em]">
                            {truncateText(String(item.label ?? "Featured"), 26)}
                          </p>
                          <h3 className="mt-1 max-w-[88%] line-clamp-2 text-[clamp(16px,3.5vw,30px)] font-bold">
                            {truncateText(String(item.title ?? "Block"), 44)}
                          </h3>
                          <Link
                            to={String(item.link ?? "/products")}
                            className="btn-secondary-contrast premium-soft-btn mt-3 inline-flex rounded-full px-4 py-2 text-sm font-semibold"
                          >
                            {String(item.buttonText ?? "Shop")}
                          </Link>
                        </div>
                      </article>
                    )})}
                  </div>
                </section>
              </RevealOnScroll>
            );
          }

          if (section.section_type === "product_grid") {
            return null;
          }

          const config = section.config_json as Record<string, any>;
          return (
            <RevealOnScroll key={section.id}>
              <section className="home-section home-custom mx-auto w-full max-w-[1320px] px-5 md:px-8">
                <div className="rounded-2xl border border-black/10 bg-[#fafafa] p-8">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#666666]">{String(config.label ?? "Custom Block")}</p>
                  <h2 className="mt-2 font-heading text-4xl uppercase text-[#111111]">{String(config.title ?? "Premium Story")}</h2>
                  <p className="mt-3 max-w-3xl text-sm text-[#555555]">{String(config.subtitle ?? config.description ?? "")}</p>
                  {config.buttonText ? (
                    <Link to={String(config.buttonUrl ?? "/products")} className="mt-5 inline-flex rounded-md bg-black px-5 py-3 text-sm font-semibold text-white">
                      {String(config.buttonText)}
                    </Link>
                  ) : null}
                </div>
              </section>
            </RevealOnScroll>
          );
        })}

      {newArrivalsProducts.length ? (
        <RevealOnScroll>
          <section className="home-section home-new-arrivals mx-auto w-full max-w-[1320px] px-5 md:px-8">
            <NewArrivalsSection title={homeMobileLabels.newArrivalsTitle} items={newArrivalsProducts} />
          </section>
        </RevealOnScroll>
      ) : null}

      {mobileSpotlightProducts.length ? (
        <RevealOnScroll>
          <section className="home-section home-spotlight mx-auto w-full max-w-[1320px] px-5 md:px-8">
            {mobileSpotlightBanner?.image ? (
              <Link
                to={mobileSpotlightBanner.link || "/products"}
                className="-mx-5 mb-6 block overflow-hidden rounded-none bg-[#efefef] shadow-[0_12px_26px_-20px_rgba(0,0,0,0.42)] md:-mx-8"
              >
                <img
                  src={mobileSpotlightBanner.image}
                  alt={mobileSpotlightBanner.alt || "Spotlight Banner"}
                  loading="lazy"
                  decoding="async"
                  className="h-[108px] w-full object-cover"
                />
              </Link>
            ) : null}
            <h2 className="premium-section-title mb-8 text-center font-heading text-3xl font-bold uppercase">{homeMobileLabels.spotlightTitle}</h2>
            <div className="grid grid-cols-4 gap-3">
              {mobileSpotlightProducts.slice(0, 8).map((product) => (
                <Link
                  key={`desktop-spot-${product.id}`}
                  to={`/products/${product.slug}`}
                  className="premium-mobile-spot rounded-none bg-white p-1 shadow-[0_10px_22px_-18px_rgba(0,0,0,0.34)]"
                  aria-label={product.title}
                >
                  <div className="overflow-hidden rounded-none bg-[#efefef]">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.title}
                        loading="lazy"
                        decoding="async"
                        className="h-[92px] w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-[92px] place-items-center text-xs text-[#777777]">No image</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </RevealOnScroll>
      ) : null}

      {(creatorsQuery.data?.spotlight?.length ?? 0) > 0 ? (
        <RevealOnScroll>
          <section className="home-section home-creators mx-auto w-full max-w-[1320px] px-5 md:px-8">
            <h2 className="premium-section-title mb-8 font-heading text-3xl font-bold uppercase">{homeMobileLabels.creatorsSpotlightTitle}</h2>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {creatorsQuery.data?.spotlight.slice(0, 6).map((item) => (
                <a
                  key={item.id}
                  href={item.video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-2xl border border-black/10 bg-white p-4 transition hover:-translate-y-0.5"
                >
                  <p className="text-xs uppercase tracking-[0.13em] text-[#666666]">{item.platform}</p>
                  <p className="mt-1 text-lg font-semibold text-[#111111]">{item.user_name}</p>
                  <p className="mt-2 text-sm text-[#444444]">Views: {Number(item.views_snapshot ?? 0).toLocaleString()}</p>
                  <p className="mt-3 text-sm font-medium underline underline-offset-2 text-[#111111]">Watch video</p>
                </a>
              ))}
            </div>
          </section>
        </RevealOnScroll>
      ) : null}
      </div>
    </div>
  );
};


