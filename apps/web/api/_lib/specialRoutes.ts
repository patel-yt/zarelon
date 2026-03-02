import { z } from "zod";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import type { ApiRequest, ApiResponse } from "./http.js";
import { adminClient, computeCartTotals, requireAdmin, requirePermission, requireUser, sendError, serverEnv } from "./server.js";
import { sendEmail } from "./email.js";
import { ensureUserReferralCode, refreshCreatorTierForUser, trackCreatorClick } from "./creatorGamification.js";
import { aiRouterGenerate, getAiClientIp } from "./aiRouter.js";
import { enforceRateLimit } from "./rateLimit.js";
import { validateDiscountCode } from "./discountCodes.js";

const bannerSchema = z.object({
  festivalName: z.string().min(2),
  discountPercent: z.coerce.number().min(0).max(95),
  categoryFocus: z.string().min(2),
  tone: z.enum(["sporty", "luxury", "bold", "emotional"]),
});

const smartLayoutSchema = z.object({
  pageId: z.string().uuid(),
  action: z.enum(["suggest", "apply", "reject"]),
  recommendationId: z.string().uuid().optional(),
});

const emailSchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().trim().min(1).max(200).optional(),
});

const socialSubmissionSchema = z.object({
  platform: z.enum(["instagram", "youtube", "tiktok", "facebook"]),
  video_url: z.string().url(),
  followers_count: z.coerce.number().int().min(0),
  views_snapshot: z.coerce.number().int().min(0).optional(),
  caption: z.string().trim().max(280).optional(),
});

const socialReviewSchema = z.object({
  submission_id: z.string().uuid(),
  action: z.enum(["approve", "reject", "pin", "unpin", "recheck"]),
  current_views_snapshot: z.coerce.number().int().min(0).optional(),
});

const socialCaptionSchema = z.object({
  base_text: z.string().trim().min(2).max(300).optional(),
});

const creatorTrackSchema = z.object({
  ref: z.string().trim().min(3).max(32),
});

const referralValidateSchema = z.object({
  referral_code: z.string().trim().min(3).max(32),
});

const referralApplySchema = z.object({
  referral_code: z.string().trim().min(3).max(32),
  device_fingerprint: z.string().trim().min(6).max(200).optional(),
});
const referralReminderSchema = z.object({
  referral_id: z.string().uuid(),
});

const referralConfigUpdateSchema = z.object({
  min_purchase_amount: z.coerce.number().int().min(1),
  referrer_reward: z.coerce.number().int().min(1),
  friend_reward: z.coerce.number().int().min(1),
  is_active: z.coerce.boolean(),
  ambassador_program_enabled: z.coerce.boolean().optional(),
  paid_ambassador_enabled: z.coerce.boolean().optional(),
  referral_program_enabled: z.coerce.boolean().optional(),
  royal_access_price_inr: z.coerce.number().int().min(1).optional(),
  early_access_lock_hours: z.coerce.number().int().refine((value) => [24, 48, 72].includes(value)).optional(),
});

const eliteTierUpdateSchema = z.object({
  id: z.string().uuid(),
  required_valid_referrals: z.coerce.number().int().min(0),
  is_active: z.coerce.boolean().optional(),
  badge_style: z.record(z.string(), z.unknown()).optional(),
});

const eliteUserControlSchema = z.object({
  user_id: z.string().uuid(),
  current_tier_id: z.string().uuid().nullable().optional(),
  highest_tier_id: z.string().uuid().nullable().optional(),
  valid_referral_count: z.coerce.number().int().min(0).optional(),
  tier_locked: z.coerce.boolean().optional(),
  permanent_royal_crown: z.coerce.boolean().optional(),
});

const eliteAdminSchema = z.object({
  action: z.enum(["update_tier", "set_user", "refresh_user"]),
  tier: eliteTierUpdateSchema.optional(),
  user: eliteUserControlSchema.optional(),
});

const adminDropCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  stock_limit: z.coerce.number().int().min(0).default(0),
  early_access_tier_required: z.string().trim().optional(),
  early_access_tier: z.string().trim().optional(),
  early_access_hours: z.coerce.number().int().min(0).optional(),
  drop_priority: z.coerce.number().int().min(0).max(1000).default(0),
  countdown_enabled: z.coerce.boolean().default(true),
  is_active: z.coerce.boolean().default(false),
  exclusive_private_drop: z.coerce.boolean().default(false),
  products: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        stock_remaining: z.coerce.number().int().min(0),
        price_at_drop: z.coerce.number().int().min(0).optional(),
        exclusive_badge: z.string().trim().max(80).optional(),
      })
    )
    .default([]),
});

const adminDropUpdateSchema = adminDropCreateSchema.extend({
  id: z.string().uuid(),
  products: adminDropCreateSchema.shape.products.optional(),
});

const dropAccessRequestSchema = z.object({
  invite_code: z.string().trim().optional(),
});

const dropRedeemSchema = z.object({
  token: z.string().trim().optional(),
  invite_code: z.string().trim().optional(),
});

const homepageInteractionSchema = z.object({
  variant_id: z.string().uuid().optional(),
  event: z.enum(["view", "click", "cta", "purchase", "scroll_depth", "search"]),
  category: z.string().trim().optional(),
  product_id: z.string().uuid().optional(),
  search_term: z.string().trim().max(120).optional(),
  section: z.string().trim().max(120).optional(),
});

const featureFlagUpdateSchema = z.object({
  flags: z.record(z.string(), z.coerce.boolean()),
});

const contentBlockUpdateSchema = z.object({
  blocks: z.array(
    z.object({
      key: z.string().trim().min(2).max(120),
      title: z.string().trim().max(200).nullable().optional(),
      description: z.string().trim().max(5000).nullable().optional(),
      is_enabled: z.coerce.boolean().optional(),
    })
  ),
});

const adminDiscountCodeCreateSchema = z.object({
  code: z.string().trim().min(3).max(40),
  title: z.string().trim().max(120).optional(),
  discount_type: z.enum(["percentage", "fixed"]),
  discount_value: z.coerce.number().int().min(1),
  min_order_inr: z.coerce.number().int().min(0).default(0),
  max_discount_inr: z.coerce.number().int().min(1).nullable().optional(),
  total_usage_limit: z.coerce.number().int().min(1).nullable().optional(),
  per_user_limit: z.coerce.number().int().min(1).default(1),
  starts_at: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  active: z.coerce.boolean().default(true),
});

const adminDiscountCodeUpdateSchema = z.object({
  id: z.string().uuid(),
  active: z.coerce.boolean(),
});

const discountCodeValidateSchema = z.object({
  cartId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
});

const royalAccessVerifySchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

const SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external";

const normalizeVideoUrl = (input: string): string => input.trim().replace(/\/+$/, "").toLowerCase();
const normalizeReferralCode = (input: string): string => input.trim().toUpperCase();
const toSlug = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const DEFAULT_FEATURE_FLAGS = {
  ambassador_program_enabled: true,
  royal_crown_enabled: true,
  royal_access_enabled: true,
  creator_program_enabled: true,
  leaderboard_enabled: true,
  vault_enabled: true,
  early_drop_enabled: true,
  priority_checkout_enabled: true,
};

const FEATURE_FLAG_KEYS = Object.keys(DEFAULT_FEATURE_FLAGS) as Array<keyof typeof DEFAULT_FEATURE_FLAGS>;
type ResolvedTier = "SUPER_ROYAL" | "ROYAL_CROWN" | "ROYAL_ACCESS" | "NORMAL_USER";
const TIER_RANK: Record<ResolvedTier, number> = {
  NORMAL_USER: 0,
  ROYAL_ACCESS: 1,
  ROYAL_CROWN: 2,
  SUPER_ROYAL: 3,
};

const getRequiredTierRank = (rawTier: string | null | undefined): number => {
  const normalized = String(rawTier ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (!normalized) return 0;
  if (normalized === "SUPER_ROYAL") return TIER_RANK.SUPER_ROYAL;
  if (normalized === "ROYAL_CROWN") return TIER_RANK.ROYAL_CROWN;
  if (normalized === "ROYAL_ACCESS") return TIER_RANK.ROYAL_ACCESS;
  return TIER_RANK.NORMAL_USER;
};

const eliteEarlyHoursByTier: Record<string, number> = {
  super_royal: 24,
  royal_crown: 24,
  royal_access: 12,
  diamond: 12,
  platinum: 6,
  gold: 2,
  silver: 0,
};

const getFeatureFlags = async (): Promise<typeof DEFAULT_FEATURE_FLAGS> => {
  const res = await adminClient
    .from("feature_flags")
    .select("feature_key,is_enabled")
    .in("feature_key", FEATURE_FLAG_KEYS);
  if (res.error) return { ...DEFAULT_FEATURE_FLAGS };
  const next = { ...DEFAULT_FEATURE_FLAGS };
  for (const row of res.data ?? []) {
    const key = String((row as any).feature_key) as keyof typeof DEFAULT_FEATURE_FLAGS;
    if (FEATURE_FLAG_KEYS.includes(key)) next[key] = Boolean((row as any).is_enabled);
  }
  if (!next.ambassador_program_enabled) {
    next.royal_crown_enabled = false;
    next.royal_access_enabled = false;
    next.leaderboard_enabled = false;
    next.vault_enabled = false;
    next.early_drop_enabled = false;
    next.priority_checkout_enabled = false;
  }
  return next;
};

const isFeatureEnabled = async (featureKey: keyof typeof DEFAULT_FEATURE_FLAGS): Promise<boolean> => {
  const res = await adminClient.from("feature_flags").select("is_enabled").eq("feature_key", featureKey).maybeSingle();
  if (res.error || !res.data) return DEFAULT_FEATURE_FLAGS[featureKey];
  return Boolean((res.data as any).is_enabled);
};

const resolveUserTierById = async (
  userId: string
): Promise<{ tier: ResolvedTier; role: "user" | "admin" | "super_admin"; rank: number; allow_all_access: boolean }> => {
  const userRes = await adminClient
    .from("users")
    .select("role,royal_crown_unlocked,royal_access_active,royal_access_expires_at")
    .eq("id", userId)
    .maybeSingle();

  const roleRaw = String((userRes.data as any)?.role ?? "user").toLowerCase();
  const role = roleRaw === "admin" || roleRaw === "super_admin" ? (roleRaw as "admin" | "super_admin") : "user";
  if (role === "admin" || role === "super_admin") {
    return { tier: "SUPER_ROYAL", role, rank: TIER_RANK.SUPER_ROYAL, allow_all_access: true };
  }

  const progressRes = await adminClient.from("elite_progress").select("royal_crown_unlocked").eq("user_id", userId).maybeSingle();
  const userCrown = Boolean((userRes.data as any)?.royal_crown_unlocked ?? false);
  const progressCrown = Boolean((progressRes.data as any)?.royal_crown_unlocked ?? false);
  if (userCrown || progressCrown) return { tier: "ROYAL_CROWN", role, rank: TIER_RANK.ROYAL_CROWN, allow_all_access: false };

  const userAccessActive = Boolean((userRes.data as any)?.royal_access_active ?? false);
  const userAccessExpiresAt = (userRes.data as any)?.royal_access_expires_at as string | null | undefined;
  const userAccessValid = userAccessActive && (!userAccessExpiresAt || new Date(userAccessExpiresAt).getTime() > Date.now());
  const passRes = await adminClient
    .from("royal_access_passes")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1)
    .maybeSingle();
  const hasActivePass = !passRes.error && Boolean(passRes.data);
  if (userAccessValid || hasActivePass) {
    return { tier: "ROYAL_ACCESS", role, rank: TIER_RANK.ROYAL_ACCESS, allow_all_access: false };
  }
  return { tier: "NORMAL_USER", role, rank: TIER_RANK.NORMAL_USER, allow_all_access: false };
};

const getUserRole = async (userId: string): Promise<"user" | "admin" | "super_admin"> => {
  const resolved = await resolveUserTierById(userId);
  return resolved.role;
};

const isSuperRoyalRole = (role: string): boolean => role === "admin" || role === "super_admin";

const getUserTierInfo = async (
  userId: string
): Promise<{
  name: string;
  rank: number;
  role: "user" | "admin" | "super_admin";
  allow_all_access: boolean;
  resolved_tier: ResolvedTier;
  resolved_rank: number;
}> => {
  const resolved = await resolveUserTierById(userId);
  if (resolved.allow_all_access) {
    return {
      name: "SUPER_ROYAL",
      rank: Number.MAX_SAFE_INTEGER,
      role: resolved.role,
      allow_all_access: true,
      resolved_tier: resolved.tier,
      resolved_rank: resolved.rank,
    };
  }
  const progressRes = await adminClient
    .from("elite_progress")
    .select("current_tier:elite_tiers!elite_progress_current_tier_id_fkey(name,required_valid_referrals)")
    .eq("user_id", userId)
    .maybeSingle();
  if (progressRes.error) {
    return {
      name: resolved.tier,
      rank: 0,
      role: resolved.role,
      allow_all_access: false,
      resolved_tier: resolved.tier,
      resolved_rank: resolved.rank,
    };
  }
  const currentTier = Array.isArray((progressRes.data as any)?.current_tier)
    ? (progressRes.data as any)?.current_tier?.[0]
    : (progressRes.data as any)?.current_tier;
  return {
    name: String(currentTier?.name ?? resolved.tier),
    rank: Number(currentTier?.required_valid_referrals ?? 0),
    role: resolved.role,
    allow_all_access: false,
    resolved_tier: resolved.tier,
    resolved_rank: resolved.rank,
  };
};

const getTierRankByName = async (tierName: string): Promise<number> => {
  const key = tierName.trim().toLowerCase();
  if (!key) return 0;
  const tierRes = await adminClient
    .from("elite_tiers")
    .select("required_valid_referrals")
    .ilike("name", tierName)
    .maybeSingle();
  if (tierRes.error || !tierRes.data) return 0;
  return Number(tierRes.data.required_valid_referrals ?? 0);
};

const getDropStartWithTierWindow = async (dropRow: any, tierName: string): Promise<Date> => {
  const baseStart = new Date(dropRow.start_time);
  const mapped = eliteEarlyHoursByTier[tierName.trim().toLowerCase().replace(/\s+/g, "_")] ?? 0;
  const explicit = Number(dropRow.early_access_hours ?? 0);
  const windowHours = Math.max(mapped, explicit);
  return new Date(baseStart.getTime() - windowHours * 60 * 60 * 1000);
};

const isDropAccessibleForUser = async (dropRow: any, userId: string | null) => {
  const featureFlags = await getFeatureFlags();
  const now = new Date();
  const start = new Date(dropRow.start_time);
  const end = new Date(dropRow.end_time);
  if (now > end) return { allowed: false, reason: "drop_ended" as const };

  if (!dropRow.is_active) return { allowed: false, reason: "drop_inactive" as const };

  if (!featureFlags.early_drop_enabled) {
    if (now >= start && !dropRow.exclusive_private_drop) return { allowed: true, reason: null };
    if (dropRow.exclusive_private_drop && userId) {
      const accessRes = await adminClient
        .from("drop_access_requests")
        .select("id,access_granted,token_expires_at")
        .eq("user_id", userId)
        .eq("drop_id", dropRow.id)
        .eq("access_granted", true)
        .order("approved_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const hasGranted =
        !accessRes.error &&
        Boolean(accessRes.data) &&
        (!accessRes.data?.token_expires_at || new Date(accessRes.data.token_expires_at).getTime() > Date.now());
      if (hasGranted) return { allowed: true, reason: "invite_only" as const };
    }
    return { allowed: false, reason: "not_started" as const };
  }

  if (!userId) {
    if (now >= start && !dropRow.exclusive_private_drop) return { allowed: true, reason: null };
    return { allowed: false, reason: "login_required" as const };
  }

  const tierInfo = await getUserTierInfo(userId);
  if (tierInfo.allow_all_access) return { allowed: true, reason: "super_royal" as const };
  const requiredTierName = String(dropRow.early_access_tier ?? dropRow.early_access_tier_required ?? "").trim();
  let tierPass = true;
  if (requiredTierName) {
    const normalized = requiredTierName.toUpperCase().replace(/\s+/g, "_");
    if (normalized in TIER_RANK) {
      const requiredRank = TIER_RANK[normalized as ResolvedTier];
      tierPass = tierInfo.resolved_rank >= requiredRank;
    } else {
      const requiredRank = await getTierRankByName(requiredTierName);
      tierPass = tierInfo.rank >= requiredRank;
    }
  }
  const tierEarlyStart = await getDropStartWithTierWindow(dropRow, tierInfo.resolved_tier);

  if (dropRow.exclusive_private_drop) {
    const accessRes = await adminClient
      .from("drop_access_requests")
      .select("id,access_granted,token_expires_at")
      .eq("user_id", userId)
      .eq("drop_id", dropRow.id)
      .eq("access_granted", true)
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const hasGranted =
      !accessRes.error &&
      Boolean(accessRes.data) &&
      (!accessRes.data?.token_expires_at || new Date(accessRes.data.token_expires_at).getTime() > Date.now());
    if (!hasGranted && !tierPass) return { allowed: false, reason: "private_access_required" as const };
  }

  if (now >= start) return { allowed: true, reason: null };
  if (tierPass && now >= tierEarlyStart) return { allowed: true, reason: "early_access" as const };

  return { allowed: false, reason: "not_started" as const };
};

const getRequestIp = (req: ApiRequest): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  const realIp = req.headers["x-real-ip"];
  return (Array.isArray(realIp) ? realIp[0] : realIp) ?? null;
};

const getAmbassadorSettings = async () => {
  const res = await adminClient
    .from("platform_settings")
    .select("ambassador_program_enabled,paid_ambassador_enabled,referral_program_enabled,royal_access_price_inr,early_access_lock_hours")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error || !res.data) {
    return {
      ambassador_program_enabled: true,
      paid_ambassador_enabled: false,
      referral_program_enabled: true,
      royal_access_price_inr: 399,
      early_access_lock_hours: 72,
    };
  }
  return {
    ambassador_program_enabled: Boolean((res.data as any).ambassador_program_enabled ?? true),
    paid_ambassador_enabled: Boolean((res.data as any).paid_ambassador_enabled ?? false),
    referral_program_enabled: Boolean((res.data as any).referral_program_enabled ?? true),
    royal_access_price_inr: Number((res.data as any).royal_access_price_inr ?? 399),
    early_access_lock_hours: [24, 48, 72].includes(Number((res.data as any).early_access_lock_hours))
      ? Number((res.data as any).early_access_lock_hours)
      : 72,
  };
};

const randomCouponCode = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let chunk = "";
  for (let i = 0; i < 4; i += 1) chunk += chars[Math.floor(Math.random() * chars.length)];
  return `ROYAL500-${chunk}`;
};

const truncateForUi = (value: string, maxLen: number): string => {
  const text = String(value ?? "").trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
};

const generateUniqueCouponCode = async (): Promise<string> => {
  for (let i = 0; i < 10; i += 1) {
    const code = randomCouponCode();
    const [socialCheck, discountCheck] = await Promise.all([
      adminClient.from("social_submissions").select("id").eq("coupon_code", code).maybeSingle(),
      adminClient.from("discount_codes").select("id").eq("code", code).maybeSingle(),
    ]);
    if (!socialCheck.error && !socialCheck.data && !discountCheck.error && !discountCheck.data) return code;
  }
  throw new Error("Could not generate unique coupon code");
};

const isAllowedSocialPlatform = (platform: string, url: string): boolean => {
  const u = url.toLowerCase();
  if (platform === "instagram") return u.includes("instagram.com");
  if (platform === "youtube") return u.includes("youtube.com") || u.includes("youtu.be");
  if (platform === "tiktok") return u.includes("tiktok.com");
  if (platform === "facebook") return u.includes("facebook.com") || u.includes("fb.watch");
  return false;
};

const checkPublicUrlAccessible = async (url: string): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    if (head.ok) return true;
    const get = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    return get.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const hashtagsMissing = (caption: string, required: string[]): string[] => {
  const normalizedCaption = caption.toLowerCase();
  return required
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => !normalizedCaption.includes(tag.toLowerCase()));
};

const runSocialRecheckForSubmission = async (submissionId: string, manualViewsSnapshot?: number) => {
  const submissionRes = await adminClient
    .from("social_submissions")
    .select("id,user_id,video_url,views_snapshot,coupon_code,coupon_generated,status")
    .eq("id", submissionId)
    .maybeSingle();
  if (submissionRes.error || !submissionRes.data) return { ok: false as const, reason: "submission_not_found" };

  const submission = submissionRes.data as any;
  const urlLive = await checkPublicUrlAccessible(String(submission.video_url ?? ""));
  const oldViews = Number(submission.views_snapshot ?? 0);
  const newViews = Number(manualViewsSnapshot ?? oldViews);
  const dropped = oldViews > 0 && newViews < oldViews * 0.5;

  if (!urlLive) {
    const revoke = await adminClient
      .from("social_submissions")
      .update({
        recheck_completed: true,
        still_live: false,
        recheck_views_snapshot: newViews,
        flagged_for_review: true,
        is_invalid: true,
        coupon_generated: false,
        coupon_revoked_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
    if (revoke.error) return { ok: false as const, reason: revoke.error.message };

    const userRes = await adminClient.from("users").select("email,name").eq("id", submission.user_id).maybeSingle();
    if (userRes.data?.email) {
      await sendEmail({
        to: userRes.data.email,
        subject: "Social reward coupon revoked",
        html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">Coupon Revoked</h2><p>Your approved social submission is no longer accessible, so the reward coupon has been revoked.</p><p>Please submit a fresh public video to re-apply.</p></div>`,
      });
    }

    return { ok: true as const, revoked: true };
  }

  const update = await adminClient
    .from("social_submissions")
    .update({
      recheck_completed: true,
      still_live: true,
      recheck_views_snapshot: newViews,
      flagged_for_review: dropped,
    })
    .eq("id", submissionId);
  if (update.error) return { ok: false as const, reason: update.error.message };

  return { ok: true as const, revoked: false, flagged: dropped };
};

const fallbackCopy = (input: z.infer<typeof bannerSchema>) => {
  const bank = {
    sporty: {
      headline: `${input.festivalName} is Live. Move Fast.`,
      subtitle: `${input.discountPercent}% OFF on ${input.categoryFocus} built for performance days.`,
      cta: "Shop the Drop",
      urgency: "Limited stock. Speed wins.",
    },
    luxury: {
      headline: `${input.festivalName}: Curated Luxury, Limited Window`,
      subtitle: `Enjoy up to ${input.discountPercent}% OFF on ${input.categoryFocus} with premium finish.`,
      cta: "Explore Collection",
      urgency: "Exclusive pieces. Limited timeline.",
    },
    bold: {
      headline: `${input.festivalName} Starts Now`,
      subtitle: `${input.discountPercent}% OFF on ${input.categoryFocus}. No second window.`,
      cta: "Claim Offer",
      urgency: "Ends soon. Own it before it is gone.",
    },
    emotional: {
      headline: `Celebrate ${input.festivalName} in Signature Style`,
      subtitle: `Save ${input.discountPercent}% on ${input.categoryFocus} and gift your best moments.`,
      cta: "Celebrate & Shop",
      urgency: "Moments pass fast. Offer ends soon.",
    },
  } as const;
  return bank[input.tone];
};

const safeJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const pickErrorText = (payload: Record<string, unknown>): string | undefined => {
  const candidates = ["message", "error", "errors", "status", "detail"];
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) return String(value[0]);
    if (value && typeof value === "object") return JSON.stringify(value);
  }
  return undefined;
};

const pickSuggestedPickupLocation = (payload: Record<string, unknown>): string | null => {
  const dataNode = payload.data;
  if (!dataNode || typeof dataNode !== "object") return null;
  const nestedData = (dataNode as Record<string, unknown>).data;
  if (!Array.isArray(nestedData)) return null;

  const firstActive = nestedData.find((item) => {
    if (!item || typeof item !== "object") return false;
    return (item as Record<string, unknown>).status === 1;
  }) as Record<string, unknown> | undefined;

  const fallback = (nestedData[0] as Record<string, unknown> | undefined) ?? null;
  const chosen = firstActive ?? fallback;
  if (!chosen) return null;
  const location = chosen.pickup_location;
  return typeof location === "string" && location.trim() ? location.trim() : null;
};

const listPickupLocations = (payload: Record<string, unknown>): string[] => {
  const dataNode = payload.data;
  if (!dataNode || typeof dataNode !== "object") return [];
  const nestedData = (dataNode as Record<string, unknown>).data;
  if (!Array.isArray(nestedData)) return [];
  const all = nestedData
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Record<string, unknown>)
    .map((item) => (typeof item.pickup_location === "string" ? item.pickup_location.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(all));
};

const isOrderCreationSuccess = (payload: Record<string, unknown>): boolean => {
  const hasOrderId =
    typeof payload.order_id === "number" ||
    typeof payload.order_id === "string" ||
    typeof payload.shipment_id === "number" ||
    typeof payload.shipment_id === "string";
  if (hasOrderId) return true;
  const message = (typeof payload.message === "string" ? payload.message : "").toLowerCase();
  return !message.includes("wrong pickup location") && !message.includes("error");
};

const getNowDateTime = () => {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(
    now.getMinutes()
  )}`;
};

const buildSuggestion = async (pageId: string) => {
  const [sectionsRes, eventsRes] = await Promise.all([
    adminClient
      .from("home_sections")
      .select("id,section_key,display_order")
      .eq("page_id", pageId)
      .order("display_order", { ascending: true }),
    adminClient
      .from("experience_events")
      .select("event_type,target_id")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(800),
  ]);

  let sections = sectionsRes.data ?? [];
  if (sectionsRes.error) {
    const fallbackSectionsRes = await adminClient
      .from("site_sections")
      .select("id,section_key,display_order")
      .order("display_order", { ascending: true })
      .limit(100);
    if (!fallbackSectionsRes.error) {
      sections = (fallbackSectionsRes.data ?? []).map((row: any) => ({
        id: row.id,
        section_key: row.section_key,
        display_order: row.display_order ?? 0,
      }));
    } else {
      throw sectionsRes.error;
    }
  }
  const events = eventsRes.error ? [] : eventsRes.data ?? [];
  const topCategory =
    events
      .filter((row: any) => row.event_type === "category_click")
      .reduce((acc: Record<string, number>, row: any) => {
        const key = String(row.target_id ?? "").toLowerCase();
        if (!key) return acc;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}) || {};
  const leadingCategory = Object.entries(topCategory).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const ranked = sections
    .map((section: any, idx) => {
      const key = String(section.section_key ?? "").toLowerCase();
      let score = 0;
      if (key.includes("hero")) score += 4;
      if (leadingCategory && key.includes(leadingCategory)) score += 9;
      if (key.includes("men") && leadingCategory.includes("men")) score += 5;
      if (key.includes("watch") && leadingCategory.includes("watch")) score += 6;
      return { id: section.id, section_key: section.section_key, display_order: section.display_order, idx, score };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((item, index) => ({ ...item, display_order: index }));

  const reason = `Based on last 7 days engagement, highlight '${leadingCategory || "top-performing"}' sections earlier.`;
  return { ranked, reason };
};

const applyOrder = async (orderedIds: string[]) => {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const update = await adminClient.from("home_sections").update({ display_order: i }).eq("id", orderedIds[i]);
    if (update.error) throw update.error;
  }
};

export async function handleBannerText(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_festival");
  if (!admin) return sendError(res, 403, "Permission denied");
  const parsed = bannerSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const input = parsed.data;

  const prompt = `Generate premium ecommerce festival banner copy as strict JSON with keys: headline, subtitle, cta, urgency.
Festival: ${input.festivalName}
Discount: ${input.discountPercent}%
Category focus: ${input.categoryFocus}
Tone: ${input.tone}
Max words: headline<=8 subtitle<=14 cta<=4 urgency<=10`;

  const fallback = fallbackCopy(input);
  const aiResult = await aiRouterGenerate({
    task: "structured_reasoning",
    prompt,
    system: "You are a conversion copywriter for premium ecommerce. Return strict JSON only.",
    cacheKey: `banner:${input.festivalName}:${input.discountPercent}:${input.categoryFocus}:${input.tone}`.toLowerCase(),
    fallback,
    ip: getAiClientIp(req),
  });
  const json = (aiResult.data ?? {}) as Record<string, unknown>;

  return res.status(200).json({
    headline: String(json.headline ?? fallback.headline),
    subtitle: String(json.subtitle ?? fallback.subtitle),
    cta: String(json.cta ?? fallback.cta),
    urgency: String(json.urgency ?? fallback.urgency),
    mode: aiResult.mode,
    ai_warning: aiResult.ok ? undefined : aiResult.warning,
    provider: aiResult.ok ? aiResult.provider : undefined,
  });
}

export async function handleSmartLayout(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_festival");
  if (!admin) return sendError(res, 403, "Permission denied");
  const parsed = smartLayoutSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const body = parsed.data;

  if (body.action === "suggest") {
    const suggestion = await buildSuggestion(body.pageId);
    const pageRes = await adminClient.from("home_pages").select("smart_auto_apply").eq("id", body.pageId).maybeSingle();
    const autoApply = Boolean(pageRes.data?.smart_auto_apply);

    const insert = await adminClient
      .from("home_layout_recommendations")
      .insert({
        page_id: body.pageId,
        proposed_order: suggestion.ranked,
        reason: suggestion.reason,
        status: autoApply ? "applied" : "pending",
        created_by: admin.id,
        approved_by: autoApply ? admin.id : null,
      })
      .select("id,page_id,proposed_order,reason,status,created_at")
      .single();

    if (insert.error) {
      return res.status(200).json({
        recommendation: {
          id: "fallback-recommendation",
          page_id: body.pageId,
          proposed_order: suggestion.ranked,
          reason: `${suggestion.reason} (fallback mode: recommendation table missing)`,
          status: "pending",
          created_at: new Date().toISOString(),
        },
      });
    }

    if (autoApply) await applyOrder(suggestion.ranked.map((item) => item.id));
    return res.status(200).json({ recommendation: insert.data });
  }

  if (!body.recommendationId) {
    return res.status(200).json({
      success: true,
      status: "skipped",
      reason: "No recommendation id provided; likely running in fallback mode.",
    });
  }
  const recommendationRes = await adminClient
    .from("home_layout_recommendations")
    .select("id,page_id,proposed_order,status")
    .eq("id", body.recommendationId)
    .maybeSingle();
  if (recommendationRes.error || !recommendationRes.data) {
    return res.status(200).json({
      success: true,
      status: "skipped",
      reason: "Recommendation table unavailable or recommendation missing.",
    });
  }

  if (body.action === "reject") {
    const reject = await adminClient
      .from("home_layout_recommendations")
      .update({ status: "rejected", approved_by: admin.id })
      .eq("id", body.recommendationId);
    if (reject.error) throw reject.error;
    return res.status(200).json({ success: true, status: "rejected" });
  }

  const proposed = Array.isArray((recommendationRes.data as any).proposed_order)
    ? ((recommendationRes.data as any).proposed_order as Array<{ id: string }>)
    : [];
  const orderedIds = proposed.map((item) => item.id).filter(Boolean);
  if (!orderedIds.length) return sendError(res, 400, "Proposed order is empty");
  await applyOrder(orderedIds);
  const approve = await adminClient
    .from("home_layout_recommendations")
    .update({ status: "approved", approved_by: admin.id })
    .eq("id", body.recommendationId);
  if (approve.error) throw approve.error;
  return res.status(200).json({ success: true, status: "approved", appliedCount: orderedIds.length });
}

export async function handleEmailTest(req: ApiRequest, res: ApiResponse) {
  const admin = await requireAdmin(req);
  if (!admin) return sendError(res, 403, "Unauthorized");
  const enabledRaw = (process.env.ENABLE_EMAIL_TEST ?? "true").trim().toLowerCase();
  if (enabledRaw === "false") return sendError(res, 403, "Email test route disabled");
  if (!process.env.RESEND_API_KEY?.trim()) return sendError(res, 500, "Resend failed");
  const parsed = emailSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const adminEmail = process.env.ADMIN_EMAIL?.trim() || process.env.RESEND_TEST_TO?.trim() || parsed.data.to?.trim() || "";
  if (!adminEmail) return sendError(res, 400, "Resend failed");

  const subject = parsed.data.subject || "ZARELON Email Test";
  const html = `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">Email Test</h2><p>This is a test email from /api/email/test.</p><p style="margin-top:12px">Sent at: ${new Date().toISOString()}</p></div>`;
  const result = await sendEmail({ to: adminEmail, subject, html, dedupeKey: `email-test:${adminEmail}:${subject}` });
  if (!result.ok) return sendError(res, 500, "Resend failed");
  return res.status(200).json({ ok: true, provider: "resend", email_sent: true });
}

export async function handleSocialSubmissionsUser(req: ApiRequest, res: ApiResponse) {
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  if (!(await isFeatureEnabled("creator_program_enabled"))) return sendError(res, 403, "Creator program is disabled");

  if (req.method === "GET") {
    const { data, error } = await adminClient
      .from("social_submissions")
      .select(
        "id,platform,video_url,followers_count,views_snapshot,status,submitted_at,verified_at,coupon_code,coupon_generated,coupon_expires_at,caption,recheck_scheduled_at,recheck_completed,still_live,recheck_views_snapshot,is_featured,flagged_for_review,is_invalid,campaign:social_campaigns(name,discount_amount,min_followers,min_views,min_days_live,required_hashtags)"
      )
      .eq("user_id", user.id)
      .order("submitted_at", { ascending: false });
    if (error) return sendError(res, 400, error.message);
    return res.status(200).json({ submissions: data ?? [] });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = socialSubmissionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const payload = parsed.data;
  const videoUrl = normalizeVideoUrl(payload.video_url);
  const caption = payload.caption?.trim() ?? "";

  const campaignRes = await adminClient
    .from("social_campaigns")
    .select("id,name,discount_amount,min_followers,min_views,min_days_live,required_hashtags,is_active")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (campaignRes.error) return sendError(res, 400, campaignRes.error.message);
  if (!campaignRes.data) return sendError(res, 400, "No active campaign available");
  if (!isAllowedSocialPlatform(payload.platform, videoUrl)) {
    return sendError(res, 400, "Video URL does not match selected platform");
  }
  if (Number(payload.followers_count ?? 0) < Number(campaignRes.data.min_followers ?? 0)) {
    return sendError(res, 400, `Minimum followers required: ${campaignRes.data.min_followers}`);
  }
  if (caption && Array.isArray(campaignRes.data.required_hashtags) && campaignRes.data.required_hashtags.length) {
    const missing = hashtagsMissing(caption, campaignRes.data.required_hashtags as string[]);
    if (missing.length) {
      return sendError(res, 400, `Required hashtags missing: ${missing.join(", ")}`);
    }
  }
  const isPublic = await checkPublicUrlAccessible(videoUrl);
  if (!isPublic) return sendError(res, 400, "Video URL must be publicly accessible");

  const duplicateVideo = await adminClient
    .from("social_submissions")
    .select("id")
    .eq("video_url", videoUrl)
    .limit(1)
    .maybeSingle();
  if (duplicateVideo.error) return sendError(res, 400, duplicateVideo.error.message);
  if (duplicateVideo.data) return sendError(res, 409, "This video URL has already been submitted");

  const pendingSubmission = await adminClient
    .from("social_submissions")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (pendingSubmission.error) return sendError(res, 400, pendingSubmission.error.message);
  if (pendingSubmission.data) return sendError(res, 409, "You already have a pending submission");

  const cooldownStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cooldownSubmission = await adminClient
    .from("social_submissions")
    .select("id,verified_at")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .gte("verified_at", cooldownStart)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cooldownSubmission.error) return sendError(res, 400, cooldownSubmission.error.message);
  if (cooldownSubmission.data) return sendError(res, 429, "Next submission allowed 30 days after last approved one");

  const insert = await adminClient
    .from("social_submissions")
    .insert({
      user_id: user.id,
      campaign_id: campaignRes.data.id,
      platform: payload.platform,
      video_url: videoUrl,
      followers_count: payload.followers_count,
      views_snapshot: Number(payload.views_snapshot ?? 0),
      caption: caption || null,
      submitted_url_public: true,
      precheck_errors: [],
      status: "pending",
    })
    .select("id,status,submitted_at")
    .single();
  if (insert.error || !insert.data) return sendError(res, 400, insert.error?.message ?? "Submission failed");

  return res.status(200).json({
    ok: true,
    submission: insert.data,
    campaign: {
      id: campaignRes.data.id,
      name: campaignRes.data.name,
      discount_amount: campaignRes.data.discount_amount,
      min_followers: campaignRes.data.min_followers,
      min_views: campaignRes.data.min_views,
      min_days_live: campaignRes.data.min_days_live,
      required_hashtags: campaignRes.data.required_hashtags ?? [],
    },
  });
}

export async function handleSocialSubmissionsAdmin(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");
  if (!(await isFeatureEnabled("creator_program_enabled"))) return sendError(res, 403, "Creator program is disabled");

  if (req.method === "GET") {
    const period = (Array.isArray(req.query?.period) ? req.query.period[0] : req.query?.period ?? "7d").toLowerCase();
    const now = new Date();
    let from: string | undefined;
    let to: string | undefined;

    if (period === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
      to = now.toISOString();
    } else if (period === "7d") {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      to = now.toISOString();
    } else if (period === "1m" || period === "30d") {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      to = now.toISOString();
    } else if (period === "custom") {
      const rawFrom = Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from;
      const rawTo = Array.isArray(req.query?.to) ? req.query.to[0] : req.query?.to;
      if (rawFrom && !Number.isNaN(new Date(rawFrom).getTime())) from = new Date(rawFrom).toISOString();
      if (rawTo && !Number.isNaN(new Date(rawTo).getTime())) to = new Date(rawTo).toISOString();
    }

    let query = adminClient
      .from("social_submissions")
      .select(
        "id,user_id,platform,video_url,followers_count,views_snapshot,status,submitted_at,verified_at,coupon_code,coupon_generated,coupon_expires_at,caption,recheck_scheduled_at,recheck_completed,still_live,recheck_views_snapshot,is_featured,flagged_for_review,is_invalid,submitted_url_public,precheck_errors,campaign:social_campaigns(id,name,discount_amount,min_followers,min_views,min_days_live,required_hashtags),user:users(id,name,email)"
      )
      .order("submitted_at", { ascending: false });
    if (from) query = query.gte("submitted_at", from);
    if (to) query = query.lte("submitted_at", to);

    const rows = await query.limit(500);
    if (rows.error) return sendError(res, 400, rows.error.message);
    return res.status(200).json({ submissions: rows.data ?? [] });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = socialReviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const { submission_id: submissionId, action, current_views_snapshot: currentViewsSnapshot } = parsed.data;

  const submissionRes = await adminClient
    .from("social_submissions")
    .select(
      "id,user_id,status,coupon_generated,coupon_code,campaign_id,is_featured,platform,video_url,followers_count,views_snapshot,caption,submitted_url_public,precheck_errors"
    )
    .eq("id", submissionId)
    .maybeSingle();
  if (submissionRes.error) return sendError(res, 400, submissionRes.error.message);
  if (!submissionRes.data) return sendError(res, 404, "Submission not found");

  if (action === "pin" || action === "unpin") {
    const pinned = action === "pin";
    const pinUpdate = await adminClient
      .from("social_submissions")
      .update({
        is_featured: pinned,
        featured_order: pinned ? 0 : null,
      })
      .eq("id", submissionId)
      .eq("status", "approved");
    if (pinUpdate.error) return sendError(res, 400, pinUpdate.error.message);
    return res.status(200).json({ ok: true, status: pinned ? "pinned" : "unpinned" });
  }

  if (action === "recheck") {
    const result = await runSocialRecheckForSubmission(submissionId, currentViewsSnapshot);
    if (!result.ok) return sendError(res, 400, "Recheck failed");
    return res.status(200).json({ ok: true, status: "rechecked", result });
  }

  if (action === "reject") {
    const reject = await adminClient
      .from("social_submissions")
      .update({
        status: "rejected",
        verified_at: new Date().toISOString(),
        coupon_generated: false,
      })
      .eq("id", submissionId);
    if (reject.error) return sendError(res, 400, reject.error.message);
    return res.status(200).json({ ok: true, status: "rejected" });
  }

  if (submissionRes.data.status !== "pending") {
    return sendError(res, 409, "Only pending submissions can be approved");
  }
  if (submissionRes.data.status === "approved" || submissionRes.data.coupon_generated) {
    return sendError(res, 409, "Coupon already generated for this submission");
  }

  const campaignRes = await adminClient
    .from("social_campaigns")
    .select("id,name,discount_amount,is_active,min_days_live,min_followers,min_views,required_hashtags")
    .eq("id", submissionRes.data.campaign_id)
    .maybeSingle();
  if (campaignRes.error) return sendError(res, 400, campaignRes.error.message);
  if (!campaignRes.data || !campaignRes.data.is_active) return sendError(res, 400, "Campaign is not active");

  // Strict re-validation at approval-time to prevent bypasses.
  const approvalErrors: string[] = [];
  const videoUrl = String((submissionRes.data as any).video_url ?? "");
  const platform = String((submissionRes.data as any).platform ?? "");
  const followers = Number((submissionRes.data as any).followers_count ?? 0);
  const views = Number((submissionRes.data as any).views_snapshot ?? 0);
  const caption = String((submissionRes.data as any).caption ?? "");
  const requiredTags = Array.isArray(campaignRes.data.required_hashtags)
    ? (campaignRes.data.required_hashtags as string[])
    : [];

  if (!videoUrl) approvalErrors.push("Missing video URL");
  if (!isAllowedSocialPlatform(platform, videoUrl)) approvalErrors.push("Video URL does not match selected platform");
  if (followers < Number(campaignRes.data.min_followers ?? 0)) {
    approvalErrors.push(`Minimum followers required: ${campaignRes.data.min_followers}`);
  }
  if (views < Number(campaignRes.data.min_views ?? 0)) {
    approvalErrors.push(`Minimum views required: ${campaignRes.data.min_views}`);
  }
  if (requiredTags.length) {
    const missing = hashtagsMissing(caption, requiredTags);
    if (missing.length) approvalErrors.push(`Required hashtags missing: ${missing.join(", ")}`);
  }
  const isStillPublic = videoUrl ? await checkPublicUrlAccessible(videoUrl) : false;
  if (!isStillPublic) approvalErrors.push("Video URL is not publicly accessible");

  if (approvalErrors.length) {
    await adminClient
      .from("social_submissions")
      .update({
        precheck_errors: approvalErrors,
        submitted_url_public: isStillPublic,
        flagged_for_review: true,
      })
      .eq("id", submissionId);
    return sendError(res, 422, approvalErrors[0]);
  }

  const code = await generateUniqueCouponCode();
  const nowTs = Date.now();
  const expiresAt = new Date(nowTs + 15 * 24 * 60 * 60 * 1000).toISOString();
  const recheckAt = new Date(nowTs + Number(campaignRes.data.min_days_live ?? 5) * 24 * 60 * 60 * 1000).toISOString();
  const discountAmount = Number(campaignRes.data.discount_amount ?? 500);
  const minOrderAmount = 1000;

  const discountCreate = await adminClient.from("discount_codes").insert({
    code,
    title: `Social Reward - ${campaignRes.data.name ?? "Campaign"}`,
    discount_type: "fixed",
    discount_value: discountAmount,
    min_order_inr: minOrderAmount,
    max_discount_inr: discountAmount,
    total_usage_limit: 1,
    per_user_limit: 1,
    used_count: 0,
    starts_at: new Date(nowTs).toISOString(),
    expires_at: expiresAt,
    active: true,
    created_by: admin.id,
  });
  if (discountCreate.error) return sendError(res, 400, discountCreate.error.message);

  const approve = await adminClient
    .from("social_submissions")
    .update({
      status: "approved",
      verified_at: new Date(nowTs).toISOString(),
      coupon_code: code,
      coupon_generated: true,
      coupon_expires_at: expiresAt,
      coupon_discount_amount: discountAmount,
      coupon_min_order_amount: minOrderAmount,
      coupon_usage_limit: 1,
      coupon_used_count: 0,
      recheck_scheduled_at: recheckAt,
      recheck_completed: false,
      still_live: true,
      is_invalid: false,
    })
    .eq("id", submissionId)
    .eq("coupon_generated", false);
  if (approve.error) return sendError(res, 400, approve.error.message);

  await adminClient.from("admin_audit_logs").insert({
    admin_user_id: admin.id,
    action: "social_submission_approved",
    entity_type: "social_submissions",
    entity_id: submissionId,
    diff: {
      coupon_code: code,
      coupon_expires_at: expiresAt,
      coupon_discount_amount: discountAmount,
      coupon_min_order_amount: minOrderAmount,
    },
  });

  const userRes = await adminClient
    .from("users")
    .select("email,name")
    .eq("id", submissionRes.data.user_id)
    .maybeSingle();
  if (userRes.data?.email) {
    const customerName = String(userRes.data.name ?? "Creator").trim() || "Creator";
    await sendEmail({
      to: userRes.data.email,
      subject: `Your Rs ${discountAmount} OFF coupon is approved`,
      html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">Coupon Approved</h2><p>Hi ${customerName}, your social submission is approved.</p><p>Your one-time coupon: <strong>${code}</strong></p><p>Discount: Rs ${discountAmount} OFF | Minimum order: Rs ${minOrderAmount}</p><p>Valid till: ${new Date(expiresAt).toLocaleString()}</p></div>`,
    });
  }

  return res.status(200).json({
    ok: true,
    status: "approved",
    coupon: {
      code,
      discount_amount: discountAmount,
      min_order_amount: minOrderAmount,
      valid_until: expiresAt,
      one_time_use: true,
    },
  });
}

export async function handleSocialRecheckRun(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");
  if (!(await isFeatureEnabled("creator_program_enabled"))) return sendError(res, 403, "Creator program is disabled");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

  const nowIso = new Date().toISOString();
  const dueRes = await adminClient
    .from("social_submissions")
    .select("id")
    .eq("status", "approved")
    .eq("coupon_generated", true)
    .eq("recheck_completed", false)
    .lte("recheck_scheduled_at", nowIso)
    .order("recheck_scheduled_at", { ascending: true })
    .limit(100);
  if (dueRes.error) return sendError(res, 400, dueRes.error.message);

  const results: Array<Record<string, unknown>> = [];
  for (const row of dueRes.data ?? []) {
    const item = await runSocialRecheckForSubmission(String((row as any).id));
    results.push({ id: (row as any).id, ...item });
  }
  return res.status(200).json({ ok: true, processed: results.length, results });
}

export async function handleSocialLeaderboard(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  if (!(await isFeatureEnabled("leaderboard_enabled"))) {
    return res.status(200).json({ leaderboard: [], monthly_winners: [], spotlight: [], disabled: true });
  }
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const rowsRes = await adminClient
    .from("social_submissions")
    .select("id,user_id,platform,views_snapshot,status,is_invalid,still_live,submitted_at,user:users(id,name,email)")
    .eq("status", "approved")
    .eq("is_invalid", false)
    .eq("still_live", true)
    .gte("submitted_at", monthStart.toISOString())
    .order("views_snapshot", { ascending: false })
    .limit(300);
  if (rowsRes.error) return sendError(res, 400, rowsRes.error.message);

  const rows = rowsRes.data ?? [];
  const grouped = new Map<string, { user: any; views: number; approved_count: number; engagement_score: number; platform: string }>();
  rows.forEach((row: any) => {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    if (!user?.id) return;
    const current = grouped.get(user.id) ?? {
      user,
      views: 0,
      approved_count: 0,
      engagement_score: 0,
      platform: row.platform,
    };
    current.views += Number(row.views_snapshot ?? 0);
    current.approved_count += 1;
    current.engagement_score += Number(row.views_snapshot ?? 0) / Math.max(1, current.approved_count);
    grouped.set(user.id, current);
  });

  const userIds = Array.from(grouped.keys());
  const eliteByUserId = new Map<string, string>();
  if (userIds.length) {
    const eliteRes = await adminClient
      .from("elite_progress")
      .select("user_id,current_tier:elite_tiers!elite_progress_current_tier_id_fkey(name)")
      .in("user_id", userIds);
    if (!eliteRes.error) {
      for (const row of eliteRes.data ?? []) {
        const tier = Array.isArray((row as any).current_tier) ? (row as any).current_tier[0] : (row as any).current_tier;
        eliteByUserId.set(String((row as any).user_id), String(tier?.name ?? ""));
      }
    }
  }

  const leaderboard = Array.from(grouped.values())
    .sort((a, b) => b.views - a.views)
    .map((item) => ({
      user_id: item.user.id,
      username: item.user.name ?? item.user.email ?? "Creator",
      platform: item.platform,
      views: item.views,
      engagement: Math.round(item.engagement_score),
      approved_submissions: item.approved_count,
      badge: "Royal Creator",
      elite_tier: eliteByUserId.get(String(item.user.id)) || null,
    }))
    .slice(0, 50);
  const topThree = leaderboard.slice(0, 3).map((row, index) => ({
    ...row,
    contest_rank: index + 1,
    contest_reward: index === 0 ? "Extra voucher + homepage spotlight" : index === 1 ? "Extra voucher" : "Special badge",
  }));

  const spotlightRes = await adminClient
    .from("social_submissions")
    .select("id,user_id,platform,video_url,views_snapshot,is_featured,user:users(id,name,email)")
    .eq("status", "approved")
    .eq("is_invalid", false)
    .eq("still_live", true)
    .eq("is_featured", true)
    .order("featured_order", { ascending: true })
    .limit(12);

  return res.status(200).json({
    leaderboard,
    monthly_winners: topThree,
    spotlight: (spotlightRes.data ?? []).map((row: any) => ({
      id: row.id,
      platform: row.platform,
      video_url: row.video_url,
      views_snapshot: row.views_snapshot,
      user_name: (Array.isArray(row.user) ? row.user[0] : row.user)?.name ?? "Creator",
    })),
  });
}

export async function handleCreatorTrack(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  if (!(await isFeatureEnabled("creator_program_enabled"))) return sendError(res, 403, "Creator program is disabled");
  const refRaw =
    (Array.isArray(req.query?.ref) ? req.query.ref[0] : req.query?.ref) ||
    (typeof req.body?.ref === "string" ? req.body.ref : "");
  const parsed = creatorTrackSchema.safeParse({ ref: refRaw });
  if (!parsed.success) return sendError(res, 400, "Invalid creator ref");

  const user = await requireUser(req);
  const result = await trackCreatorClick({
    creatorCode: parsed.data.ref.toUpperCase(),
    userId: user?.id ?? null,
    ipAddress: getRequestIp(req),
    userAgent: (Array.isArray(req.headers["user-agent"]) ? req.headers["user-agent"][0] : req.headers["user-agent"]) ?? null,
  });
  if (!result.ok) return sendError(res, 400, "Could not track creator ref");
  return res.status(200).json({ ok: true, tracked: !result.skipped, reason: result.reason ?? null });
}

export async function handleCreatorDashboard(req: ApiRequest, res: ApiResponse) {
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  if (!(await isFeatureEnabled("creator_program_enabled"))) return sendError(res, 403, "Creator program is disabled");
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");

  await adminClient.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      name: (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : user.email?.split("@")[0]) ?? null,
    },
    { onConflict: "id" }
  );

  await refreshCreatorTierForUser(user.id);
  const ensuredCode = await ensureUserReferralCode(user.id);

  const userRes = await adminClient
    .from("users")
    .select(
      "id,name,email,referral_code,total_creator_views,total_approved_submissions,creator_tier_id,creator_tier:creator_tiers(id,name,min_approved_submissions,min_total_views,badge_color,reward_bonus)"
    )
    .eq("id", user.id)
    .maybeSingle();
  if (userRes.error || !userRes.data) return sendError(res, 400, userRes.error?.message ?? "User not found");

  const submissionsRes = await adminClient
    .from("social_submissions")
    .select("id,status,coupon_code,coupon_generated,coupon_expires_at")
    .eq("user_id", user.id);
  if (submissionsRes.error) return sendError(res, 400, submissionsRes.error.message);
  const totalSubmissions = (submissionsRes.data ?? []).length;
  const earnedCoupons = (submissionsRes.data ?? []).filter((row: any) => row.coupon_generated && row.coupon_code);
  const referralsRes = await adminClient
    .from("referrals")
    .select(
      "id,referred_user_id,purchase_amount,reward_given,created_at,friend:users!referrals_referred_user_id_fkey(id,name,email)"
    )
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (referralsRes.error) return sendError(res, 400, referralsRes.error.message);

  const tiersRes = await adminClient
    .from("creator_tiers")
    .select("id,name,min_approved_submissions,min_total_views,badge_color,reward_bonus")
    .eq("is_active", true)
    .order("min_approved_submissions", { ascending: true })
    .order("min_total_views", { ascending: true });
  const tiers = tiersRes.data ?? [];

  const currentTier = (Array.isArray((userRes.data as any).creator_tier) ? (userRes.data as any).creator_tier[0] : (userRes.data as any).creator_tier) ?? null;
  const approved = Number((userRes.data as any).total_approved_submissions ?? 0);
  const views = Number((userRes.data as any).total_creator_views ?? 0);
  const nextTier =
    tiers.find(
      (tier: any) =>
        Number(tier.min_approved_submissions ?? 0) > approved || Number(tier.min_total_views ?? 0) > views
    ) ?? null;

  const approvedProgress = nextTier
    ? Math.min(100, Math.round((approved / Math.max(1, Number(nextTier.min_approved_submissions))) * 100))
    : 100;
  const viewsProgress = nextTier
    ? Math.min(100, Math.round((views / Math.max(1, Number(nextTier.min_total_views))) * 100))
    : 100;

  return res.status(200).json({
    ok: true,
    creator: {
      id: userRes.data.id,
      name: userRes.data.name,
      referral_code: userRes.data.referral_code ?? ensuredCode,
      total_submissions: totalSubmissions,
      approved_count: approved,
      total_views: views,
      current_tier: currentTier,
      next_tier: nextTier,
      progress: {
        approved_percent: approvedProgress,
        views_percent: viewsProgress,
      },
      earned_coupons: earnedCoupons,
      referrals: (referralsRes.data ?? []).map((row: any) => ({
        id: row.id,
        referred_user_id: row.referred_user_id,
        purchase_amount: row.purchase_amount,
        reward_given: Boolean(row.reward_given),
        created_at: row.created_at,
        friend: {
          id: (Array.isArray(row.friend) ? row.friend[0] : row.friend)?.id ?? row.referred_user_id,
          name: (Array.isArray(row.friend) ? row.friend[0] : row.friend)?.name ?? "New user",
          email: (Array.isArray(row.friend) ? row.friend[0] : row.friend)?.email ?? null,
        },
      })),
    },
  });
}

export async function handleRoyalAccessOrder(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  if (!serverEnv.razorpayKeyId || !serverEnv.razorpayKeySecret) return sendError(res, 500, "Razorpay not configured");

  const featureFlags = await getFeatureFlags();
  if (!featureFlags.ambassador_program_enabled || !featureFlags.royal_access_enabled) {
    return sendError(res, 400, "Royal Access is currently disabled");
  }

  const rate = await enforceRateLimit({
    eventType: "royal_access_order_create",
    maxHits: 8,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: getRequestIp(req),
  });
  if (!rate.allowed) return sendError(res, 429, "Too many attempts. Please retry later.");

  const settings = await getAmbassadorSettings();
  const currentMonthlyPriceInr = Math.max(1, Number(settings.royal_access_price_inr ?? 399));
  const historyRes = await adminClient
    .from("royal_access_passes")
    .select("amount_paid")
    .eq("user_id", user.id)
    .gt("amount_paid", 0)
    .order("created_at", { ascending: false })
    .limit(100);
  const historicalBestPrice =
    historyRes.error || !(historyRes.data?.length ?? 0)
      ? null
      : Math.min(...(historyRes.data ?? []).map((row: any) => Math.max(1, Number(row.amount_paid ?? currentMonthlyPriceInr))));
  // Loyalty price lock: user never pays more than previous best, but receives lower global prices automatically.
  const monthlyPriceInr =
    historicalBestPrice == null ? currentMonthlyPriceInr : Math.min(currentMonthlyPriceInr, historicalBestPrice);
  const amountPaise = Math.round(monthlyPriceInr * 100);
  const receipt = `royal_${crypto.randomBytes(8).toString("hex")}`;
  const razorpay = new Razorpay({ key_id: serverEnv.razorpayKeyId, key_secret: serverEnv.razorpayKeySecret });
  const order = await razorpay.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes: { purchase_type: "royal_access", user_id: user.id, monthly_price_inr: String(monthlyPriceInr) },
  });

  const pending = await adminClient.from("royal_access_passes").insert({
    user_id: user.id,
    amount_paid: monthlyPriceInr,
    payment_ref: order.id,
    is_active: false,
    expires_at: null,
  });
  if (pending.error) return sendError(res, 400, pending.error.message);

  return res.status(200).json({
    ok: true,
    razorpayOrderId: order.id,
    amount: amountPaise,
    currency: "INR",
    monthly_price_inr: monthlyPriceInr,
    loyalty_price_applied: historicalBestPrice != null && monthlyPriceInr < currentMonthlyPriceInr,
  });
}

export async function handleRoyalAccessVerify(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  if (!serverEnv.razorpayKeySecret) return sendError(res, 500, "Razorpay not configured");
  const parsed = royalAccessVerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const featureFlags = await getFeatureFlags();
  if (!featureFlags.ambassador_program_enabled || !featureFlags.royal_access_enabled) {
    return sendError(res, 400, "Royal Access is currently disabled");
  }

  const rate = await enforceRateLimit({
    eventType: "royal_access_verify_attempt",
    maxHits: 12,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: getRequestIp(req),
  });
  if (!rate.allowed) return sendError(res, 429, "Too many verification attempts. Please retry later.");

  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;
  const signature = crypto
    .createHmac("sha256", serverEnv.razorpayKeySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  const expectedSig = Buffer.from(signature, "utf8");
  const incomingSig = Buffer.from(razorpaySignature, "utf8");
  if (expectedSig.length !== incomingSig.length || !crypto.timingSafeEqual(expectedSig, incomingSig)) {
    return sendError(res, 400, "Signature verification failed");
  }

  const pendingRes = await adminClient
    .from("royal_access_passes")
    .select("id")
    .eq("user_id", user.id)
    .eq("payment_ref", razorpayOrderId)
    .eq("is_active", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingRes.error) return sendError(res, 400, pendingRes.error.message);
  if (!pendingRes.data?.id) return sendError(res, 404, "Royal Access payment record not found");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await adminClient.from("royal_access_passes").update({ is_active: false }).eq("user_id", user.id).eq("is_active", true);
  const activate = await adminClient
    .from("royal_access_passes")
    .update({
      is_active: true,
      granted_at: now.toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", pendingRes.data.id);
  if (activate.error) return sendError(res, 400, activate.error.message);

  const updateUser = await adminClient
    .from("users")
    .update({
      royal_access_active: true,
      royal_access_expires_at: expiresAt,
    })
    .eq("id", user.id);
  if (updateUser.error) return sendError(res, 400, updateUser.error.message);

  return res.status(200).json({ ok: true, unlocked: true, tier: "ROYAL_ACCESS", expires_at: expiresAt });
}

export async function handleReferralReminder(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const parsed = referralReminderSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const referralRes = await adminClient
    .from("referrals")
    .select("id,referrer_id,referred_user_id,reward_given,friend:users!referrals_referred_user_id_fkey(id,name,email)")
    .eq("id", parsed.data.referral_id)
    .maybeSingle();
  if (referralRes.error) return sendError(res, 400, referralRes.error.message);
  if (!referralRes.data) return sendError(res, 404, "Referral not found");
  if (String(referralRes.data.referrer_id) !== user.id) return sendError(res, 403, "Not allowed");
  if (referralRes.data.reward_given) return sendError(res, 400, "Referral already converted");

  const recentReminder = await adminClient
    .from("referral_reminders")
    .select("id")
    .eq("referral_id", parsed.data.referral_id)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recentReminder.error) return sendError(res, 400, recentReminder.error.message);
  if (recentReminder.data) return sendError(res, 429, "Reminder already sent in last 24 hours");

  const cfgRes = await adminClient
    .from("referral_config")
    .select("min_purchase_amount,friend_reward,referrer_reward")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cfgRes.error) return sendError(res, 400, cfgRes.error.message);

  const minOrder = Number(cfgRes.data?.min_purchase_amount ?? 1000);
  const friendReward = Number(cfgRes.data?.friend_reward ?? 150);
  const referrerReward = Number(cfgRes.data?.referrer_reward ?? 200);
  const friend = Array.isArray((referralRes.data as any).friend)
    ? (referralRes.data as any).friend[0]
    : (referralRes.data as any).friend;

  const message = `Hey ${friend?.name ?? "there"}! Your friend invited you to ZARELON. Complete your first delivered order above ₹${minOrder} and unlock your reward. You get ₹${friendReward} OFF and your friend gets ₹${referrerReward} OFF. Limited time benefit - shop your premium picks now.`;

  const notificationInsert = await adminClient.from("user_notifications").insert({
    user_id: referralRes.data.referred_user_id,
    type: "referral_reminder",
    title: "Referral Reward Waiting",
    message,
    meta: {
      referral_id: referralRes.data.id,
      min_order_value: minOrder,
      friend_reward: friendReward,
      referrer_reward: referrerReward,
    },
  });
  if (notificationInsert.error) return sendError(res, 400, notificationInsert.error.message);

  await adminClient.from("referral_reminders").insert({
    referral_id: referralRes.data.id,
    referrer_id: user.id,
    referred_user_id: referralRes.data.referred_user_id,
    message,
  });

  if (friend?.email) {
    await sendEmail({
      to: friend.email,
      subject: "Your referral reward is waiting at ZARELON",
      html: `<div style="font-family:Inter,sans-serif;background:#0D0D0D;color:#F5F5F5;padding:24px"><h2 style="color:#D8AE43">Your friend invited you</h2><p>${message}</p><p style="margin-top:14px">Complete a delivered order above ₹${minOrder} to unlock benefits.</p></div>`,
    });
  }

  return res.status(200).json({ ok: true, reminded: true });
}

export async function handleAdminCreatorAnalytics(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const [ordersAdmin, analyticsAdmin] = await Promise.all([
    requirePermission(req, "can_manage_orders"),
    requirePermission(req, "can_view_analytics"),
  ]);
  const admin = ordersAdmin ?? analyticsAdmin;
  if (!admin) return sendError(res, 403, "Permission denied");

  const period = (Array.isArray(req.query?.period) ? req.query.period[0] : req.query?.period ?? "7d").toLowerCase();
  const now = new Date();
  let from: string | undefined;
  let to: string | undefined;
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    from = start.toISOString();
    to = now.toISOString();
  } else if (period === "7d") {
    from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    to = now.toISOString();
  } else if (period === "30d" || period === "1m") {
    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    to = now.toISOString();
  } else if (period === "custom") {
    const rawFrom = Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from;
    const rawTo = Array.isArray(req.query?.to) ? req.query.to[0] : req.query?.to;
    if (rawFrom && !Number.isNaN(new Date(rawFrom).getTime())) from = new Date(rawFrom).toISOString();
    if (rawTo && !Number.isNaN(new Date(rawTo).getTime())) to = new Date(rawTo).toISOString();
  }

  let query = adminClient
    .from("creator_referrals")
    .select("creator_id,creator_code,click_count,purchase_count,revenue_generated,bonus_reward_total,user:users(id,name,email)")
    .order("revenue_generated", { ascending: false })
    .limit(500);
  if (from) query = query.gte("updated_at", from);
  if (to) query = query.lte("updated_at", to);
  const rowsRes = await query;
  if (rowsRes.error) return sendError(res, 400, rowsRes.error.message);

  const rows = (rowsRes.data ?? []).map((row: any) => {
    const clicks = Number(row.click_count ?? 0);
    const purchases = Number(row.purchase_count ?? 0);
    const conversion = clicks > 0 ? Number(((purchases / clicks) * 100).toFixed(2)) : 0;
    return {
      creator_id: row.creator_id,
      creator_code: row.creator_code,
      creator_name: (Array.isArray(row.user) ? row.user[0] : row.user)?.name ?? "Creator",
      click_count: clicks,
      purchase_count: purchases,
      revenue_generated: Number(row.revenue_generated ?? 0),
      bonus_reward_total: Number(row.bonus_reward_total ?? 0),
      conversion_rate: conversion,
      roi: Number(row.revenue_generated ?? 0) - Number(row.bonus_reward_total ?? 0),
    };
  });

  const topRevenue = [...rows].sort((a, b) => b.revenue_generated - a.revenue_generated).slice(0, 10);
  const topEngagement = [...rows].sort((a, b) => b.click_count - a.click_count).slice(0, 10);
  return res.status(200).json({
    ok: true,
    filters: { period, from, to },
    top_revenue_creators: topRevenue,
    top_engagement_creators: topEngagement,
    creators: rows,
  });
}

export async function handleSocialCaptionGenerate(req: ApiRequest, res: ApiResponse) {
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = socialCaptionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const campaignRes = await adminClient
    .from("social_campaigns")
    .select("required_hashtags,is_active")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const requiredTags = Array.isArray(campaignRes.data?.required_hashtags) ? campaignRes.data?.required_hashtags : [];

  const base = parsed.data.base_text?.trim() || "Crafted for timeless everyday luxury.";
  const hashtags = requiredTags.slice(0, 3).join(" ");
  const fallback = `${base} ${hashtags}`.trim().slice(0, 150);
  const prompt = `Write one premium luxury social caption under 150 characters.
Must include these hashtags: ${requiredTags.join(", ")}.
Tone: luxury.
Base context: ${parsed.data.base_text ?? "ZARELON premium fashion"}.
Return plain text only (no markdown, no quotes).`;

  const aiResult = await aiRouterGenerate({
    task: "short_text",
    prompt,
    system: "You write concise luxury captions for ecommerce social media.",
    cacheKey: `caption:${base}:${hashtags}`.toLowerCase(),
    fallback,
    maxChars: 150,
    ip: getAiClientIp(req),
  });
  const caption = String(aiResult.data ?? fallback).slice(0, 150);
  return res.status(200).json({
    caption,
    mode: aiResult.mode,
    ai_warning: aiResult.ok ? undefined : aiResult.warning,
    provider: aiResult.ok ? aiResult.provider : undefined,
  });
}

export async function handleReferralValidate(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = referralValidateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const code = normalizeReferralCode(parsed.data.referral_code);

  const userRes = await adminClient.from("users").select("id,name,email").eq("referral_code", code).maybeSingle();
  if (userRes.error) return sendError(res, 400, userRes.error.message);
  if (!userRes.data) return sendError(res, 404, "Referral code not found");

  return res.status(200).json({
    ok: true,
    referrer: {
      id: userRes.data.id,
      name: userRes.data.name ?? "ZARELON Member",
      email: userRes.data.email ?? null,
    },
  });
}

export async function handleReferralApply(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const parsed = referralApplySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const code = normalizeReferralCode(parsed.data.referral_code);
  const fingerprint = parsed.data.device_fingerprint?.trim() || null;
  const ip = getRequestIp(req);
  const rate = await enforceRateLimit({
    eventType: "referral_apply_attempt",
    maxHits: 8,
    windowMs: 60 * 60 * 1000,
    userId: user.id,
    ipAddress: ip,
  });
  if (!rate.allowed) return sendError(res, 429, "Too many referral attempts. Please try again later.");

  const profileRes = await adminClient.from("users").select("id,referred_by,referral_code").eq("id", user.id).maybeSingle();
  if (profileRes.error || !profileRes.data) return sendError(res, 400, profileRes.error?.message ?? "Profile not found");
  if (profileRes.data.referred_by) {
    return res.status(200).json({ ok: true, applied: false, reason: "already_referred" });
  }

  const settings = await getAmbassadorSettings();
  if (!settings.referral_program_enabled) return sendError(res, 400, "Referral program is disabled");

  const cfgRes = await adminClient
    .from("referral_config")
    .select("id,is_active")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cfgRes.error) return sendError(res, 400, cfgRes.error.message);
  if (!cfgRes.data?.is_active) return sendError(res, 400, "Referral program is not active");

  const referrerRes = await adminClient.from("users").select("id,referral_code").eq("referral_code", code).maybeSingle();
  if (referrerRes.error) return sendError(res, 400, referrerRes.error.message);
  if (!referrerRes.data) return sendError(res, 404, "Referral code not found");
  if (referrerRes.data.id === user.id) return sendError(res, 400, "Self referral is not allowed");

  if (ip) {
    const recentIpRes = await adminClient
      .from("payment_risk_events")
      .select("id")
      .eq("event_type", "referral_signup_ip")
      .eq("ip_address", ip)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (recentIpRes.error) return sendError(res, 400, recentIpRes.error.message);
    if ((recentIpRes.data?.length ?? 0) >= 5) {
      await adminClient.from("payment_risk_events").insert({
        user_id: user.id,
        event_type: "referral_abuse_blocked_ip",
        risk_level: "high",
        ip_address: ip,
        details: { ip_referrals_24h: recentIpRes.data?.length ?? 0 },
      });
      return sendError(res, 429, "Referral temporarily blocked from this IP");
    }
  }

  if (fingerprint) {
    const deviceRes = await adminClient
      .from("referrals")
      .select("id")
      .eq("device_fingerprint", fingerprint)
      .neq("referred_user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (deviceRes.error) return sendError(res, 400, deviceRes.error.message);
    if (deviceRes.data) return sendError(res, 429, "Referral blocked for this device");
  }

  const existingReferralRes = await adminClient
    .from("referrals")
    .select("id")
    .eq("referred_user_id", user.id)
    .maybeSingle();
  if (existingReferralRes.error) return sendError(res, 400, existingReferralRes.error.message);
  if (existingReferralRes.data) return res.status(200).json({ ok: true, applied: false, reason: "already_exists" });

  const updateUser = await adminClient.from("users").update({ referred_by: referrerRes.data.id }).eq("id", user.id);
  if (updateUser.error) return sendError(res, 400, updateUser.error.message);

  const insertReferral = await adminClient.from("referrals").insert({
    referrer_id: referrerRes.data.id,
    referred_user_id: user.id,
    referral_code: code,
    reward_given: false,
    signup_ip: ip,
    device_fingerprint: fingerprint,
  });
  if (insertReferral.error) return sendError(res, 400, insertReferral.error.message);

  if (ip) {
    await adminClient.from("payment_risk_events").insert({
      user_id: user.id,
      event_type: "referral_signup_ip",
      risk_level: "low",
      ip_address: ip,
      details: { referred_by: referrerRes.data.id },
    });
  }

  return res.status(200).json({ ok: true, applied: true });
}

export async function handleAdminReferrals(req: ApiRequest, res: ApiResponse) {
  if (req.method === "GET") {
    const [ordersAdmin, analyticsAdmin] = await Promise.all([
      requirePermission(req, "can_manage_orders"),
      requirePermission(req, "can_view_analytics"),
    ]);
    const admin = ordersAdmin ?? analyticsAdmin;
    if (!admin) return sendError(res, 403, "Permission denied");

    const period = (Array.isArray(req.query?.period) ? req.query.period[0] : req.query?.period ?? "7d").toLowerCase();
    const now = new Date();
    let from: string | undefined;
    let to: string | undefined;
    if (period === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
      to = now.toISOString();
    } else if (period === "7d") {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      to = now.toISOString();
    } else if (period === "1m" || period === "30d") {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      to = now.toISOString();
    } else if (period === "custom") {
      const rawFrom = Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from;
      const rawTo = Array.isArray(req.query?.to) ? req.query.to[0] : req.query?.to;
      if (rawFrom && !Number.isNaN(new Date(rawFrom).getTime())) from = new Date(rawFrom).toISOString();
      if (rawTo && !Number.isNaN(new Date(rawTo).getTime())) to = new Date(rawTo).toISOString();
    }

    let refQuery = adminClient
      .from("referrals")
      .select(
        "id,referrer_id,referred_user_id,referral_code,purchase_amount,reward_given,created_at,reward_given_at,friend_coupon_code,referrer_coupon_code,signup_ip,referrer:users!referrals_referrer_id_fkey(id,name,email),friend:users!referrals_referred_user_id_fkey(id,name,email)"
      )
      .order("created_at", { ascending: false });
    if (from) refQuery = refQuery.gte("created_at", from);
    if (to) refQuery = refQuery.lte("created_at", to);
    const refs = await refQuery.limit(1000);
    if (refs.error) return sendError(res, 400, refs.error.message);

    const configRes = await adminClient
      .from("referral_config")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (configRes.error) return sendError(res, 400, configRes.error.message);

    const rows = refs.data ?? [];
    const successful = rows.filter((r: any) => r.reward_given).length;
    const totalRewardsGiven = rows.reduce((sum: number, row: any) => {
      if (!row.reward_given) return sum;
      return sum + 1;
    }, 0);

    const [settings, featureFlags, contentBlocks] = await Promise.all([
      getAmbassadorSettings(),
      getFeatureFlags(),
      adminClient.from("content_blocks").select("key,title,description,is_enabled").order("key", { ascending: true }),
    ]);

    return res.status(200).json({
      config: configRes.data,
      settings,
      feature_flags: featureFlags,
      content_blocks: contentBlocks.error ? [] : contentBlocks.data ?? [],
      metrics: {
        total_referrals: rows.length,
        successful_conversions: successful,
        total_rewards_given: totalRewardsGiven,
      },
      referrals: rows,
    });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");
  const parsed = referralConfigUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const input = parsed.data;

  const activeConfigRes = await adminClient
    .from("referral_config")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeConfigRes.error) return sendError(res, 400, activeConfigRes.error.message);

  if (input.is_active) {
    await adminClient.from("referral_config").update({ is_active: false }).eq("is_active", true);
  }

  let upsertRes;
  if (activeConfigRes.data?.id) {
    upsertRes = await adminClient
      .from("referral_config")
      .update({
        min_purchase_amount: input.min_purchase_amount,
        referrer_reward: input.referrer_reward,
        friend_reward: input.friend_reward,
        is_active: input.is_active,
      })
      .eq("id", activeConfigRes.data.id)
      .select("*")
      .single();
  } else {
    upsertRes = await adminClient
      .from("referral_config")
      .insert({
        min_purchase_amount: input.min_purchase_amount,
        referrer_reward: input.referrer_reward,
        friend_reward: input.friend_reward,
        is_active: input.is_active,
      })
      .select("*")
      .single();
  }
  if (upsertRes.error) return sendError(res, 400, upsertRes.error.message);

  if (
    input.ambassador_program_enabled !== undefined ||
    input.paid_ambassador_enabled !== undefined ||
    input.referral_program_enabled !== undefined ||
    input.royal_access_price_inr !== undefined ||
    input.early_access_lock_hours !== undefined
  ) {
    const latestSettings = await adminClient
      .from("platform_settings")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const settingsPayload: Record<string, unknown> = {};
    if (input.ambassador_program_enabled !== undefined) settingsPayload.ambassador_program_enabled = input.ambassador_program_enabled;
    if (input.paid_ambassador_enabled !== undefined) settingsPayload.paid_ambassador_enabled = input.paid_ambassador_enabled;
    if (input.referral_program_enabled !== undefined) settingsPayload.referral_program_enabled = input.referral_program_enabled;
    if (input.royal_access_price_inr !== undefined) settingsPayload.royal_access_price_inr = input.royal_access_price_inr;
    if (input.early_access_lock_hours !== undefined) settingsPayload.early_access_lock_hours = input.early_access_lock_hours;

    if (latestSettings.data?.id) {
      const settingsUpdate = await adminClient.from("platform_settings").update(settingsPayload).eq("id", latestSettings.data.id);
      if (settingsUpdate.error) return sendError(res, 400, settingsUpdate.error.message);
    } else {
      const settingsInsert = await adminClient.from("platform_settings").insert(settingsPayload);
      if (settingsInsert.error) return sendError(res, 400, settingsInsert.error.message);
    }
  }

  const featureFlagsInput = featureFlagUpdateSchema.safeParse(req.body ?? {});
  if (featureFlagsInput.success) {
    const rows = Object.entries(featureFlagsInput.data.flags)
      .filter(([key]) => FEATURE_FLAG_KEYS.includes(key as keyof typeof DEFAULT_FEATURE_FLAGS))
      .map(([feature_key, is_enabled]) => ({ feature_key, is_enabled, updated_at: new Date().toISOString() }));
    if (rows.length) {
      const upsertFlags = await adminClient.from("feature_flags").upsert(rows, { onConflict: "feature_key" });
      if (upsertFlags.error) return sendError(res, 400, upsertFlags.error.message);
    }
  }

  const contentBlocksInput = contentBlockUpdateSchema.safeParse(req.body ?? {});
  if (contentBlocksInput.success && contentBlocksInput.data.blocks.length) {
    const rows = contentBlocksInput.data.blocks.map((item) => ({
      key: item.key,
      title: item.title ?? null,
      description: item.description ?? null,
      is_enabled: item.is_enabled ?? true,
      updated_at: new Date().toISOString(),
    }));
    const upsertContent = await adminClient.from("content_blocks").upsert(rows, { onConflict: "key" });
    if (upsertContent.error) return sendError(res, 400, upsertContent.error.message);
  }

  await adminClient.from("admin_audit_logs").insert({
    admin_user_id: admin.id,
    action: "referral_config_update",
    entity_type: "referral_config",
    entity_id: upsertRes.data.id,
    diff: input,
  });

  return res.status(200).json({ ok: true, config: upsertRes.data });
}

export async function handleEliteMe(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");

  const [settings, featureFlags, contentBlocks] = await Promise.all([
    getAmbassadorSettings(),
    getFeatureFlags(),
    adminClient.from("content_blocks").select("key,title,description,is_enabled").ilike("key", "royal_%"),
  ]);
  if (!featureFlags.ambassador_program_enabled || !settings.ambassador_program_enabled || !featureFlags.royal_crown_enabled) {
    return res.status(200).json({
      ok: true,
      disabled: true,
      progress: null,
      tiers: [],
      settings,
      feature_flags: featureFlags,
      content_blocks: contentBlocks.error ? [] : contentBlocks.data ?? [],
    });
  }

  const resolvedTier = await resolveUserTierById(user.id);
  const roleIsSuperRoyal = resolvedTier.allow_all_access;

  await adminClient.rpc("refresh_elite_progress_for_user", { p_user_id: user.id });

  const [progressRes, tiersRes, userAccessRes, accessPassRes] = await Promise.all([
    adminClient
      .from("elite_progress")
      .select(
        "user_id,valid_referral_count,current_tier_id,highest_tier_id,royal_crown_unlocked,unlocked_at,tier_locked,permanent_royal_crown,current_tier:elite_tiers!elite_progress_current_tier_id_fkey(id,name,required_valid_referrals,badge_style,is_active),highest_tier:elite_tiers!elite_progress_highest_tier_id_fkey(id,name,required_valid_referrals,badge_style,is_active)"
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    adminClient
      .from("elite_tiers")
      .select("id,name,required_valid_referrals,badge_style,is_active")
      .eq("is_active", true)
      .order("required_valid_referrals", { ascending: true }),
    adminClient
      .from("users")
      .select("royal_access_active,royal_access_expires_at")
      .eq("id", user.id)
      .maybeSingle(),
    adminClient
      .from("royal_access_passes")
      .select("is_active,expires_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("expires_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (progressRes.error) return sendError(res, 400, progressRes.error.message);
  if (tiersRes.error) return sendError(res, 400, tiersRes.error.message);
  if (userAccessRes.error) return sendError(res, 400, userAccessRes.error.message);
  if (accessPassRes.error) return sendError(res, 400, accessPassRes.error.message);

  const progress = (progressRes.data as any) ?? null;
  const derivedTier = resolvedTier.tier;
  const userAccessActive = Boolean((userAccessRes.data as any)?.royal_access_active ?? false);
  const userAccessExpiresAt = ((userAccessRes.data as any)?.royal_access_expires_at ?? null) as string | null;
  const passExpiresAt = ((accessPassRes.data as any)?.expires_at ?? null) as string | null;
  const royalAccessExpiresAt = passExpiresAt ?? userAccessExpiresAt;

  return res.status(200).json({
    ok: true,
    disabled: false,
    progress,
    tiers: tiersRes.data ?? [],
    settings,
    feature_flags: featureFlags,
    content_blocks: contentBlocks.error ? [] : contentBlocks.data ?? [],
    role: resolvedTier.role,
    derived_tier: derivedTier,
    allow_all_access: roleIsSuperRoyal,
    royal_access_active: userAccessActive,
    royal_access_expires_at: royalAccessExpiresAt,
  });
}

export async function handleAdminElite(req: ApiRequest, res: ApiResponse) {
  if (req.method === "GET") {
    const [ordersAdmin, analyticsAdmin] = await Promise.all([
      requirePermission(req, "can_manage_orders"),
      requirePermission(req, "can_view_analytics"),
    ]);
    const admin = ordersAdmin ?? analyticsAdmin;
    if (!admin) return sendError(res, 403, "Permission denied");

    const period = (Array.isArray(req.query?.period) ? req.query.period[0] : req.query?.period ?? "7d").toLowerCase();
    const now = new Date();
    let from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let to = now.toISOString();
    if (period === "today") {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      from = start.toISOString();
    } else if (period === "30d" || period === "1m") {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (period === "custom") {
      const rawFrom = Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from;
      const rawTo = Array.isArray(req.query?.to) ? req.query.to[0] : req.query?.to;
      if (rawFrom && !Number.isNaN(new Date(rawFrom).getTime())) from = new Date(rawFrom).toISOString();
      if (rawTo && !Number.isNaN(new Date(rawTo).getTime())) to = new Date(rawTo).toISOString();
    }

    const [tiersRes, progressRes, abuseRes, featureFlags] = await Promise.all([
      adminClient
        .from("elite_tiers")
        .select("id,name,required_valid_referrals,badge_style,is_active")
        .order("required_valid_referrals", { ascending: true }),
      adminClient
        .from("elite_progress")
        .select(
          "user_id,valid_referral_count,current_tier_id,highest_tier_id,royal_crown_unlocked,unlocked_at,tier_locked,permanent_royal_crown,user:users(id,name,email),current_tier:elite_tiers!elite_progress_current_tier_id_fkey(id,name,required_valid_referrals,badge_style,is_active),highest_tier:elite_tiers!elite_progress_highest_tier_id_fkey(id,name,required_valid_referrals,badge_style,is_active)"
        )
        .order("valid_referral_count", { ascending: false })
        .limit(500),
      adminClient
        .from("referral_abuse_logs")
        .select("id,event_type,risk_level,created_at,referrer_id,referred_user_id")
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: false })
        .limit(300),
      getFeatureFlags(),
    ]);

    if (tiersRes.error) return sendError(res, 400, tiersRes.error.message);
    if (progressRes.error) return sendError(res, 400, progressRes.error.message);
    if (abuseRes.error) return sendError(res, 400, abuseRes.error.message);

    const progressRows = progressRes.data ?? [];
    const metrics = {
      total_profiles: progressRows.length,
      royal_crown_unlocked: progressRows.filter((row: any) => Boolean(row.royal_crown_unlocked)).length,
      locked_profiles: progressRows.filter((row: any) => Boolean(row.tier_locked)).length,
      suspicious_events: (abuseRes.data ?? []).length,
    };

    return res.status(200).json({
      ok: true,
      tiers: tiersRes.data ?? [],
      progress: progressRows,
      abuse_logs: abuseRes.data ?? [],
      metrics,
      feature_flags: featureFlags,
    });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");
  const parsed = eliteAdminSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const input = parsed.data;

  if (input.action === "update_tier") {
    if (!input.tier) return sendError(res, 400, "Tier payload required");
    const update = await adminClient
      .from("elite_tiers")
      .update({
        required_valid_referrals: input.tier.required_valid_referrals,
        is_active: input.tier.is_active ?? true,
        badge_style: input.tier.badge_style ?? undefined,
      })
      .eq("id", input.tier.id)
      .select("id,name,required_valid_referrals,badge_style,is_active")
      .single();
    if (update.error) return sendError(res, 400, update.error.message);

    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: "elite_tier_update",
      entity_type: "elite_tiers",
      entity_id: input.tier.id,
      diff: input.tier,
    });
    return res.status(200).json({ ok: true, tier: update.data });
  }

  if (!input.user) return sendError(res, 400, "User payload required");

  if (input.action === "set_user") {
    const current = await adminClient
      .from("elite_progress")
      .select("user_id")
      .eq("user_id", input.user.user_id)
      .maybeSingle();
    if (current.error) return sendError(res, 400, current.error.message);

    const payload: Record<string, unknown> = {
      user_id: input.user.user_id,
      updated_at: new Date().toISOString(),
    };
    if (input.user.current_tier_id !== undefined) payload.current_tier_id = input.user.current_tier_id;
    if (input.user.highest_tier_id !== undefined) payload.highest_tier_id = input.user.highest_tier_id;
    if (input.user.valid_referral_count !== undefined) payload.valid_referral_count = input.user.valid_referral_count;
    if (input.user.tier_locked !== undefined) payload.tier_locked = input.user.tier_locked;
    if (input.user.permanent_royal_crown !== undefined) payload.permanent_royal_crown = input.user.permanent_royal_crown;
    if (input.user.permanent_royal_crown === true) {
      const royalRes = await adminClient.from("elite_tiers").select("id").eq("name", "Royal Crown").maybeSingle();
      if (royalRes.data?.id) {
        payload.current_tier_id = royalRes.data.id;
        payload.highest_tier_id = royalRes.data.id;
        payload.royal_crown_unlocked = true;
        payload.unlocked_at = new Date().toISOString();
      }
    }

    const upsert = current.data
      ? await adminClient.from("elite_progress").update(payload).eq("user_id", input.user.user_id).select("*").single()
      : await adminClient.from("elite_progress").insert(payload).select("*").single();
    if (upsert.error) return sendError(res, 400, upsert.error.message);

    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: "elite_user_manual_update",
      entity_type: "elite_progress",
      entity_id: null,
      diff: input.user,
    });

    return res.status(200).json({ ok: true, progress: upsert.data });
  }

  await adminClient.rpc("refresh_elite_progress_for_user", { p_user_id: input.user.user_id });
  const refreshed = await adminClient
    .from("elite_progress")
    .select(
      "user_id,valid_referral_count,current_tier_id,highest_tier_id,royal_crown_unlocked,unlocked_at,tier_locked,permanent_royal_crown,current_tier:elite_tiers!elite_progress_current_tier_id_fkey(id,name,required_valid_referrals,badge_style,is_active),highest_tier:elite_tiers!elite_progress_highest_tier_id_fkey(id,name,required_valid_referrals,badge_style,is_active)"
    )
    .eq("user_id", input.user.user_id)
    .maybeSingle();
  if (refreshed.error) return sendError(res, 400, refreshed.error.message);

  return res.status(200).json({ ok: true, progress: refreshed.data ?? null });
}

export async function handleRoyalSystemSettings(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");

  if (req.method === "GET") {
    const [settings, featureFlags] = await Promise.all([getAmbassadorSettings(), getFeatureFlags()]);
    return res.status(200).json({ ok: true, settings, feature_flags: featureFlags });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = featureFlagUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const rows = Object.entries(parsed.data.flags)
    .filter(([key]) => FEATURE_FLAG_KEYS.includes(key as keyof typeof DEFAULT_FEATURE_FLAGS))
    .map(([feature_key, is_enabled]) => ({ feature_key, is_enabled, updated_at: new Date().toISOString() }));
  if (rows.length) {
    const upsertFlags = await adminClient.from("feature_flags").upsert(rows, { onConflict: "feature_key" });
    if (upsertFlags.error) return sendError(res, 400, upsertFlags.error.message);
  }

  if (parsed.data.flags.ambassador_program_enabled !== undefined) {
    const latestSettings = await adminClient
      .from("platform_settings")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestSettings.data?.id) {
      const syncSetting = await adminClient
        .from("platform_settings")
        .update({ ambassador_program_enabled: parsed.data.flags.ambassador_program_enabled })
        .eq("id", latestSettings.data.id);
      if (syncSetting.error) return sendError(res, 400, syncSetting.error.message);
    }
  }

  await adminClient.from("admin_audit_logs").insert({
    admin_user_id: admin.id,
    action: "royal_system_feature_flags_update",
    entity_type: "feature_flags",
    entity_id: null,
    diff: parsed.data.flags,
  });

  const featureFlags = await getFeatureFlags();
  return res.status(200).json({ ok: true, feature_flags: featureFlags });
}

export async function handleAdminContentBlocks(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");

  if (req.method === "GET") {
    const rows = await adminClient.from("content_blocks").select("key,title,description,is_enabled").order("key", { ascending: true });
    if (rows.error) return sendError(res, 400, rows.error.message);
    return res.status(200).json({ ok: true, content_blocks: rows.data ?? [] });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = contentBlockUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  if (!parsed.data.blocks.length) return res.status(200).json({ ok: true, content_blocks: [] });

  const rows = parsed.data.blocks.map((item) => ({
    key: item.key,
    title: item.title ?? null,
    description: item.description ?? null,
    is_enabled: item.is_enabled ?? true,
    updated_at: new Date().toISOString(),
  }));
  const upsert = await adminClient.from("content_blocks").upsert(rows, { onConflict: "key" });
  if (upsert.error) return sendError(res, 400, upsert.error.message);

  await adminClient.from("admin_audit_logs").insert({
    admin_user_id: admin.id,
    action: "royal_content_blocks_update",
    entity_type: "content_blocks",
    entity_id: null,
    diff: rows,
  });
  return res.status(200).json({ ok: true, updated: rows.length });
}

export async function handleAdminDropsCreate(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = adminDropCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const input = parsed.data;

  if (new Date(input.start_time).getTime() >= new Date(input.end_time).getTime()) {
    return sendError(res, 400, "start_time must be before end_time");
  }
  const featureFlags = await getFeatureFlags();

  const insert = await adminClient
    .from("drops")
    .insert({
      name: input.name,
      slug: toSlug(input.name),
      start_time: input.start_time,
      end_time: input.end_time,
      stock_limit: input.stock_limit,
      total_stock: input.stock_limit,
      available_stock: input.stock_limit,
      early_access_tier_required: featureFlags.early_drop_enabled ? input.early_access_tier_required || null : null,
      early_access_tier: featureFlags.early_drop_enabled ? input.early_access_tier || null : null,
      early_access_hours: featureFlags.early_drop_enabled ? Math.max(0, Number(input.early_access_hours ?? 0)) : 0,
      drop_priority: input.drop_priority,
      countdown_enabled: input.countdown_enabled,
      is_active: input.is_active,
      exclusive_private_drop: input.exclusive_private_drop,
      hero_media_type: "image",
      hero_media_url: "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=1400&q=80",
      access_type: "public",
    })
    .select(
      "id,name,slug,start_time,end_time,stock_limit,drop_priority,countdown_enabled,is_active,early_access_tier_required,early_access_tier,early_access_hours,exclusive_private_drop"
    )
    .single();
  if (insert.error) return sendError(res, 400, insert.error.message);

  if (input.products.length) {
    const rows = input.products.map((item) => ({
      drop_id: insert.data.id,
      product_id: item.product_id,
      stock_remaining: item.stock_remaining,
      sold_count: 0,
      status: "active",
      price_at_drop: item.price_at_drop ?? null,
      exclusive_badge: item.exclusive_badge ?? null,
    }));
    const addProducts = await adminClient.from("drop_products").insert(rows);
    if (addProducts.error) return sendError(res, 400, addProducts.error.message);
  }

  await adminClient.from("admin_audit_logs").insert({
    admin_user_id: admin.id,
    action: "drop_create",
    entity_type: "drops",
    entity_id: insert.data.id,
    diff: input,
  });

  return res.status(200).json({ ok: true, drop: insert.data });
}

export async function handleAdminDropsUpdate(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = adminDropUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const input = parsed.data;

  if (new Date(input.start_time).getTime() >= new Date(input.end_time).getTime()) {
    return sendError(res, 400, "start_time must be before end_time");
  }
  const featureFlags = await getFeatureFlags();

  const update = await adminClient
    .from("drops")
    .update({
      name: input.name,
      slug: toSlug(input.name),
      start_time: input.start_time,
      end_time: input.end_time,
      stock_limit: input.stock_limit,
      total_stock: input.stock_limit,
      available_stock: Math.min(Number(input.stock_limit), Number(input.stock_limit)),
      early_access_tier_required: featureFlags.early_drop_enabled ? input.early_access_tier_required || null : null,
      early_access_tier: featureFlags.early_drop_enabled ? input.early_access_tier || null : null,
      early_access_hours: featureFlags.early_drop_enabled ? Math.max(0, Number(input.early_access_hours ?? 0)) : 0,
      drop_priority: input.drop_priority,
      countdown_enabled: input.countdown_enabled,
      is_active: input.is_active,
      exclusive_private_drop: input.exclusive_private_drop,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select(
      "id,name,slug,start_time,end_time,stock_limit,drop_priority,countdown_enabled,is_active,early_access_tier_required,early_access_tier,early_access_hours,exclusive_private_drop"
    )
    .single();
  if (update.error) return sendError(res, 400, update.error.message);

  if (input.products) {
    await adminClient.from("drop_products").delete().eq("drop_id", input.id);
    if (input.products.length) {
      const rows = input.products.map((item) => ({
        drop_id: input.id,
        product_id: item.product_id,
        stock_remaining: item.stock_remaining,
        sold_count: 0,
        status: "active",
        price_at_drop: item.price_at_drop ?? null,
        exclusive_badge: item.exclusive_badge ?? null,
      }));
      const addProducts = await adminClient.from("drop_products").insert(rows);
      if (addProducts.error) return sendError(res, 400, addProducts.error.message);
    }
  }

  await adminClient.from("admin_audit_logs").insert({
    admin_user_id: admin.id,
    action: "drop_update",
    entity_type: "drops",
    entity_id: input.id,
    diff: input,
  });
  return res.status(200).json({ ok: true, drop: update.data });
}

export async function handleDropsActive(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const featureFlags = await getFeatureFlags();
  const rows = await adminClient
    .from("drops")
    .select(
      "id,name,slug,start_time,end_time,stock_limit,drop_priority,countdown_enabled,is_active,early_access_tier_required,early_access_tier,early_access_hours,exclusive_private_drop"
    )
    .eq("is_active", true)
    .order("drop_priority", { ascending: false })
    .order("start_time", { ascending: true })
    .limit(50);
  if (rows.error) return sendError(res, 400, rows.error.message);
  return res.status(200).json({ ok: true, drops: rows.data ?? [], feature_flags: featureFlags });
}

export async function handleDropById(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const dropId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  if (!dropId) return sendError(res, 400, "drop id required");
  const row = await adminClient
    .from("drops")
    .select(
      "id,name,slug,start_time,end_time,stock_limit,drop_priority,countdown_enabled,is_active,early_access_tier_required,early_access_tier,early_access_hours,exclusive_private_drop,created_at,updated_at"
    )
    .eq("id", dropId)
    .maybeSingle();
  if (row.error) return sendError(res, 400, row.error.message);
  if (!row.data) return sendError(res, 404, "Drop not found");
  return res.status(200).json({ ok: true, drop: row.data });
}

export async function handleDropProductsById(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const dropId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  if (!dropId) return sendError(res, 400, "drop id required");
  const user = await requireUser(req);
  const featureFlags = await getFeatureFlags();
  const dropRes = await adminClient
    .from("drops")
    .select(
      "id,name,start_time,end_time,is_active,exclusive_private_drop,early_access_tier_required,early_access_tier,early_access_hours,drop_priority,countdown_enabled"
    )
    .eq("id", dropId)
    .maybeSingle();
  if (dropRes.error) return sendError(res, 400, dropRes.error.message);
  if (!dropRes.data) return sendError(res, 404, "Drop not found");

  const access = await isDropAccessibleForUser(dropRes.data, user?.id ?? null);
  if (!access.allowed) {
    return res.status(200).json({
      ok: true,
      access: { allowed: false, reason: access.reason },
      feature_flags: featureFlags,
      teaser: {
        id: dropRes.data.id,
        name: dropRes.data.name,
        start_time: dropRes.data.start_time,
        end_time: dropRes.data.end_time,
      },
      products: [],
    });
  }

  const productsRes = await adminClient
    .from("drop_products")
    .select(
      "id,drop_id,product_id,stock_remaining,sold_count,status,price_at_drop,exclusive_badge,product:products(id,slug,title,price_inr,discount_price,image_url,active,minimum_required_tier)"
    )
    .eq("drop_id", dropId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (productsRes.error) return sendError(res, 400, productsRes.error.message);
  const resolvedTier = user ? await resolveUserTierById(user.id) : { rank: TIER_RANK.NORMAL_USER };
  const blockedProduct = (productsRes.data ?? []).find((row: any) => {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    const requiredTier = String(product?.minimum_required_tier ?? "").trim();
    if (!requiredTier) return false;
    if (!featureFlags.vault_enabled) return true;
    return resolvedTier.rank < getRequiredTierRank(requiredTier);
  });
  if (blockedProduct) return sendError(res, 403, "Tier access required for one or more products");

  return res.status(200).json({
    ok: true,
    access: { allowed: true, reason: access.reason },
    drop: dropRes.data,
    feature_flags: featureFlags,
    products: productsRes.data ?? [],
  });
}

export async function handleDropAccessRequest(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const ip = getRequestIp(req);
  const rate = await enforceRateLimit({
    eventType: "drop_access_request_attempt",
    maxHits: 15,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: ip,
  });
  if (!rate.allowed) return sendError(res, 429, "Too many access attempts. Please retry later.");
  const dropId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  if (!dropId) return sendError(res, 400, "drop id required");
  const parsed = dropAccessRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const inviteCode = parsed.data.invite_code?.trim().toUpperCase() ?? "";

  if (ip) {
    const recentIp = await adminClient
      .from("drop_access_requests")
      .select("id")
      .eq("drop_id", dropId)
      .gte("requested_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
    if (!recentIp.error && (recentIp.data?.length ?? 0) > 100) {
      await adminClient.from("referral_abuse_logs").insert({
        referrer_id: user.id,
        event_type: "drop_access_spam_blocked",
        risk_level: "high",
        ip_address: ip,
        details: { drop_id: dropId },
      });
      return sendError(res, 429, "Too many access requests. Try again later.");
    }
  }

  const dropRes = await adminClient
    .from("drops")
    .select("id,name,start_time,end_time,is_active,exclusive_private_drop,early_access_tier_required,early_access_hours")
    .eq("id", dropId)
    .maybeSingle();
  if (dropRes.error) return sendError(res, 400, dropRes.error.message);
  if (!dropRes.data) return sendError(res, 404, "Drop not found");

  const access = await isDropAccessibleForUser(dropRes.data, user.id);
  let granted = access.allowed;
  let mode: "vip" | "tier" | "invite_code" = access.reason === "early_access" ? "tier" : "vip";

  if (!granted && inviteCode) {
    const invite = await adminClient
      .from("secret_launch_access")
      .select("id,code,drop_id,assigned_user_id,usage_count,max_usage,is_active,expires_at")
      .eq("drop_id", dropId)
      .eq("code", inviteCode)
      .eq("is_active", true)
      .maybeSingle();
    const usable =
      !invite.error &&
      Boolean(invite.data) &&
      (!invite.data?.assigned_user_id || invite.data?.assigned_user_id === user.id) &&
      Number(invite.data?.usage_count ?? 0) < Number(invite.data?.max_usage ?? 1) &&
      (!invite.data?.expires_at || new Date(invite.data.expires_at).getTime() > Date.now());
    if (usable) {
      granted = true;
      mode = "invite_code";
      await adminClient
        .from("secret_launch_access")
        .update({ usage_count: Number(invite.data?.usage_count ?? 0) + 1, assigned_user_id: invite.data?.assigned_user_id ?? user.id })
        .eq("id", invite.data!.id);
    }
  }

  const token = `DLA-${crypto.randomBytes(12).toString("hex").slice(0, 14).toUpperCase()}`;
  const tokenExp = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const upsert = await adminClient.from("drop_access_requests").upsert(
    {
      user_id: user.id,
      drop_id: dropId,
      access_granted: granted,
      access_mode: mode,
      generated_token: granted ? token : null,
      token_expires_at: granted ? tokenExp : null,
      requested_at: new Date().toISOString(),
      approved_at: granted ? new Date().toISOString() : null,
    },
    { onConflict: "user_id,drop_id" }
  );
  if (upsert.error) return sendError(res, 400, upsert.error.message);

  return res.status(200).json({
    ok: true,
    access_granted: granted,
    access_mode: granted ? mode : null,
    token: granted ? token : null,
    token_expires_at: granted ? tokenExp : null,
  });
}

export async function handleDropRedeem(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const ip = getRequestIp(req);
  const rate = await enforceRateLimit({
    eventType: "drop_redeem_attempt",
    maxHits: 20,
    windowMs: 10 * 60 * 1000,
    userId: user.id,
    ipAddress: ip,
  });
  if (!rate.allowed) return sendError(res, 429, "Too many redeem attempts. Please retry later.");
  const dropId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  if (!dropId) return sendError(res, 400, "drop id required");
  const userRole = await getUserRole(user.id);
  if (isSuperRoyalRole(userRole)) {
    return res.status(200).json({ ok: true, redeemed: true, mode: "super_royal" });
  }
  const parsed = dropRedeemSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const token = parsed.data.token?.trim();
  const inviteCode = parsed.data.invite_code?.trim().toUpperCase();

  if (!token && !inviteCode) return sendError(res, 400, "token or invite_code required");

  if (token) {
    const row = await adminClient
      .from("drop_access_requests")
      .select("id,access_granted,token_expires_at")
      .eq("drop_id", dropId)
      .eq("user_id", user.id)
      .eq("generated_token", token)
      .maybeSingle();
    if (row.error) return sendError(res, 400, row.error.message);
    if (!row.data || !row.data.access_granted) return sendError(res, 403, "Invalid token");
    if (row.data.token_expires_at && new Date(row.data.token_expires_at).getTime() <= Date.now()) {
      return sendError(res, 403, "Token expired");
    }
    return res.status(200).json({ ok: true, redeemed: true, mode: "token" });
  }

  const invite = await adminClient
    .from("secret_launch_access")
    .select("id,usage_count,max_usage,is_active,expires_at,assigned_user_id")
    .eq("drop_id", dropId)
    .eq("code", inviteCode as string)
    .maybeSingle();
  if (invite.error) return sendError(res, 400, invite.error.message);
  const valid =
    Boolean(invite.data) &&
    invite.data?.is_active &&
    Number(invite.data?.usage_count ?? 0) < Number(invite.data?.max_usage ?? 1) &&
    (!invite.data?.expires_at || new Date(invite.data.expires_at).getTime() > Date.now()) &&
    (!invite.data?.assigned_user_id || invite.data?.assigned_user_id === user.id);
  if (!valid) return sendError(res, 403, "Invalid invite code");

  await adminClient
    .from("secret_launch_access")
    .update({ usage_count: Number(invite.data?.usage_count ?? 0) + 1, assigned_user_id: invite.data?.assigned_user_id ?? user.id })
    .eq("id", invite.data!.id);
  return res.status(200).json({ ok: true, redeemed: true, mode: "invite_code" });
}

export async function handleHomepageMobile(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");

  const user = await requireUser(req);
  const [featureFlags, activePageRes, siteFestivalRes, productsRes] = await Promise.all([
    getFeatureFlags(),
    adminClient.from("home_pages").select("id").eq("is_active", true).maybeSingle(),
    adminClient
      .from("site_festivals")
      .select("festival_name,urgency_text,discount_text,start_date,end_date,is_active")
      .eq("is_active", true)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    adminClient
      .from("products")
      .select("id,slug,title,category,price_inr,discount_price,image_url,show_on_home,show_on_new_in,featured,active")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const pageId = (activePageRes.data as any)?.id as string | undefined;
  const sectionsRes = pageId
    ? await adminClient
        .from("home_sections")
        .select("id,section_type,section_key,display_order,config_json,is_visible")
        .eq("page_id", pageId)
        .eq("is_visible", true)
        .order("display_order", { ascending: true })
    : { data: [], error: null as any };

  const sections = sectionsRes.error ? [] : ((sectionsRes.data ?? []) as any[]);
  const productRows = ((productsRes.error ? [] : productsRes.data) ?? []) as any[];
  const productIds = productRows.map((item) => String(item.id)).filter(Boolean);
  const productImagesRes =
    productIds.length > 0
      ? await adminClient
          .from("product_images")
          .select("product_id,image_url,sort_order,is_primary")
          .in("product_id", productIds)
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true })
      : { data: [], error: null as any };
  const imagesByProduct = new Map<string, string[]>();
  if (!productImagesRes.error) {
    for (const row of (productImagesRes.data ?? []) as any[]) {
      const key = String(row.product_id ?? "");
      const url = String(row.image_url ?? "");
      if (!key || !url) continue;
      const current = imagesByProduct.get(key) ?? [];
      current.push(url);
      imagesByProduct.set(key, current);
    }
  }
  const resolveProductImage = (item: any): string => {
    const direct = String(item?.image_url ?? "").trim();
    if (direct) return direct;
    const byGallery = imagesByProduct.get(String(item?.id ?? ""))?.[0] ?? "";
    return String(byGallery ?? "").trim();
  };
  const heroSections = sections
    .filter((section) => section.section_type === "hero")
    .map((section) => {
      const config = section.config_json ?? {};
      return {
        id: section.id,
        imageMobile: String(config.media ?? config.image ?? config.media_url ?? ""),
        headline: truncateForUi(String(config.title ?? "Signature Luxury"), 35),
        subText: truncateForUi(String(config.subtitle ?? ""), 60),
        ctaText: String(config.buttonText ?? config.button_text ?? "Shop Now"),
        ctaUrl: String(config.buttonUrl ?? config.button_link ?? "/products"),
        priority: Number(section.display_order ?? 0),
        imagePosition: String(config.imagePosition ?? "center"),
      };
    })
    .filter((item) => item.imageMobile);

  const featuredSection = sections.find((section) => section.section_type === "featured");
  const featuredConfig = (featuredSection?.config_json ?? {}) as any;
  const featuredItems = Array.isArray((featuredSection?.config_json as any)?.items)
    ? ((featuredSection?.config_json as any).items as any[])
    : [];
  const maxItems = Math.max(1, Number(featuredConfig.maxItems ?? 6));
  const fromProducts = productRows
    .filter((item) => Boolean(item.show_on_home || item.featured))
    .slice(0, maxItems)
    .map((item) => ({
      id: String(item.id),
      image: resolveProductImage(item),
      title: String(item.title ?? "Featured"),
      link: `/products/${String(item.slug ?? "")}`,
    }))
    .filter((item) => item.image);

  const featuredTiles =
    fromProducts.length > 0
      ? (() => {
          if (fromProducts.length >= maxItems) return fromProducts;
          const remaining = maxItems - fromProducts.length;
          const fromCms = featuredItems.slice(0, remaining).map((item, index) => ({
            id: `${featuredSection?.id ?? "featured"}-fallback-${index}`,
            image: String(item.image ?? ""),
            title: String(item.title ?? item.label ?? "Featured"),
            link: String(item.link ?? "/products"),
          }));
          return [...fromProducts, ...fromCms].filter((item) => item.image);
        })()
      : featuredItems.slice(0, 6).map((item, index) => ({
          id: `${featuredSection?.id ?? "featured"}-${index}`,
          image: String(item.image ?? ""),
          title: String(item.title ?? item.label ?? "Featured"),
          link: String(item.link ?? "/products"),
        }));

  const categorySection = sections.find((section) => section.section_type === "category");
  const categoryItems = Array.isArray((categorySection?.config_json as any)?.items)
    ? ((categorySection?.config_json as any).items as any[])
    : [];
  const resolveCategoryLink = (title: string, rawLink: unknown) => {
    const link = String(rawLink ?? "").trim();
    if (link) return link;
    const slug = title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug ? `/products/c/${slug}` : "/products";
  };

  const categories = categoryItems.map((item, index) => {
    const title = String(item.title ?? "Category");
    return {
      id: `${categorySection?.id ?? "category"}-${index}`,
      imageMobile: String(item.image ?? ""),
      title,
      link: resolveCategoryLink(title, item.link),
    };
  });

  const spotlightBannerSection = sections.find(
    (section) =>
      section.section_key === "spotlight_banner" ||
      section.section_key === "spotlight" ||
      section.section_type === "spotlight_banner"
  );
  const spotlightBannerConfig = (spotlightBannerSection?.config_json ?? {}) as any;
  const spotlightBannerImage = String(
    spotlightBannerConfig.image ?? spotlightBannerConfig.media ?? spotlightBannerConfig.image_url ?? ""
  ).trim();
  const spotlightBanner =
    spotlightBannerImage.length > 0
      ? {
          image: spotlightBannerImage,
          alt: String(spotlightBannerConfig.alt ?? spotlightBannerConfig.title ?? "Spotlight Banner"),
          link: String(spotlightBannerConfig.link ?? spotlightBannerConfig.buttonUrl ?? "/products"),
        }
      : null;

  const spotlightSections = [
    {
      title: "Spotlight",
      banner: spotlightBanner ?? undefined,
      products: productRows
        .filter((item) => Boolean(item.show_on_home || item.featured))
        .slice(0, 8)
        .map((item) => ({
          id: String(item.id),
          slug: String(item.slug),
          image: resolveProductImage(item) || null,
          title: String(item.title ?? "Product"),
          category: String(item.category ?? ""),
          price_inr: Number(item.discount_price ?? item.price_inr ?? 0),
        })),
    },
  ];

  const newArrivals = productRows
    .filter((item) => Boolean(item.show_on_new_in))
    .slice(0, 12)
    .map((item) => ({
      id: String(item.id),
      slug: String(item.slug),
      image: resolveProductImage(item) || null,
      title: String(item.title ?? "Product"),
      category: String(item.category ?? ""),
      price_inr: Number(item.discount_price ?? item.price_inr ?? 0),
    }));

  let royal: any = null;
  if (user) {
    const [eliteRes, leaderboardRes] = await Promise.all([
      adminClient
        .from("elite_progress")
        .select(
          "valid_referral_count,current_tier:elite_tiers!elite_progress_current_tier_id_fkey(name,required_valid_referrals)"
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      adminClient
        .from("creator_dashboard")
        .select("user_id,username,views,elite_tier")
        .order("views", { ascending: false })
        .limit(10),
    ]);
    royal = {
      crownProgress: eliteRes.error
        ? null
        : {
            valid_referral_count: Number((eliteRes.data as any)?.valid_referral_count ?? 0),
            current_tier_name: String((eliteRes.data as any)?.current_tier?.name ?? "Base"),
            next_target: Number((eliteRes.data as any)?.current_tier?.required_valid_referrals ?? 1000),
          },
      leaderboard: leaderboardRes.error
        ? []
        : (leaderboardRes.data ?? [])
            .filter((row: any) => String(row.elite_tier ?? "").toLowerCase() === "royal crown")
            .map((row: any) => ({
              user_id: String(row.user_id),
              username: String(row.username ?? "Member"),
              views: Number(row.views ?? 0),
            })),
    };
  }

  const now = Date.now();
  const festival = siteFestivalRes.data as any;
  const festivalLive =
    Boolean(festival?.is_active) &&
    (!festival?.start_date || new Date(festival.start_date).getTime() <= now) &&
    (!festival?.end_date || new Date(festival.end_date).getTime() >= now);

  const topNotice = festivalLive
    ? `${festival.festival_name} Live | ${festival.urgency_text || festival.discount_text || "Limited time offer"}`
    : "Free Shipping | Easy Returns | Holiday Offer";

  return res.status(200).json({
    topNotice,
    heroSections,
    featuredTiles,
    categories,
    newArrivals,
    spotlightSections,
    royal,
    featureFlags: featureFlags,
    flags: featureFlags,
  });
}

const chooseHomepageVariantHeuristic = async (userId: string | null) => {
  const templatesRes = await adminClient
    .from("ai_homepage_templates")
    .select("id,layout_name,section_configuration_json,predicted_performance_score")
    .order("predicted_performance_score", { ascending: false })
    .limit(20);
  if (templatesRes.error) throw new Error(templatesRes.error.message);
  const templates = templatesRes.data ?? [];
  if (!templates.length) return { variant: null, reason: "no_templates" };
  if (!userId) return { variant: templates[0], reason: "guest_best_default" };

  const behaviorRes = await adminClient
    .from("user_behavior")
    .select("most_viewed_category,predicted_interest,engagement_score,recent_searches,viewed_sections")
    .eq("user_id", userId)
    .maybeSingle();
  const behavior = behaviorRes.data as any;
  const focus = String(behavior?.most_viewed_category ?? behavior?.predicted_interest ?? "").toLowerCase().trim();

  const scored = templates.map((tpl: any) => {
    const config = tpl.section_configuration_json ?? {};
    const keywords = Array.isArray(config?.focus_categories) ? config.focus_categories.map((x: any) => String(x).toLowerCase()) : [];
    const base = Number(tpl.predicted_performance_score ?? 0);
    const matchBoost = focus && keywords.some((k: string) => k.includes(focus) || focus.includes(k)) ? 15 : 0;
    const engagementBoost = Math.min(10, Number(behavior?.engagement_score ?? 0) / 10);
    return { tpl, score: base + matchBoost + engagementBoost };
  });
  scored.sort((a, b) => b.score - a.score);
  return { variant: scored[0]?.tpl ?? templates[0], reason: "behavior_weighted_selection" };
};

export async function handleHomepageVariant(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  const userId = user?.id ?? null;
  const picked = await chooseHomepageVariantHeuristic(userId);
  if (!picked.variant) return res.status(200).json({ ok: true, variant: null, reason: picked.reason });

  if (userId) {
    await adminClient.from("user_homepage_variant").upsert(
      {
        user_id: userId,
        variant_id: picked.variant.id,
        last_served_at: new Date().toISOString(),
        interaction_score: 0,
        performance_metrics: { reason: picked.reason },
      },
      { onConflict: "user_id" }
    );
  }

  return res.status(200).json({ ok: true, variant: picked.variant, reason: picked.reason });
}

export async function handleHomepageInteraction(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");
  const parsed = homepageInteractionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");
  const input = parsed.data;

  const behaviorRes = await adminClient.from("user_behavior").select("*").eq("user_id", user.id).maybeSingle();
  const existing = (behaviorRes.data as any) ?? {};
  const viewedSections = Array.isArray(existing.viewed_sections) ? existing.viewed_sections : [];
  const searches = Array.isArray(existing.recent_searches) ? existing.recent_searches : [];
  const viewedProductIds = Array.isArray(existing.most_viewed_product_ids) ? existing.most_viewed_product_ids : [];
  const historyIds = Array.isArray(existing.purchase_history_ids) ? existing.purchase_history_ids : [];

  const nextSections = input.section ? Array.from(new Set([input.section, ...viewedSections])).slice(0, 20) : viewedSections;
  const nextSearches = input.search_term ? Array.from(new Set([input.search_term, ...searches])).slice(0, 20) : searches;
  const nextProducts = input.product_id ? Array.from(new Set([input.product_id, ...viewedProductIds])).slice(0, 20) : viewedProductIds;
  const engagementDelta = input.event === "purchase" ? 10 : input.event === "cta" ? 4 : input.event === "click" ? 2 : 1;

  const upsertBehavior = await adminClient.from("user_behavior").upsert(
    {
      user_id: user.id,
      most_viewed_category: input.category ?? existing.most_viewed_category ?? null,
      most_viewed_product_ids: nextProducts,
      recent_searches: nextSearches,
      last_visit_at: new Date().toISOString(),
      viewed_sections: nextSections,
      purchase_history_ids: historyIds,
      engagement_score: Number(existing.engagement_score ?? 0) + engagementDelta,
      predicted_interest: input.category ?? existing.predicted_interest ?? null,
    },
    { onConflict: "user_id" }
  );
  if (upsertBehavior.error) return sendError(res, 400, upsertBehavior.error.message);

  if (input.variant_id) {
    const variantRow = await adminClient
      .from("user_homepage_variant")
      .select("interaction_score,performance_metrics")
      .eq("user_id", user.id)
      .eq("variant_id", input.variant_id)
      .maybeSingle();
    const interactionScore = Number((variantRow.data as any)?.interaction_score ?? 0) + engagementDelta;
    const metrics = {
      ...((variantRow.data as any)?.performance_metrics ?? {}),
      last_event: input.event,
      last_event_at: new Date().toISOString(),
    };
    await adminClient.from("user_homepage_variant").upsert(
      {
        user_id: user.id,
        variant_id: input.variant_id,
        last_served_at: new Date().toISOString(),
        interaction_score: interactionScore,
        performance_metrics: metrics,
      },
      { onConflict: "user_id" }
    );
  }

  return res.status(200).json({ ok: true, recorded: true });
}

export async function handleAdminDiscountCodes(req: ApiRequest, res: ApiResponse) {
  const admin = await requirePermission(req, "can_manage_orders");
  if (!admin) return sendError(res, 403, "Permission denied");

  if (req.method === "GET") {
    const rows = await adminClient
      .from("discount_codes")
      .select(
        "id,code,title,discount_type,discount_value,min_order_inr,max_discount_inr,total_usage_limit,per_user_limit,used_count,starts_at,expires_at,active,created_at,updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (rows.error) return sendError(res, 400, rows.error.message);
    return res.status(200).json({ ok: true, rows: rows.data ?? [] });
  }

  if (req.method === "PATCH") {
    const parsed = adminDiscountCodeUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(res, 400, "Invalid payload");
    const update = await adminClient
      .from("discount_codes")
      .update({ active: parsed.data.active, updated_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .select("id")
      .maybeSingle();
    if (update.error || !update.data) return sendError(res, 400, update.error?.message || "Code update failed");
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const parsed = adminDiscountCodeCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  const code = parsed.data.code.trim().toUpperCase();
  const insert = await adminClient
    .from("discount_codes")
    .insert({
      code,
      title: parsed.data.title?.trim() || null,
      discount_type: parsed.data.discount_type,
      discount_value: parsed.data.discount_value,
      min_order_inr: parsed.data.min_order_inr,
      max_discount_inr: parsed.data.max_discount_inr ?? null,
      total_usage_limit: parsed.data.total_usage_limit ?? null,
      per_user_limit: parsed.data.per_user_limit,
      starts_at: parsed.data.starts_at ?? null,
      expires_at: parsed.data.expires_at ?? null,
      active: parsed.data.active,
      created_by: admin.id,
    })
    .select("id")
    .maybeSingle();
  if (insert.error || !insert.data) return sendError(res, 400, insert.error?.message || "Could not create discount code");

  return res.status(200).json({ ok: true, id: insert.data.id });
}

export async function handleDiscountCodeValidate(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
  const user = await requireUser(req);
  if (!user) return sendError(res, 401, "Unauthorized");

  const parsed = discountCodeValidateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendError(res, 400, "Invalid payload");

  try {
    const totals = await computeCartTotals(parsed.data.cartId);
    const validation = await validateDiscountCode({
      userId: user.id,
      code: parsed.data.code,
      subtotalInr: totals.subtotal,
    });
    if (!validation.ok) return sendError(res, 400, validation.error);
    return res.status(200).json({
      ok: true,
      code: validation.code,
      title: validation.title,
      discount_type: validation.discountType,
      discount_value: validation.discountValue,
      discount_amount_inr: validation.discountAmountInr,
      min_order_inr: validation.minOrderInr,
      max_discount_inr: validation.maxDiscountInr,
      subtotal_inr: totals.subtotal,
      shipping_inr: totals.shipping,
      total_after_discount_inr: Math.max(0, totals.subtotal - validation.discountAmountInr) + totals.shipping,
    });
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : "Could not validate code");
  }
}

export async function handleShippingTest(req: ApiRequest, res: ApiResponse) {
  const admin = await requireAdmin(req);
  if (!admin) return sendError(res, 403, "Unauthorized");
  const testModeRaw = Array.isArray(req.query?.test_mode) ? req.query?.test_mode[0] : req.query?.test_mode;
  const testMode = testModeRaw === "true";
  if (!testMode) return sendError(res, 400, "test_mode required");
  if (process.env.NODE_ENV === "production" && !testMode) return sendError(res, 400, "test_mode required");
  const enabledRaw = (process.env.ENABLE_SHIPROCKET_TEST ?? "true").trim().toLowerCase();
  if (enabledRaw === "false") return sendError(res, 403, "Shipping test route disabled");

  const email = process.env.SHIPROCKET_EMAIL?.trim();
  const password = process.env.SHIPROCKET_PASSWORD?.trim();
  if (!email || !password) return sendError(res, 500, "Shiprocket credentials missing");

  let token = "";
  const loginResponse = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!loginResponse.ok) {
    const loginError = await safeJson(loginResponse);
    return res.status(401).json({
      ok: false,
      error: "Login failed",
      status_code: loginResponse.status,
      reason: pickErrorText(loginError) ?? "Shiprocket auth rejected request",
    });
  }
  const loginData = (await loginResponse.json()) as { token?: string };
  if (!loginData.token) return sendError(res, 401, "Login failed");
  token = loginData.token;

  const orderRef = `TEST-${Date.now()}`;
  const createPayload = (pickupLocation: string) => ({
    order_id: orderRef,
    order_date: getNowDateTime(),
    pickup_location: pickupLocation,
    channel_id: "",
    comment: "Shiprocket test create from serverless endpoint",
    billing_customer_name: "Test",
    billing_last_name: "User",
    billing_address: "221B Baker Street",
    billing_address_2: "",
    billing_city: "Mumbai",
    billing_pincode: "400001",
    billing_state: "Maharashtra",
    billing_country: "India",
    billing_email: "test@example.com",
    billing_phone: "9876543210",
    shipping_is_billing: true,
    shipping_customer_name: "Test",
    shipping_last_name: "User",
    shipping_address: "221B Baker Street",
    shipping_address_2: "",
    shipping_city: "Mumbai",
    shipping_pincode: "400001",
    shipping_country: "India",
    shipping_state: "Maharashtra",
    shipping_email: "test@example.com",
    shipping_phone: "9876543210",
    order_items: [{ name: "Test Product", sku: `SKU-${Date.now()}`, units: 1, selling_price: 499, discount: "", tax: "", hsn: 111111 }],
    payment_method: "Prepaid",
    shipping_charges: 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: 499,
    length: 10,
    breadth: 10,
    height: 10,
    weight: 0.5,
  });

  const configuredPickup = process.env.SHIPROCKET_PICKUP_LOCATION?.trim() || "Primary";
  const queue: string[] = [configuredPickup];
  const tried = new Set<string>();
  let createOrderResponse: Response | null = null;
  let shiprocketResponse: Record<string, unknown> = {};

  while (queue.length) {
    const pickup = queue.shift()!.trim();
    if (!pickup || tried.has(pickup)) continue;
    tried.add(pickup);
    const response = await fetch(`${SHIPROCKET_BASE}/orders/create/adhoc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(createPayload(pickup)),
    });
    const payload = await safeJson(response);
    createOrderResponse = response;
    shiprocketResponse = payload;
    if (response.ok && isOrderCreationSuccess(payload)) break;
    const suggested = pickSuggestedPickupLocation(payload);
    if (suggested && !tried.has(suggested)) queue.push(suggested);
    for (const candidate of listPickupLocations(payload)) if (!tried.has(candidate)) queue.push(candidate);
  }

  if (!createOrderResponse || !createOrderResponse.ok || !isOrderCreationSuccess(shiprocketResponse)) {
    return res.status(400).json({
      ok: false,
      error: "Order failed",
      status_code: createOrderResponse?.status ?? 400,
      reason: pickErrorText(shiprocketResponse) ?? "Shiprocket order create rejected request",
    });
  }

  return res.status(200).json({
    ok: true,
    login_success: true,
    shipment_created: true,
    order_id: String(shiprocketResponse.order_id ?? shiprocketResponse.channel_order_id ?? ""),
    shipment_id: String(shiprocketResponse.shipment_id ?? ""),
    test_mode: true,
  });
}
