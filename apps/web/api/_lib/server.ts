import { createClient } from "@supabase/supabase-js";
import type { ApiRequest, ApiResponse } from "./http";

const clean = (value: string | undefined): string => (value ?? "").trim();

export const serverEnv = {
  supabaseUrl: clean(process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL),
  serviceRoleKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  razorpayKeyId: clean(process.env.RAZORPAY_KEY_ID),
  razorpayKeySecret: clean(process.env.RAZORPAY_KEY_SECRET),
  razorpayWebhookSecret: clean(process.env.RAZORPAY_WEBHOOK_SECRET),
  resendApiKey: clean(process.env.RESEND_API_KEY),
  flatShippingInr: Number(process.env.VITE_FLAT_SHIPPING_INR ?? 9900),
  shippingWebhookSecret: clean(process.env.SHIPPING_WEBHOOK_SECRET),
  shiprocketEmail: clean(process.env.SHIPROCKET_EMAIL),
  shiprocketPassword: clean(process.env.SHIPROCKET_PASSWORD),
  groqApiKey: clean(process.env.GROQ_API_KEY),
  geminiApiKey: clean(process.env.GEMINI_API_KEY),
};

const safeServerSupabaseUrl = serverEnv.supabaseUrl || "https://placeholder.supabase.co";
const safeServerSupabaseServiceKey = serverEnv.serviceRoleKey || "service-role-key-placeholder";

export const hasServerSupabaseConfig = Boolean(serverEnv.supabaseUrl && serverEnv.serviceRoleKey);

export const getServerConfigError = (): string | null => {
  if (!serverEnv.supabaseUrl) return "Server config missing: SUPABASE_URL (or VITE_SUPABASE_URL)";
  if (!serverEnv.serviceRoleKey) return "Server config missing: SUPABASE_SERVICE_ROLE_KEY";
  return null;
};

export const adminClient = createClient(safeServerSupabaseUrl, safeServerSupabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const sendError = (res: ApiResponse, code: number, error: string) => {
  res.status(code).json({ error });
};

export const getBearerToken = (req: ApiRequest): string | null => {
  const auth = req.headers.authorization;
  const value = Array.isArray(auth) ? auth[0] : auth;
  if (!value || !value.startsWith("Bearer ")) return null;
  return value.slice(7);
};

export const requireUser = async (req: ApiRequest) => {
  if (!hasServerSupabaseConfig) return null;
  const token = getBearerToken(req);
  if (!token) return null;

  const { data, error } = await adminClient.auth.getUser(token);
  if (error) return null;
  return data.user;
};

export const requireAdmin = async (req: ApiRequest): Promise<{ id: string } | null> => {
  const user = await requireUser(req);
  if (!user) return null;

  const { data } = await adminClient
    .from("users")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!data || (data.role !== "admin" && data.role !== "super_admin")) return null;
  return { id: user.id };
};

export const requirePermission = async (
  req: ApiRequest,
  permission:
    | "can_manage_products"
    | "can_manage_orders"
    | "can_manage_users"
    | "can_refund"
    | "can_manage_festival"
    | "can_view_analytics"
): Promise<{ id: string; role: string } | null> => {
  const user = await requireUser(req);
  if (!user) return null;

  const { data: profile } = await adminClient.from("users").select("id, role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "admin" && profile.role !== "super_admin")) return null;
  if (profile.role === "super_admin") return { id: profile.id, role: profile.role };

  const { data: perms, error: permsError } = await adminClient
    .from("admin_permissions")
    .select(
      "can_manage_products,can_manage_orders,can_manage_users,can_refund,can_manage_festival,can_view_analytics"
    )
    .eq("admin_id", user.id)
    .maybeSingle();

  if (permsError) return null;

  if (!perms) {
    const bootstrapPermissions = {
      admin_id: user.id,
      can_manage_products: true,
      can_manage_orders: true,
      can_manage_users: true,
      can_refund: true,
      can_manage_festival: true,
      can_view_analytics: true,
    };
    const bootstrap = await adminClient.from("admin_permissions").upsert(bootstrapPermissions, { onConflict: "admin_id" });
    if (bootstrap.error) return null;
    return { id: profile.id, role: profile.role };
  }

  if (!(perms as Record<string, boolean>)[permission]) return null;
  return { id: profile.id, role: profile.role };
};

export const computeCartTotals = async (cartId: string) => {
  if (!hasServerSupabaseConfig) throw new Error(getServerConfigError() ?? "Server config missing");
  let data: any[] | null = null;
  let error: any = null;
  let hasRequiresShippingColumn = true;
  let hasRequiresCodColumn = true;
  const primary = await adminClient
    .from("cart_items")
    .select(
      "quantity, variant_id, product:products(id,title,price_inr,discount_price,stock,requires_shipping,requires_cod), variant:product_variants(id,product_id,color,size,stock,active)"
    )
    .eq("cart_id", cartId);
  data = primary.data as any[] | null;
  error = primary.error;

  if (error) {
    const fallback = await adminClient
      .from("cart_items")
      .select("quantity, product:products(id,title,price_inr,discount_price,stock)")
      .eq("cart_id", cartId);
    data = fallback.data as any[] | null;
    error = fallback.error;
    hasRequiresShippingColumn = false;
    hasRequiresCodColumn = false;
  }

  if (error) throw error;

  const items = (data ?? []).map((item) => ({
    ...item,
    product: Array.isArray(item.product) ? item.product[0] : item.product,
    variant: Array.isArray(item.variant) ? item.variant[0] : item.variant,
  }));
  if (!items.length) throw new Error("Cart is empty");
  if (items.some((item) => !item.product)) throw new Error("Some products are unavailable");
  if (
    items.some((item) => {
      const stockSource = item.variant_id ? item.variant?.stock : item.product?.stock;
      if (item.variant_id && (!item.variant || item.variant.active === false)) return true;
      return item.quantity > (stockSource ?? 0);
    })
  ) {
    throw new Error("Insufficient stock for one or more items");
  }

  const now = new Date().toISOString();
  let festivalDiscount = 0;
  const siteFestivalRes = await adminClient
    .from("site_festivals")
    .select("discount_percent,is_active,start_date,end_date")
    .eq("is_active", true)
    .lte("start_date", now)
    .gte("end_date", now)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!siteFestivalRes.error && siteFestivalRes.data) {
    festivalDiscount = siteFestivalRes.data.discount_percent ?? 0;
  } else {
    const legacyFestivalRes = await adminClient
      .from("festivals")
      .select("festival_discount")
      .eq("active", true)
      .lte("start_date", now)
      .gte("end_date", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    festivalDiscount = legacyFestivalRes.data?.festival_discount ?? 0;
  }
  const subtotal = items.reduce((sum, item) => {
    const basePrice = item.product?.discount_price ?? item.product?.price_inr ?? 0;
    const discounted = Math.round(basePrice * (1 - festivalDiscount / 100));
    return sum + item.quantity * discounted;
  }, 0);
  const needsShipping = hasRequiresShippingColumn
    ? items.some((item) => item.product?.requires_shipping !== false)
    : true;
  const { data: settings } = await adminClient
    .from("platform_settings")
    .select("shipping_flat_inr")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const shippingBase = settings?.shipping_flat_inr ?? serverEnv.flatShippingInr;
  const shipping = needsShipping ? shippingBase : 0;
  const codAllowed = hasRequiresCodColumn
    ? items.every((item) => item.product?.requires_cod !== false)
    : true;

  return {
    items,
    subtotal,
    shipping,
    total: subtotal + shipping,
    festivalDiscount,
    codAllowed,
  };
};

export const isPaymentGatewayEnabled = async (): Promise<boolean> => {
  const { data } = await adminClient
    .from("platform_settings")
    .select("payment_gateway_enabled")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.payment_gateway_enabled ?? true;
};

