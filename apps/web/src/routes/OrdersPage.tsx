import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { eliteApi, ordersApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/lib/utils";
import { createAddress, fetchAddresses } from "@/services/addresses";
import { formatCurrencyAmount, resolveUserCurrency } from "@/services/currency";
import { fetchOrders } from "@/services/orders";

const trackingLabel: Record<string, string> = {
  placed: "Order Placed",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  failed: "Delivery Failed",
  rto: "Returned to Origin",
};

const orderLabel: Record<string, string> = {
  pending: "Order Placed",
  confirmed: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

const refundLabel: Record<string, string> = {
  none: "No Refund",
  pending: "Refund Pending",
  processed: "Refund Processed",
  failed: "Refund Failed",
  refunded: "Refunded",
};

const cancelLabel: Record<string, string> = {
  none: "No Cancel",
  requested: "Cancel Requested",
  processed: "Cancel Processed",
  completed: "Cancel Completed",
};

const statusSteps = ["requested", "processed", "completed"] as const;

const orderToTrackingState: Record<string, string> = {
  pending: "placed",
  confirmed: "packed",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "failed",
  refunded: "rto",
};

const timeline = ["placed", "packed", "shipped", "out_for_delivery", "delivered"] as const;
const activeReturnStatuses = ["PENDING", "APPROVED", "PICKUP_SCHEDULED", "PICKED_UP", "DELIVERED_TO_ORIGIN", "REFUND_PENDING"];
const returnStatusLabel: Record<string, string> = {
  PENDING: "Request Pending",
  APPROVED: "Request Approved",
  PICKUP_SCHEDULED: "Pickup Scheduled",
  PICKED_UP: "Pickup Completed",
  DELIVERED_TO_ORIGIN: "Received at Origin",
  REFUND_PENDING: "Refund Processing",
  REFUND_COMPLETED: "Refund Completed",
  REFUND_FAILED: "Refund Failed",
  REJECTED: "Request Rejected",
  COMPLETED: "Completed",
};
const returnReasons = [
  "Damaged item",
  "Wrong item received",
  "Size issue",
  "Quality issue",
  "Not as described",
  "Changed mind",
];

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString();
};

const formatDateOnly = (value: string | null | undefined) => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getLatestShipmentEvent = (order: any) =>
  order.shipments?.[0]?.shipment_events
    ?.slice()
    .sort((a: any, b: any) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime())[0] ?? null;

const getDeliveryCommitment = (order: any): { label: string; days: number; fast: boolean } => {
  const address = (order?.shipping_address ?? {}) as Record<string, unknown>;
  const lane = String(address.deliveryLane ?? "").toLowerCase();
  const royalFast = address.royalPriorityDelivery === true || String(address.royalPriorityDelivery) === "true";
  if (lane === "priority" || royalFast) return { label: "Fast Delivery (3 days)", days: 3, fast: true };
  return { label: "Standard Delivery (7 days)", days: 7, fast: false };
};

const getPaymentMethodLabel = (order: any): string => {
  const provider = String(order?.payment_provider ?? "").toLowerCase();
  if (provider === "cod") return "Cash on Delivery";
  if (provider === "razorpay") return "Online Payment";
  if (provider) return provider.toUpperCase();
  return order?.payment_status === "captured" ? "Online Payment" : "Pending";
};

const formatCompactOrderDate = (value: string | null | undefined) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
};

const getOrderHeadline = (order: any) => {
  const dateText = formatCompactOrderDate(order.updated_at ?? order.created_at);
  if (order.status === "delivered") return `Delivered on ${dateText}`;
  if (order.status === "cancelled") return `Cancelled on ${dateText}`;
  if (order.status === "refunded") return `Refunded on ${dateText}`;
  if (order.status === "shipped") return `Shipped on ${dateText}`;
  if (order.status === "confirmed") return `Confirmed on ${dateText}`;
  return `Placed on ${dateText}`;
};

export const OrdersPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [cancelMessage, setCancelMessage] = useState<string>("");
  const [cancelError, setCancelError] = useState<string>("");
  const [refundMessage, setRefundMessage] = useState<string>("");
  const [refundError, setRefundError] = useState<string>("");
  const [returnModalOrderId, setReturnModalOrderId] = useState<string | null>(null);
  const [returnModalItemId, setReturnModalItemId] = useState<string | null>(null);
  const [returnType, setReturnType] = useState<"RETURN" | "EXCHANGE">("RETURN");
  const [returnReason, setReturnReason] = useState(returnReasons[0]);
  const [returnDescription, setReturnDescription] = useState("");
  const [returnPhotoFiles, setReturnPhotoFiles] = useState<File[]>([]);
  const [returnExchangeVariantId, setReturnExchangeVariantId] = useState<string>("");
  const [returnMessage, setReturnMessage] = useState<string>("");
  const [returnError, setReturnError] = useState<string>("");
  const [returnPayoutMethod, setReturnPayoutMethod] = useState<"bank" | "upi" | "">("");
  const [pickupAddressId, setPickupAddressId] = useState<string>("");
  const [confirmReturnRequest, setConfirmReturnRequest] = useState(false);
  const [showPickupAddressForm, setShowPickupAddressForm] = useState(false);
  const [detailsOrderId, setDetailsOrderId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "shipped" | "delivered" | "cancelled" | "refunded">("all");
  const [pickupAddressForm, setPickupAddressForm] = useState({
    label: "Pickup",
    fullName: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    isDefault: false,
  });
  const query = useQuery({
    queryKey: ["orders", user?.id],
    queryFn: () => fetchOrders(user!.id),
    enabled: Boolean(user?.id),
  });
  const trackingSyncQuery = useQuery({
    queryKey: ["orders-tracking-sync", user?.id],
    queryFn: () => ordersApi.syncTracking(),
    enabled: Boolean(user?.id),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: 0,
  });
  const eliteQuery = useQuery({
    queryKey: ["elite-me-orders", user?.id],
    queryFn: eliteApi.getMyStatus,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
  const currencyQuery = useQuery({ queryKey: ["currency"], queryFn: resolveUserCurrency, staleTime: 30 * 60 * 1000 });
  const payoutQuery = useQuery({
    queryKey: ["refund-payout-account-orders", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refund_payout_accounts")
        .select("account_holder_name,bank_account_number,bank_ifsc,upi_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error && !String(error.message ?? "").toLowerCase().includes("refund_payout_accounts")) throw error;
      return data ?? null;
    },
  });
  const pickupAddressesQuery = useQuery({
    queryKey: ["pickup-addresses-orders", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => fetchAddresses(user!.id),
  });
  const addPickupAddressMutation = useMutation({
    mutationFn: () => {
      if (!user?.id) throw new Error("Please sign in to add pickup address");
      return createAddress(user.id, pickupAddressForm);
    },
    onSuccess: async (address) => {
      await queryClient.invalidateQueries({ queryKey: ["pickup-addresses-orders", user?.id] });
      setPickupAddressId(address.id);
      setShowPickupAddressForm(false);
      setPickupAddressForm((prev) => ({ ...prev, line1: "", line2: "", city: "", state: "", postalCode: "" }));
    },
    onError: (error) => {
      setReturnError((error as Error).message ?? "Could not save pickup address.");
    },
  });
  const cancelMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason?: string }) => ordersApi.cancelOrder(orderId, reason),
    onMutate: () => {
      setCancelMessage("");
      setCancelError("");
    },
    onSuccess: async () => {
      setCancelMessage("Order cancelled successfully.");
      if (user?.id) {
        await queryClient.invalidateQueries({ queryKey: ["orders", user.id] });
      }
    },
    onError: (error) => {
      setCancelError((error as Error)?.message ?? "Could not cancel order.");
    },
  });
  const refundRequestMutation = useMutation({
    mutationFn: ({ orderId, reason, payoutMethod }: { orderId: string; reason: string; payoutMethod?: "bank" | "upi" }) =>
      ordersApi.requestRefund(orderId, reason, payoutMethod),
    onMutate: () => {
      setRefundMessage("");
      setRefundError("");
    },
    onSuccess: async () => {
      setRefundMessage("Refund request submitted. Admin will review it.");
      if (user?.id) {
        await queryClient.invalidateQueries({ queryKey: ["orders", user.id] });
      }
    },
    onError: (error) => {
      setRefundError((error as Error)?.message ?? "Could not request refund.");
    },
  });
  const returnRequestMutation = useMutation({
    mutationFn: async () => {
      if (!returnModalOrderId || !returnModalItemId) throw new Error("Select an eligible item first.");
      setReturnMessage("");
      setReturnError("");

      const order = (query.data ?? []).find((o) => o.id === returnModalOrderId);
      const item = order?.order_items?.find((x) => x.id === returnModalItemId);
      if (!order || !item) throw new Error("Selected item not found");
      if (!pickupAddressId) throw new Error("Please select pickup address.");
      if (!confirmReturnRequest) throw new Error("Please confirm request details before submitting.");
      if (returnType === "RETURN") {
        if (!hasBankPayout && !hasUpiPayout) {
          throw new Error("Add bank account or UPI in profile before creating return request.");
        }
        if (hasBankPayout && hasUpiPayout && !returnPayoutMethod) {
          throw new Error("Select payout method (bank or upi) to continue.");
        }
      }

      const uploadUrls: string[] = [];
      for (const file of returnPhotoFiles.slice(0, 3)) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const path = `returns/${order.id}/${item.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("return-requests").upload(path, file, {
          upsert: false,
          cacheControl: "3600",
        });
        if (error) throw error;
        uploadUrls.push(supabase.storage.from("return-requests").getPublicUrl(path).data.publicUrl);
      }

      await ordersApi.createReturnRequest({
        orderId: order.id,
        productId: item.product_id,
        orderItemId: item.id,
        type: returnType,
        reason: returnReason,
        description: returnDescription || undefined,
        photos: uploadUrls,
        exchangeVariantId: returnType === "EXCHANGE" ? returnExchangeVariantId || undefined : undefined,
        payoutMethod: returnType === "RETURN" ? (returnPayoutMethod || undefined) : undefined,
        pickupAddressId,
        customerConfirmation: confirmReturnRequest,
      });
    },
    onSuccess: async () => {
      setReturnMessage("Return/Exchange request submitted.");
      setReturnError("");
      setReturnModalOrderId(null);
      setReturnModalItemId(null);
      setReturnPhotoFiles([]);
      setReturnDescription("");
      setReturnExchangeVariantId("");
      setReturnType("RETURN");
      setReturnPayoutMethod("");
      setPickupAddressId("");
      setConfirmReturnRequest(false);
      setShowPickupAddressForm(false);
      if (user?.id) await queryClient.invalidateQueries({ queryKey: ["orders", user.id] });
    },
    onError: (error) => {
      setReturnError((error as Error).message ?? "Could not submit request.");
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const updated = Number(trackingSyncQuery.data?.updated ?? 0);
    if (updated > 0) {
      void queryClient.invalidateQueries({ queryKey: ["orders", user.id] });
    }
  }, [trackingSyncQuery.data?.updated, queryClient, user?.id]);

  const daysLeftForItem = (order: any, item: any) => {
    const windowDays = Math.max(1, Math.min(30, item?.product?.return_window_days ?? 7));
    const deliveredAt = order.updated_at ?? order.created_at;
    const elapsed = Math.floor((Date.now() - new Date(deliveredAt).getTime()) / (1000 * 60 * 60 * 24));
    return windowDays - elapsed;
  };

  const isItemEligibleForAction = (order: any, item: any, mode: "RETURN" | "EXCHANGE") => {
    if (order.status !== "delivered") return false;
    const daysLeft = daysLeftForItem(order, item);
    if (daysLeft < 0) return false;
    const allowed = mode === "RETURN" ? item?.product?.return_allowed !== false : item?.product?.exchange_allowed !== false;
    if (!allowed) return false;
    const refundOverride = Boolean(item?.refund_allowed_override);
    const exchangeOverride = Boolean(item?.exchange_allowed_override);
    const refundCompleted = Boolean(item?.refund_completed);
    const exchangeCompleted = Boolean(item?.exchange_completed);
    const refundLocked = Boolean(item?.refund_locked);
    const exchangeLocked = Boolean(item?.exchange_locked);
    const activeRequestFromState = Boolean(item?.active_request);
    const activeRequestFromRequests = (order.return_requests ?? []).some(
      (r: any) => r.order_item_id === item.id && activeReturnStatuses.includes(r.status)
    );
    const activeRequest = activeRequestFromState || activeRequestFromRequests;

    if (refundCompleted) return false;
    if (activeRequest) return false;
    if (refundLocked && exchangeLocked && !refundOverride && !exchangeOverride) return false;

    if (mode === "RETURN") {
      if (refundOverride) return true;
      if (refundLocked || refundCompleted) return false;
      return true;
    }
    if (exchangeOverride) return true;
    if (exchangeLocked || exchangeCompleted || refundCompleted) return false;
    return true;
  };

  const selectedReturnOrder = useMemo(
    () => (query.data ?? []).find((order) => order.id === returnModalOrderId),
    [query.data, returnModalOrderId]
  );
  const selectedReturnItem = useMemo(
    () => selectedReturnOrder?.order_items?.find((item: any) => item.id === returnModalItemId) ?? null,
    [selectedReturnOrder, returnModalItemId]
  );
  const hasBankPayout = Boolean(
    payoutQuery.data?.account_holder_name && payoutQuery.data?.bank_account_number && payoutQuery.data?.bank_ifsc
  );
  const hasUpiPayout = Boolean(payoutQuery.data?.upi_id);

  const filteredOrders = useMemo(() => {
    const source = query.data ?? [];
    const q = searchText.trim().toLowerCase();
    return source.filter((order: any) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (!q) return true;
      const inOrderNumber = String(order.order_number ?? "").toLowerCase().includes(q);
      const inStatus = String(order.status ?? "").toLowerCase().includes(q);
      const inItems = (order.order_items ?? []).some((item: any) =>
        String(item?.title_snapshot ?? "")
          .toLowerCase()
          .includes(q)
      );
      return inOrderNumber || inItems || inStatus;
    });
  }, [query.data, searchText, statusFilter]);

  useEffect(() => {
    if (!returnModalOrderId) return;
    if (pickupAddressId) return;
    const first = pickupAddressesQuery.data?.[0];
    if (first?.id) setPickupAddressId(first.id);
  }, [returnModalOrderId, pickupAddressesQuery.data, pickupAddressId]);

  useEffect(() => {
    if (!returnModalOrderId) return;
    if (returnType !== "RETURN") {
      setReturnPayoutMethod("");
      return;
    }
    if (hasBankPayout && hasUpiPayout && !returnPayoutMethod) return;
    if (hasBankPayout && !hasUpiPayout) setReturnPayoutMethod("bank");
    if (!hasBankPayout && hasUpiPayout) setReturnPayoutMethod("upi");
  }, [returnModalOrderId, returnType, hasBankPayout, hasUpiPayout, returnPayoutMethod]);

  const requestRefundFlow = (order: any) => {
    const reason = window.prompt("Reason for refund (required):")?.trim() || "";
    if (!reason || reason.length < 3) {
      setRefundError("Please provide a valid refund reason (min 3 characters).");
      return;
    }
    const payout = payoutQuery.data;
    const hasBank = Boolean(payout?.account_holder_name && payout?.bank_account_number && payout?.bank_ifsc);
    const hasUpi = Boolean(payout?.upi_id);
    if (!hasBank && !hasUpi) {
      setRefundError("Add refund payout details in Profile first (bank account or UPI).");
      return;
    }

    let payoutMethod: "bank" | "upi" | undefined;
    if (hasBank && hasUpi) {
      const selected = window.prompt("Choose refund receive method: type 'bank' or 'upi'")?.trim().toLowerCase() ?? "";
      if (selected !== "bank" && selected !== "upi") {
        setRefundError("Invalid selection. Please type bank or upi.");
        return;
      }
      payoutMethod = selected as "bank" | "upi";
    } else if (hasBank) {
      payoutMethod = "bank";
    } else {
      payoutMethod = "upi";
    }

    refundRequestMutation.mutate({ orderId: order.id, reason, payoutMethod });
  };

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`orders-realtime-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await queryClient.invalidateQueries({ queryKey: ["orders", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  if (!user) return <div>Please sign in to view orders.</div>;

  return (
    <div className="space-y-5 rounded-2xl border border-zinc-300/80 bg-[#f8f7f3] p-4 text-zinc-900 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl text-zinc-900 sm:text-4xl">Order History</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-600">Live shipment + premium support timeline</p>
        </div>
        <span className="rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-xs uppercase tracking-[0.15em] text-gold-200">
          {eliteQuery.data?.progress?.current_tier?.name ?? "Base"} Tier
        </span>
      </div>
      {cancelMessage ? <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{cancelMessage}</p> : null}
      {cancelError ? <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{cancelError}</p> : null}
      {refundMessage ? <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{refundMessage}</p> : null}
      {refundError ? <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{refundError}</p> : null}
      {returnMessage ? <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{returnMessage}</p> : null}
      {returnError ? <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{returnError}</p> : null}
      <div className="sticky top-[70px] z-20 rounded-xl border border-zinc-300 bg-white/95 p-2 backdrop-blur sm:top-[84px]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_180px]">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search order number or product"
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-gold-400"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as any)}
            className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-800 outline-none focus:border-gold-400"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
      </div>
      {filteredOrders.map((order) => {
        const delivery = getDeliveryCommitment(order);
        const isRoyal = delivery.fast;
        return (
        <div
          key={order.id}
          className={`rounded-2xl border bg-white p-4 text-zinc-900 sm:p-5 ${
            isRoyal
              ? "border-gold-400/70 shadow-[0_16px_32px_rgba(212,175,55,0.22)]"
              : "border-zinc-300 shadow-[0_12px_24px_rgba(0,0,0,0.08)]"
          }`}
        >
          <div className="mb-3 flex justify-end">
            <p
              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                delivery.fast
                  ? "border border-emerald-400/45 bg-emerald-500/15 text-emerald-200"
                  : "border border-cyan-400/45 bg-cyan-500/15 text-cyan-200"
              }`}
            >
              {delivery.label}
            </p>
          </div>
          <div className={`flex flex-wrap items-start justify-between gap-3 border-b pb-3 ${isRoyal ? "border-gold-300/40" : "border-zinc-200"}`}>
            <div>
              <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Order ID</p>
              <p className="font-heading text-lg text-gold-100">#{order.order_number}</p>
              <p className="mt-1 text-xs text-zinc-600">{new Date(order.created_at).toLocaleString()}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-right">
              <p className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Order Value</p>
              <p className="min-w-[130px] text-right font-heading text-xl text-zinc-900">
                {currencyQuery.data ? formatCurrencyAmount(order.total_inr, currencyQuery.data) : formatINR(order.total_inr)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`mt-3 flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${
              isRoyal ? "border-gold-400/60 bg-[#fff8e3]" : "border-zinc-300 bg-zinc-50"
            }`}
            onClick={() => setDetailsOrderId((current) => (current === order.id ? null : order.id))}
          >
            <div className="flex min-w-0 items-center gap-3">
              {order.order_items?.[0]?.product?.image_url ? (
                <img
                  src={order.order_items[0].product.image_url}
                  alt={order.order_items?.[0]?.title_snapshot ?? "Product"}
                  className="h-14 w-14 rounded-md border border-zinc-300 object-cover"
                />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded-md border border-zinc-300 bg-white text-[10px] uppercase text-zinc-500">
                  Item
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900">{getOrderHeadline(order)}</p>
                <p className="truncate text-xs text-zinc-600">
                  {order.order_items?.[0]?.title_snapshot ?? "Tap to view full order details"}
                </p>
              </div>
            </div>
            <span className="pl-2 text-lg text-zinc-700">{detailsOrderId === order.id ? "▾" : "▸"}</span>
          </button>
          {detailsOrderId === order.id ? (
            <>
          <div className={`mt-2 rounded-lg border p-3 text-xs ${isRoyal ? "border-gold-400/60 bg-[#fff8e3]" : "border-zinc-300 bg-zinc-50"}`}>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              <p className="text-zinc-700">
                Payment Method: <span className="font-semibold text-zinc-900">{getPaymentMethodLabel(order)}</span>
              </p>
              <p className="text-zinc-700">
                Payment Status: <span className="font-semibold text-zinc-900">{String(order.payment_status ?? "pending").toUpperCase()}</span>
              </p>
              <p className="text-zinc-700">
                Order Number: <span className="font-semibold text-zinc-900">#{order.order_number}</span>
              </p>
              <p className="text-zinc-700">
                Reference: <span className="font-semibold text-zinc-900">{order.payment_ref || "Not available"}</span>
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="rounded-full border border-gold-400/40 bg-gold-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold-200">
              {order.status === "cancelled" || order.status === "refunded" || order.status === "delivered"
                ? orderLabel[order.status] ?? order.status
                : order.shipments?.[0]
                ? trackingLabel[order.shipments[0].normalized_status] ?? order.shipments[0].normalized_status
                : orderLabel[order.status] ?? order.status}
            </p>
            {order.refund_status && order.refund_status !== "none" && (
              <p className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-[11px] uppercase text-rose-200">
                {refundLabel[order.refund_status] ?? order.refund_status}
              </p>
            )}
            {order.cancel_status && order.cancel_status !== "none" && (
              <p className="rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-[11px] uppercase text-rose-200">
                {cancelLabel[order.cancel_status] ?? order.cancel_status}
              </p>
            )}
            {(order.return_requests ?? []).some((r: any) => activeReturnStatuses.includes(r.status)) ? (
              <p className="rounded-full border border-amber-400/35 bg-amber-500/10 px-3 py-1 text-[11px] uppercase text-amber-200">
                Return Request{" "}
                {(order.return_requests ?? []).find((r: any) => activeReturnStatuses.includes(r.status))?.status}
              </p>
            ) : null}
          </div>
          <div className="mt-3">
            <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              {(order.status === "pending" || order.status === "confirmed") && (
                <Button
                  variant="ghost"
                  className="w-full rounded-full border border-rose-400/35 bg-rose-500/10 px-4 py-2 text-xs text-rose-200 sm:w-auto"
                  onClick={async () => {
                    const reason = window.prompt("Reason for cancellation (optional):")?.trim() || undefined;
                    try {
                      await cancelMutation.mutateAsync({ orderId: order.id, reason });
                      if (
                        order.payment_status === "captured" &&
                        order.refund_status !== "processed" &&
                        order.refund_status !== "refunded"
                      ) {
                        requestRefundFlow(order);
                      }
                    } catch {
                      // handled by mutation onError
                    }
                  }}
                  disabled={cancelMutation.isPending}
                >
                  {cancelMutation.isPending ? "Cancelling..." : "Cancel Order"}
                </Button>
              )}
              {order.status !== "pending" && order.status !== "confirmed" && (
                <Button variant="ghost" className="w-full rounded-full border border-zinc-300 bg-zinc-100 px-4 py-2 text-xs text-zinc-600 sm:w-auto" disabled>
                  Cancel Unavailable (After Shipping)
                </Button>
              )}
              {(order.status === "delivered" || order.status === "cancelled" || order.status === "refunded") &&
              order.payment_status === "captured" &&
              order.refund_status !== "pending" &&
              order.refund_status !== "processed" &&
              order.refund_status !== "refunded" ? (
                <Button
                  variant="ghost"
                  className="w-full rounded-full border border-emerald-400/35 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200 sm:w-auto"
                  disabled={refundRequestMutation.isPending || payoutQuery.isLoading}
                  onClick={() => requestRefundFlow(order)}
                >
                  {refundRequestMutation.isPending ? "Submitting..." : "Request Refund"}
                </Button>
              ) : null}
            </div>
          </div>

          {!!order.order_items?.length ? (
            <div className={`mt-3 rounded-xl border p-3.5 ${isRoyal ? "border-gold-400/80 bg-[linear-gradient(135deg,#fffaf0,#fff2cc)] text-zinc-900 shadow-[inset_0_0_0_1px_rgba(212,175,55,0.25)]" : "border-zinc-200 bg-zinc-50"}`}>
              <p className={`mb-2 text-xs uppercase tracking-wider ${isRoyal ? "text-zinc-700" : "text-zinc-500"}`}>Ordered Items</p>
              <div className="space-y-2">
                {order.order_items.map((item: any) => {
                  const daysLeft = daysLeftForItem(order, item);
                  const openRequest = [...(order.return_requests ?? [])]
                    .filter((r: any) => r.order_item_id === item.id)
                    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                  const refundCompleted = Boolean(item?.refund_completed);
                  const exchangeCompleted = Boolean(item?.exchange_completed);
                  const refundLocked = Boolean(item?.refund_locked);
                  const exchangeLocked = Boolean(item?.exchange_locked);
                  const refundOverride = Boolean(item?.refund_allowed_override);
                  const exchangeOverride = Boolean(item?.exchange_allowed_override);
                  const activeRequest = Boolean(item?.active_request) || activeReturnStatuses.includes(openRequest?.status);
                  const permanentLock = refundLocked && exchangeLocked && !refundOverride && !exchangeOverride;
                  return (
                    <div key={item.id} className={`rounded-lg border p-2.5 ${isRoyal ? "border-gold-400/70 bg-[#fffdf6] text-zinc-900" : "border-zinc-200 bg-white"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className={`text-sm ${isRoyal ? "text-zinc-900" : "text-zinc-800"}`}>
                          {item.title_snapshot} x {item.quantity}
                          {item.variant?.color || item.variant?.size
                            ? ` (${item.variant?.color ?? "N/A"} / ${item.variant?.size ?? "N/A"})`
                            : ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`text-xs ${isRoyal ? "text-zinc-700" : "text-zinc-600"}`}>Window: {daysLeft >= 0 ? `${daysLeft} day(s) left` : "Closed"}</p>
                          {openRequest ? (
                            <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                          {openRequest.type} {openRequest.status}
                        </span>
                      ) : null}
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                        {refundCompleted ? (
                          <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
                            Refund Completed
                          </span>
                        ) : null}
                        {exchangeCompleted ? (
                          <span className="rounded-full border border-blue-400/35 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-200">
                            Exchange Completed
                          </span>
                        ) : null}
                        {activeRequest ? (
                          <span className="rounded-full border border-amber-400/35 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                            Active Request
                          </span>
                        ) : null}
                        {permanentLock ? (
                          <span className="rounded-full border border-rose-400/35 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200">
                            Permanent Lock
                          </span>
                        ) : null}
                        {refundOverride || exchangeOverride ? (
                          <span className="rounded-full border border-sky-400/35 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
                            Manual Override Enabled
                          </span>
                        ) : null}
                        {!permanentLock ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${isRoyal ? "border border-gold-300 bg-[#fff6dd] text-zinc-700" : "border border-zinc-300 bg-zinc-100 text-zinc-700"}`}>
                            Attempts: Refund {item?.refund_attempts ?? 0} | Exchange {item?.exchange_attempts ?? 0}
                          </span>
                        ) : null}
                        {isItemEligibleForAction(order, item, "RETURN") ? (
                          <Button
                            variant="ghost"
                            className="w-full px-2 py-1.5 text-xs sm:w-auto"
                            onClick={() => {
                              setReturnModalOrderId(order.id);
                              setReturnModalItemId(item.id);
                              setReturnType("RETURN");
                              setReturnExchangeVariantId("");
                              setReturnPhotoFiles([]);
                              setConfirmReturnRequest(false);
                              setReturnPayoutMethod("");
                              setShowPickupAddressForm(false);
                            }}
                          >
                            Request Return
                          </Button>
                        ) : null}
                        {isItemEligibleForAction(order, item, "EXCHANGE") ? (
                          <Button
                            variant="ghost"
                            className="w-full px-2 py-1.5 text-xs sm:w-auto"
                            onClick={() => {
                              setReturnModalOrderId(order.id);
                              setReturnModalItemId(item.id);
                              setReturnType("EXCHANGE");
                              setReturnPhotoFiles([]);
                              setConfirmReturnRequest(false);
                              setReturnPayoutMethod("");
                              setShowPickupAddressForm(false);
                            }}
                          >
                            Request Exchange
                          </Button>
                        ) : null}
                        {permanentLock ? (
                          <a
                            href={`mailto:support@zarelon.com?subject=${encodeURIComponent(`Return Issue - ${order.order_number ?? order.id}`)}`}
                            className="inline-flex items-center rounded-full border border-gold-400/30 bg-gold-500/10 px-3 py-1 text-xs text-gold-200"
                          >
                            Contact Support
                          </a>
                        ) : null}
                      </div>
                      {openRequest ? (
                        <div className={`mt-2 rounded border p-2 ${isRoyal ? "border-gold-300 bg-[#fff7e8]" : "border-zinc-200 bg-zinc-50"}`}>
                          <p className={`text-[11px] uppercase ${isRoyal ? "text-zinc-600" : "text-zinc-500"}`}>Return Timeline</p>
                          <p className={`text-xs ${isRoyal ? "text-zinc-800" : "text-zinc-700"}`}>{returnStatusLabel[openRequest.status] ?? openRequest.status}</p>
                          {openRequest.pickup_status && openRequest.pickup_status !== "none" ? (
                            <p className={`text-xs ${isRoyal ? "text-zinc-700" : "text-zinc-600"}`}>Pickup: {openRequest.pickup_status}</p>
                          ) : null}
                          {openRequest.pickup_tracking_number ? (
                            <p className={`text-xs ${isRoyal ? "text-zinc-700" : "text-zinc-600"}`}>Pickup Tracking: {openRequest.pickup_tracking_number}</p>
                          ) : null}
                          {openRequest.refund_status && openRequest.refund_status !== "none" ? (
                            <p className={`text-xs ${isRoyal ? "text-zinc-700" : "text-zinc-600"}`}>Refund: {openRequest.refund_status}</p>
                          ) : null}
                          {openRequest.refunded_at ? (
                            <p className="text-xs text-emerald-200">
                              Refunded At: {new Date(openRequest.refunded_at).toLocaleString()}
                            </p>
                          ) : null}
                          {openRequest.pickup_tracking_url ? (
                            <a
                              href={openRequest.pickup_tracking_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-gold-200 underline"
                            >
                              Open Pickup Tracking
                            </a>
                          ) : null}
                          {!!openRequest.return_events?.length ? (
                            <div className="mt-1 space-y-1">
                              {[...openRequest.return_events]
                                .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                                .slice(0, 5)
                                .map((event: any) => (
                                  <p key={event.id} className={`text-[11px] ${isRoyal ? "text-zinc-600" : "text-zinc-600"}`}>
                                    {new Date(event.created_at).toLocaleString()} | {event.message}
                                  </p>
                                ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {(() => {
            const refundDone = order.refund_status === "processed" || order.refund_status === "refunded";
            if (order.status === "cancelled") {
              const currentCancelStep = Math.max(0, statusSteps.indexOf((order.cancel_status ?? "requested") as any));
              return (
                <div className="mt-4 rounded-lg border border-rose-400/25 bg-rose-500/5 p-3 text-center">
                  <p className="mb-3 text-xs uppercase tracking-wider text-rose-200">Order Progress</p>
                  <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-2 sm:flex-row sm:gap-3">
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
                  <div className="mx-auto mt-3 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
                    {statusSteps.map((step, index) => {
                      const done = index <= currentCancelStep;
                      return (
                        <p
                          key={step}
                          className={`text-[11px] uppercase ${done ? "text-rose-200" : "text-white/45"}`}
                        >
                          {cancelLabel[step]}
                        </p>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (order.status === "refunded" || refundDone) {
              const normalizedRefund = order.refund_status === "pending" ? "requested" : order.refund_status;
              const refundStep = normalizedRefund === "processed" ? 1 : 2;
              return (
                <div className="mt-4 rounded-lg border border-emerald-400/25 bg-emerald-500/5 p-3 text-center">
                  <p className="mb-3 text-xs uppercase tracking-wider text-emerald-200">Order Progress</p>
                  <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-2 sm:flex-row sm:gap-3">
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
                  <div className="mx-auto mt-3 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
                    {statusSteps.map((step, index) => {
                      const done = index <= refundStep;
                      const label = step === "requested" ? "Refund Requested" : step === "processed" ? "Refund Processed" : "Refund Completed";
                      return (
                        <p
                          key={step}
                          className={`text-[11px] uppercase ${done ? "text-emerald-200" : "text-white/45"}`}
                        >
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
                  <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-2 sm:flex-row sm:gap-3">
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
                  <div className="mx-auto mt-3 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-3">
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
              order.status === "delivered"
                ? "delivered"
                : order.shipments?.[0]?.normalized_status ?? orderToTrackingState[order.status] ?? "placed";
            const activeStep = timeline.indexOf(shipmentState as (typeof timeline)[number]);
            const clampedStep = activeStep < 0 ? 0 : activeStep;
            return (
              <div className={`mt-4 rounded-xl border p-3 text-center ${isRoyal ? "border-gold-400/45 bg-[#17150f]" : "border-zinc-200 bg-white"}`}>
                <p className={`mb-3 text-xs uppercase tracking-wider ${isRoyal ? "text-white/65" : "text-zinc-600"}`}>Order Progress</p>
                <div className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-2 sm:grid-cols-5">
                  {timeline.map((step, index) => {
                    const done = index <= clampedStep;
                    return (
                      <div key={step} className={`rounded-md border px-2 py-1.5 text-left ${isRoyal ? "border-gold-400/30 bg-white/[0.03]" : "border-zinc-200 bg-zinc-50"}`}>
                        <div className={`mb-1 h-[2px] w-full rounded-full ${isRoyal ? "bg-white/10" : "bg-zinc-200"}`}>
                          <div className={`h-full rounded-full ${done ? "w-full bg-gold-300" : "w-0 bg-transparent"}`} />
                        </div>
                        <div className="flex items-center gap-2">
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            done ? "bg-gold-300 shadow-[0_0_10px_rgba(212,175,55,0.65)]" : "bg-white/25"
                          }`}
                        />
                        <p className={`text-xs ${done ? (isRoyal ? "text-gold-100" : "text-zinc-800") : (isRoyal ? "text-white/45" : "text-zinc-500")}`}>{trackingLabel[step]}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {order.shipments?.[0] ? (
            <div className={`mt-4 rounded-xl border p-3 ${isRoyal ? "border-gold-400/45 bg-[#17150f]" : "border-zinc-200 bg-zinc-50"}`}>
              {(() => {
                const latestEvent = getLatestShipmentEvent(order);
                const currentCity = latestEvent?.location || "Location unavailable";
                const eta = order.shipments[0].eta;
                return (
                  <div className={`mb-3 grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-3 ${isRoyal ? "border-gold-500/30 bg-gold-500/5" : "border-zinc-200 bg-white"}`}>
                    <p className={isRoyal ? "text-white/85" : "text-zinc-700"}>
                      Current Location: <span className="text-gold-100">{currentCity}</span>
                    </p>
                    <p className={isRoyal ? "text-white/85" : "text-zinc-700"}>
                      Expected Delivery: <span className="text-gold-100">{formatDateOnly(eta)}</span>
                    </p>
                    <p className={isRoyal ? "text-white/85" : "text-zinc-700"}>
                      Last Update:{" "}
                      <span className="text-gold-100">
                        {formatDateTime(latestEvent?.event_time ?? order.shipments[0].last_event_at)}
                      </span>
                    </p>
                  </div>
                );
              })()}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className={`text-sm ${isRoyal ? "text-white/90" : "text-zinc-800"}`}>
                    Courier: <span className="text-gold-100">{order.shipments[0].carrier_name}</span>
                  </p>
                  <p className={`text-xs ${isRoyal ? "text-white/70" : "text-zinc-600"}`}>Tracking ID: {order.shipments[0].tracking_number || "Pending assignment"}</p>
                </div>
                <p className="text-xs uppercase tracking-wider text-gold-300">
                  {trackingLabel[order.shipments[0].normalized_status] ?? order.shipments[0].normalized_status}
                </p>
              </div>
              {order.shipments[0].tracking_url && (
                <a
                  href={order.shipments[0].tracking_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-xs text-gold-200"
                >
                  Open courier tracking
                </a>
              )}
              {!!order.shipments[0].shipment_events?.length && (
                <div className="mt-3 space-y-2">
                  <p className={`text-xs uppercase tracking-wider ${isRoyal ? "text-white/65" : "text-zinc-500"}`}>Courier Updates</p>
                  {order.shipments[0].shipment_events
                    ?.slice()
                    .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime())
                    .slice(0, 5)
                    .map((event) => (
                      <div key={event.id} className={`text-xs ${isRoyal ? "text-white/70" : "text-zinc-600"}`}>
                        {new Date(event.event_time).toLocaleString()} |{" "}
                        {trackingLabel[event.normalized_status] ?? event.normalized_status}
                        {event.location ? ` | ${event.location}` : ""}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <p className={`mt-3 text-xs ${isRoyal ? "text-white/60" : "text-zinc-600"}`}>
              Courier not assigned yet. Status will update automatically after dispatch.
            </p>
          )}
            </>
          ) : null}
        </div>
      );
      })}
      {!filteredOrders.length && <p className="text-sm text-[#555555]">No orders found.</p>}

      {returnModalOrderId && selectedReturnItem ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
          <div className="w-full max-w-xl rounded-xl border border-white/15 bg-matte p-4">
            <p className="font-heading text-2xl text-gold-200">Request {returnType === "RETURN" ? "Return" : "Exchange"}</p>
            <p className="mt-1 text-xs text-white/65">
              Item: {selectedReturnItem.title_snapshot} | Window left: {Math.max(0, daysLeftForItem(selectedReturnOrder, selectedReturnItem))} day(s)
            </p>
            <div className="mt-3 grid gap-3">
              <label className="text-xs text-white/70">
                Type
                <select
                  value={returnType}
                  onChange={(event) => setReturnType(event.target.value as "RETURN" | "EXCHANGE")}
                  className="mt-1 w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-sm"
                >
                  <option value="RETURN">RETURN</option>
                  <option value="EXCHANGE">EXCHANGE</option>
                </select>
              </label>
              <label className="text-xs text-white/70">
                Reason
                <select
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                  className="mt-1 w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-sm"
                >
                  {returnReasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-white/70">
                Description
                <textarea
                  value={returnDescription}
                  onChange={(event) => setReturnDescription(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-sm"
                  placeholder="Add details (optional)"
                />
              </label>
              <label className="text-xs text-white/70">
                Photo Evidence (max 3)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  multiple
                  className="mt-1 w-full text-xs"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []).slice(0, 3);
                    setReturnPhotoFiles(files);
                  }}
                />
              </label>
              {returnType === "RETURN" ? (
                <div className="rounded-lg border border-white/15 bg-black/15 p-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-white/70">Refund Receive Method</p>
                  {!hasBankPayout && !hasUpiPayout ? (
                    <p className="mt-2 text-xs text-rose-300">
                      No bank/UPI found. Please add one in Profile before submitting return request.
                    </p>
                  ) : (
                    <div className="mt-2 grid gap-2">
                      {hasBankPayout ? (
                        <label className="flex items-center gap-2 text-xs text-white/85">
                          <input
                            type="radio"
                            name="return-payout-method"
                            value="bank"
                            checked={returnPayoutMethod === "bank"}
                            onChange={() => setReturnPayoutMethod("bank")}
                          />
                          Bank Account ({payoutQuery.data?.bank_ifsc ?? "Saved"})
                        </label>
                      ) : null}
                      {hasUpiPayout ? (
                        <label className="flex items-center gap-2 text-xs text-white/85">
                          <input
                            type="radio"
                            name="return-payout-method"
                            value="upi"
                            checked={returnPayoutMethod === "upi"}
                            onChange={() => setReturnPayoutMethod("upi")}
                          />
                          UPI ({payoutQuery.data?.upi_id})
                        </label>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
              <div className="rounded-lg border border-white/15 bg-black/15 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-white/70">Pickup Address</p>
                  <button
                    type="button"
                    className="text-xs text-gold-200 underline"
                    onClick={() => setShowPickupAddressForm((prev) => !prev)}
                  >
                    {showPickupAddressForm ? "Hide Add Form" : "Add New Address"}
                  </button>
                </div>
                {pickupAddressesQuery.isLoading ? <p className="mt-2 text-xs text-white/60">Loading saved addresses...</p> : null}
                {!!pickupAddressesQuery.data?.length ? (
                  <div className="mt-2 grid gap-2">
                    {pickupAddressesQuery.data.map((address) => (
                      <label key={address.id} className="rounded border border-white/15 bg-black/20 p-2 text-xs text-white/85">
                        <div className="flex items-start gap-2">
                          <input
                            type="radio"
                            name="return-pickup-address"
                            checked={pickupAddressId === address.id}
                            onChange={() => setPickupAddressId(address.id)}
                          />
                          <div>
                            <p className="font-semibold">{address.full_name}{address.label ? ` (${address.label})` : ""}</p>
                            <p>{address.phone}</p>
                            <p>
                              {address.line1}
                              {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state} {address.postal_code}
                            </p>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-amber-200">No saved address found. Add pickup address to continue.</p>
                )}

                {showPickupAddressForm ? (
                  <div className="mt-3 grid gap-2">
                    <input
                      value={pickupAddressForm.label}
                      onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, label: event.target.value }))}
                      placeholder="Label (Home / Office)"
                      className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                    />
                    <input
                      value={pickupAddressForm.fullName}
                      onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, fullName: event.target.value }))}
                      placeholder="Full Name"
                      className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                    />
                    <input
                      value={pickupAddressForm.phone}
                      onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, phone: event.target.value }))}
                      placeholder="Phone Number"
                      className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                    />
                    <input
                      value={pickupAddressForm.line1}
                      onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, line1: event.target.value }))}
                      placeholder="Address Line 1"
                      className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                    />
                    <input
                      value={pickupAddressForm.line2}
                      onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, line2: event.target.value }))}
                      placeholder="Address Line 2 (Optional)"
                      className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        value={pickupAddressForm.city}
                        onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, city: event.target.value }))}
                        placeholder="City"
                        className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                      />
                      <input
                        value={pickupAddressForm.state}
                        onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, state: event.target.value }))}
                        placeholder="State"
                        className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                      />
                      <input
                        value={pickupAddressForm.postalCode}
                        onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, postalCode: event.target.value }))}
                        placeholder="Pincode"
                        className="w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-xs"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-white/80">
                      <input
                        type="checkbox"
                        checked={pickupAddressForm.isDefault}
                        onChange={(event) => setPickupAddressForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
                      />
                      Set as default address
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => addPickupAddressMutation.mutate()}
                      disabled={addPickupAddressMutation.isPending}
                    >
                      {addPickupAddressMutation.isPending ? "Saving..." : "Save Pickup Address"}
                    </Button>
                  </div>
                ) : null}
              </div>
              {returnType === "EXCHANGE" ? (
                <label className="text-xs text-white/70">
                  Replacement Variant
                  <select
                    value={returnExchangeVariantId}
                    onChange={(event) => setReturnExchangeVariantId(event.target.value)}
                    className="mt-1 w-full rounded border border-white/20 bg-black/20 px-2 py-2 text-sm"
                  >
                    <option value="">Select variant</option>
                    {(selectedReturnItem.product?.product_variants ?? [])
                      .filter((variant: any) => variant.active !== false)
                      .map((variant: any) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.color ?? "N/A"} / {variant.size ?? "N/A"}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-white/85">
                <input
                  type="checkbox"
                  checked={confirmReturnRequest}
                  onChange={(event) => setConfirmReturnRequest(event.target.checked)}
                />
                I confirm these details are correct. Proceed with pickup and {returnType === "RETURN" ? "refund" : "exchange"} request.
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setReturnModalOrderId(null);
                  setReturnModalItemId(null);
                  setConfirmReturnRequest(false);
                }}
                disabled={returnRequestMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => returnRequestMutation.mutate()}
                disabled={
                  returnRequestMutation.isPending ||
                  !pickupAddressId ||
                  !confirmReturnRequest ||
                  (returnType === "EXCHANGE" && !returnExchangeVariantId) ||
                  (returnType === "RETURN" && !hasBankPayout && !hasUpiPayout) ||
                  (returnType === "RETURN" && hasBankPayout && hasUpiPayout && !returnPayoutMethod)
                }
              >
                {returnRequestMutation.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
