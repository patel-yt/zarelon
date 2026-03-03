import { normalizeTrackingStatus, type TrackingStatus } from "./shipping.js";
import { serverEnv } from "./server.js";

type ShiprocketAuthResponse = {
  token?: string;
};

type ShiprocketTrackResponse = {
  tracking_data?: {
    shipment_track_activities?: Array<{
      date?: string;
      activity?: string;
      location?: string;
      sr_status?: string;
      status?: string;
    }>;
    shipment_status?: string;
    shipment_status_label?: string;
    etd?: string;
    tracking_url?: string;
    awb_code?: string;
    courier_name?: string;
  };
};

type ShiprocketCreateOrderResponse = {
  order_id?: string | number;
  shipment_id?: string | number;
  awb_code?: string;
  tracking_number?: string;
  tracking_url?: string;
  courier_name?: string;
  channel_order_id?: string;
  message?: string;
  status?: boolean | number | string;
  data?: Record<string, unknown>;
  errors?: unknown;
};

type ShiprocketPickupLocation = {
  pickup_location?: string;
  status?: number;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const hasShiprocketConfig = () => Boolean(serverEnv.shiprocketEmail && serverEnv.shiprocketPassword);

const isTokenValid = () => Boolean(cachedToken && cachedToken.expiresAt > Date.now() + 10_000);

const parseDate = (value?: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const safeJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const toCleanString = (value: unknown): string => {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  if (["null", "undefined", "na", "n/a"].includes(text.toLowerCase())) return "";
  return text;
};

const pickString = (input: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = toCleanString(input[key]);
    if (value) return value;
  }
  return "";
};

export const getShiprocketToken = async (): Promise<string | null> => {
  if (!hasShiprocketConfig()) return null;
  if (isTokenValid() && cachedToken) return cachedToken.value;

  const response = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: serverEnv.shiprocketEmail,
      password: serverEnv.shiprocketPassword,
    }),
  });

  if (!response.ok) {
    throw new Error("Shiprocket auth failed");
  }

  const data = (await response.json()) as ShiprocketAuthResponse;
  if (!data.token) throw new Error("Shiprocket token missing");

  cachedToken = {
    value: data.token,
    expiresAt: Date.now() + 8 * 60 * 1000,
  };
  return data.token;
};

const getLatestActivity = (
  activities: NonNullable<ShiprocketTrackResponse["tracking_data"]>["shipment_track_activities"] | undefined
) => {
  if (!activities?.length) return null;
  return [...activities]
    .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
    .find((item) => item.activity || item.status || item.sr_status);
};

export const fetchShiprocketTracking = async (trackingNumber: string) => {
  const token = await getShiprocketToken();
  if (!token) return null;

  const url = `${SHIPROCKET_BASE}/courier/track/awb/${encodeURIComponent(trackingNumber)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
    }
    throw new Error("Shiprocket tracking fetch failed");
  }

  const data = (await response.json()) as ShiprocketTrackResponse;
  const tracking = data.tracking_data;
  if (!tracking) return null;

  const latest = getLatestActivity(tracking.shipment_track_activities);
  const rawStatus =
    latest?.activity ||
    latest?.status ||
    latest?.sr_status ||
    tracking.shipment_status_label ||
    tracking.shipment_status ||
    "shipped";

  const normalizedStatus = normalizeTrackingStatus(rawStatus);
  return {
    normalizedStatus: normalizedStatus as TrackingStatus,
    carrierStatus: rawStatus,
    location: latest?.location ?? undefined,
    eventTime: parseDate(latest?.date) ?? new Date().toISOString(),
    eta: parseDate(tracking.etd) ?? undefined,
    trackingUrl: tracking.tracking_url ?? undefined,
    awbNumber: tracking.awb_code ?? undefined,
    carrierName: tracking.courier_name ?? undefined,
    source: "shiprocket" as const,
  };
};

type CreateShiprocketForwardOrderInput = {
  orderId: string;
  orderNumber: string;
  totalInr: number;
  paymentProvider: string | null | undefined;
  shippingAddress: Record<string, unknown>;
  items: Array<{
    title: string;
    quantity: number;
    priceInr: number;
    sku?: string | null;
  }>;
  priorityDelivery: boolean;
};

export const createShiprocketForwardOrder = async (input: CreateShiprocketForwardOrderInput) => {
  const token = await getShiprocketToken();
  if (!token) throw new Error("Shiprocket credentials missing");

  const address = input.shippingAddress ?? {};
  const fullName = String(address.fullName ?? address.full_name ?? "Customer").trim() || "Customer";
  const line1 = String(address.line1 ?? "").trim();
  const line2 = String(address.line2 ?? "").trim();
  const city = String(address.city ?? "").trim();
  const state = String(address.state ?? "").trim();
  const country = String(address.country ?? "India").trim() || "India";
  const postalCode = String(address.postalCode ?? address.postal_code ?? "").trim();
  const phone = String(address.phone ?? "").trim();

  const now = new Date();
  const orderDate = now.toISOString().slice(0, 19).replace("T", " ");
  const pickupLocation = (process.env.SHIPROCKET_PICKUP_LOCATION ?? "Primary").trim() || "Primary";
  const subTotal = Math.max(1, Number((input.totalInr / 100).toFixed(2)));
  const paymentMethod = String(input.paymentProvider ?? "").toLowerCase() === "cod" ? "COD" : "Prepaid";

  const shiprocketItems = input.items.slice(0, 20).map((item, index) => ({
    name: item.title || `Item ${index + 1}`,
    sku: (item.sku ?? `SKU-${input.orderId.slice(0, 8)}-${index + 1}`).slice(0, 50),
    units: Math.max(1, Number(item.quantity ?? 1)),
    selling_price: Number((Math.max(0, Number(item.priceInr ?? 0)) / 100).toFixed(2)),
    discount: "",
    tax: "",
    hsn: 111111,
  }));

  const buildPayload = (pickupLocation: string) => ({
    order_id: input.orderNumber || `ORD-${input.orderId.slice(0, 8).toUpperCase()}`,
    order_date: orderDate,
    pickup_location: pickupLocation,
    channel_id: "",
    comment: input.priorityDelivery ? "Royal priority fast delivery" : "Standard delivery order",
    billing_customer_name: fullName,
    billing_last_name: "",
    billing_address: line1 || "Address line 1",
    billing_address_2: line2,
    billing_city: city || "City",
    billing_pincode: postalCode || "000000",
    billing_state: state || "State",
    billing_country: country,
    billing_email: "orders@zarelon.com",
    billing_phone: phone || "9999999999",
    shipping_is_billing: true,
    shipping_customer_name: fullName,
    shipping_last_name: "",
    shipping_address: line1 || "Address line 1",
    shipping_address_2: line2,
    shipping_city: city || "City",
    shipping_pincode: postalCode || "000000",
    shipping_country: country,
    shipping_state: state || "State",
    shipping_email: "orders@zarelon.com",
    shipping_phone: phone || "9999999999",
    order_items: shiprocketItems.length
      ? shiprocketItems
      : [{ name: "Order Item", sku: `SKU-${input.orderId.slice(0, 8)}`, units: 1, selling_price: subTotal, discount: "", tax: "", hsn: 111111 }],
    payment_method: paymentMethod,
    shipping_charges: 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: subTotal,
    length: 10,
    breadth: 10,
    height: 10,
    weight: 0.7,
  });

  const callCreateOrder = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${SHIPROCKET_BASE}/orders/create/adhoc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = (await safeJson(response)) as ShiprocketCreateOrderResponse;
    return { response, json };
  };

  let payload = buildPayload(pickupLocation);
  let { response, json } = await callCreateOrder(payload);
  const message = toCleanString((json as unknown as Record<string, unknown>).message);
  if (response.ok && /wrong pickup location/i.test(message)) {
    const root = json as unknown as Record<string, unknown>;
    const dataNode =
      root.data && typeof root.data === "object" && !Array.isArray(root.data) ? (root.data as Record<string, unknown>) : {};
    const list = Array.isArray(dataNode.data) ? (dataNode.data as ShiprocketPickupLocation[]) : [];
    const activePickup = list.find((item) => Number(item.status ?? 0) === 1 && toCleanString(item.pickup_location));
    if (activePickup?.pickup_location) {
      payload = buildPayload(String(activePickup.pickup_location));
      const retry = await callCreateOrder(payload);
      response = retry.response;
      json = retry.json;
    }
  }

  if (!response.ok) {
    const reason = typeof json.message === "string" ? json.message : "Shiprocket create order failed";
    throw new Error(reason);
  }

  const root = json as unknown as Record<string, unknown>;
  const nestedData =
    root.data && typeof root.data === "object" && !Array.isArray(root.data) ? (root.data as Record<string, unknown>) : {};
  const shiprocketOrderId = pickString(root, ["order_id", "channel_order_id"]) || pickString(nestedData, ["order_id", "channel_order_id"]);
  const shipmentId = pickString(root, ["shipment_id"]) || pickString(nestedData, ["shipment_id"]);
  const awbNumber = pickString(root, ["awb_code", "tracking_number"]) || pickString(nestedData, ["awb_code", "tracking_number"]);
  const trackingNumber =
    pickString(root, ["tracking_number", "awb_code"]) || pickString(nestedData, ["tracking_number", "awb_code"]);
  const trackingUrl = pickString(root, ["tracking_url"]) || pickString(nestedData, ["tracking_url"]);
  const carrierName = pickString(root, ["courier_name"]) || pickString(nestedData, ["courier_name"]) || "Shiprocket";

  const accepted = root.status;
  const isAccepted =
    typeof accepted === "boolean"
      ? accepted
      : typeof accepted === "number"
      ? accepted === 1
      : typeof accepted === "string"
      ? ["1", "true", "success", "ok"].includes(accepted.toLowerCase())
      : true;

  if (!isAccepted || (!shiprocketOrderId && !shipmentId && !awbNumber && !trackingNumber)) {
    const errorBits: string[] = [];
    const finalMessage = toCleanString(root.message);
    if (finalMessage) errorBits.push(finalMessage);
    if (root.errors !== undefined) {
      try {
        errorBits.push(`errors=${JSON.stringify(root.errors)}`);
      } catch {
        errorBits.push("errors=unserializable");
      }
    }
    if (!errorBits.length) errorBits.push("Shiprocket create response missing order/shipment/tracking ids");
    throw new Error(errorBits.join(" | "));
  }

  return {
    shiprocketOrderId,
    shipmentId,
    awbNumber,
    trackingNumber,
    trackingUrl,
    carrierName,
    raw: json,
  };
};
