import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { formatINR } from "@/lib/utils";
import { fetchAdminMetrics } from "@/services/analytics";

export const AdminDashboardPage = () => {
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin";
  const isOwner = isOwnerEmail(user?.email);
  const query = useQuery({ queryKey: ["admin-metrics"], queryFn: fetchAdminMetrics });
  const canViewAnalytics = isOwner || isSuperAdmin || hasPermission("can_view_analytics");

  if (isLoading) return <p className="text-sm text-white/70">Loading analytics access...</p>;

  if (!canViewAnalytics && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen dashboard once.</p>;
  }

  if (!canViewAnalytics) {
    return <p className="text-sm text-white/70">You do not have analytics access.</p>;
  }

  const data = query.data;

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Analytics Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Revenue">
          <p className="text-2xl text-gold-100">{formatINR(data?.totalRevenue ?? 0)}</p>
        </Card>
        <Card title="Orders Today">
          <p className="text-2xl text-gold-100">{data?.ordersToday ?? 0}</p>
        </Card>
        <Card title="AOV">
          <p className="text-2xl text-gold-100">{formatINR(data?.aov ?? 0)}</p>
        </Card>
        <Card title="Conversion Rate">
          <p className="text-2xl text-gold-100">{(data?.conversionRate ?? 0).toFixed(2)}%</p>
        </Card>
        <Card title="Return Rate">
          <p className="text-2xl text-gold-100">{(data?.returnRate ?? 0).toFixed(2)}%</p>
        </Card>
        <Card title="Refund Impact">
          <p className="text-2xl text-gold-100">{(data?.refundImpact ?? 0).toFixed(2)}%</p>
        </Card>
        <Card title="Active Products">
          <p className="text-2xl text-gold-100">{data?.activeProducts ?? 0}</p>
        </Card>
        <Card title="Low Stock Alerts">
          <p className="text-2xl text-gold-100">{data?.lowStock ?? 0}</p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 p-4">
          <h2 className="mb-3 font-heading text-xl text-gold-200">Top Selling Products</h2>
          {!data?.topProducts?.length ? (
            <p className="text-sm text-white/60">No sales yet.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.topProducts.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                  <span>{item.title}</span>
                  <span className="text-gold-200">{item.quantity}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 p-4">
          <h2 className="mb-3 font-heading text-xl text-gold-200">Inventory Signals</h2>
          {!data?.lowStockProducts?.length ? (
            <p className="text-sm text-white/60">No low-stock products.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.lowStockProducts.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2">
                  <span>{item.title}</span>
                  <span className="text-amber-200">Only {item.stock} left</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 p-4">
          <h2 className="mb-3 font-heading text-xl text-gold-200">Royal Drop Intelligence</h2>
          <p className="text-sm text-white/80">{data?.smartLayoutSuggestion?.summary ?? "No smart suggestion yet."}</p>
          <div className="mt-3 grid gap-2 text-sm">
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-white/60">Top Banner</p>
              <p className="text-white">{data?.royalInsights?.topBanners?.[0]?.id ?? "N/A"}</p>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-white/60">Top Category</p>
              <p className="text-white">{data?.royalInsights?.topCategories?.[0]?.id ?? "N/A"}</p>
            </div>
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-white/60">Top Product</p>
              <p className="text-white">{data?.royalInsights?.topProducts?.[0]?.id ?? "N/A"}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 p-4">
          <h2 className="mb-3 font-heading text-xl text-gold-200">Admin Alerts</h2>
          {!data?.notifications?.length ? (
            <p className="text-sm text-white/60">No notifications.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.notifications.slice(0, 6).map((item: any) => (
                <div key={item.id} className="rounded-lg border border-white/10 px-3 py-2">
                  <p className="font-medium text-gold-100">{item.title}</p>
                  <p className="text-white/70">{item.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 p-4">
          <h2 className="mb-3 font-heading text-xl text-gold-200">Fraud Risk Flags</h2>
          {!data?.riskEvents?.length ? (
            <p className="text-sm text-white/60">No flagged events.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.riskEvents.slice(0, 6).map((item: any) => (
                <div key={item.id} className="rounded-lg border border-rose-400/20 bg-rose-500/5 px-3 py-2">
                  <p className="font-medium text-rose-200">{item.event_type}</p>
                  <p className="text-white/70">Risk: {item.risk_level}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
