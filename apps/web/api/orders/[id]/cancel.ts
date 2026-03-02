import type { ApiRequest, ApiResponse } from "../../_lib/http.js";
import { adminClient, getServerConfigError, requireUser, sendError } from "../../_lib/server.js";
import { z } from "zod";
import { restoreOrderInventory } from "../../_lib/inventory.js";
import { releaseReservationByOrderId } from "../../_lib/inventoryIntelligence.js";
import { enforceRateLimit } from "../../_lib/rateLimit.js";

const CUSTOMER_CANCELLABLE_STATUSES = new Set(["pending", "confirmed"]);
const bodySchema = z.object({
  reason: z.string().trim().min(2).max(500).optional(),
});

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);

  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const requestIp =
    (Array.isArray(req.headers["x-forwarded-for"]) ? req.headers["x-forwarded-for"][0] : req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? null;

  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid cancellation reason");
  const rate = await enforceRateLimit({
    eventType: "order_cancel_attempt",
    maxHits: 8,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: requestIp,
  });
  if (!rate.allowed) return sendError(res, 429, "Too many cancellation attempts. Please retry later.");

  const orderId = req.query.id;
  const normalizedOrderId = Array.isArray(orderId) ? orderId[0] : orderId;
  if (!normalizedOrderId) return sendError(res, 400, "Order id is required");

  let orderQuery = await adminClient
    .from("orders")
    .select("id,user_id,status,cancel_status,payment_status,payment_provider")
    .eq("id", normalizedOrderId)
    .maybeSingle();
  if (orderQuery.error && String(orderQuery.error.message ?? "").toLowerCase().includes("cancel_status")) {
    orderQuery = await adminClient
      .from("orders")
      .select("id,user_id,status,payment_status,payment_provider")
      .eq("id", normalizedOrderId)
      .maybeSingle();
  }
  const { data: order, error: orderError } = orderQuery;

  if (orderError) return sendError(res, 400, orderError.message || "Could not load order");
  if (!order) return sendError(res, 404, "Order not found");
  if (order.user_id !== user.id) return sendError(res, 403, "You can cancel only your own order");
  if (order.status === "cancelled") return res.status(200).json({ success: true, status: "cancelled" });
  if (!CUSTOMER_CANCELLABLE_STATUSES.has(order.status)) {
    return sendError(res, 400, `Order cannot be cancelled in '${order.status}' state`);
  }

  const nowIso = new Date().toISOString();
  let updateResult = await adminClient
    .from("orders")
    .update({ status: "cancelled", cancel_status: "requested", updated_at: nowIso })
    .eq("id", normalizedOrderId)
    .eq("user_id", user.id)
    .select("id,status,cancel_status")
    .maybeSingle();
  if (updateResult.error && String(updateResult.error.message ?? "").toLowerCase().includes("cancel_status")) {
    updateResult = await adminClient
      .from("orders")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("id", normalizedOrderId)
      .eq("user_id", user.id)
      .select("id,status")
      .maybeSingle();
  }
  const { data: updatedOrder, error: updateError } = updateResult;

  if (updateError) return sendError(res, 400, updateError.message || "Could not cancel order");
  if (!updatedOrder) return sendError(res, 404, "Order not found while cancelling");

  await releaseReservationByOrderId(normalizedOrderId, "customer_cancelled_order");
  const shouldRestoreCommittedInventory =
    (order as any).payment_provider === "cod" || (order as any).payment_status === "captured";

  if (shouldRestoreCommittedInventory) {
    try {
      await restoreOrderInventory(normalizedOrderId);
    } catch (inventoryError) {
      const message =
        inventoryError instanceof Error ? inventoryError.message : "Order cancelled but inventory restore failed";
      return sendError(res, 400, message);
    }
  }

  await adminClient.from("payments_audit").insert({
    order_id: normalizedOrderId,
    event_type: "order_cancelled_by_customer",
    provider_payload: {
      reason: parsed.data.reason ?? null,
      user_id: user.id,
    },
  });

  const { data: shipment } = await adminClient
    .from("shipments")
    .select("id")
    .eq("order_id", normalizedOrderId)
    .maybeSingle();

  if (shipment?.id) {
    await adminClient
      .from("shipments")
      .update({
        normalized_status: "failed",
        carrier_status: "cancelled",
        last_event_at: nowIso,
      })
      .eq("id", shipment.id);

    await adminClient.from("shipment_events").insert({
      shipment_id: shipment.id,
      raw_status: "cancelled_by_customer",
      normalized_status: "failed",
      location: null,
      raw_payload: { source: "customer_cancel" },
      event_time: nowIso,
    });
  }

  res.status(200).json({
    success: true,
    status: "cancelled",
    cancel_status: (updatedOrder as any)?.cancel_status ?? "requested",
  });
}
