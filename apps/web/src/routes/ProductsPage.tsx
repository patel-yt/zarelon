import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { ProductCard } from "@/components/ui/ProductCard";
import { useAuth } from "@/features/auth/AuthContext";
import { slugify } from "@/lib/utils";
import { fetchActiveFestival } from "@/services/festivals";
import { trackSearchTerm } from "@/services/personalization";
import { fetchProductCategories, fetchProductsBySlugs, fetchProductsPage } from "@/services/products";
import type { FetchProductsPageResult } from "@/services/products";
import { fetchSiteSectionsByLocation } from "@/services/siteSections";
import type { SiteSection } from "@/types/domain";

const alignClass: Record<string, string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

const renderMedia = (section: SiteSection, className: string) => {
  if (!section.media_url) return <div className={`grid place-items-center bg-black/20 ${className}`}>No media</div>;
  if (section.media_type === "video") {
    return <video src={section.media_url} className={className} autoPlay muted loop playsInline />;
  }
  return <img src={section.media_url} alt={section.title ?? section.section_key} loading="lazy" className={className} />;
};

type ProductSortBy = "newest" | "price_low_high" | "price_high_low";
type ProductGender = "all" | "men" | "women" | "unisex";

const parseSortBy = (value: string | null): ProductSortBy => {
  if (value === "price_low_high" || value === "price_high_low" || value === "newest") return value;
  return "newest";
};

const parseGender = (value: string | null): ProductGender => {
  if (value === "men" || value === "women" || value === "unisex" || value === "all") return value;
  return "all";
};

const toTitleCase = (value: string) =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const ProductsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { categorySlug: routeCategorySlug } = useParams();
  const [params, setParams] = useSearchParams();
  const [filterOpen, setFilterOpen] = useState(false);

  const requestedPage = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const searchTerm = (params.get("q") ?? "").trim();
  const sortBy = parseSortBy(params.get("sort"));
  const genderFilter = parseGender(params.get("gender"));
  const inStockOnly = params.get("in_stock") === "1";

  const legacyCategory = (params.get("category") ?? "").trim();
  const selectedCategorySlug = (routeCategorySlug ?? "").trim().toLowerCase();

  const [draftCategory, setDraftCategory] = useState(selectedCategorySlug || "all");
  const [draftSortBy, setDraftSortBy] = useState<ProductSortBy>(sortBy);
  const [draftGender, setDraftGender] = useState<ProductGender>(genderFilter);
  const [draftInStockOnly, setDraftInStockOnly] = useState(inStockOnly);

  const festivalQuery = useQuery({ queryKey: ["festival-active"], queryFn: fetchActiveFestival });
  const categoriesQuery = useQuery({
    queryKey: ["product-categories"],
    queryFn: fetchProductCategories,
    staleTime: 5 * 60 * 1000,
  });
  const sectionsQuery = useQuery({
    queryKey: ["site-sections-products"],
    queryFn: () => fetchSiteSectionsByLocation("products"),
    retry: 1,
  });

  const pageSize = 12;
  const productsQuery = useQuery<FetchProductsPageResult>({
    queryKey: [
      "products-paginated",
      {
        page: requestedPage,
        pageSize,
        query: searchTerm,
        categorySlug: selectedCategorySlug || null,
        sortBy,
        genderFilter,
        inStockOnly,
      },
    ],
    queryFn: () =>
      fetchProductsPage({
        page: requestedPage,
        pageSize,
        query: searchTerm,
        categorySlug: selectedCategorySlug || null,
        sortBy,
        gender: genderFilter,
        inStockOnly,
      }),
  });

  const sections = useMemo(
    () => [...(sectionsQuery.data ?? [])].sort((a, b) => a.display_order - b.display_order),
    [sectionsQuery.data]
  );
  const sectionHero = sections.find((item) => item.section_key === "category_hero");
  const hero = useMemo(() => {
    if (sectionHero) return sectionHero;
    if (selectedCategorySlug === "watches") {
      return {
        id: "watches-fallback-hero",
        section_key: "category_hero",
        page_location: "products",
        layout_template: null,
        title: "WATCHES",
        subtitle: "Precision Timepieces",
        description: "Curated premium watches crafted for everyday luxury.",
        media_type: "image",
        media_url:
          "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1800&q=80",
        button_text: "Explore Watches",
        button_link: "/products/c/watches",
        text_color: "#F8F5F2",
        text_alignment: "left",
        overlay_opacity: 0.35,
        display_order: 0,
        is_active: true,
        created_at: "",
        updated_at: "",
      } as SiteSection;
    }
    return null;
  }, [sectionHero, selectedCategorySlug]);

  useEffect(() => {
    if (!legacyCategory || selectedCategorySlug) return;
    const legacySlug = slugify(legacyCategory);
    const next = new URLSearchParams(params);
    next.delete("category");
    navigate(`/products/c/${legacySlug}${next.toString() ? `?${next.toString()}` : ""}`, { replace: true });
  }, [legacyCategory, selectedCategorySlug, params, navigate]);

  useEffect(() => {
    if (!productsQuery.data) return;
    if (productsQuery.data.currentPage === requestedPage) return;
    const next = new URLSearchParams(params);
    if (productsQuery.data.currentPage > 1) {
      next.set("page", String(productsQuery.data.currentPage));
    } else {
      next.delete("page");
    }
    setParams(next, { replace: true });
  }, [productsQuery.data, requestedPage, params, setParams]);

  useEffect(() => {
    if (!searchTerm || searchTerm.length < 2) return;
    const timer = setTimeout(() => {
      void trackSearchTerm({ userId: user?.id, query: searchTerm.toLowerCase() });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchTerm, user?.id]);

  useEffect(() => {
    if (!filterOpen) return;
    setDraftCategory(selectedCategorySlug || "all");
    setDraftSortBy(sortBy);
    setDraftGender(genderFilter);
    setDraftInStockOnly(inStockOnly);
  }, [filterOpen, selectedCategorySlug, sortBy, genderFilter, inStockOnly]);

  const categoryOptions = useMemo(() => {
    const rows = categoriesQuery.data ?? [];
    return [{ label: "All", slug: "all" }, ...rows];
  }, [categoriesQuery.data]);

  const categoryLabel = useMemo(() => {
    if (!selectedCategorySlug) return "All Products";
    const matched = (categoriesQuery.data ?? []).find((item) => item.slug === selectedCategorySlug);
    return matched?.label ?? toTitleCase(selectedCategorySlug);
  }, [selectedCategorySlug, categoriesQuery.data]);

  const totalCount = productsQuery.data?.totalCount ?? 0;
  const totalPages = productsQuery.data?.totalPages ?? 1;
  const currentPage = productsQuery.data?.currentPage ?? requestedPage;
  const items = productsQuery.data?.items ?? [];

  const start = totalCount ? (currentPage - 1) * pageSize + 1 : 0;
  const end = totalCount ? Math.min(currentPage * pageSize, totalCount) : 0;
  const itemCountLabel = totalCount ? `Items ${start}-${end} of ${totalCount}` : "Items 0 of 0";

  const isShoesCategory = selectedCategorySlug === "shoes";
  const hasAnyFilter = Boolean(selectedCategorySlug || searchTerm || sortBy !== "newest" || genderFilter !== "all" || inStockOnly);
  const activeFilterCount =
    (selectedCategorySlug ? 1 : 0) + (genderFilter !== "all" ? 1 : 0) + (inStockOnly ? 1 : 0) + (sortBy !== "newest" ? 1 : 0);

  const setQueryParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const goToPage = (nextPage: number) => {
    const safePage = Math.max(1, Math.min(totalPages, nextPage));
    setQueryParams({ page: safePage > 1 ? String(safePage) : null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const applyFilters = () => {
    const next = new URLSearchParams(params);
    next.delete("page");

    if (draftSortBy === "newest") next.delete("sort");
    else next.set("sort", draftSortBy);

    if (draftGender === "all") next.delete("gender");
    else next.set("gender", draftGender);

    if (draftInStockOnly) next.set("in_stock", "1");
    else next.delete("in_stock");

    const targetPath = draftCategory !== "all" ? `/products/c/${draftCategory}` : "/products";
    navigate(`${targetPath}${next.toString() ? `?${next.toString()}` : ""}`);
    setFilterOpen(false);
  };

  const resetFilters = () => {
    setDraftCategory("all");
    setDraftSortBy("newest");
    setDraftGender("all");
    setDraftInStockOnly(false);
  };

  const clearAllFilters = () => {
    navigate("/products");
  };

  const featuredEditorialItems = items.slice(0, 2);
  const featuredSection = useMemo(() => {
    const keys = selectedCategorySlug
      ? [`featured_editorial_${selectedCategorySlug}`, `featured_editorial:${selectedCategorySlug}`, "featured_editorial"]
      : ["featured_editorial"];
    return sections.find((section) => keys.includes(section.section_key)) ?? null;
  }, [sections, selectedCategorySlug]);
  const configuredFeaturedSlugs = useMemo(() => {
    const config = ((featuredSection as unknown as { config_json?: Record<string, unknown> } | null)?.config_json ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(config.product_slugs) ? config.product_slugs : [];
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }, [featuredSection?.id]);
  const configuredFeaturedQuery = useQuery({
    queryKey: ["products-featured-editorial", selectedCategorySlug ?? "all", configuredFeaturedSlugs.join("|")],
    queryFn: () => fetchProductsBySlugs(configuredFeaturedSlugs),
    enabled: configuredFeaturedSlugs.length > 0,
    staleTime: 60_000,
  });
  const editorialItems = configuredFeaturedQuery.data?.length ? configuredFeaturedQuery.data.slice(0, 2) : featuredEditorialItems;

  return (
    <div>
      <div className="space-y-6">
      {hero ? (
        <section className="relative overflow-hidden rounded-none border border-white/10 bg-[#14121A]" data-bg="dark">
          {renderMedia(hero, "h-[240px] w-full object-cover md:h-[320px]")}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: `rgba(0,0,0,${Math.max(0.45, Math.min(1, hero.overlay_opacity ?? 0.3))})` }}
          />
          <div className={`absolute inset-0 flex flex-col justify-end gap-2 p-6 md:p-8 ${alignClass[hero.text_alignment] ?? alignClass.left}`}>
            {hero.subtitle ? (
              <p className="force-text-light text-xs uppercase tracking-[0.28em] [text-shadow:0_2px_10px_rgba(0,0,0,0.55)]" style={{ color: hero.text_color ?? "#F8F5F2" }}>
                {hero.subtitle}
              </p>
            ) : null}
            {hero.title ? (
              <h1 className="force-text-light font-heading text-[clamp(1.7rem,5vw,3rem)] [text-shadow:0_4px_14px_rgba(0,0,0,0.58)]" style={{ color: hero.text_color ?? "#F8F5F2" }}>
                {hero.title}
              </h1>
            ) : null}
            {hero.description ? (
              <p className="force-text-light max-w-xl text-sm [text-shadow:0_2px_10px_rgba(0,0,0,0.5)] md:text-base" style={{ color: hero.text_color ?? "#F8F5F2" }}>
                {hero.description}
              </p>
            ) : null}
            {hero.button_text ? (
              <div className="pt-1">
                <Link
                  to={hero.button_link || "/products"}
                  className="inline-flex rounded-full border border-[#8E6CFF]/60 bg-[#8E6CFF] px-5 py-2 text-sm text-[#F8F5F2] transition hover:bg-[#D4AF37] hover:text-[#0B0A0F]"
                >
                  {hero.button_text}
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {selectedCategorySlug ? (
        <section className="rounded-none border border-black/10 bg-gradient-to-r from-[#f7f7f7] to-[#ffffff] px-5 py-5">
          <p className="text-xs uppercase tracking-[0.22em] text-[#666666]">Category</p>
          <h1 className="mt-1 font-heading text-3xl tracking-[0.01em] text-[#111111]">{categoryLabel}</h1>
          <p className="mt-1 text-sm text-[#555555]">Precision-crafted picks curated for everyday premium wear.</p>
        </section>
      ) : null}

      {selectedCategorySlug && editorialItems.length ? (
        <section className="space-y-6">
          <h3 className="font-heading text-2xl uppercase text-[#111111]">Featured Editorial</h3>
          {editorialItems[0] ? (
            <div className="grid grid-cols-[1.1fr_0.9fr] gap-0">
              <div className="overflow-hidden rounded-none bg-[#efefef]">
                {editorialItems[0].image_url ? (
                  <img
                    src={editorialItems[0].image_url}
                    alt={editorialItems[0].title}
                    loading="lazy"
                    decoding="async"
                    className="h-[260px] w-full object-cover md:h-[340px]"
                  />
                ) : (
                  <div className="grid h-[260px] place-items-center text-sm text-[#666666] md:h-[340px]">No image</div>
                )}
              </div>
              <div className="flex h-full flex-col justify-center rounded-none bg-[#fafafa] p-6">
                <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{categoryLabel} Featured</p>
                <h4 className="mt-3 font-heading text-[clamp(2rem,4vw,3rem)] uppercase">{editorialItems[0].title}</h4>
                <p className="mt-2 text-sm uppercase tracking-[0.12em] text-[#555555]">{editorialItems[0].category}</p>
                <p className="mt-4 max-w-xl text-sm text-[#555555]">
                  {editorialItems[0].description ??
                    "Premium curation with elevated design language and signature category detailing."}
                </p>
                <Link
                  to={`/products/${editorialItems[0].slug}`}
                  className="mt-6 inline-flex w-fit rounded-full border border-black/20 px-5 py-2 text-sm font-semibold text-[#111111] transition hover:border-black"
                >
                  Explore
                </Link>
              </div>
            </div>
          ) : null}
          {editorialItems[1] ? (
            <div className="grid grid-cols-[0.9fr_1.1fr] gap-0">
              <div className="flex h-full flex-col justify-center rounded-none bg-[#fafafa] p-6">
                <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">{categoryLabel} Featured</p>
                <h4 className="mt-3 font-heading text-[clamp(2rem,4vw,3rem)] uppercase">{editorialItems[1].title}</h4>
                <p className="mt-2 text-sm uppercase tracking-[0.12em] text-[#555555]">{editorialItems[1].category}</p>
                <p className="mt-4 max-w-xl text-sm text-[#555555]">
                  {editorialItems[1].description ??
                    "Signature visual storytelling with clean composition and strong premium category identity."}
                </p>
                <Link
                  to={`/products/${editorialItems[1].slug}`}
                  className="mt-6 inline-flex w-fit rounded-full border border-black/20 px-5 py-2 text-sm font-semibold text-[#111111] transition hover:border-black"
                >
                  Explore
                </Link>
              </div>
              <div className="overflow-hidden rounded-none bg-[#efefef]">
                {editorialItems[1].image_url ? (
                  <img
                    src={editorialItems[1].image_url}
                    alt={editorialItems[1].title}
                    loading="lazy"
                    decoding="async"
                    className="h-[260px] w-full object-cover md:h-[340px]"
                  />
                ) : (
                  <div className="grid h-[260px] place-items-center text-sm text-[#666666] md:h-[340px]">No image</div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
        <input
          value={searchTerm}
          onChange={(event) => setQueryParams({ q: event.target.value || null, page: null })}
          placeholder="Search products"
          className="min-w-56 flex-1 rounded-lg border-white/20 bg-black/20 text-sm"
        />
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-[#111]"
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal size={16} />
          Sort and filter
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-semibold text-white">{activeFilterCount}</span>
          ) : null}
        </button>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#555]">{itemCountLabel}</p>
      </div>

      {productsQuery.isError ? (
        <p className="text-sm text-rose-300">
          Could not load products: {(productsQuery.error as Error)?.message ?? "Unknown error"}
        </p>
      ) : null}

      {productsQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {Array.from({ length: pageSize }).map((_, idx) => (
            <div key={idx} className="animate-pulse space-y-2">
              <div className="aspect-[3/4] w-full rounded-none bg-[#ececec]" />
              <div className="h-4 w-4/5 rounded bg-[#ececec]" />
              <div className="h-3 w-2/5 rounded bg-[#ececec]" />
              <div className="h-4 w-1/3 rounded bg-[#ececec]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} festivalDiscount={festivalQuery.data?.festival_discount ?? 0} />
          ))}
          {!items.length ? (
            <div className="md:col-span-2 xl:col-span-4">
              <div className="premium-surface-strong mx-auto max-w-2xl rounded-3xl border border-black/10 bg-gradient-to-b from-[#ffffff] to-[#f6f6f6] px-6 py-12 text-center">
                <p className="text-xs uppercase tracking-[0.22em] text-[#666666]">No products found</p>
                <h3 className="mt-3 text-3xl font-bold tracking-[0.06em] text-[#111111] md:text-4xl">
                  {isShoesCategory ? "Shoes Coming Soon" : "Try Different Filters"}
                </h3>
                <p className="mx-auto mt-3 max-w-xl text-sm text-[#555555] md:text-base">
                  {isShoesCategory
                    ? "A powerful new footwear drop is about to land. Stay ready for signature comfort and limited premium pairs."
                    : "No match for current filter combination. Reset filters and explore more collections."}
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  {hasAnyFilter ? (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="rounded-full border border-black/20 bg-white px-6 py-2.5 text-sm font-semibold text-[#111111]"
                    >
                      Reset Filters
                    </button>
                  ) : null}
                  <Link
                    to="/collections"
                    className="btn-primary-contrast rounded-full px-6 py-2.5 text-sm font-semibold transition hover:-translate-y-0.5"
                  >
                    Explore Collections
                  </Link>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {!productsQuery.isLoading && totalCount > pageSize ? (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
            className="rounded-full border border-black/20 bg-white px-4 py-2 text-sm font-medium text-[#111] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-2 text-sm font-medium text-[#444]">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
            className="rounded-full border border-black/20 bg-white px-4 py-2 text-sm font-medium text-[#111] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}

      {filterOpen ? (
        <div className="fixed inset-0 z-[90] bg-black/40">
          <div className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-white shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-4 py-3">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#111]">Sort and Filter</p>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/15"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-6 p-4">
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#555]">Sort</p>
                <select
                  value={draftSortBy}
                  onChange={(event) => setDraftSortBy(event.target.value as ProductSortBy)}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
                >
                  <option value="newest">Newest</option>
                  <option value="price_low_high">Price: Low to High</option>
                  <option value="price_high_low">Price: High to Low</option>
                </select>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#555]">Category</p>
                <select
                  value={draftCategory}
                  onChange={(event) => setDraftCategory(event.target.value)}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
                >
                  {categoryOptions.map((value) => (
                    <option key={value.slug} value={value.slug}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#555]">Gender</p>
                <select
                  value={draftGender}
                  onChange={(event) => setDraftGender(event.target.value as ProductGender)}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                  <option value="unisex">Unisex</option>
                </select>
              </section>

              <section className="space-y-2">
                <label className="inline-flex items-center gap-2 text-sm text-[#111]">
                  <input
                    type="checkbox"
                    checked={draftInStockOnly}
                    onChange={(event) => setDraftInStockOnly(event.target.checked)}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  In stock only
                </label>
              </section>
            </div>

            <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-black/10 bg-white p-4">
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-lg border border-black/20 px-4 py-2 text-sm font-semibold text-[#111]"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={applyFilters}
                className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
};
