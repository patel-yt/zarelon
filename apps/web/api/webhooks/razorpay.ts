import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import crypto from "node:crypto";
import { adminClient, sendError, serverEnv } from "../_lib/server.js";
import { syncReturnRefundFromWebhook } from "../_lib/returns.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  if (!serverEnv.razorpayWebhookSecret) return sendError(res, 500, "Missing Razorpay webhook secret");

  const signature = req.headers["x-razorpay-signature"];
  if (!signature || typeof signature !== "string") return sendError(res, 400, "Missing signature");

  const payloadRaw = JSON.stringify(req.body ?? {});
  const digest = crypto.createHmac("sha256", serverEnv.razorpayWebhookSecret).update(payloadRaw).digest("hex");
  const expectedSig = Buffer.from(digest, "utf8");
  const incomingSig = Buffer.from(signature, "utf8");
  if (expectedSig.length !== incomingSig.length || !crypto.timingSafeEqual(expectedSig, incomingSig)) {
    return sendError(res, 400, "Invalid signature");
  }

  const eventType = req.body?.event;
  const paymentEntity = req.body?.payload?.payment?.entity;
  const refundEntity = req.body?.payload?.refund?.entity;
  const externalEventId = String(
    req.body?.payload?.payment?.entity?.id ??
      req.body?.payload?.refund?.entity?.id ??
      req.body?.id ??
      ""
  ).trim();

  if (typeof eventType === "string" && eventType.startsWith("refund.")) {
    await syncReturnRefundFromWebhook(eventType, req.body).catch(() => false);
  }

  let orderRef = paymentEntity?.order_id;
  if (!orderRef && refundEntity?.payment_id) {
    const { data: orderByPaymentId } = await adminClient
      .from("orders")
      .select("payment_ref")
      .eq("razorpay_payment_id", refundEntity.payment_id)
      .maybeSingle();
    orderRef = orderByPaymentId?.payment_ref;
  }

  if (!orderRef) return res.status(200).json({ received: true });

  const { data: order } = await adminClient
    .from("orders")
    .select("id,payment_status,status,refund_status")
    .eq("payment_ref", orderRef)
    .maybeSingle();

  if (!order) return res.status(200).json({ received: true });

  if (externalEventId) {
    const duplicate = await adminClient
      .from("payments_audit")
      .select("id")
      .eq("order_id", order.id)
      .eq("event_type", `webhook_${String(eventType ?? "unknown")}`)
      .eq("provider_payload->>external_event_id", externalEventId)
      .maybeSingle();
    if (!duplicate.error && duplicate.data) {
      return res.status(200).json({ received: true, duplicate: true });
    }
  }

  const statusMap: Record<string, string> = {
    "payment.captured": "captured",
    "payment.failed": "failed",
    "refund.created": "captured",
    "refund.processed": "refunded",
    "refund.failed": "captured",
  };

  const mapped = statusMap[eventType] ?? order.payment_status;
  const orderStatus =
    eventType === "refund.processed"
      ? "refunded"
      : eventType === "payment.failed"
      ? "pending"
      : (order.status as string);
  const refundStatus =
    eventType === "refund.created"
      ? "pending"
      : eventType === "refund.processed"
      ? "processed"
      : eventType === "refund.failed"
      ? "failed"
      : (order.refund_status as string) || "none";

  await adminClient
    .from("orders")
    .update({
      payment_status: mapped,
      status: orderStatus,
      refund_status: refundStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  await adminClient.from("payments_audit").insert({
    order_id: order.id,
    event_type: `webhook_${String(eventType ?? "unknown")}`,
    provider_payload: {
      external_event_id: externalEventId || null,
      raw: req.body,
    },
  });

  return res.status(200).json({ received: true });
}

