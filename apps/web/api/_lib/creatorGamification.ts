import { adminClient } from "./server.js";

type CreatorTierRow = {
  id: string;
  name: string;
  min_approved_submissions: number;
  min_total_views: number;
  badge_color: string | null;
  reward_bonus: number | null;
  is_active: boolean;
};

const nowIso = () => new Date().toISOString();
const fallbackCodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const randomFallbackReferralCode = (length = 8): string => {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += fallbackCodeChars[Math.floor(Math.random() * fallbackCodeChars.length)];
  }
  return code;
};

export const ensureUserReferralCode = async (userId: string): Promise<string | null> => {
  const existing = await adminClient.from("users").select("id,referral_code").eq("id", userId).maybeSingle();
  if (existing.error || !existing.data) return null;
  if (existing.data.referral_code) return existing.data.referral_code;

  // Prefer DB generator when available.
  for (let i = 0; i < 10; i += 1) {
    const gen = await adminClient.rpc("generate_referral_code");
    if (gen.error || typeof gen.data !== "string") continue;
    const update = await adminClient
      .from("users")
      .update({ referral_code: gen.data })
      .eq("id", userId)
      .is("referral_code", null)
      .select("referral_code")
      .maybeSingle();
    if (!update.error && update.data?.referral_code) return update.data.referral_code;
  }

  // Fallback path if RPC is unavailable in current DB state.
  for (let i = 0; i < 40; i += 1) {
    const generatedCode = randomFallbackReferralCode(8);
    const taken = await adminClient.from("users").select("id").eq("referral_code", generatedCode).maybeSingle();
    if (taken.error) continue;
    if (taken.data) continue;

    const update = await adminClient
      .from("users")
      .update({ referral_code: generatedCode })
      .eq("id", userId)
      .is("referral_code", null)
      .select("referral_code")
      .maybeSingle();
    if (!update.error && update.data?.referral_code) return update.data.referral_code;
  }

  const latest = await adminClient.from("users").select("referral_code").eq("id", userId).maybeSingle();
  return latest.data?.referral_code ?? null;
};

const getActiveTiers = async (): Promise<CreatorTierRow[]> => {
  const tiersRes = await adminClient
    .from("creator_tiers")
    .select("id,name,min_approved_submissions,min_total_views,badge_color,reward_bonus,is_active")
    .eq("is_active", true)
    .order("min_approved_submissions", { ascending: true })
    .order("min_total_views", { ascending: true });
  if (tiersRes.error) return [];
  return (tiersRes.data ?? []) as CreatorTierRow[];
};

export const refreshCreatorTierForUser = async (userId: string) => {
  const aggregate = await adminClient
    .from("social_submissions")
    .select("id,views_snapshot")
    .eq("user_id", userId)
    .eq("status", "approved")
    .eq("is_invalid", false);

  if (aggregate.error) return { ok: false as const, reason: aggregate.error.message };

  const approvedCount = (aggregate.data ?? []).length;
  const totalViews = (aggregate.data ?? []).reduce((sum: number, row: any) => sum + Number(row.views_snapshot ?? 0), 0);
  const tiers = await getActiveTiers();
  const matchedTier =
    [...tiers]
      .reverse()
      .find(
        (tier) =>
          Number(approvedCount) >= Number(tier.min_approved_submissions ?? 0) &&
          Number(totalViews) >= Number(tier.min_total_views ?? 0)
      ) ?? null;

  const update = await adminClient
    .from("users")
    .update({
      total_approved_submissions: approvedCount,
      total_creator_views: totalViews,
      creator_tier_id: matchedTier?.id ?? null,
    })
    .eq("id", userId);
  if (update.error) return { ok: false as const, reason: update.error.message };

  return { ok: true as const, approvedCount, totalViews, tier: matchedTier };
};

export const trackCreatorClick = async (input: {
  creatorCode: string;
  ipAddress?: string | null;
  userId?: string | null;
  userAgent?: string | null;
}) => {
  const code = input.creatorCode.trim().toUpperCase();
  if (!code) return { ok: false as const, reason: "missing_code" };

  const creatorRes = await adminClient.from("users").select("id,referral_code").eq("referral_code", code).maybeSingle();
  if (creatorRes.error || !creatorRes.data) return { ok: false as const, reason: "creator_not_found" };
  if (input.userId && input.userId === creatorRes.data.id) return { ok: false as const, reason: "self_referral" };

  if (input.ipAddress) {
    const recentClick = await adminClient
      .from("creator_referral_events")
      .select("id")
      .eq("creator_id", creatorRes.data.id)
      .eq("event_type", "click")
      .eq("ip_address", input.ipAddress)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (!recentClick.error && recentClick.data) {
      return { ok: true as const, skipped: true, reason: "duplicate_click_window", creatorId: creatorRes.data.id };
    }
  }

  await adminClient.from("creator_referrals").upsert(
    {
      creator_id: creatorRes.data.id,
      creator_code: code,
      click_count: 0,
      purchase_count: 0,
      revenue_generated: 0,
      updated_at: nowIso(),
    },
    { onConflict: "creator_id" }
  );

  const current = await adminClient
    .from("creator_referrals")
    .select("click_count")
    .eq("creator_id", creatorRes.data.id)
    .maybeSingle();
  if (!current.error && current.data) {
    await adminClient
      .from("creator_referrals")
      .update({ click_count: Number(current.data.click_count ?? 0) + 1, updated_at: nowIso() })
      .eq("creator_id", creatorRes.data.id);
  }

  await adminClient.from("creator_referral_events").insert({
    creator_id: creatorRes.data.id,
    event_type: "click",
    ip_address: input.ipAddress ?? null,
    user_id: input.userId ?? null,
    user_agent: input.userAgent ?? null,
    referral_code: code,
  });

  return { ok: true as const, creatorId: creatorRes.data.id, creatorCode: code };
};

export const attributeCreatorPurchase = async (input: {
  creatorCode?: string | null;
  buyerUserId: string;
  orderId: string;
  orderAmount: number;
  ipAddress?: string | null;
}) => {
  const code = (input.creatorCode ?? "").trim().toUpperCase();
  if (!code) return { ok: false as const, reason: "missing_code" };

  const creatorRes = await adminClient.from("users").select("id").eq("referral_code", code).maybeSingle();
  if (creatorRes.error || !creatorRes.data) return { ok: false as const, reason: "creator_not_found" };
  if (creatorRes.data.id === input.buyerUserId) return { ok: false as const, reason: "self_referral" };

  const existingOrderEvent = await adminClient
    .from("creator_referral_events")
    .select("id")
    .eq("creator_id", creatorRes.data.id)
    .eq("event_type", "purchase")
    .eq("order_id", input.orderId)
    .limit(1)
    .maybeSingle();
  if (!existingOrderEvent.error && existingOrderEvent.data) {
    return { ok: true as const, skipped: true, reason: "already_counted" };
  }

  await adminClient.from("creator_referrals").upsert(
    {
      creator_id: creatorRes.data.id,
      creator_code: code,
      click_count: 0,
      purchase_count: 0,
      revenue_generated: 0,
      updated_at: nowIso(),
    },
    { onConflict: "creator_id" }
  );

  const statsRes = await adminClient
    .from("creator_referrals")
    .select("purchase_count,revenue_generated,bonus_reward_total")
    .eq("creator_id", creatorRes.data.id)
    .maybeSingle();
  if (statsRes.error || !statsRes.data) return { ok: false as const, reason: statsRes.error?.message ?? "stats_not_found" };

  const purchaseCount = Number(statsRes.data.purchase_count ?? 0) + 1;
  const revenueGenerated = Number(statsRes.data.revenue_generated ?? 0) + Number(input.orderAmount ?? 0);
  let bonusRewardTotal = Number(statsRes.data.bonus_reward_total ?? 0);
  let bonusAwarded = 0;

  if (purchaseCount === 10) {
    bonusAwarded = 500;
    bonusRewardTotal += 500;
  }
  if (purchaseCount >= 100) {
    const eliteTier = await adminClient.from("creator_tiers").select("id").eq("name", "Royal Elite").maybeSingle();
    if (!eliteTier.error && eliteTier.data?.id) {
      await adminClient.from("users").update({ creator_tier_id: eliteTier.data.id }).eq("id", creatorRes.data.id);
    }
  }

  await adminClient
    .from("creator_referrals")
    .update({
      purchase_count: purchaseCount,
      revenue_generated: revenueGenerated,
      bonus_reward_total: bonusRewardTotal,
      updated_at: nowIso(),
    })
    .eq("creator_id", creatorRes.data.id);

  await adminClient.from("creator_referral_events").insert({
    creator_id: creatorRes.data.id,
    event_type: "purchase",
    ip_address: input.ipAddress ?? null,
    user_id: input.buyerUserId,
    order_id: input.orderId,
    referral_code: code,
    order_amount: input.orderAmount,
  });

  await refreshCreatorTierForUser(creatorRes.data.id);

  return {
    ok: true as const,
    creatorId: creatorRes.data.id,
    purchaseCount,
    revenueGenerated,
    bonusAwarded,
  };
};
