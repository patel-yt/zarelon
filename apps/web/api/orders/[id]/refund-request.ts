import type { ApiRequest, ApiResponse } from "../../_lib/http.js";
import { z } from "zod";
import { adminClient, getServerConfigError, requireUser, sendError } from "../../_lib/server.js";
import { enforceRateLimit } from "../../_lib/rateLimit.js";

const refundBodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
  payout_method: z.enum(["bank", "upi"]).optional(),
});

const returnBodySchema = z.object({
  request_kind: z.literal("RETURN_REQUEST"),
  product_id: z.string().uuid(),
  order_item_id: z.string().uuid().optional(),
  type: z.enum(["RETURN", "EXCHANGE"]),
  reason: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).optional(),
  photos: z.array(z.string().url()).max(3).optional().default([]),
  exchange_variant_id: z.string().uuid().optional(),
  payout_method: z.enum(["bank", "upi"]).optional(),
  pickup_address_id: z.string().uuid(),
  customer_confirmation: z.coerce.boolean().default(false),
});

const daysSince = (dateText: string): number => {
  const ms = Date.now() - new Date(dateText).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
};

const hasStateColumnError = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes("refund_attempts") ||
    lower.includes("exchange_attempts") ||
    lower.includes("refund_completed") ||
    lower.includes("exchange_completed") ||
    lower.includes("refund_locked") ||
    lower.includes("exchange_locked") ||
    lower.includes("active_request") ||
    lower.includes("refund_allowed_override") ||
    lower.includes("exchange_allowed_override")
  );
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);

  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const requestIp =
    (Array.isArray(req.headers["x-forwarded-for"]) ? req.headers["x-forwarded-for"][0] : req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? null;

  const orderId = req.query.id;
  const normalizedOrderId = Array.isArray(orderId) ? orderId[0] : orderId;
  if (!normalizedOrderId) return sendError(res, 400, "Order id is required");
  const rate = await enforceRateLimit({
    eventType: "refund_request_attempt",
    maxHits: 6,
    windowMs: 30 * 60 * 1000,
    userId: user.id,
    ipAddress: requestIp,
  });
  if (!rate.allowed) return sendError(res, 429, "Too many refund/return attempts. Please retry later.");

  const returnParsed = returnBodySchema.safeParse(req.body ?? {});
  if (returnParsed.success) {
    const payload = returnParsed.data;
    if (!payload.customer_confirmation) return sendError(res, 400, "Please confirm details before submitting request");
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id,user_id,status,created_at,updated_at")
      .eq("id", normalizedOrderId)
      .maybeSingle();
    if (orderError) return sendError(res, 400, orderError.message || "Could not load order");
    if (!order) return sendError(res, 404, "Order not found");
    if (order.user_id !== user.id) return sendError(res, 403, "You can request return only for your own order");
    if (order.status !== "delivered") return sendError(res, 400, "Return/Exchange is available only after delivery");

    let productPolicy: { return_allowed?: boolean; exchange_allowed?: boolean; return_window_days?: number } | null = null;
    const productRead = await adminClient
      .from("products")
      .select("id,return_allowed,exchange_allowed,return_window_days")
      .eq("id", payload.product_id)
      .maybeSingle();
    if (!productRead.error) {
      productPolicy = productRead.data;
    } else {
      const fallback = await adminClient.from("products").select("id").eq("id", payload.product_id).maybeSingle();
      if (fallback.error) return sendError(res, 400, fallback.error.message || "Could not load product policy");
      if (!fallback.data) return sendError(res, 404, "Product not found");
      productPolicy = { return_allowed: true, exchange_allowed: true, return_window_days: 7 };
    }

    const returnAllowed = productPolicy?.return_allowed ?? true;
    const exchangeAllowed = productPolicy?.exchange_allowed ?? true;
    const windowDays = Math.max(1, Math.min(30, productPolicy?.return_window_days ?? 7));

    if (payload.type === "RETURN" && !returnAllowed) return sendError(res, 400, "Return is not allowed for this product");
    if (payload.type === "EXCHANGE" && !exchangeAllowed) return sendError(res, 400, "Exchange is not allowed for this product");
    if (payload.type === "EXCHANGE" && !payload.exchange_variant_id) {
      return sendError(res, 400, "Please select replacement variant for exchange");
    }

    const { data: pickupAddress, error: pickupAddressError } = await adminClient
      .from("shipping_addresses")
      .select("id,label,full_name,phone,line1,line2,city,state,postal_code,country")
      .eq("id", payload.pickup_address_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (pickupAddressError) return sendError(res, 400, pickupAddressError.message || "Could not load pickup address");
    if (!pickupAddress) return sendError(res, 400, "Please select a valid pickup address");

    let payoutMethod: "bank" | "upi" | null = null;
    let payoutSnapshot: Record<string, unknown> | null = null;
    if (payload.type === "RETURN") {
      const payoutQuery = await adminClient
        .from("refund_payout_accounts")
        .select("account_holder_name,bank_account_number,bank_ifsc,bank_name,upi_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (payoutQuery.error) return sendError(res, 400, payoutQuery.error.message || "Could not validate payout details");
      const payout = payoutQuery.data;
      const hasBank = Boolean(payout?.account_holder_name && payout?.bank_account_number && payout?.bank_ifsc);
      const hasUpi = Boolean(payout?.upi_id);
      if (!hasBank && !hasUpi) {
        return sendError(res, 400, "Add bank account or UPI in profile before requesting return refund");
      }

      if (hasBank && hasUpi) {
        if (!payload.payout_method) return sendError(res, 400, "Please select refund receive method (bank or upi)");
        payoutMethod = payload.payout_method;
      } else if (hasBank) {
        payoutMethod = "bank";
      } else {
        payoutMethod = "upi";
      }

      payoutSnapshot =
        payoutMethod === "bank"
          ? {
              account_holder_name: payout?.account_holder_name ?? null,
              bank_account_number: payout?.bank_account_number ?? null,
              bank_ifsc: payout?.bank_ifsc ?? null,
              bank_name: payout?.bank_name ?? null,
            }
          : {
              upi_id: payout?.upi_id ?? null,
            };
    }

    const deliveredAt = order.updated_at ?? order.created_at;
    if (daysSince(deliveredAt) > windowDays) {
      return sendError(res, 400, `Return/Exchange window closed. Allowed within ${windowDays} days of delivery.`);
    }

    const itemQuery = payload.order_item_id
      ? adminClient
          .from("order_items")
          .select(
            "id,order_id,product_id,variant_id,refund_attempts,exchange_attempts,refund_completed,exchange_completed,refund_locked,exchange_locked,active_request,refund_allowed_override,exchange_allowed_override"
          )
          .eq("id", payload.order_item_id)
          .eq("order_id", order.id)
          .maybeSingle()
      : adminClient
          .from("order_items")
          .select(
            "id,order_id,product_id,variant_id,refund_attempts,exchange_attempts,refund_completed,exchange_completed,refund_locked,exchange_locked,active_request,refund_allowed_override,exchange_allowed_override"
          )
          .eq("order_id", order.id)
          .eq("product_id", payload.product_id)
          .limit(1)
          .maybeSingle();

    const { data: item, error: itemError } = await itemQuery;
    if (itemError) {
      if (hasStateColumnError(itemError.message || "")) {
        return sendError(res, 500, "Database not updated for return locks. Run supabase db push.");
      }
      return sendError(res, 400, itemError.message || "Could not validate order item");
    }
    if (!item) return sendError(res, 400, "Selected product is not part of this order");

    const refundCompleted = Boolean(item.refund_completed);
    const exchangeCompleted = Boolean(item.exchange_completed);
    const refundLocked = Boolean(item.refund_locked);
    const exchangeLocked = Boolean(item.exchange_locked);
    const activeRequest = Boolean(item.active_request);
    const refundOverride = Boolean((item as any).refund_allowed_override);
    const exchangeOverride = Boolean((item as any).exchange_allowed_override);

    if (refundCompleted) return sendError(res, 400, "Refund already completed. Return/Exchange permanently locked.");
    if (refundLocked && exchangeLocked && !refundOverride && !exchangeOverride) {
      return sendError(res, 400, "Return and exchange are permanently locked for this item.");
    }
    if (activeRequest) return sendError(res, 409, "An active return/exchange request already exists for this item.");

    if (payload.type === "RETURN" && !refundOverride && (refundLocked || refundCompleted)) {
      return sendError(res, 400, "Refund request is locked for this item.");
    }
    if (payload.type === "EXCHANGE" && !exchangeOverride && (exchangeLocked || exchangeCompleted)) {
      return sendError(res, 400, "Exchange request is locked for this item.");
    }

    const { data: existingOpen } = await adminClient
      .from("return_requests")
      .select("id,status")
      .eq("order_id", order.id)
      .eq("order_item_id", item.id)
      .eq("user_id", user.id)
      .in("status", ["PENDING", "APPROVED", "PICKUP_SCHEDULED", "PICKED_UP", "DELIVERED_TO_ORIGIN", "REFUND_PENDING"])
      .limit(1)
      .maybeSingle();
    if (existingOpen) {
      return sendError(res, 409, "A return/exchange request is already open for this item.");
    }

    const insertPayload: Record<string, unknown> = {
      order_id: order.id,
      order_item_id: item.id,
      product_id: payload.product_id,
      user_id: user.id,
      exchange_variant_id: payload.type === "EXCHANGE" ? payload.exchange_variant_id ?? null : null,
      type: payload.type,
      reason: payload.reason,
      description: payload.description ?? null,
      photos: payload.photos ?? [],
      status: "PENDING",
      payout_method: payoutMethod,
      payout_snapshot: payoutSnapshot,
      pickup_address_id: pickupAddress.id,
      pickup_address_snapshot: {
        label: pickupAddress.label ?? null,
        full_name: pickupAddress.full_name,
        phone: pickupAddress.phone,
        line1: pickupAddress.line1,
        line2: pickupAddress.line2 ?? null,
        city: pickupAddress.city,
        state: pickupAddress.state,
        postal_code: pickupAddress.postal_code,
        country: pickupAddress.country,
      },
      customer_confirmation: true,
      confirmed_at: new Date().toISOString(),
    };

    let { data: inserted, error: insertError } = await adminClient.from("return_requests").insert(insertPayload).select("id,status").single();
    if (insertError) {
      const lower = String(insertError.message ?? "").toLowerCase();
      if (
        lower.includes("payout_method") ||
        lower.includes("payout_snapshot") ||
        lower.includes("pickup_address_id") ||
        lower.includes("pickup_address_snapshot") ||
        lower.includes("customer_confirmation") ||
        lower.includes("confirmed_at")
      ) {
        delete insertPayload.payout_method;
        delete insertPayload.payout_snapshot;
        delete insertPayload.pickup_address_id;
        delete insertPayload.pickup_address_snapshot;
        delete insertPayload.customer_confirmation;
        delete insertPayload.confirmed_at;
        ({ data: inserted, error: insertError } = await adminClient.from("return_requests").insert(insertPayload).select("id,status").single());
      }
    }
    if (insertError || !inserted) {
      return sendError(res, 400, insertError?.message || "Could not create return request");
    }

    const { error: lockError } = await adminClient
      .from("order_items")
      .update({ active_request: true })
      .eq("id", item.id);
    if (lockError) {
      if (hasStateColumnError(lockError.message || "")) {
        return sendError(res, 500, "Database not updated for return locks. Run supabase db push.");
      }
      return sendError(res, 400, lockError.message || "Could not lock item for active request");
    }

    await adminClient.from("payments_audit").insert({
      order_id: order.id,
      event_type: "return_request_created",
      provider_payload: {
        request_id: inserted.id,
        type: payload.type,
        reason: payload.reason,
        by_user: user.id,
        product_id: payload.product_id,
        order_item_id: item.id,
        payout_method: payoutMethod,
        pickup_address_id: pickupAddress.id,
      },
    });
    await adminClient.from("return_events").insert({
      return_request_id: inserted.id,
      event_type: "REQUEST_CREATED",
      message: "Return/Exchange request created by customer",
      payload: {
        type: payload.type,
        reason: payload.reason,
        by_user: user.id,
      },
    });

    return res.status(200).json({ success: true, requestId: inserted.id, status: inserted.status });
  }

  const parsed = refundBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Please provide a valid refund reason");

  const { data: order, error: orderError } = await adminClient
    .from("orders")
    .select("id,user_id,status,payment_provider,payment_status,refund_status")
    .eq("id", normalizedOrderId)
    .maybeSingle();
  if (orderError) return sendError(res, 400, orderError.message || "Could not load order");
  if (!order) return sendError(res, 404, "Order not found");
  if (order.user_id !== user.id) return sendError(res, 403, "You can request refund only for your own order");
  if (order.payment_provider !== "razorpay" || order.payment_status !== "captured") {
    return sendError(res, 400, "Refund request is available only for paid online orders");
  }
  if (order.status !== "delivered" && order.status !== "cancelled" && order.status !== "refunded") {
    return sendError(res, 400, "Refund can be requested after delivery or cancellation");
  }
  if (order.refund_status === "pending") {
    return res.status(200).json({ success: true, refund_status: "pending" });
  }

  const payoutQuery = await adminClient
    .from("refund_payout_accounts")
    .select("account_holder_name,bank_account_number,bank_ifsc,bank_name,upi_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const payout = payoutQuery.data;
  const hasBank = Boolean(payout?.account_holder_name && payout?.bank_account_number && payout?.bank_ifsc);
  const hasUpi = Boolean(payout?.upi_id);
  if (!hasBank && !hasUpi) {
    return sendError(res, 400, "Add refund payout details in Profile (bank account or UPI) before requesting refund");
  }

  let payoutMethod: "bank" | "upi";
  if (hasBank && hasUpi) {
    if (!parsed.data.payout_method) {
      return sendError(res, 400, "Please choose refund method: bank or upi");
    }
    payoutMethod = parsed.data.payout_method;
  } else if (hasBank) {
    payoutMethod = "bank";
  } else {
    payoutMethod = "upi";
  }

  const { error: updateError } = await adminClient
    .from("orders")
    .update({ refund_status: "pending", updated_at: new Date().toISOString() })
    .eq("id", normalizedOrderId);
  if (updateError) return sendError(res, 400, updateError.message || "Could not mark refund request");

  await adminClient.from("payments_audit").insert({
    order_id: normalizedOrderId,
    event_type: "refund_requested_by_customer",
    provider_payload: {
      reason: parsed.data.reason,
      requested_by: user.id,
      payout_method: payoutMethod,
      payout:
        payoutMethod === "bank"
          ? {
              account_holder_name: payout?.account_holder_name ?? null,
              bank_account_number: payout?.bank_account_number ?? null,
              bank_ifsc: payout?.bank_ifsc ?? null,
              bank_name: payout?.bank_name ?? null,
            }
          : {
              upi_id: payout?.upi_id ?? null,
            },
    },
  });

  res.status(200).json({ success: true, refund_status: "pending", payout_method: payoutMethod });
}
