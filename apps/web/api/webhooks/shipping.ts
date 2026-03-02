import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_lib/email.js";
import { handleReturnPickupWebhook } from "../_lib/returns.js";
import { fetchShiprocketTracking } from "../_lib/shiprocket.js";

declare const process: {
  env: Record<string, string | undefined>;
};

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => void;
};

const serverEnv = {
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  shippingWebhookSecret: process.env.SHIPPING_WEBHOOK_SECRET ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  automationCronSecret: process.env.AUTOMATION_CRON_SECRET ?? "",
};

const adminClient = createClient(
  serverEnv.supabaseUrl || "https://placeholder.supabase.co",
  serverEnv.serviceRoleKey || "service-role-key-placeholder",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

type TrackingStatus =
  | "placed"
  | "packed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "failed"
  | "rto";

const normalizeTrackingStatus = (rawStatus: string): TrackingStatus => {
  const key = rawStatus.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const statusMap: Record<string, TrackingStatus> = {
    created: "placed",
    placed: "placed",
    packed: "packed",
    in_transit: "shipped",
    shipped: "shipped",
    out_for_delivery: "out_for_delivery",
    ofd: "out_for_delivery",
    delivered: "delivered",
    failed: "failed",
    undelivered: "failed",
    rto: "rto",
    return_to_origin: "rto",
  };
  return statusMap[key] ?? "shipped";
};

const mapTrackingToOrderStatus = (
  status: TrackingStatus
): "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" => {
  switch (status) {
    case "placed":
      return "pending";
    case "packed":
      return "confirmed";
    case "shipped":
    case "out_for_delivery":
      return "shipped";
    case "delivered":
      return "delivered";
    case "failed":
    case "rto":
      return "cancelled";
    default:
      return "confirmed";
  }
};

const asRecord = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

const pickString = (obj: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const runAbandonedCartSweep = async () => {
  if (!serverEnv.resendApiKey) {
    return { ok: true, skipped: true, reason: "resend_not_configured", firstSent: 0, secondSent: 0 };
  }

  const settings = await adminClient
    .from("platform_settings")
    .select("abandoned_cart_first_minutes,abandoned_cart_second_hours")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const firstMinutes = settings.data?.abandoned_cart_first_minutes ?? 60;
  const secondHours = settings.data?.abandoned_cart_second_hours ?? 24;

  const cartsRes = await adminClient
    .from("carts")
    .select("id,user_id,updated_at,cart_items(id,quantity,product:products(title,price_inr))")
    .limit(300);
  if (cartsRes.error) throw new Error(cartsRes.error.message || "Could not load carts");

  const carts = (cartsRes.data ?? []).filter((cart: any) => (cart.cart_items ?? []).length > 0);
  if (!carts.length) return { ok: true, firstSent: 0, secondSent: 0 };

  const userIds = Array.from(new Set(carts.map((c: any) => c.user_id)));
  const usersRes = await adminClient.from("users").select("id,email,name").in("id", userIds);
  if (usersRes.error) throw new Error(usersRes.error.message || "Could not load users");
  const userMap = new Map((usersRes.data ?? []).map((u: any) => [u.id, u]));

  const cartIds = carts.map((c: any) => c.id);
  const remindersRes = await adminClient
    .from("abandoned_cart_reminders")
    .select("id,cart_id,first_reminder_sent_at,second_reminder_sent_at,coupon_code")
    .in("cart_id", cartIds);
  if (remindersRes.error) throw new Error(remindersRes.error.message || "Could not load reminder state");
  const reminderMap = new Map((remindersRes.data ?? []).map((r: any) => [r.cart_id, r]));

  const now = Date.now();
  let firstSent = 0;
  let secondSent = 0;

  for (const cart of carts) {
    const user = userMap.get(cart.user_id);
    if (!user?.email) continue;

    const cartUpdatedAt = new Date(cart.updated_at).getTime();
    const elapsedMinutes = (now - cartUpdatedAt) / (60 * 1000);

    const hasRecentOrder = await adminClient
      .from("orders")
      .select("id")
      .eq("user_id", cart.user_id)
      .gte("created_at", cart.updated_at)
      .limit(1)
      .maybeSingle();
    if (hasRecentOrder.data?.id) continue;

    const reminder = reminderMap.get(cart.id);
    const lines = (cart.cart_items ?? []).slice(0, 4).map((item: any) => {
      const product = Array.isArray(item.product) ? item.product[0] : item.product;
      return `${product?.title ?? "Product"} x${item.quantity}`;
    });

    if (!reminder?.first_reminder_sent_at && elapsedMinutes >= firstMinutes) {
      await sendEmail({
        to: user.email,
        subject: "Your ZARELON cart is waiting",
        html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">Complete your order</h2><p>You left premium picks in your cart:</p><p>${lines.join("<br/>")}</p><p style="margin-top:16px">Resume checkout from your account.</p></div>`,
        dedupeKey: `abandoned-cart:first:${cart.id}:${user.email}`,
      });
      firstSent += 1;

      await adminClient
        .from("abandoned_cart_reminders")
        .upsert(
          {
            cart_id: cart.id,
            user_id: cart.user_id,
            first_reminder_sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "cart_id" }
        );
      continue;
    }

    const firstSentAt = reminder?.first_reminder_sent_at ? new Date(reminder.first_reminder_sent_at).getTime() : null;
    if (firstSentAt && !reminder.second_reminder_sent_at && now - firstSentAt >= secondHours * 60 * 60 * 1000) {
      const coupon = reminder.coupon_code || `ZAR10-${cart.id.slice(0, 6).toUpperCase()}`;

      await sendEmail({
        to: user.email,
        subject: "Final reminder: your cart + exclusive incentive",
        html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">Complete your order</h2><p>Your curated cart is still available.</p><p>Use coupon <strong>${coupon}</strong> on your next checkout.</p></div>`,
        dedupeKey: `abandoned-cart:second:${cart.id}:${user.email}`,
      });
      secondSent += 1;

      await adminClient
        .from("abandoned_cart_reminders")
        .upsert(
          {
            cart_id: cart.id,
            user_id: cart.user_id,
            coupon_code: coupon,
            second_reminder_sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "cart_id" }
        );
    }
  }

  return { ok: true, firstSent, secondSent };
};

const runShiprocketTrackingSync = async () => {
  const rowsRes = await adminClient
    .from("shipments")
    .select("id,order_id,carrier_name,tracking_number,carrier_status,normalized_status,last_event_at")
    .ilike("carrier_name", "%shiprocket%")
    .limit(200);

  if (rowsRes.error) throw new Error(rowsRes.error.message || "Could not load shipments for Shiprocket sync");

  const rows = (rowsRes.data ?? []) as Array<{
    id: string;
    order_id: string;
    carrier_name: string | null;
    tracking_number: string | null;
    carrier_status: string | null;
    normalized_status: TrackingStatus | null;
    last_event_at: string | null;
  }>;

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const trackingNumber = String(row.tracking_number ?? "").trim();
    if (!trackingNumber) {
      skipped += 1;
      continue;
    }

    try {
      const live = await fetchShiprocketTracking(trackingNumber);
      if (!live) {
        skipped += 1;
        continue;
      }

      const lastTs = row.last_event_at ? new Date(row.last_event_at).getTime() : 0;
      const nextTs = live.eventTime ? new Date(live.eventTime).getTime() : Date.now();
      const unchanged =
        String(row.carrier_status ?? "") === String(live.carrierStatus ?? "") &&
        String(row.normalized_status ?? "") === String(live.normalizedStatus ?? "") &&
        nextTs <= lastTs;
      if (unchanged) {
        skipped += 1;
        continue;
      }

      const normalizedStatus = normalizeTrackingStatus(live.carrierStatus ?? String(live.normalizedStatus ?? "shipped"));
      const mappedOrderStatus = mapTrackingToOrderStatus(normalizedStatus);

      const updateShipment = await adminClient
        .from("shipments")
        .update({
          carrier_name: live.carrierName ?? row.carrier_name ?? "Shiprocket",
          carrier_status: live.carrierStatus ?? String(normalizedStatus),
          normalized_status: normalizedStatus,
          eta: live.eta ?? null,
          tracking_url: live.trackingUrl ?? null,
          awb_number: live.awbNumber ?? null,
          last_event_at: live.eventTime ?? new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updateShipment.error) throw new Error(updateShipment.error.message || "Could not update shipment");

      await adminClient.from("shipment_events").insert({
        shipment_id: row.id,
        raw_status: live.carrierStatus ?? String(normalizedStatus),
        normalized_status: normalizedStatus,
        location: live.location ?? null,
        raw_payload: { source: "shiprocket_sync_job", tracking_number: trackingNumber },
        event_time: live.eventTime ?? new Date().toISOString(),
      });

      await adminClient
        .from("orders")
        .update({ status: mappedOrderStatus, updated_at: new Date().toISOString() })
        .eq("id", row.order_id);

      updated += 1;
    } catch {
      failed += 1;
    }
  }

  return { ok: true, total: rows.length, updated, skipped, failed };
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    const task = Array.isArray(req.query?.task) ? req.query?.task[0] : req.query?.task;
    const token = Array.isArray(req.query?.token) ? req.query?.token[0] : req.query?.token;

    if (task === "abandoned-carts") {
      if (token !== serverEnv.automationCronSecret) {
        res.status(401).json({ error: "Unauthorized cron request" });
        return;
      }
      try {
        await runAbandonedCartSweep();
        res.status(200).json({ success: true, job: "abandoned-carts" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "abandoned_cart_sweep_failed";
        res.status(500).json({ success: false, error: message });
      }
      return;
    }

    if (task === "sync-shiprocket") {
      if (token !== serverEnv.automationCronSecret) {
        res.status(401).json({ error: "Unauthorized cron request" });
        return;
      }
      try {
        const result = await runShiprocketTrackingSync();
        res.status(200).json({ success: true, job: "sync-shiprocket", ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "shiprocket_sync_failed";
        res.status(500).json({ success: false, error: message });
      }
      return;
    }

    res.status(200).json({ ok: true, webhook: "shiprocket" });
    return;
  }

  if (req.method !== "POST") {
    res.status(200).json({ ok: true, accepted: false, reason: "unsupported_method" });
    return;
  }

  if (serverEnv.shippingWebhookSecret) {
    const expectedSecret = serverEnv.shippingWebhookSecret.trim();
    const h1 = req.headers["x-shipping-webhook-secret"];
    const h2 = req.headers["x-webhook-token"];
    const h3 = req.headers["x-api-key"];
    const authHeader = req.headers.authorization;
    const q = req.query?.token;
    const bearer = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const fromBearer = bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined;
    const token = Array.isArray(q) ? q[0] : q;
    const secretValue = [h1, h2, h3, fromBearer, token]
      .map((v) => (Array.isArray(v) ? v[0] : v))
      .find(Boolean)
      ?.trim();
    if (!secretValue || secretValue !== expectedSecret) {
      res.status(401).json({ ok: false, accepted: false, reason: "invalid_or_missing_secret" });
      return;
    }
  }

  const raw = asRecord(req.body);
  const returnHookResult = await handleReturnPickupWebhook(raw);
  if (returnHookResult.matched) {
    res.status(200).json({
      ok: true,
      accepted: true,
      webhook: "shiprocket_return",
      return_request_id: returnHookResult.returnRequestId,
      return_status: returnHookResult.mappedStatus,
    });
    return;
  }

  const statusRaw =
    pickString(raw, ["status", "current_status", "shipment_status", "tracking_status"]) ?? "shipped";
  const normalizedStatus = normalizeTrackingStatus(statusRaw);

  const eventTime = pickString(raw, ["event_time", "updated_at", "event_date", "scan_date"]);
  const carrierName = pickString(raw, ["carrier_name", "courier_name", "courier", "logistics_partner"]) ?? "Shiprocket";
  const trackingNumber =
    pickString(raw, ["tracking_number", "awb", "awb_number", "awb_code", "tracking_id"]) ?? "";
  const awbNumber = pickString(raw, ["awb_number", "awb", "awb_code"]);
  const location = pickString(raw, ["location", "current_location", "city", "hub"]);
  const trackingUrl = pickString(raw, ["tracking_url", "track_url", "shipment_track_url"]);
  const eta = pickString(raw, ["eta", "edd", "estimated_delivery_date"]);

  let orderId = pickString(raw, ["order_id", "merchant_order_id", "order_number", "reference_id"]);
  if (orderId && !isUuid(orderId)) {
    const { data: orderByNumber } = await adminClient
      .from("orders")
      .select("id")
      .eq("order_number", orderId)
      .maybeSingle();
    orderId = orderByNumber?.id ?? null;
  }

  if (!orderId || !trackingNumber) {
    res.status(200).json({ ok: true, accepted: false, reason: "insufficient_payload" });
    return;
  }

  const { data: shipment, error: shipmentError } = await adminClient
    .from("shipments")
    .upsert(
      {
        order_id: orderId,
        carrier_name: carrierName,
        tracking_number: trackingNumber,
        awb_number: awbNumber ?? null,
        carrier_status: statusRaw,
        normalized_status: normalizedStatus,
        eta: eta ?? null,
        tracking_url: trackingUrl ?? null,
        last_event_at: eventTime ?? new Date().toISOString(),
      },
      { onConflict: "order_id" }
    )
    .select("id")
    .single();

  if (shipmentError || !shipment) {
    res.status(200).json({ ok: true, accepted: false, reason: "shipment_upsert_failed" });
    return;
  }

  await adminClient.from("shipment_events").insert({
    shipment_id: shipment.id,
    raw_status: statusRaw,
    normalized_status: normalizedStatus,
    location: location ?? null,
    raw_payload: raw,
    event_time: eventTime ?? new Date().toISOString(),
  });

  const mappedOrderStatus = mapTrackingToOrderStatus(normalizedStatus);
  await adminClient
    .from("orders")
    .update({ status: mappedOrderStatus, updated_at: new Date().toISOString() })
    .eq("id", orderId);

  res.status(200).json({ ok: true, accepted: true, normalized_status: normalizedStatus, order_status: mappedOrderStatus });
}
