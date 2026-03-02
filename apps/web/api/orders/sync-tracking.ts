import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import { adminClient, getServerConfigError, requireUser, sendError } from "../_lib/server.js";
import { fetchShiprocketTracking } from "../_lib/shiprocket.js";
import { mapTrackingToOrderStatus, normalizeTrackingStatus } from "../_lib/shipping.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const serverConfigError = getServerConfigError();
  if (serverConfigError) return sendError(res, 500, serverConfigError);

  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");

  const ordersRes = await adminClient
    .from("orders")
    .select(
      "id,status,shipments(id,carrier_name,tracking_number,carrier_status,normalized_status,last_event_at)"
    )
    .eq("user_id", user.id)
    .in("status", ["confirmed", "shipped", "delivered"])
    .order("created_at", { ascending: false })
    .limit(25);
  if (ordersRes.error) return sendError(res, 400, ordersRes.error.message || "Could not load orders");

  const orders = (ordersRes.data ?? []) as Array<{
    id: string;
    status: string;
    shipments?: Array<{
      id: string;
      carrier_name: string | null;
      tracking_number: string | null;
      carrier_status: string | null;
      normalized_status: string | null;
      last_event_at: string | null;
    }>;
  }>;

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of orders) {
    const shipment = order.shipments?.[0];
    if (!shipment) {
      skipped += 1;
      continue;
    }
    const carrier = String(shipment.carrier_name ?? "").toLowerCase();
    const trackingNumber = String(shipment.tracking_number ?? "").trim();
    if (!trackingNumber || !carrier.includes("shiprocket")) {
      skipped += 1;
      continue;
    }

    try {
      const live = await fetchShiprocketTracking(trackingNumber);
      if (!live) {
        skipped += 1;
        continue;
      }

      const normalizedStatus = normalizeTrackingStatus(live.carrierStatus ?? String(live.normalizedStatus ?? "shipped"));
      const mappedOrderStatus = mapTrackingToOrderStatus(normalizedStatus);
      const lastTs = shipment.last_event_at ? new Date(shipment.last_event_at).getTime() : 0;
      const nextTs = live.eventTime ? new Date(live.eventTime).getTime() : Date.now();
      const unchanged =
        String(shipment.carrier_status ?? "") === String(live.carrierStatus ?? "") &&
        String(shipment.normalized_status ?? "") === String(normalizedStatus) &&
        nextTs <= lastTs &&
        order.status === mappedOrderStatus;
      if (unchanged) {
        skipped += 1;
        continue;
      }

      const updateShipment = await adminClient
        .from("shipments")
        .update({
          carrier_name: live.carrierName ?? shipment.carrier_name ?? "Shiprocket",
          carrier_status: live.carrierStatus ?? String(normalizedStatus),
          normalized_status: normalizedStatus,
          eta: live.eta ?? null,
          tracking_url: live.trackingUrl ?? null,
          awb_number: live.awbNumber ?? null,
          last_event_at: live.eventTime ?? new Date().toISOString(),
        })
        .eq("id", shipment.id);
      if (updateShipment.error) {
        failed += 1;
        continue;
      }

      await adminClient.from("shipment_events").insert({
        shipment_id: shipment.id,
        raw_status: live.carrierStatus ?? String(normalizedStatus),
        normalized_status: normalizedStatus,
        location: live.location ?? null,
        raw_payload: { source: "user_orders_sync", tracking_number: trackingNumber },
        event_time: live.eventTime ?? new Date().toISOString(),
      });

      if (order.status !== mappedOrderStatus) {
        await adminClient
          .from("orders")
          .update({ status: mappedOrderStatus, updated_at: new Date().toISOString() })
          .eq("id", order.id);
      }

      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return res.status(200).json({ ok: true, updated, skipped, failed });
}

