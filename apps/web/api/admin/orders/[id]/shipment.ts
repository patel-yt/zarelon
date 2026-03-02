import type { ApiRequest, ApiResponse } from "../../../_lib/http.js";
import { z } from "zod";
import { adminClient, getServerConfigError, requirePermission, sendError } from "../../../_lib/server.js";
import { mapTrackingToOrderStatus, normalizeTrackingStatus } from "../../../_lib/shipping.js";
import { fetchShiprocketTracking } from "../../../_lib/shiprocket.js";

const optionalText = z
  .union([z.string(), z.literal("")])
  .optional()
  .transform((value) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized.length ? normalized : undefined;
  });

const optionalUrl = z
  .union([z.string().url(), z.literal("")])
  .optional()
  .transform((value) => (value && value.trim() ? value : undefined));

const optionalDate = z
  .union([z.string().datetime(), z.literal("")])
  .optional()
  .transform((value) => (value && value.trim() ? value : undefined));

const bodySchema = z.object({
  carrier_name: z.string().trim().min(2),
  tracking_number: z.string().trim().min(4),
  awb_number: optionalText,
  carrier_status: optionalText,
  normalized_status: z
    .enum(["placed", "packed", "shipped", "out_for_delivery", "delivered", "failed", "rto"])
    .optional(),
  eta: optionalDate,
  tracking_url: optionalUrl,
  location: optionalText,
});

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);

  try {
    const admin = await requirePermission(req, "can_manage_orders");
    if (!admin) return sendError(res, 403, "Permission denied");

    const orderId = req.query.id;
    const normalizedOrderId = Array.isArray(orderId) ? orderId[0] : orderId;
    if (!normalizedOrderId) return sendError(res, 400, "Order id is required");

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid payload");

    const payload = parsed.data;
    const isShiprocketCarrier = /shiprocket/i.test(payload.carrier_name);
    const shiprocketData = isShiprocketCarrier ? await fetchShiprocketTracking(payload.tracking_number) : null;

    const normalizedStatus =
      shiprocketData?.normalizedStatus ??
      payload.normalized_status ??
      normalizeTrackingStatus(payload.carrier_status ?? "shipped");
    const carrierStatus = shiprocketData?.carrierStatus ?? payload.carrier_status ?? normalizedStatus;
    const location = shiprocketData?.location ?? payload.location ?? null;
    const eta = shiprocketData?.eta ?? payload.eta ?? null;
    const trackingUrl = shiprocketData?.trackingUrl ?? payload.tracking_url ?? null;
    const awbNumber = shiprocketData?.awbNumber ?? payload.awb_number ?? null;
    const carrierName = shiprocketData?.carrierName ?? payload.carrier_name;
    const eventTime = shiprocketData?.eventTime ?? new Date().toISOString();

    const { data: shipment, error: shipmentError } = await adminClient
      .from("shipments")
      .upsert(
        {
          order_id: normalizedOrderId,
          carrier_name: carrierName,
          tracking_number: payload.tracking_number,
          awb_number: awbNumber,
          carrier_status: carrierStatus,
          normalized_status: normalizedStatus,
          eta,
          tracking_url: trackingUrl,
          last_event_at: eventTime,
        },
        { onConflict: "order_id" }
      )
      .select("id")
      .single();

    if (shipmentError || !shipment) return sendError(res, 400, shipmentError?.message ?? "Could not save shipment");

    const { error: eventError } = await adminClient.from("shipment_events").insert({
      shipment_id: shipment.id,
      raw_status: carrierStatus,
      normalized_status: normalizedStatus,
      location,
      raw_payload: {
        ...payload,
        shiprocketSynced: Boolean(shiprocketData),
      },
      event_time: eventTime,
    });
    if (eventError) return sendError(res, 400, eventError.message || "Could not save shipment event");

    const mappedOrderStatus = mapTrackingToOrderStatus(normalizedStatus);
    const { data: updatedOrder, error: orderUpdateError } = await adminClient
      .from("orders")
      .update({ status: mappedOrderStatus, updated_at: new Date().toISOString() })
      .eq("id", normalizedOrderId)
      .select("id,status")
      .maybeSingle();
    if (orderUpdateError) return sendError(res, 400, orderUpdateError.message || "Could not sync order status");
    if (!updatedOrder) return sendError(res, 404, "Order not found while syncing status");

    res.status(200).json({
      success: true,
      normalized_status: normalizedStatus,
      order_status: mappedOrderStatus,
      source: shiprocketData ? "shiprocket" : "manual",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shipment update failed";
    return sendError(res, 500, message);
  }
}
