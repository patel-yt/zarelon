import { supabase } from "@/lib/supabase";
import type { Order } from "@/types/domain";

export const fetchOrders = async (userId: string): Promise<Order[]> => {
  const withReturns = await supabase
    .from("orders")
    .select(
      "id, order_number, total_inr, total_amount, status, payment_status, refund_status, cancel_status, created_at, updated_at, shipping_address, shipments(id,carrier_name,tracking_number,awb_number,carrier_status,normalized_status,last_event_at,eta,tracking_url,shipment_events(id,event_time,raw_status,normalized_status,location)), order_items(id,order_id,product_id,variant_id,title_snapshot,price_inr,quantity,refund_attempts,exchange_attempts,refund_completed,exchange_completed,refund_locked,exchange_locked,active_request,refund_allowed_override,exchange_allowed_override,manual_override_reason,manual_override_admin_id,manual_override_at,product:products(id,title,return_allowed,exchange_allowed,return_window_days,product_variants(id,color,size,active)),variant:product_variants(id,color,size)), return_requests(id,order_id,order_item_id,product_id,user_id,exchange_variant_id,type,reason,description,photos,status,pickup_status,pickup_awb,pickup_tracking_number,pickup_tracking_url,refund_id,refund_status,refund_amount_inr,refunded_at,admin_note,admin_user_id,created_at,updated_at,return_events(id,event_type,message,payload,created_at))"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  let result: { data: any[] | null; error: any } = withReturns as any;
  if (withReturns.error) {
    const withoutCancel = await supabase
      .from("orders")
      .select(
        "id, order_number, total_inr, total_amount, status, payment_status, refund_status, created_at, updated_at, shipping_address, shipments(id,carrier_name,tracking_number,awb_number,carrier_status,normalized_status,last_event_at,eta,tracking_url,shipment_events(id,event_time,raw_status,normalized_status,location)), order_items(id,order_id,product_id,variant_id,title_snapshot,price_inr,quantity,product:products(id,title),variant:product_variants(id,color,size))"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    result = withoutCancel as any;
  }

  if (result.error) throw result.error;
  return result.data ?? [];
};

export const fetchAdminOrders = async (): Promise<any[]> => {
  const fetchWithCancelStatus = () =>
    supabase
      .from("orders")
      .select(
        "id, order_number, total_inr, total_amount, status, payment_status, payment_provider, payment_ref, razorpay_payment_id, refund_status, cancel_status, created_at, user_id, shipping_address, user:users(name,email), shipments(id,carrier_name,tracking_number,awb_number,carrier_status,normalized_status,last_event_at,eta,tracking_url)"
      )
      .order("created_at", { ascending: false })
      .limit(100);
  const fetchWithoutCancelStatus = () =>
    supabase
      .from("orders")
      .select(
        "id, order_number, total_inr, total_amount, status, payment_status, payment_provider, payment_ref, razorpay_payment_id, refund_status, created_at, user_id, shipping_address, user:users(name,email), shipments(id,carrier_name,tracking_number,awb_number,carrier_status,normalized_status,last_event_at,eta,tracking_url)"
      )
      .order("created_at", { ascending: false })
      .limit(100);

  let result = (await Promise.race([
    fetchWithCancelStatus(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Orders request timeout")), 12000)),
  ])) as { data: any[] | null; error: any };

  if (result.error && String(result.error.message ?? "").toLowerCase().includes("cancel_status")) {
    result = (await Promise.race([
      fetchWithoutCancelStatus(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Orders request timeout")), 12000)),
    ])) as { data: any[] | null; error: any };
  }

  const { data, error } = result;

  if (error) throw error;
  return data ?? [];
};

export const fetchAdminReturnRequests = async (): Promise<any[]> => {
  const primary = await supabase
    .from("return_requests")
    .select(
      "id,order_id,order_item_id,product_id,user_id,exchange_variant_id,type,reason,description,photos,status,pickup_status,pickup_awb,pickup_tracking_number,pickup_tracking_url,refund_id,refund_status,refund_amount_inr,refunded_at,admin_note,created_at,updated_at,order:orders(id,order_number,status,payment_status,total_inr),order_item:order_items(id,refund_attempts,exchange_attempts,refund_completed,exchange_completed,refund_locked,exchange_locked,active_request,refund_allowed_override,exchange_allowed_override,manual_override_reason,manual_override_admin_id,manual_override_at),user:users(id,name,email),product:products(id,title),exchange_variant:product_variants(id,color,size),return_events(id,event_type,message,payload,created_at)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (!primary.error) return primary.data ?? [];

  const fallback = await supabase
    .from("return_requests")
    .select("id,order_id,product_id,user_id,type,reason,description,photos,status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (fallback.error) throw fallback.error;
  return fallback.data ?? [];
};
