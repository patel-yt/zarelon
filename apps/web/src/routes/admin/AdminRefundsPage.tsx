import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { paymentsApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/lib/utils";
import { fetchAdminOrders } from "@/services/orders";

export const AdminRefundsPage = () => {
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canRefund = isSuperAdmin || hasPermission("can_refund");

  if (isLoading) {
    return <p className="text-sm text-white/70">Loading refund access...</p>;
  }

  if (!canRefund && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen refunds once.</p>;
  }

  if (!canRefund) {
    return <p className="text-sm text-white/70">You do not have refund permission.</p>;
  }

  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin-refunds"], queryFn: fetchAdminOrders });

  const refundMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      paymentsApi.refund({ orderId, reason }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-refunds"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    },
  });

  useEffect(() => {
    if (!canRefund) return;
    const channel = supabase
      .channel("admin-refunds-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        async () => {
          await queryClient.invalidateQueries({ queryKey: ["admin-refunds"] });
          await queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [canRefund, queryClient]);

  const refundable = (query.data ?? []).filter(
    (order) => order.payment_status === "captured" && order.status !== "refunded"
  );

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Refund Control</h1>
      <p className="text-sm text-white/70">Only orders with captured payments are listed.</p>
      {refundable.map((order) => (
        <div key={order.id} className="rounded-xl border border-white/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">#{order.order_number}</p>
              <p className="text-xs text-white/60">Payment: {order.payment_status}</p>
            </div>
            <p>{formatINR(order.total_inr)}</p>
            <Button
              variant="danger"
              onClick={() => {
                const reason = window.prompt("Refund reason (required):")?.trim() || "";
                if (!reason || reason.length < 3) return;
                refundMutation.mutate({ orderId: order.id, reason });
              }}
              disabled={refundMutation.isPending}
            >
              {refundMutation.isPending ? "Processing..." : "Issue Refund"}
            </Button>
          </div>
        </div>
      ))}
      {!refundable.length && <p className="text-sm text-white/60">No refundable orders found.</p>}
    </div>
  );
};
