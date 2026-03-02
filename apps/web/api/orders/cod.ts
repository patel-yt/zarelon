import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import crypto from "node:crypto";
import { z } from "zod";
import { adminClient, computeCartTotals, getServerConfigError, requireUser, sendError } from "../_lib/server.js";
import { consumeReservationForOrder, reserveInventoryForCart } from "../_lib/inventoryIntelligence.js";
import { attributeCreatorPurchase } from "../_lib/creatorGamification.js";
import { enforceRateLimit } from "../_lib/rateLimit.js";
import { registerDiscountUsage, validateDiscountCode } from "../_lib/discountCodes.js";

const bodySchema = z.object({
  cartId: z.string().uuid(),
  addressId: z.string().uuid(),
  discountCode: z.string().trim().max(40).optional(),
});
const getRequestIp = (req: ApiRequest): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  const realIp = req.headers["x-real-ip"];
  return (Array.isArray(realIp) ? realIp[0] : realIp) ?? null;
};

const isRoyalPriorityUser = async (userId: string): Promise<boolean> => {
  const flagsRes = await adminClient
    .from("feature_flags")
    .select("feature_key,is_enabled")
    .in("feature_key", ["ambassador_program_enabled", "priority_checkout_enabled"]);
  if (flagsRes.error) return false;
  const flags = new Map((flagsRes.data ?? []).map((row: any) => [String(row.feature_key), Boolean(row.is_enabled)]));
  if (!flags.get("ambassador_program_enabled") || !flags.get("priority_checkout_enabled")) return false;

  const userRes = await adminClient
    .from("users")
    .select("role,royal_access_active,royal_access_expires_at")
    .eq("id", userId)
    .maybeSingle();
  if (userRes.error || !userRes.data) return false;
  const role = String((userRes.data as any).role ?? "user").toLowerCase();
  if (role === "admin" || role === "super_admin") return true;

  const userAccessActive = Boolean((userRes.data as any).royal_access_active ?? false);
  const userAccessExpiresAt = (userRes.data as any).royal_access_expires_at as string | null | undefined;
  const userAccessValid = userAccessActive && (!userAccessExpiresAt || new Date(userAccessExpiresAt).getTime() > Date.now());
  if (userAccessValid) return true;

  const passRes = await adminClient
    .from("royal_access_passes")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1)
    .maybeSingle();
  return !passRes.error && Boolean(passRes.data);
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);

  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const requestIp = getRequestIp(req);

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const rate = await enforceRateLimit({
    eventType: "cod_order_create",
    maxHits: 5,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: requestIp,
  });
  if (!rate.allowed) return sendError(res, 429, "Too many COD attempts. Please wait and retry.");

  try {
    const totals = await computeCartTotals(parsed.data.cartId);
    const discountCodeRaw = parsed.data.discountCode?.trim() || "";
    let discountAmountInr = 0;
    let appliedDiscount: { codeId: string; code: string } | null = null;
    if (discountCodeRaw) {
      const discountValidation = await validateDiscountCode({
        userId: user.id,
        code: discountCodeRaw,
        subtotalInr: totals.subtotal,
      });
      if (!discountValidation.ok) throw new Error(discountValidation.error);
      discountAmountInr = discountValidation.discountAmountInr;
      appliedDiscount = { codeId: discountValidation.codeId, code: discountValidation.code };
    }
    const discountedSubtotal = Math.max(0, totals.subtotal - discountAmountInr);
    const grandTotal = discountedSubtotal + totals.shipping;
    const royalPriority = await isRoyalPriorityUser(user.id);
    const { data: shippingAddress, error: shippingAddressError } = await adminClient
      .from("shipping_addresses")
      .select("id,full_name,phone,line1,line2,city,state,postal_code,country")
      .eq("id", parsed.data.addressId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (shippingAddressError || !shippingAddress) {
      throw shippingAddressError ?? new Error("Please select a valid delivery address");
    }
    if (!totals.codAllowed) {
      return sendError(res, 400, "Cash on Delivery is not available for one or more cart items");
    }

    const reservation = await reserveInventoryForCart(user.id, parsed.data.cartId);

    const orderNumber = `cod_${crypto.randomBytes(8).toString("hex")}`;
    const { data: order, error } = await adminClient
      .from("orders")
      .insert({
        order_number: orderNumber,
        user_id: user.id,
        subtotal_inr: discountedSubtotal,
        shipping_inr: totals.shipping,
        total_inr: grandTotal,
        total_amount: grandTotal,
        status: "pending",
        payment_status: "created",
        payment_provider: "cod",
        payment_ref: null,
        razorpay_payment_id: null,
        refund_status: "none",
        shipping_address: {
          id: shippingAddress.id,
          fullName: shippingAddress.full_name,
          phone: shippingAddress.phone,
          line1: shippingAddress.line1,
          line2: shippingAddress.line2,
          city: shippingAddress.city,
          state: shippingAddress.state,
          postalCode: shippingAddress.postal_code,
          country: shippingAddress.country,
          royalPriorityDelivery: royalPriority,
          deliveryLane: royalPriority ? "priority" : "standard",
          discountCodeId: appliedDiscount?.codeId ?? null,
          discountCode: appliedDiscount?.code ?? null,
          discountAmountInr,
          subtotalBeforeDiscountInr: totals.subtotal,
        },
      })
      .select("id,order_number")
      .single();

    if (error || !order) throw error ?? new Error("COD order insert failed");

    await adminClient
      .from("inventory_reservations")
      .update({ order_id: order.id, updated_at: new Date().toISOString() })
      .eq("id", reservation.reservationId);

    const orderItems = totals.items.map((item: any) => {
      const basePrice = item.product.discount_price ?? item.product.price_inr;
      const finalPrice = Math.round(basePrice * (1 - (totals.festivalDiscount ?? 0) / 100));
      const variantLabel = item.variant ? [item.variant.color, item.variant.size].filter(Boolean).join(" / ") : null;
      return {
        order_id: order.id,
        product_id: item.product.id,
        variant_id: item.variant?.id ?? null,
        variant_label: variantLabel,
        selected_color: item.variant?.color ?? null,
        selected_size: item.variant?.size ?? null,
        title_snapshot: item.product.title,
        price_inr: finalPrice,
        quantity: item.quantity,
      };
    });
    let { error: itemsError } = await adminClient.from("order_items").insert(orderItems);
    if (itemsError && String(itemsError.message ?? "").toLowerCase().includes("variant")) {
      const fallbackRows = orderItems.map(({ order_id, product_id, title_snapshot, price_inr, quantity }) => ({
        order_id,
        product_id,
        title_snapshot,
        price_inr,
        quantity,
      }));
      ({ error: itemsError } = await adminClient.from("order_items").insert(fallbackRows));
    }
    if (itemsError) throw itemsError;

    await consumeReservationForOrder(order.id);

    const { data: settings } = await adminClient
      .from("platform_settings")
      .select("high_value_cod_threshold_inr")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const codThreshold = settings?.high_value_cod_threshold_inr ?? 150000;

    if (grandTotal >= codThreshold) {
      await adminClient.from("payment_risk_events").insert({
        user_id: user.id,
        order_id: order.id,
        event_type: "high_value_cod",
        risk_level: "high",
        details: { total_inr: grandTotal, threshold_inr: codThreshold },
      });
    }

    const ip = requestIp;
    if (ip) {
      const hourStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentIpEvents } = await adminClient
        .from("payment_risk_events")
        .select("id")
        .eq("event_type", "order_created_ip")
        .eq("ip_address", ip)
        .gte("created_at", hourStart);
      const count = (recentIpEvents?.length ?? 0) + 1;
      await adminClient.from("payment_risk_events").insert({
        user_id: user.id,
        order_id: order.id,
        event_type: "order_created_ip",
        risk_level: count >= 5 ? "high" : "low",
        ip_address: ip,
        details: { orders_from_same_ip_1h: count, channel: "cod" },
      });
    }

    const { data: cart } = await adminClient.from("carts").select("id").eq("user_id", user.id).maybeSingle();
    if (cart?.id) {
      await adminClient.from("cart_items").delete().eq("cart_id", cart.id);
    }

    await adminClient.from("payments_audit").insert({
      order_id: order.id,
      event_type: "cod_order_created",
      provider_payload: {
        cartId: parsed.data.cartId,
        total: grandTotal,
        reservation_id: reservation.reservationId,
        discount_code: appliedDiscount?.code ?? null,
        discount_amount_inr: discountAmountInr,
      },
    });

    if (appliedDiscount && discountAmountInr > 0) {
      await registerDiscountUsage({
        codeId: appliedDiscount.codeId,
        userId: user.id,
        orderId: order.id,
        codeSnapshot: appliedDiscount.code,
        discountAmountInr,
      });
    }

    const creatorRefHeader = Array.isArray(req.headers["x-creator-ref"])
      ? req.headers["x-creator-ref"][0]
      : req.headers["x-creator-ref"];
    await attributeCreatorPurchase({
      creatorCode: typeof creatorRefHeader === "string" ? creatorRefHeader : null,
      buyerUserId: user.id,
      orderId: order.id,
    orderAmount: Number(grandTotal ?? 0),
    ipAddress: getRequestIp(req),
  });

    return res.status(200).json({
      success: true,
      orderId: order.id,
      orderNumber: order.order_number,
      paymentStatus: "created",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "COD order creation failed";
    return sendError(res, 400, message);
  }
}
