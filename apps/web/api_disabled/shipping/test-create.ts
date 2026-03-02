import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import { requireAdmin } from "../_lib/server.js";

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const safeJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const pickErrorText = (payload: Record<string, unknown>): string | undefined => {
  const candidates = ["message", "error", "errors", "status", "detail"];
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) return String(value[0]);
    if (value && typeof value === "object") return JSON.stringify(value);
  }
  return undefined;
};

const pickSuggestedPickupLocation = (payload: Record<string, unknown>): string | null => {
  const dataNode = payload.data;
  if (!dataNode || typeof dataNode !== "object") return null;
  const nestedData = (dataNode as Record<string, unknown>).data;
  if (!Array.isArray(nestedData)) return null;

  const firstActive = nestedData.find((item) => {
    if (!item || typeof item !== "object") return false;
    const status = (item as Record<string, unknown>).status;
    return status === 1;
  }) as Record<string, unknown> | undefined;

  const fallback = (nestedData[0] as Record<string, unknown> | undefined) ?? null;
  const chosen = firstActive ?? fallback;
  if (!chosen) return null;
  const location = chosen.pickup_location;
  return typeof location === "string" && location.trim() ? location.trim() : null;
};

const listPickupLocations = (payload: Record<string, unknown>): string[] => {
  const dataNode = payload.data;
  if (!dataNode || typeof dataNode !== "object") return [];
  const nestedData = (dataNode as Record<string, unknown>).data;
  if (!Array.isArray(nestedData)) return [];

  const active = nestedData
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Record<string, unknown>)
    .filter((item) => item.status === 1)
    .map((item) => (typeof item.pickup_location === "string" ? item.pickup_location.trim() : ""))
    .filter(Boolean);

  const all = nestedData
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Record<string, unknown>)
    .map((item) => (typeof item.pickup_location === "string" ? item.pickup_location.trim() : ""))
    .filter(Boolean);

  return Array.from(new Set([...active, ...all]));
};

const isOrderCreationSuccess = (payload: Record<string, unknown>): boolean => {
  const hasOrderId =
    typeof payload.order_id === "number" ||
    typeof payload.order_id === "string" ||
    typeof payload.shipment_id === "number" ||
    typeof payload.shipment_id === "string";
  if (hasOrderId) return true;

  const message = (typeof payload.message === "string" ? payload.message : "").toLowerCase();
  if (message.includes("wrong pickup location") || message.includes("error")) return false;
  return false;
};

const getNowDateTime = () => {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `${y}-${m}-${d} ${hh}:${mm}`;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const admin = await requireAdmin(req);
  if (!admin) {
    res.status(403).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const testModeRaw = Array.isArray(req.query?.test_mode) ? req.query.test_mode[0] : req.query?.test_mode;
  const testMode = testModeRaw === "true";
  if (!testMode) {
    res.status(400).json({ ok: false, error: "test_mode required" });
    return;
  }

  if (process.env.NODE_ENV === "production" && !testMode) {
    res.status(400).json({ ok: false, error: "test_mode required" });
    return;
  }

  const testRouteEnabled = (process.env.ENABLE_SHIPROCKET_TEST ?? "").trim().toLowerCase() === "true";
  if (!testRouteEnabled) {
    res.status(403).json({ ok: false, error: "Unauthorized" });
    return;
  }

  const email = process.env.SHIPROCKET_EMAIL?.trim();
  const password = process.env.SHIPROCKET_PASSWORD?.trim();

  if (!email || !password) {
    res.status(500).json({ ok: false, error: "Shiprocket credentials missing" });
    return;
  }

  let token = "";
  try {
    const loginResponse = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!loginResponse.ok) {
      const loginError = await safeJson(loginResponse);
      console.error("[shipping/test-create] Shiprocket login failed", loginError);
      res.status(401).json({
        ok: false,
        error: "Login failed",
        status_code: loginResponse.status,
        reason: pickErrorText(loginError) ?? "Shiprocket auth rejected request",
      });
      return;
    }

    const loginData = (await loginResponse.json()) as { token?: string };
    if (!loginData.token) {
      console.error("[shipping/test-create] Shiprocket login token missing");
      res.status(401).json({ ok: false, error: "Login failed", reason: "Shiprocket token missing" });
      return;
    }
    token = loginData.token;
  } catch (error) {
    console.error("[shipping/test-create] Shiprocket login exception", error);
    res.status(401).json({ ok: false, error: "Login failed", reason: "Network or auth exception" });
    return;
  }

  const orderRef = `TEST-${Date.now()}`;
  const validPhone = "9876543210";
  const createPayload = (pickupLocation: string) => ({
    order_id: orderRef,
    order_date: getNowDateTime(),
    pickup_location: pickupLocation,
    channel_id: "",
    comment: "Shiprocket test create from serverless endpoint",
    billing_customer_name: "Test",
    billing_last_name: "User",
    billing_address: "221B Baker Street",
    billing_address_2: "",
    billing_city: "Mumbai",
    billing_pincode: "400001",
    billing_state: "Maharashtra",
    billing_country: "India",
    billing_email: "test@example.com",
    billing_phone: validPhone,
    shipping_is_billing: true,
    shipping_customer_name: "Test",
    shipping_last_name: "User",
    shipping_address: "221B Baker Street",
    shipping_address_2: "",
    shipping_city: "Mumbai",
    shipping_pincode: "400001",
    shipping_country: "India",
    shipping_state: "Maharashtra",
    shipping_email: "test@example.com",
    shipping_phone: validPhone,
    order_items: [
      {
        name: "Test Product",
        sku: `SKU-${Date.now()}`,
        units: 1,
        selling_price: 499,
        discount: "",
        tax: "",
        hsn: 111111,
      },
    ],
    payment_method: "Prepaid",
    shipping_charges: 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: 499,
    length: 10,
    breadth: 10,
    height: 10,
    weight: 0.5,
  });

  try {
    const configuredPickup = process.env.SHIPROCKET_PICKUP_LOCATION?.trim() || "Primary";

    const createOrder = async (pickupLocation: string) => {
      const response = await fetch(`${SHIPROCKET_BASE}/orders/create/adhoc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(createPayload(pickupLocation)),
      });
      const payload = await safeJson(response);
      return { response, payload };
    };

    const tried = new Set<string>();
    const queue: string[] = [configuredPickup];
    let createOrderResponse: Response | null = null;
    let shiprocketResponse: Record<string, unknown> = {};

    while (queue.length) {
      const pickup = queue.shift()!.trim();
      if (!pickup || tried.has(pickup)) continue;
      tried.add(pickup);

      const result = await createOrder(pickup);
      createOrderResponse = result.response;
      shiprocketResponse = result.payload;

      if (result.response.ok && isOrderCreationSuccess(result.payload)) {
        break;
      }

      // Add suggested pickup locations from payload and retry.
      const suggestedSingle = pickSuggestedPickupLocation(result.payload);
      if (suggestedSingle && !tried.has(suggestedSingle)) queue.push(suggestedSingle);
      for (const candidate of listPickupLocations(result.payload)) {
        if (!tried.has(candidate)) queue.push(candidate);
      }
    }

    if (!createOrderResponse || !createOrderResponse.ok || !isOrderCreationSuccess(shiprocketResponse)) {
      console.error("[shipping/test-create] Shiprocket order failed", shiprocketResponse);
      res.status(400).json({
        ok: false,
        error: "Order failed",
        status_code: createOrderResponse?.status ?? 400,
        reason: pickErrorText(shiprocketResponse) ?? "Shiprocket order create rejected request",
      });
      return;
    }

    res.status(200).json({
      ok: true,
      login_success: true,
      shipment_created: true,
      order_id: String(shiprocketResponse.order_id ?? shiprocketResponse.channel_order_id ?? ""),
      shipment_id: String(shiprocketResponse.shipment_id ?? ""),
      test_mode: true,
    });
  } catch (error) {
    console.error("[shipping/test-create] Shiprocket order exception", error);
    res.status(400).json({ ok: false, error: "Order failed", reason: "Order create exception" });
  }
}
