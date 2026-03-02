import type { ApiRequest, ApiResponse } from "../../_lib/http.js";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import { z } from "zod";
import {
  adminClient,
  computeCartTotals,
  isPaymentGatewayEnabled,
  getServerConfigError,
  requireUser,
  sendError,
  serverEnv,
} from "../../_lib/server.js";
import { releaseReservationByOrderId, reserveInventoryForCart } from "../../_lib/inventoryIntelligence.js";
import { enforceRateLimit } from "../../_lib/rateLimit.js";
import { validateDiscountCode } from "../../_lib/discountCodes.js";

const bodySchema = z.object({
  cartId: z.string().uuid(),
  addressId: z.string().uuid(),
  discountCode: z.string().trim().max(40).optional(),
});
const releaseSchema = z.object({ orderId: z.string().uuid(), reason: z.string().optional() });
const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage;
  }
  return "Order creation failed";
};
const isInventoryInfraError = (message: string): boolean => {
  const text = message.toLowerCase();
  return (
    text.includes("inventory_reservations") ||
    text.includes("inventory_reservation_items") ||
    text.includes("reservation_hold_minutes")
  );
};
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
  if (req.method !== "POST" && req.method !== "DELETE") return sendError(res, 405, "Method not allowed");
  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);
  if (!serverEnv.razorpayKeyId || !serverEnv.razorpayKeySecret) return sendError(res, 500, "Razorpay not configured");

  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const requestIp = getRequestIp(req);

  if (req.method === "DELETE") {
    const parsedRelease = releaseSchema.safeParse(req.body ?? {});
    if (!parsedRelease.success) return sendError(res, 400, "Invalid payload");

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id,user_id,payment_status")
      .eq("id", parsedRelease.data.orderId)
      .maybeSingle();
    if (orderError || !order) return sendError(res, 404, orderError?.message || "Order not found");
    if (order.user_id !== user.id) return sendError(res, 403, "Forbidden");
    if (order.payment_status === "captured") {
      return res.status(200).json({ success: true, released: false, reason: "already_paid" });
    }

    let released = false;
    try {
      released = await releaseReservationByOrderId(order.id, parsedRelease.data.reason?.trim() || "checkout_dismissed");
    } catch (error) {
      console.error("releaseReservationByOrderId failed", {
        orderId: order.id,
        reason: parsedRelease.data.reason,
        error: getErrorMessage(error),
      });
    }
    if ((parsedRelease.data.reason ?? "").toLowerCase().includes("payment_failed")) {
      const now = Date.now();
      const windowStart = new Date(now - 30 * 60 * 1000).toISOString();
      const { data: recentFailures } = await adminClient
        .from("payment_risk_events")
        .select("id")
        .eq("user_id", user.id)
        .eq("event_type", "payment_failed")
        .gte("created_at", windowStart);
      const failedCount = (recentFailures?.length ?? 0) + 1;
      await adminClient.from("payment_risk_events").insert({
        user_id: user.id,
        order_id: order.id,
        event_type: "payment_failed",
        risk_level: failedCount >= 3 ? "high" : "medium",
        details: { failed_attempts_30m: failedCount },
      });
    }
    return res.status(200).json({ success: true, released });
  }

  if (!(await isPaymentGatewayEnabled())) return sendError(res, 503, "Payment gateway is temporarily disabled");

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const userRate = await enforceRateLimit({
    eventType: "razorpay_order_create",
    maxHits: 10,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: requestIp,
  });
  if (!userRate.allowed) return sendError(res, 429, "Too many payment attempts. Please wait and retry.");

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

    let reservation: Awaited<ReturnType<typeof reserveInventoryForCart>> | null = null;
    try {
      reservation = await reserveInventoryForCart(user.id, parsed.data.cartId);
    } catch (error) {
      const message = getErrorMessage(error);
      if (!isInventoryInfraError(message)) throw new Error(message);
      console.error("Inventory reservation unavailable, continuing checkout", {
        userId: user.id,
        cartId: parsed.data.cartId,
        error: message,
      });
    }
    const razorpay = new Razorpay({ key_id: serverEnv.razorpayKeyId, key_secret: serverEnv.razorpayKeySecret });

    const receipt = `aur_${crypto.randomBytes(8).toString("hex")}`;
    const razorpayOrder = await razorpay.orders.create({ amount: grandTotal, currency: "INR", receipt });

    const { data: order, error } = await adminClient
      .from("orders")
      .insert({
        order_number: receipt,
        user_id: user.id,
        subtotal_inr: discountedSubtotal,
        shipping_inr: totals.shipping,
        total_inr: grandTotal,
        total_amount: grandTotal,
        status: "pending",
        payment_status: "created",
        payment_provider: "razorpay",
        payment_ref: razorpayOrder.id,
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
      .select("id")
      .single();

    if (error || !order) throw error ?? new Error("Order insert failed");

    if (reservation?.reservationId) {
      await adminClient
        .from("inventory_reservations")
        .update({ order_id: order.id, updated_at: new Date().toISOString() })
        .eq("id", reservation.reservationId);
    }

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

    let { error: itemInsertError } = await adminClient.from("order_items").insert(orderItems);
    if (itemInsertError && String(itemInsertError.message ?? "").toLowerCase().includes("variant")) {
      const fallbackRows = orderItems.map(({ order_id, product_id, title_snapshot, price_inr, quantity }) => ({
        order_id,
        product_id,
        title_snapshot,
        price_inr,
        quantity,
      }));
      ({ error: itemInsertError } = await adminClient.from("order_items").insert(fallbackRows));
    }
    if (itemInsertError) {
      await releaseReservationByOrderId(order.id, "order_item_insert_failed");
      throw itemInsertError;
    }

    await adminClient.from("payments_audit").insert({
      order_id: order.id,
      event_type: "order_created",
      provider_payload: {
        razorpay_order_id: razorpayOrder.id,
        amount: grandTotal,
        reservation_id: reservation?.reservationId ?? null,
        hold_expires_at: reservation?.expiresAt ?? null,
        discount_code: appliedDiscount?.code ?? null,
        discount_amount_inr: discountAmountInr,
      },
    });

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
        details: { orders_from_same_ip_1h: count },
      });
    }

    res.status(200).json({
      orderId: order.id,
      razorpayOrderId: razorpayOrder.id,
      amount: grandTotal,
      currency: "INR",
      reservationId: reservation?.reservationId ?? null,
      holdExpiresAt: reservation?.expiresAt ?? null,
      discountCode: appliedDiscount?.code ?? null,
      discountAmountInr,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    console.error("Razorpay order create failed", { userId: user.id, cartId: parsed.data.cartId, error: message });
    return sendError(res, 400, message);
  }
}
