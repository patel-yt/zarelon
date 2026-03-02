import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { adminApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import { fetchAdminReturnRequests } from "@/services/orders";

const statusClass: Record<string, string> = {
  PENDING: "text-amber-200",
  APPROVED: "text-emerald-200",
  PICKUP_SCHEDULED: "text-sky-200",
  PICKED_UP: "text-blue-200",
  DELIVERED_TO_ORIGIN: "text-indigo-200",
  REFUND_PENDING: "text-yellow-200",
  REFUND_COMPLETED: "text-emerald-300",
  REFUND_FAILED: "text-rose-300",
  REJECTED: "text-rose-300",
  COMPLETED: "text-gold-200",
};

export const AdminReturnsPage = () => {
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManageOrders = isSuperAdmin || hasPermission("can_manage_orders");

  if (isLoading) return <p className="text-sm text-white/70">Loading return management access...</p>;
  if (!canManageOrders && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen returns once.</p>;
  }
  if (!canManageOrders) return <p className="text-sm text-white/70">You do not have return management access.</p>;

  const query = useQuery({
    queryKey: ["admin-return-requests"],
    queryFn: fetchAdminReturnRequests,
  });

  const mutation = useMutation({
    mutationFn: adminApi.updateReturnRequestStatus,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-return-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
  const resetLocksMutation = useMutation({
    mutationFn: adminApi.resetReturnItemLocks,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-return-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("admin-returns-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "return_requests" },
        async () => {
          await queryClient.invalidateQueries({ queryKey: ["admin-return-requests"] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-3xl text-gold-200">Return & Exchange Requests</h1>
      <p className="text-sm text-white/65">Approve, reject, and complete return/exchange lifecycle.</p>

      {query.isLoading ? <p className="text-sm text-white/60">Loading requests...</p> : null}
      {query.error ? (
        <p className="text-sm text-rose-300">Could not load requests: {(query.error as Error).message}</p>
      ) : null}

      {(query.data ?? []).map((request) => {
        const orderNumber = request.order?.order_number ?? request.order_id?.slice(0, 8);
        const productTitle = request.product?.title ?? request.product_id?.slice(0, 8);
        const customer = request.user?.name || request.user?.email || request.user_id?.slice(0, 8);
        const canAct = request.status === "PENDING";
        const canComplete = request.status === "APPROVED" && request.type === "EXCHANGE";
        const itemState = request.order_item ?? {};
        const timeline = [...(request.return_events ?? [])].sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        return (
          <div key={request.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-white/90">
                Order <span className="text-gold-200">#{orderNumber}</span> | Product{" "}
                <span className="text-gold-200">{productTitle}</span>
              </p>
              <p className={`text-xs uppercase ${statusClass[request.status] ?? "text-white/70"}`}>{request.status}</p>
            </div>

            <div className="mt-2 grid gap-2 text-xs text-white/70 sm:grid-cols-2">
              <p>Customer: {customer}</p>
              <p>Type: {request.type}</p>
              <p>Reason: {request.reason}</p>
              <p>Created: {new Date(request.created_at).toLocaleString()}</p>
              {request.exchange_variant ? (
                <p className="sm:col-span-2">
                  Exchange Variant: {request.exchange_variant.color ?? "N/A"} / {request.exchange_variant.size ?? "N/A"}
                </p>
              ) : null}
              {request.description ? <p className="sm:col-span-2">Description: {request.description}</p> : null}
              <div className="sm:col-span-2 rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="mb-1 text-[11px] uppercase tracking-wider text-white/60">Automation Status</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  <p>Pickup Status: {request.pickup_status ?? "none"}</p>
                  <p>Pickup AWB: {request.pickup_awb ?? "-"}</p>
                  <p>Pickup Tracking: {request.pickup_tracking_number ?? "-"}</p>
                  <p>
                    Refund ID: {request.refund_id ?? "-"}
                  </p>
                  <p>Refund Status: {request.refund_status ?? "none"}</p>
                  <p>
                    Refund Amount: {typeof request.refund_amount_inr === "number" ? `Rs ${(request.refund_amount_inr / 100).toFixed(2)}` : "-"}
                  </p>
                </div>
                {request.pickup_tracking_url ? (
                  <a
                    href={request.pickup_tracking_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs text-gold-200 underline"
                  >
                    Open pickup tracking
                  </a>
                ) : null}
              </div>
              <div className="sm:col-span-2 rounded-lg border border-white/10 bg-black/20 p-2">
                <p className="mb-1 text-[11px] uppercase tracking-wider text-white/60">Item State</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  <p>Refund Attempts: {itemState.refund_attempts ?? 0}</p>
                  <p>Exchange Attempts: {itemState.exchange_attempts ?? 0}</p>
                  <p>Refund Completed: {String(Boolean(itemState.refund_completed))}</p>
                  <p>Exchange Completed: {String(Boolean(itemState.exchange_completed))}</p>
                  <p>Refund Locked: {String(Boolean(itemState.refund_locked))}</p>
                  <p>Exchange Locked: {String(Boolean(itemState.exchange_locked))}</p>
                  <p>Active Request: {String(Boolean(itemState.active_request))}</p>
                  <p>Refund Override: {String(Boolean(itemState.refund_allowed_override))}</p>
                  <p>Exchange Override: {String(Boolean(itemState.exchange_allowed_override))}</p>
                  <p>Override At: {itemState.manual_override_at ? new Date(itemState.manual_override_at).toLocaleString() : "-"}</p>
                  <p>Override Reason: {itemState.manual_override_reason ?? "-"}</p>
                </div>
              </div>
              {!!request.photos?.length ? (
                <div className="sm:col-span-2 flex flex-wrap gap-2">
                  {request.photos.slice(0, 3).map((photo: string) => (
                    <a key={photo} href={photo} target="_blank" rel="noreferrer">
                      <img src={photo} alt="return evidence" className="h-16 w-16 rounded border border-white/10 object-cover" />
                    </a>
                  ))}
                </div>
              ) : null}
              {!!timeline.length ? (
                <div className="sm:col-span-2 rounded-lg border border-white/10 bg-black/20 p-2">
                  <p className="mb-1 text-[11px] uppercase tracking-wider text-white/60">Timeline</p>
                  <div className="space-y-1">
                    {timeline.slice(0, 8).map((event: any) => (
                      <p key={event.id} className="text-[11px] text-white/70">
                        {new Date(event.created_at).toLocaleString()} | {event.event_type} | {event.message}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {canAct ? (
                <>
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-xs text-emerald-200"
                    disabled={mutation.isPending}
                    onClick={() => {
                      const note = window.prompt("Approval note (optional):")?.trim();
                      if (request.type === "EXCHANGE") {
                        const carrier = window.prompt("Exchange courier name (optional):")?.trim() || "";
                        const tracking = window.prompt("Exchange tracking number (optional):")?.trim() || "";
                        const trackingUrl = window.prompt("Exchange tracking URL (optional):")?.trim() || "";
                        mutation.mutate({
                          requestId: request.id,
                          status: "APPROVED",
                          adminNote: note || undefined,
                          exchangeTracking:
                            carrier && tracking
                              ? {
                                  carrier_name: carrier,
                                  tracking_number: tracking,
                                  tracking_url: trackingUrl || undefined,
                                }
                              : undefined,
                        });
                        return;
                      }
                      mutation.mutate({ requestId: request.id, status: "APPROVED", adminNote: note || undefined });
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-xs text-rose-300"
                    disabled={mutation.isPending}
                    onClick={() => {
                      const note = window.prompt("Reject reason (required):")?.trim() || "";
                      if (!note || note.length < 3) return;
                      mutation.mutate({ requestId: request.id, status: "REJECTED", adminNote: note });
                    }}
                  >
                    Reject
                  </Button>
                </>
              ) : null}

              {canComplete ? (
                <Button
                  variant="ghost"
                  className="px-3 py-1 text-xs text-gold-200"
                  disabled={mutation.isPending}
                  onClick={() => {
                    const note = window.prompt("Completion note (optional):")?.trim();
                    mutation.mutate({ requestId: request.id, status: "COMPLETED", adminNote: note || undefined });
                  }}
                >
                  Mark Completed
                </Button>
              ) : null}

              {isSuperAdmin ? (
                <>
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-xs text-sky-200"
                    disabled={resetLocksMutation.isPending}
                    onClick={() => {
                      const note = window.prompt("Full unlock reason (required):")?.trim() || "";
                      if (note.length < 3) return;
                      resetLocksMutation.mutate({
                        mode: "FULL_UNLOCK",
                        orderItemId: request.order_item?.id,
                        orderId: request.order_id,
                        productId: request.product_id,
                        adminNote: note,
                      });
                    }}
                  >
                    {resetLocksMutation.isPending ? "Applying..." : "Full Unlock"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-xs text-sky-300"
                    disabled={resetLocksMutation.isPending}
                    onClick={() => {
                      const note = window.prompt("Refund-only unlock reason (required):")?.trim() || "";
                      if (note.length < 3) return;
                      resetLocksMutation.mutate({
                        mode: "REFUND_ONLY_UNLOCK",
                        orderItemId: request.order_item?.id,
                        orderId: request.order_id,
                        productId: request.product_id,
                        adminNote: note,
                      });
                    }}
                  >
                    {resetLocksMutation.isPending ? "Applying..." : "Refund Only Unlock"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-3 py-1 text-xs text-sky-100"
                    disabled={resetLocksMutation.isPending}
                    onClick={() => {
                      const note = window.prompt("Exchange-only unlock reason (required):")?.trim() || "";
                      if (note.length < 3) return;
                      resetLocksMutation.mutate({
                        mode: "EXCHANGE_ONLY_UNLOCK",
                        orderItemId: request.order_item?.id,
                        orderId: request.order_id,
                        productId: request.product_id,
                        adminNote: note,
                      });
                    }}
                  >
                    {resetLocksMutation.isPending ? "Applying..." : "Exchange Only Unlock"}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      {!query.isLoading && !(query.data ?? []).length ? (
        <p className="text-sm text-white/60">No return/exchange requests.</p>
      ) : null}
    </div>
  );
};
