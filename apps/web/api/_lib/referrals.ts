import { adminClient } from "./server.js";

const randomCouponChunk = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

const generateUniqueReferralCoupon = async (prefix: "FRIEND" | "REFERRER"): Promise<string> => {
  for (let i = 0; i < 12; i += 1) {
    const code = `AUR-${prefix}-${randomCouponChunk()}`;
    const referralCheck = await adminClient
      .from("referrals")
      .select("id")
      .or(`friend_coupon_code.eq.${code},referrer_coupon_code.eq.${code}`)
      .maybeSingle();
    if (!referralCheck.error && !referralCheck.data) {
      const socialCheck = await adminClient.from("social_submissions").select("id").eq("coupon_code", code).maybeSingle();
      if (!socialCheck.error && !socialCheck.data) return code;
    }
  }
  throw new Error("Could not generate referral coupon");
};

export const getRequestIp = (headers: Record<string, string | string[] | undefined>): string | null => {
  const forwarded = headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  const realIp = headers["x-real-ip"];
  return (Array.isArray(realIp) ? realIp[0] : realIp) ?? null;
};

export const processReferralRewardsForOrder = async (orderId: string) => {
  const orderRes = await adminClient
    .from("orders")
    .select("id,user_id,total_inr,payment_provider,payment_status,status,refund_status")
    .eq("id", orderId)
    .maybeSingle();
  if (orderRes.error || !orderRes.data) return { applied: false as const, reason: "order_not_found" };

  const order = orderRes.data;
  if (order.status !== "delivered") {
    return { applied: false as const, reason: "order_not_delivered" };
  }
  if (String(order.refund_status ?? "none").toLowerCase() !== "none") {
    return { applied: false as const, reason: "order_refunded_or_pending" };
  }
  const userRes = await adminClient.from("users").select("id,referred_by").eq("id", order.user_id).maybeSingle();
  if (userRes.error || !userRes.data?.referred_by) return { applied: false as const, reason: "no_referrer" };

  const referralRes = await adminClient
    .from("referrals")
    .select("id,referrer_id,referred_user_id,reward_given,purchase_amount")
    .eq("referred_user_id", order.user_id)
    .maybeSingle();
  if (referralRes.error || !referralRes.data) return { applied: false as const, reason: "referral_missing" };
  if (referralRes.data.reward_given) return { applied: false as const, reason: "already_rewarded" };

  const cfgRes = await adminClient
    .from("referral_config")
    .select("id,min_purchase_amount,referrer_reward,friend_reward,is_active")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cfgRes.error || !cfgRes.data) return { applied: false as const, reason: "config_inactive" };

  const cfg = cfgRes.data;
  const purchaseAmount = Number(order.total_inr ?? 0);
  if (purchaseAmount < Number(cfg.min_purchase_amount ?? 1000)) {
    await adminClient
      .from("referrals")
      .update({ purchase_amount: purchaseAmount })
      .eq("id", referralRes.data.id);
    return { applied: false as const, reason: "min_purchase_not_met" };
  }

  const now = Date.now();
  const friendCode = await generateUniqueReferralCoupon("FRIEND");
  const referrerCode = await generateUniqueReferralCoupon("REFERRER");
  const friendExp = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const referrerExp = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

  const update = await adminClient
    .from("referrals")
    .update({
      purchase_amount: purchaseAmount,
      reward_given: true,
      reward_given_at: new Date(now).toISOString(),
      friend_coupon_code: friendCode,
      friend_coupon_expires_at: friendExp,
      referrer_coupon_code: referrerCode,
      referrer_coupon_expires_at: referrerExp,
      coupon_usage_limit: 1,
      coupon_used_count: 0,
    })
    .eq("id", referralRes.data.id)
    .eq("reward_given", false);
  if (update.error) return { applied: false as const, reason: update.error.message };

  await adminClient.rpc("refresh_elite_progress_for_user", { p_user_id: referralRes.data.referrer_id });

  const [referrerOrderRes, referredOrderRes] = await Promise.all([
    adminClient
      .from("orders")
      .select("id,payment_ref,payment_provider,shipping_address,created_at")
      .eq("user_id", referralRes.data.referrer_id)
      .order("created_at", { ascending: false })
      .limit(20),
    adminClient
      .from("orders")
      .select("id,payment_ref,payment_provider,shipping_address,created_at")
      .eq("id", order.id)
      .limit(1)
      .maybeSingle(),
  ]);

  const referredOrder = referredOrderRes.data as any | null;
  const referrerOrders = (referrerOrderRes.data ?? []) as any[];
  const normalizeAddress = (value: any): string => {
    if (!value || typeof value !== "object") return "";
    const line1 = String(value.line1 ?? value.address_line1 ?? value.address1 ?? "").trim().toLowerCase();
    const postal = String(value.postal_code ?? value.pin_code ?? value.pincode ?? "").trim().toLowerCase();
    const city = String(value.city ?? "").trim().toLowerCase();
    return [line1, city, postal].filter(Boolean).join("|");
  };
  const referredAddress = normalizeAddress(referredOrder?.shipping_address);

  const paymentRef = String(referredOrder?.payment_ref ?? "").trim();
  const paymentProvider = String(referredOrder?.payment_provider ?? "").trim().toLowerCase();
  const paymentMatch = paymentRef
    ? referrerOrders.some((row) => String(row.payment_ref ?? "").trim() === paymentRef)
    : false;
  const addressMatch = referredAddress
    ? referrerOrders.some((row) => normalizeAddress(row.shipping_address) === referredAddress)
    : false;
  const suspicious = paymentMatch || addressMatch;

  if (suspicious) {
    await adminClient.from("referral_abuse_logs").insert({
      referrer_id: referralRes.data.referrer_id,
      referred_user_id: referralRes.data.referred_user_id,
      event_type: "reward_generated_with_abuse_signal",
      risk_level: paymentMatch ? "high" : "medium",
      details: {
        order_id: order.id,
        payment_provider: paymentProvider || null,
        payment_method_match: paymentMatch,
        delivery_address_match: addressMatch,
      },
    });
    await adminClient.from("payment_risk_events").insert({
      user_id: referralRes.data.referred_user_id,
      event_type: "referral_abuse_signal",
      risk_level: paymentMatch ? "high" : "medium",
      details: {
        referrer_id: referralRes.data.referrer_id,
        order_id: order.id,
        payment_method_match: paymentMatch,
        delivery_address_match: addressMatch,
      },
    });
  }

  await adminClient.from("admin_audit_logs").insert({
    action: "referral_reward_generated",
    entity_type: "referrals",
    entity_id: referralRes.data.id,
    diff: {
      order_id: order.id,
      purchase_amount: purchaseAmount,
      min_purchase_amount: cfg.min_purchase_amount,
      friend_coupon_code: friendCode,
      friend_coupon_discount: cfg.friend_reward,
      friend_coupon_valid_days: 7,
      referrer_coupon_code: referrerCode,
      referrer_coupon_discount: cfg.referrer_reward,
      referrer_coupon_valid_days: 30,
      non_combinable_with: ["social_coupon"],
      usage_limit: 1,
    },
  });

  return { applied: true as const, friendCode, referrerCode, purchaseAmount };
};
