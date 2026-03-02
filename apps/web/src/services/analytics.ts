import { supabase } from "@/lib/supabase";
import { fetchRoyalDropInsights, getSmartLayoutSuggestion } from "@/services/royalDropEngine";

export const fetchAdminMetrics = async () => {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [ordersRes, productsRes, itemsRes, returnsRes, notificationsRes, riskRes] = await Promise.all([
    supabase.from("orders").select("id,total_inr,created_at,status,payment_status,refund_status,user_id"),
    supabase.from("products").select("id,title,stock,active").order("stock", { ascending: true }).limit(50),
    supabase.from("order_items").select("product_id,title_snapshot,quantity,order:orders(status)"),
    supabase.from("return_requests").select("id,status"),
    supabase.from("admin_notifications").select("id,type,severity,title,message,meta,is_read,created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("payment_risk_events").select("id,event_type,risk_level,details,created_at").order("created_at", { ascending: false }).limit(20),
  ]);

  if (ordersRes.error) throw ordersRes.error;
  if (productsRes.error) throw productsRes.error;

  const orders = ordersRes.data ?? [];
  const products = productsRes.data ?? [];
  const items = itemsRes.error ? [] : itemsRes.data ?? [];
  const returnRows = returnsRes.error ? [] : returnsRes.data ?? [];

  const successfulOrders = orders.filter((item) => !["cancelled"].includes(item.status));
  const totalRevenue = successfulOrders.reduce((sum, item) => sum + (item.total_inr ?? 0), 0);

  const deliveredOrders = orders.filter((item) => item.status === "delivered");
  const refundedOrders = orders.filter((item) => item.status === "refunded" || item.refund_status === "processed");
  const ordersToday = orders.filter((item) => item.created_at?.slice(0, 10) === todayIso).length;
  const aov = successfulOrders.length ? Math.round(totalRevenue / successfulOrders.length) : 0;

  const cartsEstimateRes = await supabase.from("carts").select("id,updated_at");
  const cartsEstimate = cartsEstimateRes.data?.length ?? 0;
  const conversionRate = cartsEstimate ? Number(((successfulOrders.length / cartsEstimate) * 100).toFixed(2)) : 0;

  const approvedOrCompletedReturns = returnRows.filter((item) => item.status === "APPROVED" || item.status === "COMPLETED").length;
  const returnRate = deliveredOrders.length
    ? Number(((approvedOrCompletedReturns / deliveredOrders.length) * 100).toFixed(2))
    : 0;

  const refundImpact = totalRevenue
    ? Number(((refundedOrders.reduce((sum, item) => sum + (item.total_inr ?? 0), 0) / totalRevenue) * 100).toFixed(2))
    : 0;

  const topMap = new Map<string, { title: string; quantity: number }>();
  for (const row of items) {
    const orderStatus = Array.isArray((row as any).order)
      ? (row as any).order[0]?.status
      : (row as any).order?.status;
    if (orderStatus === "cancelled") continue;
    const key = (row as any).product_id as string;
    const current = topMap.get(key) ?? { title: (row as any).title_snapshot ?? "Product", quantity: 0 };
    current.quantity += (row as any).quantity ?? 0;
    topMap.set(key, current);
  }

  const topProducts = Array.from(topMap.entries())
    .map(([id, value]) => ({ id, title: value.title, quantity: value.quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  const lowStockProducts = products.filter((item) => (item.stock ?? 0) > 0 && (item.stock ?? 0) <= 5).slice(0, 8);
  const royalInsights = await fetchRoyalDropInsights().catch(() => ({
    topBanners: [] as Array<{ id: string; count: number }>,
    topCategories: [] as Array<{ id: string; count: number }>,
    topProducts: [] as Array<{ id: string; count: number }>,
  }));
  const smartLayoutSuggestion = getSmartLayoutSuggestion({
    topCategories: royalInsights.topCategories,
    topProducts: royalInsights.topProducts,
  });

  return {
    totalRevenue,
    ordersToday,
    activeProducts: products.filter((item) => item.active).length,
    lowStock: lowStockProducts.length,
    aov,
    conversionRate,
    returnRate,
    refundImpact,
    topProducts,
    lowStockProducts,
    notifications: notificationsRes.error ? [] : notificationsRes.data ?? [],
    riskEvents: riskRes.error ? [] : riskRes.data ?? [],
    royalInsights,
    smartLayoutSuggestion,
  };
};
