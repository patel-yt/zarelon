import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Filter, IndianRupee, Sparkles, Tag } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CategoryTiles } from "@/components/ui/CategoryTiles";
import { ProductCard } from "@/components/ui/ProductCard";
import { fetchActiveFestival } from "@/services/festivals";
import { fetchProducts } from "@/services/products";
import { fetchCategoriesByGender } from "@/services/categories";
import { fetchSiteSectionsByLocation } from "@/services/siteSections";
import type { Product, SiteSection } from "@/types/domain";

type Mode = "new-in" | "men" | "women" | "collections";
type LayoutTemplate =
  | "default"
  | "men-performance"
  | "women-editorial"
  | "collection-premium"
  | "collection-minimal"
  | "collection-story"
  | "home-mixed";

type CollectionSortBy = "newest" | "price_low_high" | "price_high_low";
type CollectionPriceFilter = "all" | "lt_5000" | "5000_10000" | "gt_10000";

const pageFallback: Record<Mode, { title: string; subtitle: string; description: string; media_url: string | null }> = {
  "new-in": {
    title: "New In",
    subtitle: "Latest arrivals",
    description: "Fresh drops curated for elevated daily luxury.",
    media_url: null,
  },
  men: {
    title: "Men",
    subtitle: "Performance essentials",
    description: "Bold silhouettes and modern sport-luxury edits.",
    media_url:
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1800&q=80",
  },
  women: {
    title: "Women",
    subtitle: "Editorial luxury",
    description: "Clean, elevated fashion stories with premium details.",
    media_url:
      "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=1800&q=80",
  },
  collections: {
    title: "Collections",
    subtitle: "Curated stories",
    description: "Seasonal capsules and premium collections in one place.",
    media_url:
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1800&q=80",
  },
};

const defaultTemplateByMode: Record<Mode, LayoutTemplate> = {
  "new-in": "default",
  men: "men-performance",
  women: "women-editorial",
  collections: "collection-premium",
};

const safeProducts = async () => {
  try {
    return await fetchProducts();
  } catch {
    return [];
  }
};

const safeFestival = async () => {
  try {
    return await fetchActiveFestival();
  } catch {
    return null;
  }
};

const safeSections = async (location: string) => {
  try {
    return await fetchSiteSectionsByLocation(location);
  } catch {
    return [];
  }
};

const safeCategoriesByGender = async (gender?: "men" | "women" | "unisex") => {
  try {
    return await fetchCategoriesByGender(gender);
  } catch {
    return [];
  }
};

const formatSlugLabel = (value: string) =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const truncateText = (value: string, maxLen: number) => {
  const text = String(value ?? "").trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
};

const parseCollectionSortBy = (value: string | null): CollectionSortBy => {
  if (value === "price_low_high" || value === "price_high_low" || value === "newest") return value;
  return "newest";
};

const parseCollectionPriceFilter = (value: string | null): CollectionPriceFilter => {
  if (value === "lt_5000" || value === "5000_10000" || value === "gt_10000" || value === "all") return value;
  return "all";
};

const renderFeaturedLayout = (
  template: LayoutTemplate,
  featuredProducts: Product[],
  festivalDiscount: number
) => {
  if (!featuredProducts.length) return null;

  if (template === "men-performance") {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {featuredProducts.slice(0, 3).map((item) => (
          <ProductCard key={item.id} product={item} festivalDiscount={festivalDiscount} />
        ))}
      </div>
    );
  }

  if (template === "women-editorial") {
    return (
      <div className="grid gap-4 md:grid-cols-12">
        <div className="md:col-span-7">
          <ProductCard product={featuredProducts[0]} festivalDiscount={festivalDiscount} />
        </div>
        <div className="grid gap-4 md:col-span-5">
          {featuredProducts.slice(1, 3).map((item) => (
            <ProductCard key={item.id} product={item} festivalDiscount={festivalDiscount} />
          ))}
        </div>
      </div>
    );
  }

  if (template === "collection-premium") {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-black/10 bg-[#111111] p-6 text-white">
          <p className="text-xs uppercase tracking-[0.18em] text-white/80">Curated Capsule</p>
          <p className="mt-2 font-heading text-4xl uppercase">Premium Edit</p>
          <p className="mt-2 text-sm text-white/80">Handpicked products from this active collection.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {featuredProducts.slice(0, 4).map((item) => (
            <ProductCard key={item.id} product={item} festivalDiscount={festivalDiscount} />
          ))}
        </div>
      </div>
    );
  }

  if (template === "collection-minimal") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {featuredProducts.slice(0, 4).map((item) => (
          <ProductCard key={item.id} product={item} festivalDiscount={festivalDiscount} />
        ))}
      </div>
    );
  }

  if (template === "collection-story") {
    return (
      <div className="space-y-4">
        <div className="rounded-3xl border border-black/10 bg-[#111111] p-6 text-white">
          <p className="text-xs uppercase tracking-[0.2em] text-white/80">Collection Story</p>
          <p className="mt-1 font-heading text-4xl uppercase">From Concept to Craft</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {featuredProducts.slice(0, 4).map((item) => (
            <ProductCard key={item.id} product={item} festivalDiscount={festivalDiscount} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-12">
      <div className="md:col-span-8">
        <ProductCard product={featuredProducts[0]} festivalDiscount={festivalDiscount} />
      </div>
      <div className="grid gap-4 md:col-span-4">
        {featuredProducts.slice(1, 3).map((item) => (
          <ProductCard key={item.id} product={item} festivalDiscount={festivalDiscount} />
        ))}
      </div>
      {featuredProducts[3] ? (
        <div className="md:col-span-12">
          <ProductCard product={featuredProducts[3]} festivalDiscount={festivalDiscount} />
        </div>
      ) : null}
    </div>
  );
};

export const CatalogLandingPage = ({
  mode,
  selectedSlug,
}: {
  mode: Mode;
  selectedSlug?: string;
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionsQuery = useQuery({
    queryKey: ["catalog-sections", mode, selectedSlug ?? ""],
    queryFn: async () => {
      const base = await safeSections(mode);
      if (!selectedSlug) return base;
      const scopedLocation = await safeSections(`${mode}:${selectedSlug}`);
      return [...scopedLocation, ...base];
    },
    staleTime: 5 * 60 * 1000,
  });
  const productsQuery = useQuery({ queryKey: ["catalog-products"], queryFn: safeProducts, staleTime: 60_000 });
  const festivalQuery = useQuery({ queryKey: ["festival-active"], queryFn: safeFestival, staleTime: 60_000 });
  const categoriesQuery = useQuery({
    queryKey: ["catalog-categories", mode],
    queryFn: () =>
      mode === "men"
        ? safeCategoriesByGender("men")
        : mode === "women"
        ? safeCategoriesByGender("women")
        : safeCategoriesByGender(),
    staleTime: 5 * 60 * 1000,
  });

  const sections = useMemo(
    () => [...(sectionsQuery.data ?? [])].sort((a, b) => a.display_order - b.display_order),
    [sectionsQuery.data]
  );

  const hero = useMemo<SiteSection | null>(() => {
    if (mode === "collections" && selectedSlug) {
      const slugHero = sections.find((item) => item.section_key === `collections:${selectedSlug}`);
      if (slugHero) return slugHero;
      const genericHero = sections.find((item) => item.section_key === "collections_default");
      if (genericHero) return genericHero;
    }
    return sections.find((item) => item.section_key === "page_hero") ?? null;
  }, [mode, selectedSlug, sections]);

  const allProducts = productsQuery.data ?? [];
  const collectionSortBy = parseCollectionSortBy(searchParams.get("sort"));
  const collectionPriceFilter = parseCollectionPriceFilter(searchParams.get("price"));
  const collectionOnlyNew = searchParams.get("new") === "1";
  const collectionCategoryParam = searchParams.get("category");

  const filteredProducts = useMemo(() => {
    return allProducts.filter((product) => {
      if (mode === "new-in") return product.show_on_new_in;
      if (mode === "men") {
        const genderMatch = product.gender === "men" || product.gender === "unisex";
        const categoryMatch = selectedSlug ? product.category_slug === selectedSlug : true;
        return genderMatch && categoryMatch;
      }
      if (mode === "women") {
        const genderMatch = product.gender === "women" || product.gender === "unisex";
        const categoryMatch = selectedSlug ? product.category_slug === selectedSlug : true;
        return genderMatch && categoryMatch;
      }
      const activeCollectionFilter =
        selectedSlug || (collectionCategoryParam && collectionCategoryParam !== "all" ? collectionCategoryParam : null);
      const collectionMatch = activeCollectionFilter
        ? product.collection_slug === activeCollectionFilter || product.category_slug === activeCollectionFilter
        : true;
      if (!collectionMatch) return false;

      const effectivePrice = (product.discount_price as number | null) ?? product.price_inr;
      const priceMatch =
        collectionPriceFilter === "all"
          ? true
          : collectionPriceFilter === "lt_5000"
          ? effectivePrice < 500000
          : collectionPriceFilter === "5000_10000"
          ? effectivePrice >= 500000 && effectivePrice <= 1000000
          : effectivePrice > 1000000;
      if (!priceMatch) return false;

      if (collectionOnlyNew) {
        const createdAt = new Date(product.created_at).getTime();
        const withinThirtyDays = Number.isFinite(createdAt) && Date.now() - createdAt <= 30 * 24 * 60 * 60 * 1000;
        if (!product.show_on_new_in && !withinThirtyDays) return false;
      }
      return true;
    });
  }, [allProducts, mode, selectedSlug, collectionCategoryParam, collectionPriceFilter, collectionOnlyNew]);

  const sortedProducts = useMemo(() => {
    if (mode !== "collections") return filteredProducts;
    const list = [...filteredProducts];
    if (collectionSortBy === "price_low_high") {
      list.sort(
        (a, b) =>
          Number((a.discount_price as number | null) ?? a.price_inr) -
          Number((b.discount_price as number | null) ?? b.price_inr)
      );
      return list;
    }
    if (collectionSortBy === "price_high_low") {
      list.sort(
        (a, b) =>
          Number((b.discount_price as number | null) ?? b.price_inr) -
          Number((a.discount_price as number | null) ?? a.price_inr)
      );
      return list;
    }
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  }, [mode, filteredProducts, collectionSortBy]);

  const requestedPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const perPage = mode === "men" ? 20 : sortedProducts.length || 1;
  const totalPages = Math.max(1, Math.ceil(sortedProducts.length / perPage));
  const currentPage = Math.min(requestedPage, totalPages);
  const paginatedProducts =
    mode === "men"
      ? sortedProducts.slice((currentPage - 1) * perPage, currentPage * perPage)
      : sortedProducts;

  useEffect(() => {
    if (mode !== "men") {
      if (!searchParams.get("page")) return;
      const next = new URLSearchParams(searchParams);
      next.delete("page");
      setSearchParams(next, { replace: true });
      return;
    }
    if (requestedPage === currentPage) return;
    const next = new URLSearchParams(searchParams);
    if (currentPage > 1) next.set("page", String(currentPage));
    else next.delete("page");
    setSearchParams(next, { replace: true });
  }, [mode, requestedPage, currentPage, searchParams, setSearchParams]);

  const goToPage = (nextPage: number) => {
    const page = Math.max(1, Math.min(totalPages, nextPage));
    const next = new URLSearchParams(searchParams);
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const featuredProducts = filteredProducts.slice(0, 4);
  const featuredEditorialSection = useMemo(() => {
    const keys = selectedSlug
      ? [`featured_editorial_${selectedSlug}`, `featured_editorial:${selectedSlug}`, "featured_editorial"]
      : ["featured_editorial"];
    return sections.find((section) => keys.includes(section.section_key)) ?? null;
  }, [sections, selectedSlug]);
  const featuredEditorialProducts = useMemo(() => {
    const config = ((featuredEditorialSection as unknown as { config_json?: Record<string, unknown> } | null)?.config_json ?? {}) as Record<string, unknown>;
    const rawIds = Array.isArray(config.product_ids) ? config.product_ids : [];
    const rawSlugs = Array.isArray(config.product_slugs) ? config.product_slugs : [];
    const byId = new Map(allProducts.map((item) => [item.id, item]));
    const bySlug = new Map(allProducts.map((item) => [String(item.slug).toLowerCase(), item]));
    const picked: Product[] = [];

    for (const id of rawIds.map((item) => String(item).trim()).filter(Boolean)) {
      const p = byId.get(id);
      if (p) picked.push(p);
    }
    for (const slug of rawSlugs.map((item) => String(item).trim().toLowerCase()).filter(Boolean)) {
      const p = bySlug.get(slug);
      if (p) picked.push(p);
    }

    const uniqueById = Array.from(new Map(picked.map((item) => [item.id, item])).values());
    if (uniqueById.length) return uniqueById.slice(0, 2);
    return featuredProducts.slice(0, 2);
  }, [featuredEditorialSection?.id, allProducts, featuredProducts]);
  const fallback = pageFallback[mode];
  const pageTitle = hero?.title || fallback.title;
  const pageSubtitle = hero?.subtitle || fallback.subtitle;
  const pageDescription = hero?.description || fallback.description;
  const pageMedia = hero?.media_url || fallback.media_url;
  const layoutTemplate =
    (hero?.layout_template as LayoutTemplate | null) ??
    (sections.find((item) => Boolean(item.layout_template))?.layout_template as LayoutTemplate | null) ??
    defaultTemplateByMode[mode];

  const categoryLinks = useMemo(() => {
    if (mode === "collections") {
      const keys = Array.from(
        new Set(allProducts.map((item) => item.collection_slug).filter((value): value is string => Boolean(value)))
      );
      return keys.map((slug) => ({ slug, label: slug.replace(/-/g, " ") }));
    }

    return (categoriesQuery.data ?? []).map((item) => ({
      slug: item.slug,
      label: item.name,
      image_url: item.image_url ?? null,
      display_image_url: item.display_image_url ?? item.image_url ?? null,
    }));
  }, [mode, categoriesQuery.data, allProducts]);

  const categoryTileItems = useMemo(() => {
    if (mode !== "men" && mode !== "women") return [];
    return categoryLinks
      .filter((item) => "display_image_url" in item)
      .map((item) => ({
        slug: item.slug,
        name: item.label,
        displayImageUrl: (item as { display_image_url?: string | null }).display_image_url ?? null,
      }));
  }, [mode, categoryLinks]);

  const basePath = mode === "collections" ? "/collections" : mode === "new-in" ? "/new-in" : `/${mode}`;
  const modeAccentClass =
    mode === "men"
      ? "font-extrabold tracking-[0.12em]"
      : mode === "women"
      ? "font-medium tracking-[0.08em]"
      : "font-semibold tracking-[0.1em]";
  const modeLabel = mode === "new-in" ? "New In" : formatSlugLabel(mode);
  const selectedLabel = selectedSlug
    ? categoryLinks.find((item) => item.slug === selectedSlug)?.label ?? formatSlugLabel(selectedSlug)
    : null;
  const activityTiles =
    mode === "women"
      ? [
          { title: "Studio", slug: "apparel", image: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1400&q=80" },
          { title: "Evening", slug: "watches", image: "https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=1400&q=80" },
          { title: "Travel", slug: "shoes", image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=1400&q=80" },
        ]
      : [
          { title: "Training", slug: "shoes", image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1400&q=80" },
          { title: "City", slug: "apparel", image: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1400&q=80" },
          { title: "Weekend", slug: "watches", image: "https://images.unsplash.com/photo-1434056886845-dac89ffe9b56?auto=format&fit=crop&w=1400&q=80" },
        ];
  const editorialLead = featuredProducts[0] ?? filteredProducts[0] ?? null;
  const exploreLinks = [
    { label: "New In", href: "/new-in" },
    { label: "Collections", href: "/collections" },
    { label: "All Products", href: "/products" },
  ];
  const updateCollectionFilter = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
    });
    params.delete("page");
    setSearchParams(params);
  };

  return (
    <div className="catalog-stack space-y-10 bg-white pb-12 md:space-y-16" data-bg="light">
      <nav
        aria-label="Breadcrumb"
        className="rounded-none border border-black/10 bg-white px-4 py-3 text-sm"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 rounded-full border border-black/15 bg-white px-3 py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-black/75 transition hover:border-[#C8A951] hover:text-black"
          >
            <ArrowLeft size={14} />
            Back
          </button>

          <ol className="flex flex-wrap items-center gap-2 text-black/60">
            <li>
              <Link to="/" className="rounded-full border border-black/10 bg-white px-3 py-1 hover:text-black">
                Home
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link to={basePath} className="rounded-full border border-black/10 bg-white px-3 py-1 hover:text-black">
                {modeLabel}
              </Link>
            </li>
            {selectedSlug ? (
              <>
                <li>/</li>
                <li className="rounded-full border border-black/20 bg-white px-3 py-1 font-medium text-black">
                  {selectedLabel}
                </li>
              </>
            ) : null}
          </ol>
        </div>
      </nav>

      <section
        className="hero-sharp-banner lux-hero hero-media-dark hero-fallback-bg premium-media-card relative overflow-hidden rounded-none border border-black/10"
        data-bg="dark"
      >
        {pageMedia ? (
          hero?.media_type === "video" ? (
            <video src={pageMedia} className="h-[85vh] w-full object-cover" autoPlay muted loop playsInline />
          ) : (
            <img
              src={pageMedia}
              alt={pageTitle}
              className="h-[85vh] w-full object-cover"
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )
        ) : (
          <div className="h-[85vh] w-full bg-[#111111]" />
        )}
        <div className={`hero-text-readable absolute inset-x-0 bottom-0 ${mode === "women" ? "p-8 md:p-12" : "p-6 md:p-8"}`}>
          <p className={`text-context-secondary text-xs uppercase ${modeAccentClass}`}>{pageSubtitle}</p>
          <h1 className="font-heading text-[clamp(2.6rem,10vw,6rem)] font-extrabold uppercase">{pageTitle}</h1>
          <p className="text-context-secondary max-w-2xl text-sm md:text-base">{pageDescription}</p>
          <Link
            to={hero?.button_link || basePath}
            className="lux-button premium-soft-btn mt-3 inline-flex px-5 py-2 text-sm font-medium"
          >
            {hero?.button_text || "Shop Now"}
          </Link>
        </div>
      </section>

      {(mode === "men" || mode === "women") ? (
        <>
          <section className="lux-section">
            <h3 className="premium-section-title mb-8 font-heading text-2xl uppercase text-[#111111]">Categories</h3>
            <div className="flex flex-wrap gap-3">
              <Link to={basePath} className="px-4 py-2 text-sm font-medium uppercase tracking-[0.14em] text-[#111111] hover:text-[#555555]">
                All
              </Link>
              {categoryLinks.map((item) => (
                <Link
                  key={item.slug}
                  to={`${basePath}/${item.slug}`}
                  className="px-4 py-2 text-sm font-medium uppercase tracking-[0.14em] text-[#111111] hover:text-[#555555]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </section>

          {(mode === "men" || mode === "women") && categoryTileItems.length ? (
            <CategoryTiles
              title={mode === "men" ? "Shop By Activity" : "Shop By Occasion"}
              basePath={basePath}
              items={activityTiles.map((item) => ({
                slug: item.slug,
                name: item.title,
                displayImageUrl: item.image,
              }))}
            />
          ) : null}

          <section className="lux-section">
            <h3 className="premium-section-title mb-8 font-heading text-2xl uppercase text-[#111111]">Featured Editorial</h3>
            {mode === "men" ? (
              <div className="space-y-8">
                {featuredEditorialProducts[0] ? (
                  <div className="grid grid-cols-[1.1fr_0.9fr] gap-0">
                    <div className="premium-media-card rounded-none">
                      <img
                        src={featuredEditorialProducts[0].image_url ?? "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1600&q=80"}
                        alt={featuredEditorialProducts[0].title}
                        loading="lazy"
                        decoding="async"
                        className="h-[260px] w-full object-cover md:h-[340px]"
                      />
                    </div>
                    <div className="flex h-full flex-col justify-center rounded-none bg-[#fafafa] p-6">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{modeLabel} Featured</p>
                      <h4 className="mt-3 font-heading text-[clamp(2rem,4vw,3rem)] uppercase">{featuredEditorialProducts[0].title}</h4>
                      <p className="mt-2 text-sm uppercase tracking-[0.12em] text-[#555555]">{featuredEditorialProducts[0].category}</p>
                      <p className="mt-4 max-w-xl text-sm text-[#555555]">
                        {truncateText(
                          featuredEditorialProducts[0].description ??
                            "Premium crafted essentials designed for movement, confidence, and everyday luxury.",
                          170
                        )}
                      </p>
                      <Link
                        to={`/products/${featuredEditorialProducts[0].slug}`}
                        className="mt-6 inline-flex w-fit rounded-full border border-black/20 px-5 py-2 text-sm font-semibold text-[#111111] transition hover:border-black"
                      >
                        Explore
                      </Link>
                    </div>
                  </div>
                ) : null}

                {featuredEditorialProducts[1] ? (
                  <div className="grid grid-cols-[0.9fr_1.1fr] gap-0">
                    <div className="flex h-full flex-col justify-center rounded-none bg-[#fafafa] p-6">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{modeLabel} Featured</p>
                      <h4 className="mt-3 font-heading text-[clamp(2rem,4vw,3rem)] uppercase">{featuredEditorialProducts[1].title}</h4>
                      <p className="mt-2 text-sm uppercase tracking-[0.12em] text-[#555555]">{featuredEditorialProducts[1].category}</p>
                      <p className="mt-4 max-w-xl text-sm text-[#555555]">
                        {truncateText(
                          featuredEditorialProducts[1].description ??
                            "Signature design story with elevated silhouette and premium detailing for daily wear.",
                          170
                        )}
                      </p>
                      <Link
                        to={`/products/${featuredEditorialProducts[1].slug}`}
                        className="mt-6 inline-flex w-fit rounded-full border border-black/20 px-5 py-2 text-sm font-semibold text-[#111111] transition hover:border-black"
                      >
                        Explore
                      </Link>
                    </div>
                    <div className="premium-media-card rounded-none">
                      <img
                        src={featuredEditorialProducts[1].image_url ?? "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1600&q=80"}
                        alt={featuredEditorialProducts[1].title}
                        loading="lazy"
                        decoding="async"
                        className="h-[260px] w-full object-cover md:h-[340px]"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : editorialLead ? (
              <div className={`grid gap-8 ${mode === "women" ? "grid-cols-[0.95fr_1.05fr]" : "grid-cols-[1.05fr_0.95fr]"}`}>
                <div className="premium-media-card">
                  <img
                    src={editorialLead.image_url ?? "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1600&q=80"}
                    alt={editorialLead.title}
                    loading="lazy"
                    decoding="async"
                    className="h-[260px] w-full object-cover md:h-[340px]"
                  />
                </div>
                <div className="flex flex-col justify-center">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{modeLabel} Editorial</p>
                  <h4 className="mt-3 font-heading text-[clamp(2rem,4vw,3rem)] uppercase">{editorialLead.title}</h4>
                  <p className="mt-4 max-w-xl text-sm text-[#555555]">
                    Refined proportions, elevated materials, and a clean silhouette designed for modern movement.
                  </p>
                  <Link to={`/products/${editorialLead.slug}`} className="lux-underline mt-6 w-fit text-sm uppercase tracking-[0.14em] text-[#111111]">
                    Discover
                  </Link>
                </div>
              </div>
            ) : null}
          </section>

          <section className="lux-section py-6 md:py-14">
            <div className="mb-6 flex items-end justify-between">
              <h3 className="premium-section-title font-heading text-2xl uppercase text-[#111111]">Best Sellers</h3>
              {selectedSlug ? <p className="text-xs uppercase tracking-wider text-black/60">Filter: {selectedSlug}</p> : null}
            </div>
            {filteredProducts.length ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-10 xl:grid-cols-3">
                {paginatedProducts.map((product) => (
                  <ProductCard key={product.id} product={product} festivalDiscount={festivalQuery.data?.festival_discount ?? 0} />
                ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <p className="font-heading text-3xl uppercase text-[#111111]">Coming Soon • Stay tuned</p>
              </div>
            )}
            {mode === "men" && filteredProducts.length > perPage ? (
              <div className="mt-8 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/20 text-[#111111] disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="px-2 text-sm text-[#555555]">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/20 text-[#111111] disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            ) : null}
          </section>

          {mode !== "men" ? (
            <section className="lux-section">
              <h3 className="premium-section-title mb-8 font-heading text-2xl uppercase text-[#111111]">Explore More</h3>
              <div className="grid gap-6 md:grid-cols-3">
                {exploreLinks.map((item) => (
                  <Link key={item.href} to={item.href} className="lux-underline py-6 text-lg font-semibold text-[#111111]">
                    {item.label}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <>
          {mode === "collections" && featuredEditorialProducts.length ? (
            <section className="lux-section">
              <h3 className="premium-section-title mb-8 font-heading text-2xl uppercase text-[#111111]">Featured Editorial</h3>
              <div className="space-y-8">
                {featuredEditorialProducts[0] ? (
                  <div className="grid grid-cols-[1.1fr_0.9fr] gap-0">
                    <div className="premium-media-card rounded-none">
                      <img
                        src={featuredEditorialProducts[0].image_url ?? "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1600&q=80"}
                        alt={featuredEditorialProducts[0].title}
                        loading="lazy"
                        decoding="async"
                        className="h-[260px] w-full object-cover md:h-[340px]"
                      />
                    </div>
                    <div className="flex h-full flex-col justify-center rounded-none bg-[#fafafa] p-6">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{modeLabel} Featured</p>
                      <h4 className="mt-3 font-heading text-[clamp(2rem,4vw,3rem)] uppercase">{featuredEditorialProducts[0].title}</h4>
                      <p className="mt-2 text-sm uppercase tracking-[0.12em] text-[#555555]">{featuredEditorialProducts[0].category}</p>
                      <p className="mt-4 max-w-xl text-sm text-[#555555]">
                        {truncateText(
                          featuredEditorialProducts[0].description ??
                            "Premium crafted essentials designed for movement, confidence, and everyday luxury.",
                          170
                        )}
                      </p>
                      <Link
                        to={`/products/${featuredEditorialProducts[0].slug}`}
                        className="mt-6 inline-flex w-fit rounded-full border border-black/20 px-5 py-2 text-sm font-semibold text-[#111111] transition hover:border-black"
                      >
                        Explore
                      </Link>
                    </div>
                  </div>
                ) : null}

                {featuredEditorialProducts[1] ? (
                  <div className="grid grid-cols-[0.9fr_1.1fr] gap-0">
                    <div className="flex h-full flex-col justify-center rounded-none bg-[#fafafa] p-6">
                      <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{modeLabel} Featured</p>
                      <h4 className="mt-3 font-heading text-[clamp(2rem,4vw,3rem)] uppercase">{featuredEditorialProducts[1].title}</h4>
                      <p className="mt-2 text-sm uppercase tracking-[0.12em] text-[#555555]">{featuredEditorialProducts[1].category}</p>
                      <p className="mt-4 max-w-xl text-sm text-[#555555]">
                        {truncateText(
                          featuredEditorialProducts[1].description ??
                            "Signature design story with elevated silhouette and premium detailing for daily wear.",
                          170
                        )}
                      </p>
                      <Link
                        to={`/products/${featuredEditorialProducts[1].slug}`}
                        className="mt-6 inline-flex w-fit rounded-full border border-black/20 px-5 py-2 text-sm font-semibold text-[#111111] transition hover:border-black"
                      >
                        Explore
                      </Link>
                    </div>
                    <div className="premium-media-card rounded-none">
                      <img
                        src={featuredEditorialProducts[1].image_url ?? "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1600&q=80"}
                        alt={featuredEditorialProducts[1].title}
                        loading="lazy"
                        decoding="async"
                        className="h-[260px] w-full object-cover md:h-[340px]"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {featuredProducts.length ? (
            <section className="lux-section">
              <div className="mb-3 flex items-end justify-between">
                <h2 className="premium-section-title font-heading text-2xl uppercase text-[#111111]">
                  {mode === "collections" ? "Curated Picks" : "Featured Grid"}
                </h2>
              </div>
              {renderFeaturedLayout(layoutTemplate, featuredProducts, festivalQuery.data?.festival_discount ?? 0)}
            </section>
          ) : null}

          <section className="lux-section">
            <h3 className="premium-section-title mb-8 font-heading text-xl uppercase text-[#111111]">
              {mode === "collections" ? "Collection Filters" : "Category Filters"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <Link to={basePath} className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm capitalize hover:border-[#C8A951]">
                All
              </Link>
              {categoryLinks.map((item) => (
                <Link
                  key={item.slug}
                  to={`${basePath}/${item.slug}`}
                  className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm capitalize hover:border-[#C8A951]"
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {mode === "collections" ? (
              <div className="mt-6 grid gap-3 md:grid-cols-4">
                <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,247,247,0.92))] px-3 py-2">
                  <Tag size={16} className="text-[#111111]" />
                  <select
                    value={collectionCategoryParam ?? "all"}
                    onChange={(event) => updateCollectionFilter({ category: event.target.value })}
                    className="w-full bg-transparent text-sm text-[#111111] outline-none"
                  >
                    <option value="all">All Categories</option>
                    {categoryLinks.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,247,247,0.92))] px-3 py-2">
                  <IndianRupee size={16} className="text-[#111111]" />
                  <select
                    value={collectionPriceFilter}
                    onChange={(event) => updateCollectionFilter({ price: event.target.value })}
                    className="w-full bg-transparent text-sm text-[#111111] outline-none"
                  >
                    <option value="all">All Prices</option>
                    <option value="lt_5000">Under 5000</option>
                    <option value="5000_10000">5000 - 10000</option>
                    <option value="gt_10000">Above 10000</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => updateCollectionFilter({ new: collectionOnlyNew ? null : "1" })}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    collectionOnlyNew
                      ? "border-[#C8A951] bg-[linear-gradient(90deg,#f2dfad,#f8ebc8)] text-[#111111]"
                      : "border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,247,247,0.92))] text-[#111111]"
                  }`}
                >
                  <Sparkles size={16} />
                  New Arrivals
                </button>

                <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,247,247,0.92))] px-3 py-2">
                  <Filter size={16} className="text-[#111111]" />
                  <select
                    value={collectionSortBy}
                    onChange={(event) => updateCollectionFilter({ sort: event.target.value })}
                    className="w-full bg-transparent text-sm text-[#111111] outline-none"
                  >
                    <option value="newest">Newest</option>
                    <option value="price_low_high">Price: Low to High</option>
                    <option value="price_high_low">Price: High to Low</option>
                  </select>
                </div>
              </div>
            ) : null}
          </section>

          <section className="lux-section py-6 md:py-14">
            <div className="mb-3 flex items-end justify-between">
              <h3 className="premium-section-title font-heading text-2xl uppercase text-[#111111]">Best Sellers</h3>
              {selectedSlug ? <p className="text-xs uppercase tracking-wider text-black/60">Filter: {selectedSlug}</p> : null}
            </div>
            {filteredProducts.length ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-10 xl:grid-cols-3">
                {paginatedProducts.map((product) => (
                  <ProductCard key={product.id} product={product} festivalDiscount={festivalQuery.data?.festival_discount ?? 0} />
                ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <p className="font-heading text-3xl uppercase text-[#111111]">Coming Soon • Stay tuned</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
