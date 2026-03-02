import type { ApiRequest, ApiResponse } from "../../_lib/http.js";
import crypto from "node:crypto";
import { z } from "zod";
import { adminClient, getServerConfigError, requireUser, sendError, serverEnv } from "../../_lib/server.js";
import { sendOrderConfirmation } from "../../_lib/email.js";
import { consumeReservationForOrder } from "../../_lib/inventoryIntelligence.js";
import { processReferralRewardsForOrder } from "../../_lib/referrals.js";
import { attributeCreatorPurchase } from "../../_lib/creatorGamification.js";
import { enforceRateLimit } from "../../_lib/rateLimit.js";
import { registerDiscountUsage } from "../../_lib/discountCodes.js";

const bodySchema = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  razorpaySignature: z.string(),
});

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
  if (!serverEnv.razorpayKeySecret) return sendError(res, 500, "Razorpay not configured");

  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const requestIp =
    (Array.isArray(req.headers["x-forwarded-for"]) ? req.headers["x-forwarded-for"][0] : req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? null;

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const rate = await enforceRateLimit({
    eventType: "payment_verify_attempt",
    maxHits: 15,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: requestIp,
  });
  if (!rate.allowed) return sendError(res, 429, "Too many payment verification attempts. Please retry later.");

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;
  const signature = crypto
    .createHmac("sha256", serverEnv.razorpayKeySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  const expectedSig = Buffer.from(signature, "utf8");
  const incomingSig = Buffer.from(razorpaySignature, "utf8");
  if (expectedSig.length !== incomingSig.length || !crypto.timingSafeEqual(expectedSig, incomingSig)) {
    await adminClient.from("payment_risk_events").insert({
      user_id: user.id,
      event_type: "payment_signature_mismatch",
      risk_level: "high",
      details: { razorpay_order_id: razorpayOrderId },
    });
    return sendError(res, 400, "Signature verification failed");
  }

  const { data: order } = await adminClient
    .from("orders")
    .select("id, user_id, total_inr, shipping_address, payment_status")
    .eq("payment_ref", razorpayOrderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!order) return sendError(res, 404, "Order not found");

  const royalPriority = await isRoyalPriorityUser(user.id);
  const wasAlreadyCaptured = String(order.payment_status ?? "").toLowerCase() === "captured";
  await adminClient
    .from("orders")
    .update({
      payment_status: "captured",
      status: royalPriority ? "confirmed" : "pending",
      razorpay_payment_id: razorpayPaymentId,
      refund_status: "none",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  const consumed = await consumeReservationForOrder(order.id);

  if (!consumed) {
    type InventoryLineItem = {
      product_id: string;
      quantity: number;
      variant_id: string | null;
    };

    const lineItemsRes = await adminClient
      .from("order_items")
      .select("product_id, variant_id, quantity")
      .eq("order_id", order.id);

    let lineItems: InventoryLineItem[] = [];
    if (lineItemsRes.error && String(lineItemsRes.error.message ?? "").toLowerCase().includes("variant")) {
      const fallbackRes = await adminClient.from("order_items").select("product_id, quantity").eq("order_id", order.id);
      if (fallbackRes.error) return sendError(res, 400, fallbackRes.error.message || "Could not load order items");
      lineItems = (fallbackRes.data ?? []).map((item) => ({
        product_id: item.product_id,
        quantity: Number(item.quantity ?? 0),
        variant_id: null,
      }));
    } else if (lineItemsRes.error) {
      return sendError(res, 400, lineItemsRes.error.message || "Could not load order items");
    } else {
      lineItems = (lineItemsRes.data ?? []).map((item) => ({
        product_id: item.product_id,
        quantity: Number(item.quantity ?? 0),
        variant_id: item.variant_id ?? null,
      }));
    }

    for (const item of lineItems) {
      if (item.variant_id) {
        const { data: variant } = await adminClient
          .from("product_variants")
          .select("stock")
          .eq("id", item.variant_id)
          .maybeSingle();
        await adminClient
          .from("product_variants")
          .update({ stock: Math.max((variant?.stock ?? 0) - item.quantity, 0) })
          .eq("id", item.variant_id);
      }
      const { data: product } = await adminClient.from("products").select("stock").eq("id", item.product_id).single();
      await adminClient
        .from("products")
        .update({ stock: Math.max((product?.stock ?? 0) - item.quantity, 0) })
        .eq("id", item.product_id);
    }
  }

  const { data: cart } = await adminClient.from("carts").select("id").eq("user_id", user.id).maybeSingle();
  if (cart?.id) {
    await adminClient.from("cart_items").delete().eq("cart_id", cart.id);
  }

  await adminClient.from("payments_audit").insert({
    order_id: order.id,
    event_type: "payment_captured",
    provider_payload: { ...parsed.data, used_reservation: consumed },
  });

  if (user.email) {
    await sendOrderConfirmation({
      to: user.email,
      orderId: order.id,
    });
  }

  await processReferralRewardsForOrder(order.id);
  const shippingAddress = (order as any)?.shipping_address ?? {};
  const discountCodeId = shippingAddress?.discountCodeId ? String(shippingAddress.discountCodeId) : null;
  const discountCode = shippingAddress?.discountCode ? String(shippingAddress.discountCode) : null;
  const discountAmountInr = Math.max(0, Number(shippingAddress?.discountAmountInr ?? 0));
  if (!wasAlreadyCaptured && discountCodeId && discountCode && discountAmountInr > 0) {
    await registerDiscountUsage({
      codeId: discountCodeId,
      userId: user.id,
      orderId: order.id,
      codeSnapshot: discountCode,
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
    orderAmount: Number(order.total_inr ?? 0),
    ipAddress: requestIp,
  });

  res.status(200).json({ success: true, appOrderId: order.id, paymentStatus: "captured" });
}
