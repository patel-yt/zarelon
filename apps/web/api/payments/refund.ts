import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import Razorpay from "razorpay";
import { z } from "zod";
import { adminClient, getServerConfigError, requirePermission, requireUser, sendError, serverEnv } from "../_lib/server.js";
import { sendRefundInitiated } from "../_lib/email.js";
import { createReversePickup, logReturnEvent } from "../_lib/returns.js";

const refundBodySchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(3),
});

const returnStatusBodySchema = z.object({
  return_request_id: z.string().uuid(),
  status: z.enum(["APPROVED", "REJECTED", "COMPLETED"]),
  admin_note: z.string().trim().max(1000).optional(),
  exchange_tracking: z
    .object({
      carrier_name: z.string().trim().min(2),
      tracking_number: z.string().trim().min(4),
      tracking_url: z.string().url().optional(),
    })
    .optional(),
});

const returnResetBodySchema = z
  .object({
    action: z.literal("OVERRIDE_LOCKS"),
    mode: z.enum(["FULL_UNLOCK", "REFUND_ONLY_UNLOCK", "EXCHANGE_ONLY_UNLOCK"]),
    order_item_id: z.string().uuid().optional(),
    order_id: z.string().uuid().optional(),
    product_id: z.string().uuid().optional(),
    admin_note: z.string().trim().min(3).max(1000),
  })
  .refine(
    (value) => Boolean(value.order_item_id) || Boolean(value.order_id && value.product_id),
    "Provide order_item_id or both order_id and product_id"
  );

const canTransition = (from: string, to: string): boolean => {
  if (from === "PENDING") return to === "APPROVED" || to === "REJECTED";
  if (from === "APPROVED") return to === "COMPLETED";
  return false;
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
    lower.includes("exchange_allowed_override") ||
    lower.includes("manual_override_reason") ||
    lower.includes("manual_override_admin_id") ||
    lower.includes("manual_override_at")
  );
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST" && req.method !== "PATCH") return sendError(res, 405, "Method not allowed");
  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);

  const returnParsed = returnStatusBodySchema.safeParse(req.body ?? {});
  const resetParsed = returnResetBodySchema.safeParse(req.body ?? {});
  if (req.method === "PATCH" || returnParsed.success || resetParsed.success) {
    if (resetParsed.success && resetParsed.data.action === "OVERRIDE_LOCKS") {
      const actor = await requireUser(req);
      if (!actor) return sendError(res, 401, "Unauthorized");
      const { data: actorProfile } = await adminClient.from("users").select("id,role").eq("id", actor.id).maybeSingle();
      if (!actorProfile || actorProfile.role !== "super_admin") {
        return sendError(res, 403, "Only super admin can reset return locks");
      }

      const resetInput = resetParsed.data;
      let targetOrderItemId: string | null = resetInput.order_item_id ?? null;
      let targetOrderId: string | null = resetInput.order_id ?? null;
      let targetProductId: string | null = resetInput.product_id ?? null;

      if (!targetOrderItemId && targetOrderId && targetProductId) {
        const { data: itemByOrderProduct, error: itemLookupError } = await adminClient
          .from("order_items")
          .select("id,order_id,product_id")
          .eq("order_id", targetOrderId)
          .eq("product_id", targetProductId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (itemLookupError) return sendError(res, 400, itemLookupError.message || "Could not find order item");
        if (!itemByOrderProduct) return sendError(res, 404, "Order item not found for provided order_id + product_id");
        targetOrderItemId = itemByOrderProduct.id;
        targetOrderId = itemByOrderProduct.order_id;
        targetProductId = itemByOrderProduct.product_id;
      }

      if (!targetOrderItemId) return sendError(res, 400, "Reset target missing");

      const { data: itemRow, error: itemRowError } = await adminClient
        .from("order_items")
        .select("id,order_id,product_id")
        .eq("id", targetOrderItemId)
        .maybeSingle();
      if (itemRowError) return sendError(res, 400, itemRowError.message || "Could not load order item");
      if (!itemRow) return sendError(res, 404, "Order item not found");
      targetOrderId = itemRow.order_id;
      targetProductId = itemRow.product_id;

      const now = new Date().toISOString();
      const overridePayloadByMode: Record<string, Record<string, unknown>> = {
        FULL_UNLOCK: {
          refund_attempts: 0,
          exchange_attempts: 0,
          refund_completed: false,
          exchange_completed: false,
          refund_locked: false,
          exchange_locked: false,
          active_request: false,
          refund_allowed_override: true,
          exchange_allowed_override: true,
          manual_override_reason: resetInput.admin_note,
          manual_override_admin_id: actorProfile.id,
          manual_override_at: now,
        },
        REFUND_ONLY_UNLOCK: {
          refund_attempts: 0,
          refund_locked: false,
          refund_allowed_override: true,
          manual_override_reason: resetInput.admin_note,
          manual_override_admin_id: actorProfile.id,
          manual_override_at: now,
        },
        EXCHANGE_ONLY_UNLOCK: {
          exchange_attempts: 0,
          exchange_locked: false,
          exchange_allowed_override: true,
          manual_override_reason: resetInput.admin_note,
          manual_override_admin_id: actorProfile.id,
          manual_override_at: now,
        },
      };
      const overridePayload = overridePayloadByMode[resetInput.mode];

      const { error: itemUpdateError } = await adminClient
        .from("order_items")
        .update(overridePayload)
        .eq("id", targetOrderItemId);
      if (itemUpdateError) {
        if (hasStateColumnError(itemUpdateError.message || "")) {
          return sendError(res, 500, "Database not updated for strict return rules. Run supabase db push.");
        }
        return sendError(res, 400, itemUpdateError.message || "Could not reset item lock state");
      }

      await adminClient
        .from("return_requests")
        .update({
          status: "REJECTED",
          admin_note: resetInput.admin_note ?? "Lock reset by super admin",
          admin_user_id: actorProfile.id,
          updated_at: new Date().toISOString(),
        })
        .eq("order_item_id", targetOrderItemId)
        .in("status", ["PENDING", "APPROVED"]);

      await adminClient.from("admin_audit_logs").insert({
        admin_user_id: actorProfile.id,
        action: "return_request_lock_override",
        entity_type: "order_items",
        entity_id: targetOrderItemId,
        diff: {
          mode: resetInput.mode,
          note: resetInput.admin_note ?? null,
          order_item_id: targetOrderItemId,
          order_id: targetOrderId,
          product_id: targetProductId,
          at: now,
        },
      });

      const { data: latestReturnForItem } = await adminClient
        .from("return_requests")
        .select("id")
        .eq("order_item_id", targetOrderItemId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestReturnForItem?.id) {
        await logReturnEvent(latestReturnForItem.id, "OVERRIDE_LOCKS", `Super admin override: ${resetInput.mode}`, {
          mode: resetInput.mode,
          admin_id: actorProfile.id,
          reason: resetInput.admin_note,
          order_item_id: targetOrderItemId,
        }).catch(() => undefined);
      }

      return res.status(200).json({
        success: true,
        action: "OVERRIDE_LOCKS",
        mode: resetInput.mode,
        order_item_id: targetOrderItemId,
      });
    }

    if (!returnParsed.success) return sendError(res, 400, "Invalid payload");
    const input = returnParsed.data;
    let nextStatusToWrite: string = input.status;

    const { data: requestRow, error: requestError } = await adminClient
      .from("return_requests")
      .select("id,order_id,order_item_id,product_id,user_id,type,status")
      .eq("id", input.return_request_id)
      .maybeSingle();
    if (requestError) return sendError(res, 400, requestError.message || "Could not load return request");
    if (!requestRow) return sendError(res, 404, "Return request not found");

    if (!canTransition(requestRow.status, input.status)) {
      return sendError(res, 400, `Invalid status transition: ${requestRow.status} -> ${input.status}`);
    }

    const needsRefundPermission = requestRow.type === "RETURN" && input.status === "APPROVED";
    const admin = needsRefundPermission
      ? await requirePermission(req, "can_refund")
      : await requirePermission(req, "can_manage_orders");
    if (!admin) return sendError(res, 403, "Permission denied");

    const itemStateQuery = await adminClient
      .from("order_items")
      .select(
        "id,refund_attempts,exchange_attempts,refund_completed,exchange_completed,refund_locked,exchange_locked,active_request"
      )
      .eq("id", requestRow.order_item_id ?? "")
      .maybeSingle();
    if (itemStateQuery.error) {
      if (hasStateColumnError(itemStateQuery.error.message || "")) {
        return sendError(res, 500, "Database not updated for strict return rules. Run supabase db push.");
      }
      return sendError(res, 400, itemStateQuery.error.message || "Could not load item return state");
    }
    const itemState = itemStateQuery.data;
    if (!itemState) return sendError(res, 400, "Could not resolve order item for request");

    if (requestRow.type === "RETURN" && input.status === "APPROVED") {
      try {
        await createReversePickup(requestRow.id);
      } catch (pickupError) {
        const message = pickupError instanceof Error ? pickupError.message : "Could not schedule reverse pickup";
        return sendError(res, 400, message);
      }
      nextStatusToWrite = "PICKUP_SCHEDULED";

      const { error: lockUpdateError } = await adminClient
        .from("order_items")
        .update({
          active_request: true,
        })
        .eq("id", itemState.id);
      if (lockUpdateError) {
        if (hasStateColumnError(lockUpdateError.message || "")) {
          return sendError(res, 500, "Database not updated for strict return rules. Run supabase db push.");
        }
        return sendError(res, 400, lockUpdateError.message || "Could not update item lock state");
      }
    }

    if (requestRow.type === "EXCHANGE" && input.status === "APPROVED") {
      const tracking = input.exchange_tracking;
      const now = new Date().toISOString();
      const trackingNumber = tracking?.tracking_number ?? `EX-${requestRow.id.slice(0, 8).toUpperCase()}`;

      const { data: shipment, error: shipmentError } = await adminClient
        .from("shipments")
        .upsert(
          {
            order_id: requestRow.order_id,
            carrier_name: tracking?.carrier_name ?? "Exchange Desk",
            tracking_number: trackingNumber,
            tracking_url: tracking?.tracking_url ?? null,
            carrier_status: tracking?.carrier_name ? "exchange_initiated" : "packed",
            normalized_status: "packed",
            last_event_at: now,
          },
          { onConflict: "order_id" }
        )
        .select("id")
        .single();
      if (shipmentError || !shipment) {
        return sendError(res, 400, shipmentError?.message || "Could not create replacement shipment");
      }

      await adminClient.from("shipment_events").insert({
        shipment_id: shipment.id,
        raw_status: "exchange_initiated",
        normalized_status: "packed",
        location: null,
        raw_payload: { return_request_id: requestRow.id, exchange_tracking: tracking ?? null },
        event_time: now,
      });

      await adminClient.from("orders").update({ status: "shipped", updated_at: now }).eq("id", requestRow.order_id);

      const { error: lockUpdateError } = await adminClient
        .from("order_items")
        .update({
          active_request: true,
        })
        .eq("id", itemState.id);
      if (lockUpdateError) {
        if (hasStateColumnError(lockUpdateError.message || "")) {
          return sendError(res, 500, "Database not updated for strict return rules. Run supabase db push.");
        }
        return sendError(res, 400, lockUpdateError.message || "Could not update item lock state");
      }
    }

    if (input.status === "REJECTED") {
      if (requestRow.type === "RETURN") {
        const nextAttempts = Number(itemState.refund_attempts ?? 0) + 1;
        const { error: lockUpdateError } = await adminClient
          .from("order_items")
          .update({
            refund_attempts: nextAttempts,
            refund_locked: nextAttempts >= 2,
            active_request: false,
          })
          .eq("id", itemState.id);
        if (lockUpdateError) {
          if (hasStateColumnError(lockUpdateError.message || "")) {
            return sendError(res, 500, "Database not updated for strict return rules. Run supabase db push.");
          }
          return sendError(res, 400, lockUpdateError.message || "Could not update item lock state");
        }
      } else {
        const nextAttempts = Number(itemState.exchange_attempts ?? 0) + 1;
        const { error: lockUpdateError } = await adminClient
          .from("order_items")
          .update({
            exchange_attempts: nextAttempts,
            exchange_locked: true,
            active_request: false,
          })
          .eq("id", itemState.id);
        if (lockUpdateError) {
          if (hasStateColumnError(lockUpdateError.message || "")) {
            return sendError(res, 500, "Database not updated for strict return rules. Run supabase db push.");
          }
          return sendError(res, 400, lockUpdateError.message || "Could not update item lock state");
        }
      }
    }

    if (input.status === "COMPLETED") {
      const updatePayload =
        requestRow.type === "RETURN"
          ? {
              refund_completed: true,
              refund_locked: true,
              exchange_locked: true,
              active_request: false,
            }
          : {
              exchange_completed: true,
              exchange_locked: true,
              active_request: false,
            };
      const { error: lockUpdateError } = await adminClient
        .from("order_items")
        .update(updatePayload)
        .eq("id", itemState.id);
      if (lockUpdateError) {
        if (hasStateColumnError(lockUpdateError.message || "")) {
          return sendError(res, 500, "Database not updated for strict return rules. Run supabase db push.");
        }
        return sendError(res, 400, lockUpdateError.message || "Could not update item lock state");
      }
    }

    const { error: updateError } = await adminClient
      .from("return_requests")
      .update({
        status: nextStatusToWrite,
        admin_note: input.admin_note ?? null,
        admin_user_id: admin.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestRow.id);
    if (updateError) return sendError(res, 400, updateError.message || "Could not update return request");

    await logReturnEvent(requestRow.id, "ADMIN_STATUS_UPDATE", `Admin updated request status to ${nextStatusToWrite}`, {
      from: requestRow.status,
      to: nextStatusToWrite,
      admin_id: admin.id,
      note: input.admin_note ?? null,
    });

    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: "return_request_status_update",
      entity_type: "return_requests",
      entity_id: requestRow.id,
      diff: { from: requestRow.status, to: nextStatusToWrite, note: input.admin_note ?? null },
    });

    return res.status(200).json({ success: true, status: nextStatusToWrite });
  }

  try {
    if (!serverEnv.razorpayKeyId || !serverEnv.razorpayKeySecret) return sendError(res, 500, "Razorpay not configured");
    const admin = await requirePermission(req, "can_refund");
    if (!admin) return sendError(res, 403, "Permission denied");

    const parsed = refundBodySchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid payload");

    const { data: order } = await adminClient
      .from("orders")
      .select("id,payment_ref,razorpay_payment_id,payment_provider,payment_status")
      .eq("id", parsed.data.orderId)
      .maybeSingle();

    if (!order) return sendError(res, 404, "Order not found");
    if (order.payment_provider !== "razorpay") {
      return sendError(res, 400, "Refund is available only for Razorpay paid orders");
    }
    if (order.payment_status !== "captured") {
      return sendError(res, 400, "Only captured payments can be refunded");
    }
    if (!order.razorpay_payment_id) {
      return sendError(res, 400, "Missing Razorpay payment id for this order");
    }

    const razorpay = new Razorpay({ key_id: serverEnv.razorpayKeyId, key_secret: serverEnv.razorpayKeySecret });
    const refund = await razorpay.payments.refund(order.razorpay_payment_id, {
      notes: { reason: parsed.data.reason },
    });

    await adminClient
      .from("orders")
      .update({
        payment_status: "refunded",
        status: "refunded",
        refund_status: "processed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    await adminClient.from("payments_audit").insert({
      order_id: order.id,
      event_type: "payment_refunded",
      provider_payload: refund,
    });

    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: "refund",
      entity_type: "orders",
      entity_id: order.id,
      diff: { reason: parsed.data.reason },
    });

    const { data: orderUser } = await adminClient.from("orders").select("user_id").eq("id", order.id).single();
    const { data: user } = await adminClient
      .from("users")
      .select("email")
      .eq("id", orderUser?.user_id ?? "")
      .maybeSingle();
    const recipient = user?.email;
    if (recipient) {
      await sendRefundInitiated({ to: recipient, orderId: order.id, reason: parsed.data.reason });
    }

    res.status(200).json({
      success: true,
      refundId: (refund as { id?: string }).id ?? "",
      paymentStatus: "refunded",
      orderStatus: "refunded",
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "Refund request failed";
    return sendError(res, 500, message);
  }
}
