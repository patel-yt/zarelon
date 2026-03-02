import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { adminApi, paymentsApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/lib/utils";
import { fetchAdminOrders } from "@/services/orders";

const statuses = ["pending", "confirmed", "shipped", "delivered", "cancelled", "refunded"];
const trackingStatuses = [
  "placed",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "failed",
  "rto",
] as const;

const trackingLabel: Record<string, string> = {
  placed: "Order Placed",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  failed: "Delivery Failed",
  rto: "Returned to Origin",
};

const timeline = ["placed", "packed", "shipped", "out_for_delivery", "delivered"] as const;

const asText = (value: unknown, fallback = "-"): string => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
};

const orderStatusLabel: Record<string, string> = {
  pending: "Order Placed",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const refundStatusLabel: Record<string, string> = {
  none: "No Refund",
  pending: "Refund Pending",
  processed: "Refund Processed",
  failed: "Refund Failed",
  refunded: "Refunded",
};

const cancelStatusLabel: Record<string, string> = {
  none: "No Cancel",
  requested: "Cancel Requested",
  processed: "Cancel Processed",
  completed: "Cancel Completed",
};

const cancelSteps = ["requested", "processed", "completed"] as const;
const paidStates = new Set(["captured", "paid", "refunded", "partially_refunded"]);

const getPaymentModeLabel = (order: any): "COD" | "Online" => {
  const provider = String(order?.payment_provider ?? "").trim().toLowerCase();
  if (provider === "cod") return "COD";
  return "Online";
};

const getPaymentReceivedLabel = (order: any): "Paid" | "Unpaid" => {
  const status = String(order?.payment_status ?? "").trim().toLowerCase();
  return paidStates.has(status) ? "Paid" : "Unpaid";
};

const isRoyalPriorityOrder = (order: any): boolean => {
  const address = (order?.shipping_address ?? {}) as Record<string, unknown>;
  const deliveryLane = String(address.deliveryLane ?? "").toLowerCase();
  const royalPriorityDelivery = address.royalPriorityDelivery;
  return deliveryLane === "priority" || royalPriorityDelivery === true || royalPriorityDelivery === "true";
};

const openRazorpayDashboard = (order: any) => {
  const paymentId = String(order?.razorpay_payment_id ?? "").trim();
  const orderRef = String(order?.payment_ref ?? "").trim();
  if (paymentId) {
    window.open(`https://dashboard.razorpay.com/app/payments/${encodeURIComponent(paymentId)}`, "_blank", "noopener,noreferrer");
    return;
  }
  if (orderRef) {
    window.open(`https://dashboard.razorpay.com/app/orders/${encodeURIComponent(orderRef)}`, "_blank", "noopener,noreferrer");
  }
};

export const AdminOrdersPage = () => {
  const navigate = useNavigate();
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManageOrders = isSuperAdmin || hasPermission("can_manage_orders");
  const canRefund = isSuperAdmin || hasPermission("can_refund");

  if (isLoading) {
    return <p className="text-sm text-white/70">Loading order access...</p>;
  }

  if (!canManageOrders && !canRefund && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen orders once.</p>;
  }

  if (!canManageOrders && !canRefund) {
    return <p className="text-sm text-white/70">You do not have order management access.</p>;
  }

  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-orders"],
    queryFn: fetchAdminOrders,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [shipmentDrafts, setShipmentDrafts] = useState<
    Record<string, { carrier_name: string; tracking_number: string; tracking_url: string; status: string }>
  >({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({});
  const [statusUpdatingOrderId, setStatusUpdatingOrderId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [statusError, setStatusError] = useState<string>("");
  const [refundMessage, setRefundMessage] = useState<string>("");
  const [refundError, setRefundError] = useState<string>("");
  const [refundingOrderId, setRefundingOrderId] = useState<string | null>(null);
  const [shipmentMessage, setShipmentMessage] = useState<string>("");
  const [shipmentError, setShipmentError] = useState<string>("");
  const [shipmentUpdatingOrderId, setShipmentUpdatingOrderId] = useState<string | null>(null);
  const [shiprocketSyncStatus, setShiprocketSyncStatus] = useState<
    Record<string, { success: boolean; reason?: string }>
  >({});

  const statusMutation = useMutation({
    mutationFn: ({
      orderId,
      status,
      reason,
      cancelStatus,
    }: {
      orderId: string;
      status: string;
      reason?: string;
      cancelStatus?: "none" | "requested" | "processed" | "completed";
      paymentStatus?: string;
    }) => adminApi.updateOrderStatus(orderId, status, reason, cancelStatus),
    onMutate: async ({ orderId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["admin-orders"] });
      const previous = queryClient.getQueryData<any[]>(["admin-orders"]);
      queryClient.setQueryData<any[]>(["admin-orders"], (old = []) =>
        old.map((row) =>
          row.id === orderId
            ? {
                ...row,
                status,
              }
            : row
        )
      );
      setStatusUpdatingOrderId(orderId);
      setStatusError("");
      setStatusMessage("");
      setStatusDrafts((prev) => ({ ...prev, [orderId]: prev[orderId] ?? "" }));
      return { previous };
    },
    onSuccess: async (data, vars) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      if (data?.shiprocket_sync?.attempted) {
        const syncReason =
          "reason" in (data.shiprocket_sync as Record<string, unknown>)
            ? ((data.shiprocket_sync as Record<string, unknown>).reason as string | undefined)
            : undefined;
        setShiprocketSyncStatus((prev) => ({
          ...prev,
          [vars.orderId]: {
            success: Boolean(data.shiprocket_sync?.success),
            reason: syncReason,
          },
        }));
      }
      if (vars.status === "cancelled" && vars.paymentStatus === "captured") {
        setStatusMessage("Order cancelled. Prepaid refund pending approval. Opening Refund Control...");
        setTimeout(() => navigate("/admin/refunds"), 600);
      } else {
        setStatusMessage("Order status updated successfully.");
      }
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["admin-orders"], context.previous);
      }
      setStatusError((error as Error)?.message ?? "Could not update order status.");
    },
    onSettled: () => {
      setStatusUpdatingOrderId(null);
    },
  });

  const refundMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      paymentsApi.refund({ orderId, reason }),
    onMutate: ({ orderId }) => {
      setRefundingOrderId(orderId);
      setRefundError("");
      setRefundMessage("");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      setRefundMessage("Refund processed successfully.");
    },
    onError: (error) => {
      setRefundError((error as Error)?.message ?? "Refund failed.");
    },
    onSettled: () => {
      setRefundingOrderId(null);
    },
  });

  const shipmentMutation = useMutation({
    mutationFn: ({
      orderId,
      payload,
    }: {
      orderId: string;
      payload: { carrier_name: string; tracking_number: string; tracking_url?: string; normalized_status?: any };
    }) => adminApi.upsertShipment(orderId, payload),
    onMutate: ({ orderId }) => {
      setShipmentUpdatingOrderId(orderId);
      setShipmentError("");
      setShipmentMessage("");
    },
    onSuccess: async (data, vars) => {
      queryClient.setQueryData<any[]>(["admin-orders"], (old = []) =>
        old.map((row) =>
          row.id === vars.orderId
            ? {
                ...row,
                status: data.order_status ?? row.status,
                shipments: [
                  {
                    ...(row.shipments?.[0] ?? {}),
                    carrier_name: vars.payload.carrier_name,
                    tracking_number: vars.payload.tracking_number,
                    tracking_url: vars.payload.tracking_url ?? null,
                    normalized_status: data.normalized_status ?? vars.payload.normalized_status ?? "shipped",
                  },
                ],
              }
            : row
        )
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      setShipmentMessage(
        `Shipment updated successfully${(data as any)?.source === "shiprocket" ? " (synced from Shiprocket)" : ""}.`
      );
    },
    onError: (error) => {
      setShipmentError((error as Error)?.message ?? "Could not save shipment tracking.");
    },
    onSettled: () => {
      setShipmentUpdatingOrderId(null);
    },
  });

  useEffect(() => {
    if (!canManageOrders && !canRefund) return;

    const channel = supabase
      .channel("admin-orders-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        async () => {
          await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canManageOrders, canRefund, queryClient]);

  useEffect(() => {
    const orders = query.data ?? [];
    const orderIds = orders.map((row: any) => String(row.id)).filter(Boolean);
    if (!orderIds.length) {
      setShiprocketSyncStatus({});
      return;
    }

    let cancelled = false;
    (async () => {
      const auditRes = await supabase
        .from("payments_audit")
        .select("order_id,event_type,provider_payload,created_at")
        .in("order_id", orderIds)
        .in("event_type", ["shiprocket_forward_order_created", "shiprocket_forward_order_failed"])
        .order("created_at", { ascending: false });

      if (cancelled || auditRes.error) return;
      const rows = (auditRes.data ?? []) as Array<{
        order_id: string;
        event_type: string;
        provider_payload?: Record<string, unknown>;
        created_at: string;
      }>;

      const map: Record<string, { success: boolean; reason?: string }> = {};
      for (const row of rows) {
        if (map[row.order_id]) continue;
        if (row.event_type === "shiprocket_forward_order_created") {
          map[row.order_id] = { success: true };
        } else {
          const reasonRaw = row.provider_payload?.reason;
          map[row.order_id] = { success: false, reason: typeof reasonRaw === "string" ? reasonRaw : undefined };
        }
      }
      setShiprocketSyncStatus(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [query.data]);

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Order Management</h1>
      {statusMessage ? <p className="text-xs text-emerald-300">{statusMessage}</p> : null}
      {statusError ? <p className="text-xs text-rose-300">{statusError}</p> : null}
      {refundMessage ? <p className="text-xs text-emerald-300">{refundMessage}</p> : null}
      {refundError ? <p className="text-xs text-rose-300">{refundError}</p> : null}
      {shipmentMessage ? <p className="text-xs text-emerald-300">{shipmentMessage}</p> : null}
      {shipmentError ? <p className="text-xs text-rose-300">{shipmentError}</p> : null}
      {query.isLoading ? <p className="text-sm text-white/70">Loading orders...</p> : null}
      {query.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-rose-300">
            Could not load orders: {(query.error as Error)?.message ?? "Unknown error"}
          </p>
          <p className="text-xs text-white/60">
            If this keeps timing out, apply latest Supabase migrations and retry.
          </p>
        </div>
      ) : null}
      {!query.isLoading && !query.isError && !(query.data ?? []).length ? (
        <p className="text-sm text-white/60">No orders found.</p>
      ) : null}
      {(query.data ?? []).map((order) => {
        const priorityOrder = isRoyalPriorityOrder(order);
        const shiprocketSync = shiprocketSyncStatus[order.id];
        const shiprocketFailed = Boolean(shiprocketSync && !shiprocketSync.success);
        return (
        <div
          key={order.id}
          className={`rounded-xl p-4 ${priorityOrder ? "border-2 border-[#d4af37] bg-[#d4af37]/6 shadow-[0_0_0_1px_rgba(212,175,55,0.25),0_10px_24px_rgba(212,175,55,0.12)]" : "border border-white/10"}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">#{order.order_number}</p>
              <p className="text-xs text-white/60">
                {orderStatusLabel[order.status] ?? order.status} | Payment: {order.payment_status}
              </p>
              <p className="text-xs text-white/60">
                Mode: {getPaymentModeLabel(order)} | Received: {getPaymentReceivedLabel(order)}
              </p>
              <p className={`text-xs ${priorityOrder ? "text-[#f1cf6a]" : "text-white/60"}`}>
                Delivery Lane: {priorityOrder ? "Royal Priority (Fast Delivery)" : "Standard Delivery"}
              </p>
              {shiprocketSync ? (
                <p
                  className={`text-xs ${
                    shiprocketSync.success ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  Shiprocket Sync:{" "}
                  {shiprocketSync.success
                    ? "Success"
                    : `Failed${shiprocketSync.reason ? ` - ${shiprocketSync.reason}` : ""}`}
                </p>
              ) : null}
              {order.refund_status ? (
                <p className="text-xs text-white/60">
                  Refund: {refundStatusLabel[order.refund_status] ?? order.refund_status}
                </p>
              ) : null}
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-right">
              <p className="min-w-[110px] text-right">{formatINR(order.total_inr)}</p>
              {canManageOrders && (
                <select
                  value={statusDrafts[order.id] || order.status}
                  onChange={(event) =>
                    {
                      const nextStatus = event.target.value;
                      setStatusDrafts((prev) => ({ ...prev, [order.id]: nextStatus }));
                      const reason =
                        nextStatus === "cancelled"
                          ? window.prompt("Enter cancellation reason (optional):")?.trim() || undefined
                          : undefined;
                    statusMutation.mutate({
                      orderId: order.id,
                      status: nextStatus,
                      reason,
                      paymentStatus: order.payment_status,
                    });
                  }
                }
                  disabled={statusUpdatingOrderId === order.id}
                  className="rounded-lg border-white/20 bg-black/20 text-xs"
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              )}
              {canRefund && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const reason = window.prompt("Refund reason (required):")?.trim() || "";
                    if (!reason || reason.length < 3) {
                      setRefundError("Please provide a valid refund reason (min 3 characters).");
                      return;
                    }
                    refundMutation.mutate({ orderId: order.id, reason });
                  }}
                  disabled={refundingOrderId === order.id}
                >
                  {refundingOrderId === order.id ? "Refunding..." : "Approve Refund"}
                </Button>
              )}
              {canManageOrders && (
                <Button
                  variant="ghost"
                  className="text-rose-200"
                  onClick={() => {
                    const reason = window.prompt("Enter cancellation reason (optional):")?.trim() || undefined;
                    statusMutation.mutate({
                      orderId: order.id,
                      status: "cancelled",
                      reason,
                      cancelStatus: "processed",
                      paymentStatus: order.payment_status,
                    });
                  }}
                  disabled={
                    statusUpdatingOrderId === order.id ||
                    !["pending", "confirmed", "shipped"].includes(order.status)
                  }
                >
                  {statusUpdatingOrderId === order.id && (statusDrafts[order.id] || order.status) === "cancelled"
                    ? "Cancelling..."
                    : "Cancel Order"}
                </Button>
              )}
              {canManageOrders && priorityOrder && (order.status === "pending" || order.status === "confirmed") ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    statusMutation.mutate({
                      orderId: order.id,
                      status: "shipped",
                      reason: "Royal priority approved for fast delivery",
                      paymentStatus: order.payment_status,
                    })
                  }
                  disabled={statusUpdatingOrderId === order.id}
                >
                  {statusUpdatingOrderId === order.id ? "Approving..." : "Approve + Fast Ship"}
                </Button>
              ) : null}
              {String(order.payment_provider ?? "").toLowerCase() === "razorpay" &&
              (order.razorpay_payment_id || order.payment_ref) ? (
                <Button
                  variant="ghost"
                  onClick={() => openRazorpayDashboard(order)}
                  className="text-cyan-200"
                >
                  View Razorpay Payment
                </Button>
              ) : null}
            </div>
          </div>
          {shiprocketFailed ? (
            <div className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-rose-200">Shiprocket Failure</p>
              <p className="mt-1 text-xs text-rose-100">
                {shiprocketSync?.reason || "Shiprocket order could not be created."}
              </p>
              <p className="mt-1 text-[11px] text-rose-100/85">
                Check address/pincode/phone and retry with `Approve + Fast Ship` or save manual shipment tracking.
              </p>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-center">
            <p className="rounded-full border border-gold-400/40 bg-gold-500/10 px-3 py-1 text-xs uppercase tracking-wider text-gold-200">
              {orderStatusLabel[order.status] ?? order.status}
            </p>
            {order.refund_status && order.refund_status !== "none" ? (
              <p className="text-xs uppercase text-red-300">
                {refundStatusLabel[order.refund_status] ?? order.refund_status}
              </p>
            ) : null}
            {order.cancel_status && order.cancel_status !== "none" ? (
              <p className="text-xs uppercase text-rose-300">
                {cancelStatusLabel[order.cancel_status] ?? order.cancel_status}
              </p>
            ) : null}
          </div>

          {(() => {
            const rawAddress = (order as any).shipping_address ?? {};
            const customer = (order as any).user ?? {};
            const fullName = asText(rawAddress.fullName ?? rawAddress.full_name ?? customer.name, "Not provided");
            const phone = asText(rawAddress.phone, "Not provided");
            const email = asText(customer.email, "Not available");
            const line1 = asText(rawAddress.line1, "");
            const line2 = asText(rawAddress.line2, "");
            const city = asText(rawAddress.city, "");
            const state = asText(rawAddress.state, "");
            const postalCode = asText(rawAddress.postalCode ?? rawAddress.postal_code, "");
            const country = asText(rawAddress.country, "India");
            const compactAddress = [line1, line2, city, state, postalCode, country].filter(Boolean).join(", ");

            return (
              <div className="mt-4 rounded-lg border border-gold-500/20 bg-gold-500/5 p-3">
                <p className="text-xs uppercase tracking-wider text-gold-200">Customer Delivery Details</p>
                <div className="mt-2 grid gap-1 text-sm text-white/85">
                  <p>
                    <span className="text-white/55">Name:</span> {fullName}
                  </p>
                  <p>
                    <span className="text-white/55">Mobile:</span> {phone}
                  </p>
                  <p>
                    <span className="text-white/55">Email:</span> {email}
                  </p>
                  <p>
                    <span className="text-white/55">Address:</span> {compactAddress || "Not provided"}
                  </p>
                  <p>
                    <span className="text-white/55">Payment Mode:</span> {getPaymentModeLabel(order)}
                  </p>
                  <p>
                    <span className="text-white/55">Payment Received:</span> {getPaymentReceivedLabel(order)}
                  </p>
                  <p>
                    <span className="text-white/55">Delivery Lane:</span> {priorityOrder ? "Royal Priority / Fast" : "Standard"}
                  </p>
                </div>
              </div>
            );
          })()}

          {(() => {
            const refundDone = order.refund_status === "processed" || order.refund_status === "refunded";
            if (order.status === "cancelled") {
              const currentCancelStep = Math.max(0, cancelSteps.indexOf((order.cancel_status ?? "requested") as any));
              return (
                <div className="mt-4 rounded-lg border border-rose-400/25 bg-rose-500/5 p-3 text-center">
                  <p className="mb-3 text-xs uppercase tracking-wider text-rose-200">Order Progress</p>
                  <div className="mx-auto flex w-full max-w-xl items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                      <p className="text-xs text-amber-100">Order Placed</p>
                    </div>
                    <div className="h-[2px] flex-1 bg-rose-400" />
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                      <p className="text-xs text-rose-200">Cancelled</p>
                    </div>
                  </div>
                  <div className="mx-auto mt-3 grid max-w-xl gap-2 sm:grid-cols-3">
                    {cancelSteps.map((step, index) => {
                      const done = index <= currentCancelStep;
                      return (
                        <p key={step} className={`text-[11px] uppercase ${done ? "text-rose-200" : "text-white/45"}`}>
                          {cancelStatusLabel[step]}
                        </p>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (order.status === "refunded" || refundDone) {
              return (
                <div className="mt-4 rounded-lg border border-emerald-400/25 bg-emerald-500/5 p-3 text-center">
                  <p className="mb-3 text-xs uppercase tracking-wider text-emerald-200">Order Progress</p>
                  <div className="mx-auto flex w-full max-w-xl items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                      <p className="text-xs text-amber-100">Order Placed</p>
                    </div>
                    <div className="h-[2px] flex-1 bg-emerald-400" />
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                      <p className="text-xs text-emerald-200">Refunded</p>
                    </div>
                  </div>
                  <div className="mx-auto mt-3 grid max-w-xl gap-2 sm:grid-cols-3">
                    {["requested", "processed", "completed"].map((step, index) => {
                      const normalizedRefund = order.refund_status === "pending" ? "requested" : order.refund_status;
                      const refundStep = normalizedRefund === "processed" ? 1 : 2;
                      const done = index <= refundStep;
                      const label =
                        step === "requested" ? "Refund Requested" : step === "processed" ? "Refund Processed" : "Refund Completed";
                      return (
                        <p key={step} className={`text-[11px] uppercase ${done ? "text-emerald-200" : "text-white/45"}`}>
                          {label}
                        </p>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (order.refund_status === "pending") {
              return (
                <div className="mt-4 rounded-lg border border-emerald-400/25 bg-emerald-500/5 p-3 text-center">
                  <p className="mb-3 text-xs uppercase tracking-wider text-emerald-200">Order Progress</p>
                  <div className="mx-auto flex w-full max-w-xl items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                      <p className="text-xs text-amber-100">Order Placed</p>
                    </div>
                    <div className="h-[2px] flex-1 bg-emerald-300/60" />
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
                      <p className="text-xs text-emerald-200">Refund Flow</p>
                    </div>
                  </div>
                  <div className="mx-auto mt-3 grid max-w-xl gap-2 sm:grid-cols-3">
                    <p className="text-[11px] uppercase text-emerald-200">Refund Requested</p>
                    <p className="text-[11px] uppercase text-white/45">Refund Processed</p>
                    <p className="text-[11px] uppercase text-white/45">Refund Completed</p>
                  </div>
                </div>
              );
            }

            if (order.status === "pending" && !order.shipments?.[0]) {
              return (
                <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-500/5 p-3 text-center">
                  <p className="mb-3 text-xs uppercase tracking-wider text-amber-200">Order Progress</p>
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.6)]" />
                    <p className="text-xs text-amber-100">Order Placed (Pending Confirmation)</p>
                  </div>
                </div>
              );
            }

            const shipmentState =
              order.status === "delivered" ? "delivered" : order.shipments?.[0]?.normalized_status ?? "placed";
            const activeStep = timeline.indexOf(shipmentState as (typeof timeline)[number]);
            const clampedStep = activeStep < 0 ? 0 : activeStep;
            return (
              <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-center">
                <p className="mb-3 text-xs uppercase tracking-wider text-white/65">Order Progress</p>
                <div className="mx-auto grid max-w-3xl gap-2 sm:grid-cols-5">
                  {timeline.map((step, index) => {
                    const done = index <= clampedStep;
                    return (
                      <div key={step} className="flex items-center gap-2">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            done ? "bg-gold-300 shadow-[0_0_10px_rgba(212,175,55,0.65)]" : "bg-white/25"
                          }`}
                        />
                        <p className={`text-xs ${done ? "text-gold-100" : "text-white/45"}`}>{trackingLabel[step]}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {canManageOrders && (
            <div className="mt-4 grid gap-2 rounded-lg border border-white/10 bg-black/20 p-3 md:grid-cols-4">
              {order.status === "cancelled" ? (
                <div className="md:col-span-4 flex items-center gap-2">
                  <p className="text-xs text-white/65">Cancel Status</p>
                  <select
                    value={order.cancel_status ?? "requested"}
                    onChange={(event) =>
                      statusMutation.mutate({
                        orderId: order.id,
                        status: "cancelled",
                        cancelStatus: event.target.value as "requested" | "processed" | "completed",
                      })
                    }
                    className="rounded-lg border-white/20 bg-black/30 text-xs"
                  >
                    <option value="requested">requested</option>
                    <option value="processed">processed</option>
                    <option value="completed">completed</option>
                  </select>
                </div>
              ) : null}
              <input
                value={shipmentDrafts[order.id]?.carrier_name ?? order.shipments?.[0]?.carrier_name ?? ""}
                onChange={(event) =>
                  setShipmentDrafts((prev) => ({
                    ...prev,
                    [order.id]: {
                      carrier_name: event.target.value,
                      tracking_number:
                        prev[order.id]?.tracking_number ?? order.shipments?.[0]?.tracking_number ?? "",
                      tracking_url:
                        prev[order.id]?.tracking_url ?? order.shipments?.[0]?.tracking_url ?? "",
                      status: prev[order.id]?.status ?? order.shipments?.[0]?.normalized_status ?? "shipped",
                    },
                  }))
                }
                placeholder="Carrier (Ekart/Delhivery)"
                className="rounded-lg border-white/20 bg-black/30 text-xs"
              />
              <input
                value={shipmentDrafts[order.id]?.tracking_number ?? order.shipments?.[0]?.tracking_number ?? ""}
                onChange={(event) =>
                  setShipmentDrafts((prev) => ({
                    ...prev,
                    [order.id]: {
                      carrier_name: prev[order.id]?.carrier_name ?? order.shipments?.[0]?.carrier_name ?? "",
                      tracking_number: event.target.value,
                      tracking_url:
                        prev[order.id]?.tracking_url ?? order.shipments?.[0]?.tracking_url ?? "",
                      status: prev[order.id]?.status ?? order.shipments?.[0]?.normalized_status ?? "shipped",
                    },
                  }))
                }
                placeholder="Tracking number"
                className="rounded-lg border-white/20 bg-black/30 text-xs"
              />
              <input
                value={shipmentDrafts[order.id]?.tracking_url ?? order.shipments?.[0]?.tracking_url ?? ""}
                onChange={(event) =>
                  setShipmentDrafts((prev) => ({
                    ...prev,
                    [order.id]: {
                      carrier_name: prev[order.id]?.carrier_name ?? order.shipments?.[0]?.carrier_name ?? "",
                      tracking_number:
                        prev[order.id]?.tracking_number ?? order.shipments?.[0]?.tracking_number ?? "",
                      tracking_url: event.target.value,
                      status: prev[order.id]?.status ?? order.shipments?.[0]?.normalized_status ?? "shipped",
                    },
                  }))
                }
                placeholder="Tracking URL"
                className="rounded-lg border-white/20 bg-black/30 text-xs"
              />
              <select
                value={shipmentDrafts[order.id]?.status ?? order.shipments?.[0]?.normalized_status ?? "shipped"}
                onChange={(event) =>
                  setShipmentDrafts((prev) => ({
                    ...prev,
                    [order.id]: {
                      carrier_name: prev[order.id]?.carrier_name ?? order.shipments?.[0]?.carrier_name ?? "",
                      tracking_number:
                        prev[order.id]?.tracking_number ?? order.shipments?.[0]?.tracking_number ?? "",
                      tracking_url:
                        prev[order.id]?.tracking_url ?? order.shipments?.[0]?.tracking_url ?? "",
                      status: event.target.value,
                    },
                  }))
                }
                className="rounded-lg border-white/20 bg-black/30 text-xs"
              >
                {trackingStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <div className="md:col-span-4">
                <Button
                  variant="ghost"
                  onClick={() =>
                    shipmentMutation.mutate({
                      orderId: order.id,
                      payload: {
                        carrier_name:
                          shipmentDrafts[order.id]?.carrier_name ?? order.shipments?.[0]?.carrier_name ?? "",
                        tracking_number:
                          shipmentDrafts[order.id]?.tracking_number ?? order.shipments?.[0]?.tracking_number ?? "",
                        tracking_url:
                          shipmentDrafts[order.id]?.tracking_url ?? order.shipments?.[0]?.tracking_url ?? "",
                        normalized_status:
                          (shipmentDrafts[order.id]?.status ??
                            order.shipments?.[0]?.normalized_status ??
                            "shipped") as any,
                      },
                    })
                  }
                  disabled={shipmentUpdatingOrderId === order.id}
                >
                  {shipmentUpdatingOrderId === order.id ? "Saving shipment..." : "Save Shipment Tracking"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )})}
    </div>
  );
};
