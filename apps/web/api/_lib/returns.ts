import Razorpay from "razorpay";
import { adminClient, serverEnv } from "./server.js";
import { getShiprocketToken } from "./shiprocket.js";

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const parseDate = (value?: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

export const logReturnEvent = async (
  returnRequestId: string,
  eventType: string,
  message: string,
  payload: Record<string, unknown> = {}
) => {
  await adminClient.from("return_events").insert({
    return_request_id: returnRequestId,
    event_type: eventType,
    message,
    payload,
  });
};

const mapPickupStatus = (rawStatus: string) => {
  const key = rawStatus.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key.includes("picked_up")) return { pickupStatus: "picked_up", status: "PICKED_UP" as const };
  if (key.includes("delivered_to_origin") || key.includes("return_received")) {
    return { pickupStatus: "delivered_to_origin", status: "DELIVERED_TO_ORIGIN" as const };
  }
  if (key.includes("failed") || key.includes("cancel")) return { pickupStatus: "failed", status: "REJECTED" as const };
  return { pickupStatus: "scheduled", status: "PICKUP_SCHEDULED" as const };
};

export const createReversePickup = async (returnRequestId: string) => {
  const token = await getShiprocketToken();
  if (!token) throw new Error("Shiprocket credentials missing");

  const { data: requestRow, error: requestError } = await adminClient
    .from("return_requests")
    .select("id,order_id,order_item_id,product_id,user_id,type")
    .eq("id", returnRequestId)
    .maybeSingle();
  if (requestError || !requestRow) throw new Error(requestError?.message || "Return request not found");

  const { data: order, error: orderError } = await adminClient
    .from("orders")
    .select("id,order_number,shipping_address")
    .eq("id", requestRow.order_id)
    .maybeSingle();
  if (orderError || !order) throw new Error(orderError?.message || "Order not found");

  const { data: orderItem, error: itemError } = await adminClient
    .from("order_items")
    .select("id,title_snapshot,quantity,price_inr")
    .eq("id", requestRow.order_item_id ?? "")
    .maybeSingle();
  if (itemError || !orderItem) throw new Error(itemError?.message || "Order item not found");

  const address = (order.shipping_address ?? {}) as Record<string, string>;
  const payload = {
    order_id: `RET-${order.order_number}`,
    order_date: new Date().toISOString().slice(0, 10),
    channel_id: "",
    pickup_customer_name: address.fullName ?? "Customer",
    pickup_last_name: "",
    pickup_address: address.line1 ?? "",
    pickup_address_2: address.line2 ?? "",
    pickup_city: address.city ?? "",
    pickup_state: address.state ?? "",
    pickup_country: address.country ?? "India",
    pickup_pincode: address.postalCode ?? "",
    pickup_email: "",
    pickup_phone: address.phone ?? "",
    shipping_customer_name: "Warehouse",
    shipping_address: "Return Warehouse",
    shipping_city: "Warehouse",
    shipping_state: "Warehouse",
    shipping_country: "India",
    shipping_pincode: "000000",
    shipping_email: "returns@zarelon.com",
    shipping_phone: "9999999999",
    order_items: [
      {
        name: orderItem.title_snapshot,
        sku: `RET-${requestRow.product_id.slice(0, 8)}`,
        units: orderItem.quantity,
        selling_price: Number(((orderItem.price_inr ?? 0) / 100).toFixed(2)),
      },
    ],
    payment_method: "Prepaid",
    sub_total: Number((((orderItem.price_inr ?? 0) * orderItem.quantity) / 100).toFixed(2)),
    length: 10,
    breadth: 10,
    height: 10,
    weight: 0.5,
    is_return: 1,
    reference_id: returnRequestId,
  };

  const candidateEndpoints = [
    `${SHIPROCKET_BASE}/orders/create/adhoc`,
    `${SHIPROCKET_BASE}/orders/create/return`,
  ];

  let responseJson: any = null;
  let lastError: string | null = null;
  for (const endpoint of candidateEndpoints) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json().catch(() => ({}));
    if (response.ok) {
      responseJson = json;
      break;
    }
    lastError = json?.message || `Shiprocket reverse pickup failed (${response.status})`;
  }

  if (!responseJson) throw new Error(lastError || "Shiprocket reverse pickup failed");

  const pickupAwb =
    responseJson?.awb_code ??
    responseJson?.shipment_id ??
    responseJson?.order_id ??
    `RET-AWB-${returnRequestId.slice(0, 8).toUpperCase()}`;
  const pickupTrackingNumber =
    responseJson?.tracking_number ??
    responseJson?.awb_code ??
    responseJson?.shipment_id ??
    pickupAwb;
  const pickupTrackingUrl = responseJson?.tracking_url ?? null;

  await adminClient
    .from("return_requests")
    .update({
      status: "PICKUP_SCHEDULED",
      pickup_status: "scheduled",
      pickup_awb: String(pickupAwb),
      pickup_tracking_number: String(pickupTrackingNumber),
      pickup_tracking_url: pickupTrackingUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", returnRequestId);

  await adminClient.from("order_items").update({ active_request: true }).eq("id", requestRow.order_item_id ?? "");

  await logReturnEvent(returnRequestId, "PICKUP_SCHEDULED", "Reverse pickup scheduled", {
    pickup_awb: pickupAwb,
    pickup_tracking_number: pickupTrackingNumber,
    pickup_tracking_url: pickupTrackingUrl,
    provider_payload: responseJson,
  });

  return {
    pickupAwb: String(pickupAwb),
    pickupTrackingNumber: String(pickupTrackingNumber),
    pickupTrackingUrl: pickupTrackingUrl as string | null,
  };
};

export const triggerReturnRefund = async (returnRequestId: string, source: "webhook" | "manual" = "webhook") => {
  if (!serverEnv.razorpayKeyId || !serverEnv.razorpayKeySecret) {
    throw new Error("Razorpay not configured");
  }

  const { data: requestRow, error: requestError } = await adminClient
    .from("return_requests")
    .select("id,order_id,order_item_id,type,status,refund_id,refund_status")
    .eq("id", returnRequestId)
    .maybeSingle();
  if (requestError || !requestRow) throw new Error(requestError?.message || "Return request not found");
  if (requestRow.type !== "RETURN") throw new Error("Refund is only for RETURN requests");
  if (requestRow.status !== "DELIVERED_TO_ORIGIN") throw new Error("Refund allowed only after pickup delivered to origin");
  if (requestRow.refund_id || requestRow.refund_status === "processed") {
    await logReturnEvent(returnRequestId, "REFUND_ATTEMPT_SKIPPED", "Refund attempt skipped (already refunded)", {
      source,
      refund_id: requestRow.refund_id ?? null,
      refund_status: requestRow.refund_status ?? null,
    });
    return { skipped: true, reason: "already_refunded" as const };
  }

  const { data: order, error: orderError } = await adminClient
    .from("orders")
    .select("id,payment_provider,payment_status,razorpay_payment_id")
    .eq("id", requestRow.order_id)
    .maybeSingle();
  if (orderError || !order) throw new Error(orderError?.message || "Order not found");
  if (order.payment_provider !== "razorpay" || order.payment_status !== "captured" || !order.razorpay_payment_id) {
    throw new Error("Online captured payment is required for automated refund");
  }

  const { data: item, error: itemError } = await adminClient
    .from("order_items")
    .select("id,price_inr,quantity")
    .eq("id", requestRow.order_item_id ?? "")
    .maybeSingle();
  if (itemError || !item) throw new Error(itemError?.message || "Order item not found");

  const amount = Math.max(1, (item.price_inr ?? 0) * (item.quantity ?? 1));
  const razorpay = new Razorpay({ key_id: serverEnv.razorpayKeyId, key_secret: serverEnv.razorpayKeySecret });
  await logReturnEvent(returnRequestId, "REFUND_ATTEMPTED", "Attempting Razorpay refund", {
    source,
    amount,
  });

  const refund = await razorpay.payments
    .refund(order.razorpay_payment_id, {
      amount,
      notes: { return_request_id: returnRequestId, source },
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : "Refund API call failed";
      await logReturnEvent(returnRequestId, "REFUND_ATTEMPT_FAILED", message, { source, amount });
      throw error;
    });

  const normalizedRefundStatus = refund.status === "processed" ? "processed" : refund.status === "failed" ? "failed" : "pending";
  const mappedRequestStatus =
    normalizedRefundStatus === "processed"
      ? "REFUND_COMPLETED"
      : normalizedRefundStatus === "failed"
      ? "REFUND_FAILED"
      : "REFUND_PENDING";

  await adminClient
    .from("return_requests")
    .update({
      status: mappedRequestStatus,
      refund_id: refund.id ?? null,
      refund_status: normalizedRefundStatus,
      refund_amount_inr: amount,
      refunded_at: normalizedRefundStatus === "processed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", returnRequestId);

  await adminClient.from("order_items").update({
    refund_completed: normalizedRefundStatus === "processed",
    refund_locked: normalizedRefundStatus === "processed",
    exchange_locked: normalizedRefundStatus === "processed",
    active_request: normalizedRefundStatus !== "processed",
  }).eq("id", item.id);

  await adminClient.from("orders").update({
    refund_status: normalizedRefundStatus === "processed" ? "processed" : normalizedRefundStatus,
    updated_at: new Date().toISOString(),
  }).eq("id", order.id);

  await adminClient.from("payments_audit").insert({
    order_id: order.id,
    event_type: "return_refund_triggered",
    provider_payload: { return_request_id: returnRequestId, refund },
  });

  await logReturnEvent(returnRequestId, "REFUND_TRIGGERED", "Refund triggered after return delivered to origin", {
    refund_id: refund.id,
    refund_status: normalizedRefundStatus,
    refund_amount_inr: amount,
  });

  return {
    refundId: refund.id ?? "",
    refundStatus: normalizedRefundStatus,
    refundAmountInr: amount,
  };
};

export const syncReturnRefundFromWebhook = async (eventType: string, payload: any) => {
  const refundEntity = payload?.payload?.refund?.entity;
  if (!refundEntity) return false;

  const requestIdFromNotes =
    refundEntity?.notes?.return_request_id ??
    refundEntity?.notes?.returnRequestId ??
    null;
  let requestQuery = requestIdFromNotes
    ? adminClient.from("return_requests").select("id").eq("id", requestIdFromNotes).maybeSingle()
    : adminClient.from("return_requests").select("id").eq("refund_id", refundEntity?.id ?? "").maybeSingle();

  const { data: requestRow, error } = await requestQuery;
  if (error || !requestRow) return false;

  const status = eventType === "refund.processed" ? "processed" : eventType === "refund.failed" ? "failed" : "pending";
  const mappedRequestStatus =
    status === "processed" ? "REFUND_COMPLETED" : status === "failed" ? "REFUND_FAILED" : "REFUND_PENDING";

  await adminClient
    .from("return_requests")
    .update({
      status: mappedRequestStatus,
      refund_id: refundEntity?.id ?? null,
      refund_status: status,
      refunded_at: status === "processed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id);

  await logReturnEvent(requestRow.id, "REFUND_STATUS_SYNC", "Refund status synced from Razorpay webhook", {
    event_type: eventType,
    refund_id: refundEntity?.id ?? null,
    refund_status: status,
  });

  return true;
};

export const handleReturnPickupWebhook = async (raw: Record<string, unknown>) => {
  const pickupRef =
    (raw.return_request_id as string | undefined) ||
    (raw.reference_id as string | undefined) ||
    null;
  const tracking = (raw.tracking_number as string | undefined) || (raw.awb as string | undefined) || null;
  const statusRaw =
    (raw.status as string | undefined) ||
    (raw.current_status as string | undefined) ||
    (raw.shipment_status as string | undefined) ||
    "";

  let requestRow: { id: string } | null = null;
  if (pickupRef) {
    const { data } = await adminClient.from("return_requests").select("id").eq("id", pickupRef).maybeSingle();
    requestRow = data;
  }
  if (!requestRow && tracking) {
    const { data } = await adminClient
      .from("return_requests")
      .select("id")
      .or(`pickup_tracking_number.eq.${tracking},pickup_awb.eq.${tracking}`)
      .limit(1)
      .maybeSingle();
    requestRow = data;
  }
  if (!requestRow) return { matched: false };

  const mapped = mapPickupStatus(statusRaw || "scheduled");
  const eventTime =
    parseDate((raw.event_time as string | undefined) || (raw.updated_at as string | undefined)) || new Date().toISOString();

  await adminClient
    .from("return_requests")
    .update({
      status: mapped.status,
      pickup_status: mapped.pickupStatus,
      pickup_awb: ((raw.awb as string | undefined) ?? null) || undefined,
      pickup_tracking_number: ((raw.tracking_number as string | undefined) ?? null) || undefined,
      pickup_tracking_url: ((raw.tracking_url as string | undefined) ?? null) || undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id);

  await logReturnEvent(requestRow.id, "PICKUP_STATUS_UPDATE", `Pickup status: ${mapped.status}`, {
    raw_status: statusRaw,
    normalized_status: mapped.status,
    event_time: eventTime,
    payload: raw,
  });

  if (mapped.status === "DELIVERED_TO_ORIGIN") {
    await triggerReturnRefund(requestRow.id, "webhook");
  }

  return { matched: true, returnRequestId: requestRow.id, mappedStatus: mapped.status };
};
