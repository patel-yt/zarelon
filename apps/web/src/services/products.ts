import { supabase } from "@/lib/supabase";
import { publicSupabase } from "@/lib/publicSupabase";
import { slugify } from "@/lib/utils";
import type { Banner, Product, ProductImage, ProductVariant } from "@/types/domain";

type ProductWithMedia = Product & { product_images: ProductImage[]; product_variants: ProductVariant[] };
type ProductSortBy = "newest" | "price_low_high" | "price_high_low";

export interface FetchProductsPageParams {
  page: number;
  pageSize: number;
  query?: string;
  categorySlug?: string | null;
  sortBy?: ProductSortBy;
  gender?: "all" | "men" | "women" | "unisex";
  inStockOnly?: boolean;
}

export interface FetchProductsPageResult {
  items: ProductWithMedia[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

interface ProductCategoryOption {
  label: string;
  slug: string;
}

const vipRank: Record<string, number> = { normal: 0, vip: 1, elite: 2 };

export const fetchActiveBanner = async (): Promise<Banner | null> => {
  const primary = await publicSupabase.from("banners").select("*").eq("active", true).maybeSingle();
  if (!primary.error) return primary.data;

  const fallback = await supabase.from("banners").select("*").eq("active", true).maybeSingle();
  if (fallback.error) throw fallback.error;
  return fallback.data;
};

export const fetchProducts = async (): Promise<ProductWithMedia[]> => {
  const primary = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  let baseProducts: Product[] = [];
  if (!primary.error) {
    baseProducts = (primary.data ?? []) as Product[];
  } else {
    const fallback = await publicSupabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (fallback.error) throw fallback.error;
    baseProducts = (fallback.data ?? []) as Product[];
  }

  // product_images can be blocked by stricter policies; keep products visible even then.
  const productIds = baseProducts.map((p) => p.id);
  if (!productIds.length) return [];

  const imageRes = await publicSupabase
    .from("product_images")
    .select("*")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });

  let images: ProductImage[] = [];
  if (!imageRes.error) {
    images = (imageRes.data ?? []) as ProductImage[];
  } else {
    const imageFallback = await supabase
      .from("product_images")
      .select("*")
      .in("product_id", productIds)
      .order("sort_order", { ascending: true });
    if (!imageFallback.error) {
      images = (imageFallback.data ?? []) as ProductImage[];
    }
  }

  const imagesByProduct = new Map<string, ProductImage[]>();
  for (const image of images) {
    const current = imagesByProduct.get(image.product_id) ?? [];
    current.push(image);
    imagesByProduct.set(image.product_id, current);
  }

  const variantRes = await publicSupabase
    .from("product_variants")
    .select("*")
    .in("product_id", productIds)
    .eq("active", true)
    .order("created_at", { ascending: true });

  let variants: ProductVariant[] = [];
  if (!variantRes.error) {
    variants = (variantRes.data ?? []) as ProductVariant[];
  } else {
    const variantFallback = await supabase
      .from("product_variants")
      .select("*")
      .in("product_id", productIds)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (!variantFallback.error) {
      variants = (variantFallback.data ?? []) as ProductVariant[];
    }
  }

  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const variant of variants) {
    const current = variantsByProduct.get(variant.product_id) ?? [];
    current.push(variant);
    variantsByProduct.set(variant.product_id, current);
  }

  return baseProducts.map((product) => ({
    ...product,
    product_images: imagesByProduct.get(product.id) ?? [],
    product_variants: variantsByProduct.get(product.id) ?? [],
  }));
};

const attachMediaToProducts = async (baseProducts: Product[]): Promise<ProductWithMedia[]> => {
  const productIds = baseProducts.map((p) => p.id);
  if (!productIds.length) return [];

  const imageRes = await publicSupabase
    .from("product_images")
    .select("*")
    .in("product_id", productIds)
    .order("sort_order", { ascending: true });

  let images: ProductImage[] = [];
  if (!imageRes.error) {
    images = (imageRes.data ?? []) as ProductImage[];
  } else {
    const imageFallback = await supabase
      .from("product_images")
      .select("*")
      .in("product_id", productIds)
      .order("sort_order", { ascending: true });
    if (!imageFallback.error) {
      images = (imageFallback.data ?? []) as ProductImage[];
    }
  }

  const imagesByProduct = new Map<string, ProductImage[]>();
  for (const image of images) {
    const current = imagesByProduct.get(image.product_id) ?? [];
    current.push(image);
    imagesByProduct.set(image.product_id, current);
  }

  const variantRes = await publicSupabase
    .from("product_variants")
    .select("*")
    .in("product_id", productIds)
    .eq("active", true)
    .order("created_at", { ascending: true });

  let variants: ProductVariant[] = [];
  if (!variantRes.error) {
    variants = (variantRes.data ?? []) as ProductVariant[];
  } else {
    const variantFallback = await supabase
      .from("product_variants")
      .select("*")
      .in("product_id", productIds)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (!variantFallback.error) {
      variants = (variantFallback.data ?? []) as ProductVariant[];
    }
  }

  const variantsByProduct = new Map<string, ProductVariant[]>();
  for (const variant of variants) {
    const current = variantsByProduct.get(variant.product_id) ?? [];
    current.push(variant);
    variantsByProduct.set(variant.product_id, current);
  }

  return baseProducts.map((product) => ({
    ...product,
    product_images: imagesByProduct.get(product.id) ?? [],
    product_variants: variantsByProduct.get(product.id) ?? [],
  }));
};

export const fetchProductCategories = async (): Promise<ProductCategoryOption[]> => {
  const primary = await publicSupabase.from("products").select("category, category_slug").eq("active", true);
  let rows: Array<Pick<Product, "category" | "category_slug">> = [];

  if (!primary.error) {
    rows = (primary.data ?? []) as Array<Pick<Product, "category" | "category_slug">>;
  } else {
    const fallback = await supabase.from("products").select("category, category_slug").eq("active", true);
    if (fallback.error) throw fallback.error;
    rows = (fallback.data ?? []) as Array<Pick<Product, "category" | "category_slug">>;
  }

  const seen = new Set<string>();
  const output: ProductCategoryOption[] = [];
  for (const row of rows) {
    const label = String(row.category ?? "").trim();
    if (!label) continue;
    const slug = String(row.category_slug ?? "").trim() || slugify(label);
    if (seen.has(slug)) continue;
    seen.add(slug);
    output.push({ label, slug });
  }

  output.sort((a, b) => a.label.localeCompare(b.label));
  return output;
};

export const fetchProductsPage = async (params: FetchProductsPageParams): Promise<FetchProductsPageResult> => {
  const pageSize = Math.max(1, Math.min(60, Number(params.pageSize) || 12));
  const requestedPage = Math.max(1, Number(params.page) || 1);
  const from = (requestedPage - 1) * pageSize;
  const to = from + pageSize - 1;
  const queryText = String(params.query ?? "").trim();
  const categorySlug = String(params.categorySlug ?? "").trim().toLowerCase();
  const sortBy = params.sortBy ?? "newest";
  const gender = params.gender ?? "all";
  const inStockOnly = Boolean(params.inStockOnly);

  const buildProductsQuery = (client: typeof supabase) => {
    let q = client.from("products").select("*", { count: "exact" }).eq("active", true);

    if (categorySlug) {
      q = q.eq("category_slug", categorySlug);
    }
    if (queryText) {
      const escaped = queryText.replace(/[%_]/g, "");
      q = q.or(`title.ilike.%${escaped}%,category.ilike.%${escaped}%,slug.ilike.%${escaped}%`);
    }
    if (gender !== "all") {
      q = q.eq("gender", gender);
    }
    if (inStockOnly) {
      q = q.gt("stock", 0);
    }

    if (sortBy === "newest") {
      q = q.order("created_at", { ascending: false });
    } else if (sortBy === "price_low_high") {
      q = q.order("discount_price", { ascending: true, nullsFirst: false });
      q = q.order("price_inr", { ascending: true, nullsFirst: false });
    } else {
      q = q.order("discount_price", { ascending: false, nullsFirst: false });
      q = q.order("price_inr", { ascending: false, nullsFirst: false });
    }

    return q.range(from, to);
  };

  const primary = await buildProductsQuery(publicSupabase);
  let rows: Product[] = [];
  let totalCount = 0;

  if (!primary.error) {
    rows = (primary.data ?? []) as Product[];
    totalCount = Number(primary.count ?? 0);
  } else {
    const fallback = await buildProductsQuery(supabase);
    if (fallback.error) throw fallback.error;
    rows = (fallback.data ?? []) as Product[];
    totalCount = Number(fallback.count ?? 0);
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);

  const items = await attachMediaToProducts(rows);
  return {
    items,
    totalCount,
    totalPages,
    currentPage,
    pageSize,
  };
};

export const fetchProductsBySlugs = async (slugs: string[]): Promise<ProductWithMedia[]> => {
  const normalized = Array.from(new Set(slugs.map((item) => String(item).trim().toLowerCase()).filter(Boolean)));
  if (!normalized.length) return [];

  const primary = await publicSupabase.from("products").select("*").in("slug", normalized).eq("active", true);
  let rows: Product[] = [];

  if (!primary.error) {
    rows = (primary.data ?? []) as Product[];
  } else {
    const fallback = await supabase.from("products").select("*").in("slug", normalized).eq("active", true);
    if (fallback.error) throw fallback.error;
    rows = (fallback.data ?? []) as Product[];
  }

  const withMedia = await attachMediaToProducts(rows);
  const bySlug = new Map(withMedia.map((item) => [String(item.slug).toLowerCase(), item]));
  return normalized.map((slug) => bySlug.get(slug)).filter((item): item is ProductWithMedia => Boolean(item));
};

export const fetchAdminProducts = async (): Promise<ProductWithMedia[]> => {
  const primary = await supabase
    .from("products")
    .select("*, product_images(*), product_variants(*)")
    .order("created_at", { ascending: false });
  if (!primary.error) return (primary.data ?? []) as ProductWithMedia[];

  const fallback = await supabase
    .from("products")
    .select("*, product_images(*)")
    .order("created_at", { ascending: false });
  if (fallback.error) throw fallback.error;
  return ((fallback.data ?? []) as Array<Product & { product_images: ProductImage[] }>).map((item) => ({
    ...item,
    product_variants: [],
  }));
};

export const fetchProductBySlug = async (
  slug: string
): Promise<ProductWithMedia | null> => {
  const primary = await supabase
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  let product: Product | null = null;
  if (!primary.error) {
    product = (primary.data as Product | null) ?? null;
  } else {
    const fallback = await publicSupabase
      .from("products")
      .select("*")
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    product = (fallback.data as Product | null) ?? null;
  }

  if (!product) return null;

  const imageRes = await publicSupabase
    .from("product_images")
    .select("*")
    .eq("product_id", product.id)
    .order("sort_order", { ascending: true });

  let images: ProductImage[] = [];
  if (!imageRes.error) {
    images = (imageRes.data ?? []) as ProductImage[];
  } else {
    const imageFallback = await supabase
      .from("product_images")
      .select("*")
      .eq("product_id", product.id)
      .order("sort_order", { ascending: true });
    if (!imageFallback.error) {
      images = (imageFallback.data ?? []) as ProductImage[];
    }
  }

  const variantRes = await publicSupabase
    .from("product_variants")
    .select("*")
    .eq("product_id", product.id)
    .eq("active", true)
    .order("created_at", { ascending: true });

  let variants: ProductVariant[] = [];
  if (!variantRes.error) {
    variants = (variantRes.data ?? []) as ProductVariant[];
  } else {
    const variantFallback = await supabase
      .from("product_variants")
      .select("*")
      .eq("product_id", product.id)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (!variantFallback.error) {
      variants = (variantFallback.data ?? []) as ProductVariant[];
    }
  }

  return { ...product, product_images: images, product_variants: variants };
};

export const filterProductsByVipLevel = <T extends { required_vip_level?: string }>(
  products: T[],
  vipLevel: "normal" | "vip" | "elite" = "normal"
): T[] => {
  const rank = vipRank[vipLevel] ?? 0;
  return products.filter((item) => {
    const required = String((item as any).required_vip_level ?? "normal");
    return rank >= (vipRank[required] ?? 0);
  });
};
