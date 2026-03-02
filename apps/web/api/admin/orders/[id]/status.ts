import type { ApiRequest, ApiResponse } from "../../../_lib/http.js";
import { z } from "zod";
import { adminClient, requirePermission, sendError } from "../../../_lib/server.js";
import { sendOrderEmail, sendOrderShipped, sendRefundInitiated } from "../../../_lib/email.js";
import { restoreOrderInventory } from "../../../_lib/inventory.js";
import { releaseReservationByOrderId } from "../../../_lib/inventoryIntelligence.js";
import { processReferralRewardsForOrder } from "../../../_lib/referrals.js";
import { createShiprocketForwardOrder } from "../../../_lib/shiprocket.js";

const orderTransitionMap: Record<string, string[]> = {
  pending: ["confirmed", "shipped", "delivered", "cancelled", "refunded"],
  confirmed: ["pending", "shipped", "delivered", "cancelled", "refunded"],
  shipped: ["confirmed", "delivered", "cancelled", "refunded"],
  delivered: ["shipped", "refunded"],
  cancelled: [],
  refunded: [],
};

const isValidOrderTransition = (from: string, to: string): boolean =>
  orderTransitionMap[from]?.includes(to) ?? false;

const toTrackingStatus = (
  status: "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | "refunded"
): "placed" | "packed" | "shipped" | "out_for_delivery" | "delivered" | "failed" | "rto" => {
  if (status === "pending") return "placed";
  if (status === "confirmed") return "packed";
  if (status === "shipped") return "shipped";
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "failed";
  return "rto";
};

const bodySchema = z.object({
  status: z.enum(["pending", "confirmed", "shipped", "delivered", "cancelled", "refunded"]),
  reason: z.string().trim().min(2).max(500).optional(),
  cancel_status: z.enum(["none", "requested", "processed", "completed"]).optional(),
});

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "PATCH") return sendError(res, 405, "Method not allowed");

  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");

  const orderId = req.query.id;
  if (!orderId || typeof orderId !== "string") return sendError(res, 400, "Order id is required");

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  let orderQuery = await adminClient
    .from("orders")
    .select("id,user_id,order_number,total_inr,shipping_address,status,cancel_status,payment_status,payment_provider,refund_status")
    .eq("id", orderId)
    .maybeSingle();
  if (orderQuery.error && String(orderQuery.error.message ?? "").toLowerCase().includes("cancel_status")) {
    orderQuery = await adminClient
      .from("orders")
      .select("id,user_id,order_number,total_inr,shipping_address,status,payment_status,payment_provider,refund_status")
      .eq("id", orderId)
      .maybeSingle();
  }
  const { data: order } = orderQuery;
  if (!order) return sendError(res, 404, "Order not found");

  if (!isValidOrderTransition(order.status, parsed.data.status) && order.status !== parsed.data.status) {
    return sendError(res, 400, `Invalid status transition from ${order.status} to ${parsed.data.status}`);
  }

  const shouldMarkRefundPending =
    parsed.data.status === "cancelled" &&
    (order as any).payment_provider === "razorpay" &&
    (order as any).payment_status === "captured" &&
    (order as any).refund_status !== "processed" &&
    (order as any).refund_status !== "refunded";

  let updateOrderResult = await adminClient
    .from("orders")
    .update({
      status: parsed.data.status,
      refund_status:
        parsed.data.status === "refunded"
          ? "processed"
          : shouldMarkRefundPending
          ? "pending"
          : (order as any).refund_status ?? "none",
      cancel_status:
        parsed.data.status === "cancelled"
          ? parsed.data.cancel_status ?? (order as any).cancel_status ?? "processed"
          : parsed.data.status === "refunded"
          ? (order as any).cancel_status ?? "none"
          : "none",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select("id,status,cancel_status")
    .maybeSingle();
  if (updateOrderResult.error && String(updateOrderResult.error.message ?? "").toLowerCase().includes("cancel_status")) {
    updateOrderResult = await adminClient
      .from("orders")
      .update({
        status: parsed.data.status,
        refund_status:
          parsed.data.status === "refunded"
            ? "processed"
            : shouldMarkRefundPending
            ? "pending"
            : (order as any).refund_status ?? "none",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("id,status")
      .maybeSingle();
  }
  const { data: updatedOrder, error: updateError } = updateOrderResult;
  if (updateError) return sendError(res, 400, updateError.message || "Could not update order status");
  if (!updatedOrder) return sendError(res, 404, "Order not found while updating status");

  let shiprocketSync: { attempted: boolean; success: boolean; reason?: string } = { attempted: false, success: false };

  // Keep shipment-based tracking UI in sync with manual order status changes.
  const normalizedStatus = toTrackingStatus(parsed.data.status);
  const { error: shipmentSyncError } = await adminClient
    .from("shipments")
    .update({
      normalized_status: normalizedStatus,
      carrier_status: parsed.data.status,
      last_event_at: new Date().toISOString(),
    })
    .eq("order_id", orderId);
  if (shipmentSyncError) {
    return sendError(res, 400, shipmentSyncError.message || "Order updated but shipment status sync failed");
  }

  if ((parsed.data.status === "confirmed" || parsed.data.status === "shipped") && order.status !== parsed.data.status) {
    const shippingAddress = ((order as any).shipping_address ?? {}) as Record<string, unknown>;
    const deliveryLane = String(shippingAddress.deliveryLane ?? "").toLowerCase();
    const royalPriorityDelivery =
      shippingAddress.royalPriorityDelivery === true || String(shippingAddress.royalPriorityDelivery) === "true";
    const isPriority = deliveryLane === "priority" || royalPriorityDelivery;

    shiprocketSync.attempted = true;
    const rollbackOrderStatus = order.status as
      | "pending"
      | "confirmed"
      | "shipped"
      | "delivered"
      | "cancelled"
      | "refunded";
    const rollbackTrackingStatus = toTrackingStatus(rollbackOrderStatus);
    try {
      const existingShipment = await adminClient
        .from("shipments")
        .select("id,tracking_number")
        .eq("order_id", orderId)
        .maybeSingle();
      if (!existingShipment.error && existingShipment.data?.tracking_number) {
        shiprocketSync = { attempted: true, success: true };
      } else {
      const itemsRes = await adminClient
        .from("order_items")
        .select("title_snapshot,quantity,price_inr,product_id")
        .eq("order_id", orderId)
        .limit(20);

      const items = (itemsRes.data ?? []).map((row: any, index: number) => ({
        title: String(row.title_snapshot ?? `Item ${index + 1}`),
        quantity: Math.max(1, Number(row.quantity ?? 1)),
        priceInr: Math.max(0, Number(row.price_inr ?? 0)),
        sku: row.product_id ? String(row.product_id).slice(0, 20) : null,
      }));

      const sr = await createShiprocketForwardOrder({
        orderId,
        orderNumber: String((order as any).order_number ?? orderId.slice(0, 8).toUpperCase()),
        totalInr: Math.max(0, Number((order as any).total_inr ?? 0)),
        paymentProvider: (order as any).payment_provider ?? null,
        shippingAddress,
        items,
        priorityDelivery: isPriority,
      });

      const etaDate = new Date(Date.now() + (isPriority ? 3 : 7) * 24 * 60 * 60 * 1000).toISOString();

      await adminClient.from("shipments").upsert(
        {
          order_id: orderId,
          carrier_name: sr.carrierName || "Shiprocket",
          tracking_number: sr.trackingNumber || sr.awbNumber || sr.shipmentId,
          awb_number: sr.awbNumber || null,
          carrier_status: parsed.data.status,
          normalized_status: parsed.data.status === "confirmed" ? "packed" : "shipped",
          eta: etaDate,
          tracking_url: sr.trackingUrl || null,
          last_event_at: new Date().toISOString(),
        },
        { onConflict: "order_id" }
      );

      await adminClient.from("payments_audit").insert({
        order_id: orderId,
        event_type: parsed.data.status === "confirmed" ? "shiprocket_forward_order_confirmed" : "shiprocket_forward_order_created",
        provider_payload: {
          shiprocket_order_id: sr.shiprocketOrderId || null,
          shipment_id: sr.shipmentId || null,
          awb_number: sr.awbNumber || null,
          tracking_number: sr.trackingNumber || null,
          tracking_url: sr.trackingUrl || null,
          priority_delivery: isPriority,
        },
      });
      shiprocketSync = { attempted: true, success: true };
      }
    } catch (shiprocketError) {
      const reason = shiprocketError instanceof Error ? shiprocketError.message : "Shiprocket create failed";
      await adminClient.from("payments_audit").insert({
        order_id: orderId,
        event_type: "shiprocket_forward_order_failed",
        provider_payload: { reason },
      });
      shiprocketSync = { attempted: true, success: false, reason };

      // Do not keep order in shipped state if Shiprocket forward order creation fails.
      await adminClient
        .from("orders")
        .update({ status: rollbackOrderStatus, updated_at: new Date().toISOString() })
        .eq("id", orderId);

      await adminClient
        .from("shipments")
        .update({
          normalized_status: rollbackTrackingStatus,
          carrier_status: rollbackOrderStatus,
          last_event_at: new Date().toISOString(),
        })
        .eq("order_id", orderId);

      return sendError(res, 400, `Shiprocket sync failed: ${reason}`);
    }
  }

  if (order.status !== "cancelled" && parsed.data.status === "cancelled") {
    await releaseReservationByOrderId(orderId, "admin_cancelled_order");
    const shouldRestoreCommittedInventory =
      (order as any).payment_provider === "cod" || (order as any).payment_status === "captured";
    if (shouldRestoreCommittedInventory) {
      try {
        await restoreOrderInventory(orderId);
        await adminClient.from("payments_audit").insert({
          order_id: orderId,
          event_type: "inventory_restored_on_cancel",
          provider_payload: {
            source: "admin",
            reason: parsed.data.reason ?? null,
          },
        });
      } catch (inventoryError) {
        const message =
          inventoryError instanceof Error ? inventoryError.message : "Order cancelled but inventory restore failed";
        return sendError(res, 400, message);
      }
    }
  }

  const { data: user } = await adminClient
    .from("users")
    .select("email")
    .eq("id", (await adminClient.from("orders").select("user_id").eq("id", orderId).single()).data?.user_id ?? "")
    .maybeSingle();

  if (user?.email && ["shipped", "delivered", "cancelled", "refunded"].includes(parsed.data.status)) {
    if (parsed.data.status === "shipped") {
      await sendOrderShipped({ to: user.email, orderId });
    } else if (parsed.data.status === "refunded") {
      await sendRefundInitiated({
        to: user.email,
        orderId,
        reason: parsed.data.reason,
      });
    } else {
      await sendOrderEmail(
        user.email,
        `Order ${parsed.data.status.toUpperCase()} - ZARELON`,
        `Your order is now ${parsed.data.status}`,
        { "Order ID": orderId, Status: parsed.data.status }
      );
    }
  }

  if (parsed.data.status === "delivered") {
    await processReferralRewardsForOrder(orderId);
  }

  await adminClient.from("admin_audit_logs").insert({
    admin_user_id: admin.id,
    action: "order_status_update",
    entity_type: "orders",
    entity_id: orderId,
    diff: { from: order.status, to: parsed.data.status, reason: parsed.data.reason ?? null },
  });

  res.status(200).json({
    success: true,
    status: parsed.data.status,
    cancel_status:
      parsed.data.status === "cancelled"
        ? parsed.data.cancel_status ?? (updatedOrder as any)?.cancel_status ?? (order as any).cancel_status ?? "processed"
        : parsed.data.status === "refunded"
        ? (updatedOrder as any)?.cancel_status ?? (order as any).cancel_status ?? "none"
        : "none",
    shiprocket_sync: shiprocketSync,
  });
}

