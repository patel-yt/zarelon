import { createRazorpayOrderSchema, refundSchema, verifyPaymentSchema } from "@/lib/schemas";
import { appEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { slugify } from "@/lib/utils";

const parse = async <T>(response: Response): Promise<T> => {
  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const statusMessage =
      response.status === 404
        ? "API route not found (404). Start backend API or set VITE_API_BASE_URL."
        : `Request failed (${response.status})`;
    throw new Error(payload.error ?? statusMessage);
  }
  return payload as T;
};

const resolveApiInput = (input: RequestInfo | URL): RequestInfo | URL => {
  if (typeof input !== "string") return input;
  if (import.meta.env.DEV) return input;
  const base = appEnv.apiBaseUrl?.trim().replace(/\/$/, "");
  if (!base) return input;
  if (!input.startsWith("/api")) return input;
  if (typeof window !== "undefined") {
    // In browser, prefer same-origin API to avoid CORS/protection issues
    // when VITE_API_BASE_URL points at a different Vercel deployment.
    try {
      const baseUrl = new URL(base);
      const currentOrigin = window.location.origin;
      if (baseUrl.origin !== currentOrigin) return input;
    } catch {
      return input;
    }
  }
  return `${base}${input}`;
};

const authedFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (typeof window !== "undefined") {
    const creatorRef = localStorage.getItem("zarelon_creator_ref_code")?.trim().toUpperCase();
    if (creatorRef) headers.set("x-creator-ref", creatorRef);
  }
  const resolved = resolveApiInput(input);
  try {
    return await fetch(resolved, { ...init, headers });
  } catch (error) {
    const target = typeof resolved === "string" ? resolved : resolved.toString();
    const base = appEnv.apiBaseUrl?.trim() || "(same origin)";
    const hint = import.meta.env.DEV
      ? "Run `npm run dev` so web + api both are up."
      : `Check VITE_API_BASE_URL (${base}) and backend server.`;
    throw new Error(`Network error: could not reach API (${target}). ${hint}`);
  }
};

export const paymentsApi = {
  createOrder: async (input: { cartId: string; addressId: string; discountCode?: string }) => {
    const parsed = createRazorpayOrderSchema.parse(input);
    const res = await authedFetch("/api/payments/razorpay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    return parse<{
      orderId: string;
      razorpayOrderId: string;
      amount: number;
      currency: string;
      discountCode?: string | null;
      discountAmountInr?: number;
    }>(res);
  },
  verify: async (input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }) => {
    const parsed = verifyPaymentSchema.parse(input);
    const res = await authedFetch("/api/payments/razorpay/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    return parse<{ success: boolean; appOrderId: string; paymentStatus: string }>(res);
  },
  refund: async (input: { orderId: string; reason: string }) => {
    const parsed = refundSchema.parse(input);
    const res = await authedFetch("/api/payments/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    return parse<{ success: boolean; refundId: string; paymentStatus: string; orderStatus: string }>(res);
  },
  releaseOrderHold: async (orderId: string, reason?: string) => {
    const res = await authedFetch("/api/payments/razorpay/order", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, reason }),
    });
    return parse<{ success: boolean; released: boolean; reason?: string }>(res);
  },
};

export const royalAccessApi = {
  createOrder: async () => {
    const res = await authedFetch("/api/royal-access/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return parse<{
      ok: boolean;
      razorpayOrderId: string;
      amount: number;
      currency: string;
      monthly_price_inr: number;
    }>(res);
  },
  verify: async (input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) => {
    const parsed = verifyPaymentSchema.parse(input);
    const res = await authedFetch("/api/royal-access/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    return parse<{ ok: boolean; unlocked: boolean; tier: string; expires_at: string }>(res);
  },
};

export const ordersApi = {
  createCodOrder: async (input: { cartId: string; addressId: string; discountCode?: string }) => {
    const parsed = createRazorpayOrderSchema.parse(input);
    const res = await authedFetch("/api/orders/cod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    return parse<{ success: boolean; orderId: string; orderNumber: string; paymentStatus: string }>(res);
  },
  downloadInvoice: async (orderId: string) => {
    const res = await authedFetch(`/api/orders/${orderId}/invoice`, {
      method: "GET",
    });
    if (!res.ok) {
      const errorBody = await parse<{ error?: string }>(res);
      throw new Error(errorBody.error ?? "Could not download invoice");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ZARELON-invoice-${orderId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  cancelOrder: async (orderId: string, reason?: string) => {
    const res = await authedFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason?.trim() || undefined }),
    });
    return parse<{ success: boolean; status: string }>(res);
  },
  requestRefund: async (orderId: string, reason: string, payoutMethod?: "bank" | "upi") => {
    const res = await authedFetch(`/api/orders/${orderId}/refund-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, payout_method: payoutMethod }),
    });
    return parse<{ success: boolean; refund_status: string; payout_method?: "bank" | "upi" }>(res);
  },
  createReturnRequest: async (input: {
    orderId: string;
    productId: string;
    orderItemId?: string;
    type: "RETURN" | "EXCHANGE";
    reason: string;
    description?: string;
    photos?: string[];
    exchangeVariantId?: string;
    payoutMethod?: "bank" | "upi";
    pickupAddressId: string;
    customerConfirmation: boolean;
  }) => {
    const res = await authedFetch(`/api/orders/${input.orderId}/refund-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_kind: "RETURN_REQUEST",
        product_id: input.productId,
        order_item_id: input.orderItemId,
        type: input.type,
        reason: input.reason,
        description: input.description,
        photos: input.photos ?? [],
        exchange_variant_id: input.exchangeVariantId,
        payout_method: input.payoutMethod,
        pickup_address_id: input.pickupAddressId,
        customer_confirmation: input.customerConfirmation,
      }),
    });
    return parse<{ success: boolean; requestId: string; status: string }>(res);
  },
};

export const discountCodeApi = {
  validate: async (input: { cartId: string; code: string }) => {
    const res = await authedFetch("/api/discount-codes/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{
      ok: boolean;
      code: string;
      title: string | null;
      discount_type: "percentage" | "fixed";
      discount_value: number;
      discount_amount_inr: number;
      min_order_inr: number;
      max_discount_inr: number | null;
      subtotal_inr: number;
      shipping_inr: number;
      total_after_discount_inr: number;
    }>(res);
  },
  listAdmin: async () => {
    const res = await authedFetch("/api/admin/discount-codes", { method: "GET" });
    return parse<{
      ok: boolean;
      rows: Array<{
        id: string;
        code: string;
        title: string | null;
        discount_type: "percentage" | "fixed";
        discount_value: number;
        min_order_inr: number;
        max_discount_inr: number | null;
        total_usage_limit: number | null;
        per_user_limit: number;
        used_count: number;
        starts_at: string | null;
        expires_at: string | null;
        active: boolean;
        created_at: string;
        updated_at: string;
      }>;
    }>(res);
  },
  createAdmin: async (input: {
    code: string;
    title?: string;
    discount_type: "percentage" | "fixed";
    discount_value: number;
    min_order_inr?: number;
    max_discount_inr?: number | null;
    total_usage_limit?: number | null;
    per_user_limit?: number;
    starts_at?: string | null;
    expires_at?: string | null;
    active?: boolean;
  }) => {
    const res = await authedFetch("/api/admin/discount-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{ ok: boolean; id: string }>(res);
  },
  setActiveAdmin: async (id: string, active: boolean) => {
    const res = await authedFetch("/api/admin/discount-codes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, active }),
    });
    return parse<{ ok: boolean }>(res);
  },
};

export const adminApi = {
  upsertProduct: async (body: {
    id?: string;
    title: string;
    description?: string;
    price_inr: number;
    discount_price?: number;
    discount_percent: number;
    category: string;
    stock: number;
    requires_shipping: boolean;
    requires_cod: boolean;
    return_allowed: boolean;
    exchange_allowed: boolean;
    return_window_days: number;
    featured: boolean;
    gender: "men" | "women" | "unisex";
    show_on_home: boolean;
    show_on_new_in: boolean;
    show_on_collection: boolean;
    collection_slug?: string;
    category_slug?: string;
    drop_id?: string;
    minimum_required_tier_id?: string;
    festival_tag?: string;
    image_url?: string;
    image_urls?: string[];
    video_url?: string;
    bundle_with?: string[];
    size_chart?: Array<Record<string, string>>;
    variants?: Array<{ color?: string; size?: string; sku?: string; stock: number; active?: boolean }>;
    active: boolean;
  }): Promise<{ productId: string; mode: "api" | "fallback" }> => {

    const res = await authedFetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const parsed = await parse<{ productId: string }>(res);
      return { ...parsed, mode: "api" };
    }

    let apiErrorMessage = "";
    try {
      const err = await res.clone().json();
      apiErrorMessage = String(err?.error ?? "");
    } catch {
      apiErrorMessage = "";
    }
    const normalizedApiError = apiErrorMessage.toLowerCase();
    const isSingleObjectCoerceError =
      normalizedApiError.includes("cannot coerce") ||
      normalizedApiError.includes("single json object") ||
      normalizedApiError.includes("json object requested");

    if (res.status === 404 || (res.status === 400 && isSingleObjectCoerceError)) {
      let previousPrice: number | null = null;
      let supportsPreviousPriceColumn = false;
      if (body.id) {
        const { data: existing, error: existingError } = await supabase
          .from("products")
          .select("price_inr, previous_price_inr")
          .eq("id", body.id)
          .maybeSingle();
        if (existingError) {
          const { data: fallbackExisting } = await supabase
            .from("products")
            .select("price_inr")
            .eq("id", body.id)
            .maybeSingle();
          if (fallbackExisting && typeof fallbackExisting.price_inr === "number") {
            previousPrice = fallbackExisting.price_inr !== body.price_inr ? fallbackExisting.price_inr : null;
          }
        } else {
          supportsPreviousPriceColumn = true;
          if (existing && typeof existing.price_inr === "number") {
            if (existing.price_inr !== body.price_inr) {
              previousPrice = existing.price_inr;
            } else {
              previousPrice = existing.previous_price_inr ?? null;
            }
          }
        }
      }

      const record: any = {
        slug: slugify(body.title),
        title: body.title,
        description: body.description ?? null,
        price_inr: body.price_inr,
        discount_price: body.discount_price ?? null,
        discount_percent: body.discount_percent,
        category: body.category,
        stock: body.stock,
        requires_shipping: body.requires_shipping,
        requires_cod: body.requires_cod,
        return_allowed: body.return_allowed,
        exchange_allowed: body.exchange_allowed,
        return_window_days: body.return_window_days,
        featured: body.featured,
        gender: body.gender,
        show_on_home: body.show_on_home,
        show_on_new_in: body.show_on_new_in,
        show_on_collection: body.show_on_collection,
        collection_slug: body.collection_slug ?? null,
        category_slug: body.category_slug ?? null,
        drop_id: body.drop_id ?? null,
        minimum_required_tier_id: body.minimum_required_tier_id ?? null,
        festival_tag: body.festival_tag ?? null,
        image_url: body.image_url ?? null,
        video_url: body.video_url ?? null,
        bundle_with: body.bundle_with ?? [],
        size_chart: body.size_chart ?? null,
        active: body.active,
        updated_at: new Date().toISOString(),
      };
      if (body.id && supportsPreviousPriceColumn) {
        record.previous_price_inr = previousPrice;
      }
      let action = body.id
        ? supabase.from("products").update(record).eq("id", body.id).select("id")
        : supabase.from("products").insert(record).select("id");
      let { data, error } = await action;
      if (
        error &&
        (String(error.message ?? "").toLowerCase().includes("requires_shipping") ||
          String(error.message ?? "").toLowerCase().includes("requires_cod") ||
          String(error.message ?? "").toLowerCase().includes("return_allowed") ||
          String(error.message ?? "").toLowerCase().includes("exchange_allowed") ||
          String(error.message ?? "").toLowerCase().includes("return_window_days") ||
          String(error.message ?? "").toLowerCase().includes("bundle_with") ||
          String(error.message ?? "").toLowerCase().includes("size_chart") ||
          String(error.message ?? "").toLowerCase().includes("show_on_home") ||
          String(error.message ?? "").toLowerCase().includes("show_on_new_in") ||
          String(error.message ?? "").toLowerCase().includes("show_on_collection") ||
          String(error.message ?? "").toLowerCase().includes("category_slug") ||
          String(error.message ?? "").toLowerCase().includes("collection_slug") ||
          String(error.message ?? "").toLowerCase().includes("gender") ||
          String(error.message ?? "").toLowerCase().includes("drop_id") ||
          String(error.message ?? "").toLowerCase().includes("minimum_required_tier_id"))
      ) {
        delete record.requires_shipping;
        delete record.requires_cod;
        delete record.return_allowed;
        delete record.exchange_allowed;
        delete record.return_window_days;
        delete record.bundle_with;
        delete record.size_chart;
        delete record.gender;
        delete record.show_on_home;
        delete record.show_on_new_in;
        delete record.show_on_collection;
        delete record.collection_slug;
        delete record.category_slug;
        delete record.drop_id;
        delete record.minimum_required_tier_id;
        action = body.id
          ? supabase.from("products").update(record).eq("id", body.id).select("id")
          : supabase.from("products").insert(record).select("id");
        ({ data, error } = await action);
      }
      let productId = Array.isArray(data) ? data[0]?.id : (data as any)?.id;
      if (!error && !productId && body.id) {
        const { data: exists } = await supabase.from("products").select("id").eq("id", body.id).maybeSingle();
        if (exists?.id) productId = body.id;
      }
      if (error) throw error;
      if (!productId) {
        throw new Error(body.id ? "Product not found for update. Refresh and try again." : "Could not save product");
      }
      if (body.image_urls) {
        await supabase.from("product_images").delete().eq("product_id", productId);
        if (body.image_urls.length) {
          await supabase.from("product_images").insert(
            body.image_urls.map((url, index) => ({
              product_id: productId,
              image_url: url,
              sort_order: index,
              is_primary: index === 0,
            }))
          );
        }
      }
      if (body.variants) {
        await supabase.from("product_variants").delete().eq("product_id", productId);
        if (body.variants.length) {
          const variantRows = body.variants.map((item) => ({
            product_id: productId,
            color: item.color?.trim() || null,
            size: item.size?.trim() || null,
            sku: item.sku?.trim() || null,
            stock: Math.max(0, Number(item.stock) || 0),
            active: item.active ?? true,
          }));
          await supabase.from("product_variants").insert(variantRows);
        }
      }
      return { productId, mode: "fallback" };
    }
    const parsed = await parse<{ productId: string }>(res);
    return { ...parsed, mode: "api" };
  },
  updateOrderStatus: async (
    orderId: string,
    status: string,
    reason?: string,
    cancelStatus?: "none" | "requested" | "processed" | "completed"
  ) => {
    const toTrackingStatus = (value: string) => {
      if (value === "pending") return "placed";
      if (value === "confirmed") return "packed";
      if (value === "shipped") return "shipped";
      if (value === "delivered") return "delivered";
      if (value === "cancelled") return "failed";
      return "rto";
    };

    const res = await authedFetch(`/api/admin/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reason: reason?.trim() || undefined, cancel_status: cancelStatus }),
    });
    if (res.ok)
      return parse<{
        success: boolean;
        status: string;
        cancel_status?: string;
        shiprocket_sync?: { attempted: boolean; success: boolean; reason?: string };
      }>(res);
    if (res.status === 404) {
      let fallbackUpdate = await supabase
        .from("orders")
        .update({
          status,
          cancel_status:
            status === "cancelled" ? cancelStatus ?? "processed" : status === "refunded" ? "completed" : "none",
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .select("id,status,cancel_status")
        .maybeSingle();
      if (fallbackUpdate.error && String(fallbackUpdate.error.message ?? "").toLowerCase().includes("cancel_status")) {
        fallbackUpdate = await supabase
          .from("orders")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", orderId)
          .select("id,status")
          .maybeSingle();
      }
      const { data: updated, error } = fallbackUpdate;
      if (error) throw error;
      if (!updated) throw new Error("Order not found while updating status");
      // Keep shipment-driven tracking UIs aligned when API route is unavailable.
      await supabase
        .from("shipments")
        .update({
          normalized_status: toTrackingStatus(status),
          carrier_status: status,
          last_event_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);
      return {
        success: true,
        status,
        cancel_status: updated.cancel_status,
        shiprocket_sync: { attempted: false, success: false },
      };
    }
    return parse<{
      success: boolean;
      status: string;
      cancel_status?: string;
      shiprocket_sync?: { attempted: boolean; success: boolean; reason?: string };
    }>(res);
  },
  upsertShipment: async (
    orderId: string,
    payload: {
      carrier_name: string;
      tracking_number: string;
      awb_number?: string;
      carrier_status?: string;
      normalized_status?: "placed" | "packed" | "shipped" | "out_for_delivery" | "delivered" | "failed" | "rto";
      eta?: string;
      tracking_url?: string;
      location?: string;
    }
  ) => {
    const res = await authedFetch(`/api/admin/orders/${orderId}/shipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return parse<{ success: boolean; normalized_status: string; order_status: string }>(res);
    if (res.status === 404) {
      const normalized = payload.normalized_status ?? "shipped";
      const { data: shipment, error: upsertError } = await supabase
        .from("shipments")
        .upsert(
          {
            order_id: orderId,
            carrier_name: payload.carrier_name,
            tracking_number: payload.tracking_number,
            awb_number: payload.awb_number ?? null,
            carrier_status: payload.carrier_status ?? normalized,
            normalized_status: normalized,
            eta: payload.eta ?? null,
            tracking_url: payload.tracking_url ?? null,
            last_event_at: new Date().toISOString(),
          },
          { onConflict: "order_id" }
        )
        .select("id")
        .single();
      if (upsertError || !shipment) throw upsertError ?? new Error("Could not save shipment");
      await supabase.from("shipment_events").insert({
        shipment_id: shipment.id,
        raw_status: payload.carrier_status ?? normalized,
        normalized_status: normalized,
        location: payload.location ?? null,
        raw_payload: payload,
        event_time: new Date().toISOString(),
      });
      return { success: true, normalized_status: normalized, order_status: "shipped" };
    }
    return parse<{ success: boolean; normalized_status: string; order_status: string }>(res);
  },
  setProductActive: async (productId: string, active: boolean) => {
    const { error } = await supabase
      .from("products")
      .update({ active, updated_at: new Date().toISOString() })
      .eq("id", productId);
    if (error) throw error;
    return { success: true };
  },
  deleteProduct: async (productId: string) => {
    const res = await authedFetch(`/api/admin/products?id=${encodeURIComponent(productId)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    return parse<{ success: boolean; productId: string; archived?: boolean }>(res);
  },
  updateReturnRequestStatus: async (input: {
    requestId: string;
    status: "APPROVED" | "REJECTED" | "COMPLETED";
    adminNote?: string;
    exchangeTracking?: {
      carrier_name: string;
      tracking_number: string;
      tracking_url?: string;
    };
  }) => {
    const res = await authedFetch(`/api/payments/refund`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        return_request_id: input.requestId,
        status: input.status,
        admin_note: input.adminNote,
        exchange_tracking: input.exchangeTracking,
      }),
    });
    return parse<{ success: boolean; status: string }>(res);
  },
  resetReturnItemLocks: async (input: {
    mode: "FULL_UNLOCK" | "REFUND_ONLY_UNLOCK" | "EXCHANGE_ONLY_UNLOCK";
    orderItemId?: string;
    orderId?: string;
    productId?: string;
    adminNote: string;
  }) => {
    const res = await authedFetch(`/api/payments/refund`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "OVERRIDE_LOCKS",
        mode: input.mode,
        order_item_id: input.orderItemId,
        order_id: input.orderId,
        product_id: input.productId,
        admin_note: input.adminNote,
      }),
    });
    return parse<{
      success: boolean;
      action: "OVERRIDE_LOCKS";
      mode: "FULL_UNLOCK" | "REFUND_ONLY_UNLOCK" | "EXCHANGE_ONLY_UNLOCK";
      order_item_id: string;
    }>(res);
  },
};

export const adminCmsApi = {
  generateBannerText: async (input: {
    festivalName: string;
    discountPercent: number;
    categoryFocus: string;
    tone: "sporty" | "luxury" | "bold" | "emotional";
  }) => {
    try {
      const res = await authedFetch("/api/admin/ai/banner-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parse<{ headline: string; subtitle: string; cta: string; urgency: string; mode: "ai" | "fallback" }>(res);
    } catch {
      const off = `${input.discountPercent}% OFF`;
      return {
        headline: `${input.festivalName} ${off}`,
        subtitle: `${input.categoryFocus} essentials curated for this drop.`,
        cta: "Shop Now",
        urgency: "Limited time offer",
        mode: "fallback",
      } as const;
    }
  },
  suggestSmartLayout: async (pageId: string) => {
    try {
      const res = await authedFetch("/api/admin/home/smart-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, action: "suggest" }),
      });
      return parse<{ recommendation: { id: string; reason: string; proposed_order: Array<{ id: string; section_key: string; display_order: number }> } }>(res);
    } catch {
      return {
        recommendation: {
          id: "local-fallback",
          reason: "Smart layout API unavailable. Keep current order.",
          proposed_order: [],
        },
      };
    }
  },
  approveSmartLayout: async (pageId: string, recommendationId: string) => {
    try {
      const res = await authedFetch("/api/admin/home/smart-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, action: "apply", recommendationId }),
      });
      return parse<{ success: boolean; status: string; appliedCount: number }>(res);
    } catch {
      return { success: true, status: "skipped", appliedCount: 0 };
    }
  },
  rejectSmartLayout: async (pageId: string, recommendationId: string) => {
    try {
      const res = await authedFetch("/api/admin/home/smart-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId, action: "reject", recommendationId }),
      });
      return parse<{ success: boolean; status: string }>(res);
    } catch {
      return { success: true, status: "skipped" };
    }
  },
};

export const socialRewardsApi = {
  submitVideo: async (input: {
    platform: "instagram" | "youtube" | "tiktok" | "facebook";
    videoUrl: string;
    followersCount: number;
    viewsSnapshot?: number;
    caption?: string;
  }) => {
    const res = await authedFetch("/api/social/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: input.platform,
        video_url: input.videoUrl,
        followers_count: input.followersCount,
        views_snapshot: input.viewsSnapshot ?? 0,
        caption: input.caption ?? "",
      }),
    });
    return parse<{
      ok: boolean;
      submission: { id: string; status: "pending"; submitted_at: string };
      campaign: {
        id: string;
        name: string;
        discount_amount: number;
        min_followers: number;
        min_views: number;
        min_days_live: number;
        required_hashtags: string[];
      };
    }>(res);
  },
  getMySubmissions: async () => {
    const res = await authedFetch("/api/social/submissions", { method: "GET" });
    return parse<{
      submissions: Array<{
        id: string;
        platform: "instagram" | "youtube" | "tiktok" | "facebook";
        video_url: string;
        followers_count: number;
        views_snapshot: number;
        status: "pending" | "approved" | "rejected";
        submitted_at: string;
        verified_at: string | null;
        coupon_code: string | null;
        coupon_generated: boolean;
        coupon_expires_at: string | null;
        caption?: string | null;
        recheck_scheduled_at?: string | null;
        recheck_completed?: boolean;
        still_live?: boolean | null;
        recheck_views_snapshot?: number | null;
        is_featured?: boolean;
        flagged_for_review?: boolean;
        is_invalid?: boolean;
      }>;
    }>(res);
  },
  getAdminSubmissions: async (params: { period: "today" | "7d" | "1m" | "custom"; from?: string; to?: string }) => {
    const search = new URLSearchParams({ period: params.period });
    if (params.from) search.set("from", params.from);
    if (params.to) search.set("to", params.to);
    const res = await authedFetch(`/api/admin/social/submissions?${search.toString()}`, { method: "GET" });
    return parse<{
      submissions: Array<{
        id: string;
        user_id: string;
        platform: "instagram" | "youtube" | "tiktok" | "facebook";
        video_url: string;
        followers_count: number;
        views_snapshot: number;
        status: "pending" | "approved" | "rejected";
        submitted_at: string;
        verified_at: string | null;
        coupon_code: string | null;
        coupon_generated: boolean;
        coupon_expires_at: string | null;
        caption?: string | null;
        recheck_scheduled_at?: string | null;
        recheck_completed?: boolean;
        still_live?: boolean | null;
        recheck_views_snapshot?: number | null;
        is_featured?: boolean;
        flagged_for_review?: boolean;
        is_invalid?: boolean;
        submitted_url_public?: boolean;
        precheck_errors?: string[] | null;
        campaign?: {
          id: string;
          name: string;
          discount_amount: number;
          min_followers?: number;
          min_views?: number;
          min_days_live?: number;
          required_hashtags?: string[];
        } | null;
        user?: { id: string; name: string | null; email: string | null } | null;
      }>;
    }>(res);
  },
  reviewSubmission: async (input: {
    submissionId: string;
    action: "approve" | "reject" | "pin" | "unpin" | "recheck";
    currentViewsSnapshot?: number;
  }) => {
    const res = await authedFetch("/api/admin/social/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submission_id: input.submissionId,
        action: input.action,
        current_views_snapshot: input.currentViewsSnapshot,
      }),
    });
    return parse<{
      ok: boolean;
      status: "approved" | "rejected" | "pinned" | "unpinned" | "rechecked";
      coupon?: {
        code: string;
        discount_amount: number;
        min_order_amount: number;
        valid_until: string;
        one_time_use: boolean;
      };
      result?: { revoked?: boolean; flagged?: boolean };
    }>(res);
  },
  runRecheckDue: async () => {
    const res = await authedFetch("/api/social/recheck/run", { method: "POST" });
    return parse<{ ok: boolean; processed: number; results: Array<Record<string, unknown>> }>(res);
  },
  getLeaderboard: async () => {
    const res = await authedFetch("/api/social/leaderboard", { method: "GET" });
    return parse<{
      leaderboard: Array<{
        user_id: string;
        username: string;
        platform: string;
        views: number;
        engagement: number;
        approved_submissions: number;
        badge: string;
        elite_tier?: string | null;
      }>;
      spotlight: Array<{
        id: string;
        platform: string;
        video_url: string;
        views_snapshot: number;
        user_name: string;
      }>;
    }>(res);
  },
  generateCaption: async (baseText?: string) => {
    const res = await authedFetch("/api/social/caption/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_text: baseText ?? "" }),
    });
    return parse<{
      caption: string;
      mode: "ai" | "cache" | "fallback";
      ai_warning?: string;
      provider?: "groq" | "gemini";
    }>(res);
  },
};

export const homepageApi = {
  getMobile: async () => {
    const res = await authedFetch("/api/homepage/mobile", { method: "GET" });
    return parse<{
      topNotice: string;
      heroSections: Array<{
        id: string;
        imageMobile: string;
        headline: string;
        subText?: string;
        ctaText?: string;
        ctaUrl?: string;
        priority?: number;
        imagePosition?: "center" | "top" | "bottom";
      }>;
      featuredTiles: Array<{ id: string; image: string; title: string; link: string }>;
      categories: Array<{ id: string; imageMobile: string; title: string; link: string }>;
      newArrivals?: Array<{
        id: string;
        slug: string;
        image: string | null;
        title: string;
        category: string;
        price_inr: number;
      }>;
      spotlightSections: Array<{
        title: string;
        banner?: { image: string; alt?: string; link?: string };
        products: Array<{ id: string; slug: string; image: string | null; title: string; category: string; price_inr: number }>;
      }>;
      royal?: {
        crownProgress?: {
          valid_referral_count: number;
          current_tier_name: string;
          next_target: number;
        } | null;
        leaderboard?: Array<{ user_id: string; username: string; views: number }>;
      } | null;
      featureFlags?: Record<string, boolean>;
      flags?: Record<string, boolean>;
    }>(res);
  },
};

export const referralApi = {
  validateCode: async (referralCode: string) => {
    const res = await authedFetch("/api/referrals/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referral_code: referralCode }),
    });
    return parse<{ ok: boolean; referrer: { id: string; name: string; email: string | null } }>(res);
  },
  applyCode: async (input: { referralCode: string; deviceFingerprint?: string }) => {
    const res = await authedFetch("/api/referrals/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referral_code: input.referralCode,
        device_fingerprint: input.deviceFingerprint,
      }),
    });
    return parse<{ ok: boolean; applied: boolean; reason?: string }>(res);
  },
  remind: async (referralId: string) => {
    const res = await authedFetch("/api/referrals/remind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referral_id: referralId }),
    });
    return parse<{ ok: boolean; reminded: boolean }>(res);
  },
  getAdminOverview: async (params: { period: "today" | "7d" | "1m" | "custom"; from?: string; to?: string }) => {
    const query = new URLSearchParams({ period: params.period });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    const res = await authedFetch(`/api/admin/referrals?${query.toString()}`, { method: "GET" });
    return parse<{
      config: {
        id: string;
        min_purchase_amount: number;
        referrer_reward: number;
        friend_reward: number;
        is_active: boolean;
      } | null;
      settings: {
        ambassador_program_enabled: boolean;
        paid_ambassador_enabled: boolean;
        referral_program_enabled: boolean;
        royal_access_price_inr: number;
        early_access_lock_hours: 24 | 48 | 72;
      };
      feature_flags?: {
        ambassador_program_enabled: boolean;
        royal_crown_enabled: boolean;
        royal_access_enabled: boolean;
        creator_program_enabled: boolean;
        leaderboard_enabled: boolean;
        vault_enabled: boolean;
        early_drop_enabled: boolean;
        priority_checkout_enabled: boolean;
      };
      content_blocks?: Array<{
        key: string;
        title: string | null;
        description: string | null;
        is_enabled: boolean;
      }>;
      metrics: {
        total_referrals: number;
        successful_conversions: number;
        total_rewards_given: number;
      };
      referrals: Array<{
        id: string;
        referral_code: string;
        purchase_amount: number | null;
        reward_given: boolean;
        created_at: string;
        reward_given_at: string | null;
        friend_coupon_code: string | null;
        referrer_coupon_code: string | null;
        signup_ip: string | null;
        referrer?: { id: string; name: string | null; email: string | null } | null;
        friend?: { id: string; name: string | null; email: string | null } | null;
      }>;
    }>(res);
  },
  updateConfig: async (input: {
    min_purchase_amount: number;
    referrer_reward: number;
    friend_reward: number;
    is_active: boolean;
    ambassador_program_enabled?: boolean;
    paid_ambassador_enabled?: boolean;
    referral_program_enabled?: boolean;
    royal_access_price_inr?: number;
    early_access_lock_hours?: 24 | 48 | 72;
    flags?: Record<string, boolean>;
    blocks?: Array<{ key: string; title?: string | null; description?: string | null; is_enabled?: boolean }>;
  }) => {
    const res = await authedFetch("/api/admin/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{ ok: boolean; config: Record<string, unknown> }>(res);
  },
};

export const creatorApi = {
  trackReferralClick: async (ref: string) => {
    const search = new URLSearchParams({ ref });
    const res = await authedFetch(`/api/creator/track?${search.toString()}`, { method: "POST" });
    return parse<{ ok: boolean; tracked: boolean; reason?: string | null }>(res);
  },
  getDashboard: async () => {
    const res = await authedFetch("/api/creator/dashboard", { method: "GET" });
    return parse<{
      ok: boolean;
      creator: {
        id: string;
        name: string | null;
        referral_code: string | null;
        total_submissions: number;
        approved_count: number;
        total_views: number;
        current_tier: {
          id: string;
          name: string;
          min_approved_submissions: number;
          min_total_views: number;
          badge_color: string | null;
          reward_bonus: number | null;
        } | null;
        next_tier: {
          id: string;
          name: string;
          min_approved_submissions: number;
          min_total_views: number;
          badge_color: string | null;
          reward_bonus: number | null;
        } | null;
        progress: { approved_percent: number; views_percent: number };
        earned_coupons: Array<{
          id: string;
          coupon_code: string;
          coupon_expires_at?: string | null;
        }>;
        referrals: Array<{
          id: string;
          referred_user_id: string;
          purchase_amount: number | null;
          reward_given: boolean;
          created_at: string;
          friend: { id: string; name: string | null; email: string | null };
        }>;
      };
    }>(res);
  },
  getAdminAnalytics: async (params: { period: "today" | "7d" | "30d" | "custom"; from?: string; to?: string }) => {
    const query = new URLSearchParams({ period: params.period });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    const res = await authedFetch(`/api/admin/creator-analytics?${query.toString()}`, { method: "GET" });
    return parse<{
      ok: boolean;
      top_revenue_creators: Array<Record<string, unknown>>;
      top_engagement_creators: Array<Record<string, unknown>>;
      creators: Array<Record<string, unknown>>;
    }>(res);
  },
};

export const eliteApi = {
  getMyStatus: async () => {
    const res = await authedFetch("/api/elite/me", { method: "GET" });
    return parse<{
      ok: boolean;
      disabled?: boolean;
      progress: {
        user_id: string;
        valid_referral_count: number;
        current_tier_id: string | null;
        highest_tier_id: string | null;
        royal_crown_unlocked: boolean;
        unlocked_at: string | null;
        tier_locked: boolean;
        permanent_royal_crown: boolean;
        current_tier?: { id: string; name: string; required_valid_referrals: number; badge_style: Record<string, unknown> | null } | null;
        highest_tier?: { id: string; name: string; required_valid_referrals: number; badge_style: Record<string, unknown> | null } | null;
      } | null;
      tiers: Array<{ id: string; name: string; required_valid_referrals: number; badge_style: Record<string, unknown> | null; is_active: boolean }>;
      settings?: {
        ambassador_program_enabled: boolean;
        paid_ambassador_enabled: boolean;
        referral_program_enabled: boolean;
        royal_access_price_inr: number;
        early_access_lock_hours: 24 | 48 | 72;
      };
      feature_flags?: {
        ambassador_program_enabled: boolean;
        royal_crown_enabled: boolean;
        royal_access_enabled: boolean;
        creator_program_enabled: boolean;
        leaderboard_enabled: boolean;
        vault_enabled: boolean;
        early_drop_enabled: boolean;
        priority_checkout_enabled: boolean;
      };
      content_blocks?: Array<{
        key: string;
        title: string | null;
        description: string | null;
        is_enabled: boolean;
      }>;
      royal_access_active?: boolean;
      royal_access_expires_at?: string | null;
      role?: "user" | "admin" | "super_admin";
      derived_tier?: "SUPER_ROYAL" | "ROYAL_CROWN" | "ROYAL_ACCESS" | "NORMAL_USER";
      allow_all_access?: boolean;
    }>(res);
  },
  getAdminOverview: async (params: { period: "today" | "7d" | "30d" | "custom"; from?: string; to?: string }) => {
    const query = new URLSearchParams({ period: params.period });
    if (params.from) query.set("from", params.from);
    if (params.to) query.set("to", params.to);
    const res = await authedFetch(`/api/admin/elite?${query.toString()}`, { method: "GET" });
    return parse<{
      ok: boolean;
      metrics: { total_profiles: number; royal_crown_unlocked: number; locked_profiles: number; suspicious_events: number };
      tiers: Array<{ id: string; name: string; required_valid_referrals: number; badge_style: Record<string, unknown> | null; is_active: boolean }>;
      progress: Array<Record<string, unknown>>;
      abuse_logs: Array<Record<string, unknown>>;
      feature_flags?: Record<string, boolean>;
    }>(res);
  },
  updateTier: async (input: {
    id: string;
    required_valid_referrals: number;
    is_active?: boolean;
    badge_style?: Record<string, unknown>;
  }) => {
    const res = await authedFetch("/api/admin/elite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_tier", tier: input }),
    });
    return parse<{ ok: boolean; tier: Record<string, unknown> }>(res);
  },
  setUserProgress: async (input: {
    user_id: string;
    current_tier_id?: string | null;
    highest_tier_id?: string | null;
    valid_referral_count?: number;
    tier_locked?: boolean;
    permanent_royal_crown?: boolean;
  }) => {
    const res = await authedFetch("/api/admin/elite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_user", user: input }),
    });
    return parse<{ ok: boolean; progress: Record<string, unknown> }>(res);
  },
  refreshUserProgress: async (userId: string) => {
    const res = await authedFetch("/api/admin/elite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh_user", user: { user_id: userId } }),
    });
    return parse<{ ok: boolean; progress: Record<string, unknown> | null }>(res);
  },
};

export const royalSystemApi = {
  getSettings: async () => {
    const res = await authedFetch("/api/admin/royal/system", { method: "GET" });
    return parse<{
      ok: boolean;
      feature_flags: {
        ambassador_program_enabled: boolean;
        royal_crown_enabled: boolean;
        royal_access_enabled: boolean;
        creator_program_enabled: boolean;
        leaderboard_enabled: boolean;
        vault_enabled: boolean;
        early_drop_enabled: boolean;
        priority_checkout_enabled: boolean;
      };
      settings: {
        ambassador_program_enabled: boolean;
        paid_ambassador_enabled: boolean;
        referral_program_enabled: boolean;
        royal_access_price_inr: number;
        early_access_lock_hours: 24 | 48 | 72;
      };
    }>(res);
  },
  updateFeatureFlags: async (flags: Record<string, boolean>) => {
    const res = await authedFetch("/api/admin/royal/system", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flags }),
    });
    return parse<{ ok: boolean; feature_flags: Record<string, boolean> }>(res);
  },
  getContentBlocks: async () => {
    const res = await authedFetch("/api/admin/content-blocks", { method: "GET" });
    return parse<{
      ok: boolean;
      content_blocks: Array<{ key: string; title: string | null; description: string | null; is_enabled: boolean }>;
    }>(res);
  },
  updateContentBlocks: async (
    blocks: Array<{ key: string; title?: string | null; description?: string | null; is_enabled?: boolean }>
  ) => {
    const res = await authedFetch("/api/admin/content-blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });
    return parse<{ ok: boolean; updated: number }>(res);
  },
};

export const scarcityDropApi = {
  createDrop: async (input: Record<string, unknown>) => {
    const res = await authedFetch("/api/admin/drops/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{ ok: boolean; drop: Record<string, unknown> }>(res);
  },
  updateDrop: async (input: Record<string, unknown>) => {
    const res = await authedFetch("/api/admin/drops/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{ ok: boolean; drop: Record<string, unknown> }>(res);
  },
  getActiveDrops: async () => {
    const res = await authedFetch("/api/drops/active", { method: "GET" });
    return parse<{ ok: boolean; drops: Array<Record<string, unknown>> }>(res);
  },
  getDropById: async (id: string) => {
    const res = await authedFetch(`/api/drops/${id}`, { method: "GET" });
    return parse<{ ok: boolean; drop: Record<string, unknown> }>(res);
  },
  getDropProducts: async (id: string) => {
    const res = await authedFetch(`/api/drops/${id}/products`, { method: "GET" });
    return parse<{
      ok: boolean;
      access: { allowed: boolean; reason: string | null };
      drop?: Record<string, unknown>;
      teaser?: Record<string, unknown>;
      products: Array<Record<string, unknown>>;
    }>(res);
  },
  requestAccess: async (id: string, inviteCode?: string) => {
    const res = await authedFetch(`/api/drops/${id}/access-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite_code: inviteCode }),
    });
    return parse<{ ok: boolean; access_granted: boolean; access_mode: string | null; token: string | null }>(res);
  },
  redeem: async (id: string, input: { token?: string; invite_code?: string }) => {
    const res = await authedFetch(`/api/drops/${id}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{ ok: boolean; redeemed: boolean; mode: string }>(res);
  },
};

export const homepageAiApi = {
  getVariant: async () => {
    const res = await authedFetch("/api/homepage/variant", { method: "GET" });
    return parse<{ ok: boolean; variant: Record<string, unknown> | null; reason: string }>(res);
  },
  trackInteraction: async (input: {
    variant_id?: string;
    event: "view" | "click" | "cta" | "purchase" | "scroll_depth" | "search";
    category?: string;
    product_id?: string;
    search_term?: string;
    section?: string;
  }) => {
    const res = await authedFetch("/api/homepage/interaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parse<{ ok: boolean; recorded: boolean }>(res);
  },
};
