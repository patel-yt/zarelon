import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { eliteApi, royalAccessApi, socialRewardsApi } from "@/lib/apiClient";

const royalTiers = [
  { name: "Silver Circle", referrals: 50, perks: "Recognition badge" },
  { name: "Gold Society", referrals: 200, perks: "2h early drop access" },
  { name: "Platinum Council", referrals: 500, perks: "6h early drop access" },
  { name: "Diamond Order", referrals: 800, perks: "12h early drop + Partial Vault" },
  { name: "Royal Crown", referrals: 1000, perks: "24h early drop + Full Vault + Leaderboard + Secret Drops" },
];

export const RoyalPage = () => {
  const { user, profile } = useAuth();
  const [royalAccessMessage, setRoyalAccessMessage] = useState<string>("");
  const [royalAccessError, setRoyalAccessError] = useState<string>("");
  const [showExpiryPopup, setShowExpiryPopup] = useState(false);
  const eliteQuery = useQuery({
    queryKey: ["elite-me-royal", user?.id],
    queryFn: eliteApi.getMyStatus,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
  const leaderboardQuery = useQuery({
    queryKey: ["royal-leaderboard"],
    queryFn: socialRewardsApi.getLeaderboard,
    staleTime: 60_000,
    enabled: Boolean(eliteQuery.data?.feature_flags?.leaderboard_enabled ?? true),
  });
  const isBlockEnabled = (key: string) =>
    (eliteQuery.data?.content_blocks ?? []).find((block) => block.key === key)?.is_enabled ?? true;
  const monthlyPriceInr = Math.max(1, Number(eliteQuery.data?.settings?.royal_access_price_inr ?? 399));
  const royalAccessEnabled =
    !eliteQuery.data?.disabled &&
    Boolean(eliteQuery.data?.feature_flags?.ambassador_program_enabled ?? true) &&
    Boolean(eliteQuery.data?.feature_flags?.royal_access_enabled ?? true);
  const derivedTier = String((eliteQuery.data as any)?.derived_tier ?? "NORMAL_USER");
  const hasRoyalAccess = derivedTier === "ROYAL_ACCESS" || derivedTier === "ROYAL_CROWN" || derivedTier === "SUPER_ROYAL";
  const royalAccessExpiresAt = (eliteQuery.data as any)?.royal_access_expires_at as string | null | undefined;
  const accessFeatures = [
    {
      title: "Instant Unlock After Payment",
      description: "Your pass is activated immediately after successful payment verification.",
      active: true,
    },
    {
      title: "Member Price Protection",
      description: "On renewal, your best historical member rate remains protected.",
      active: true,
    },
    {
      title: "Early Drop Entry",
      description: "Get into selected drops before public release and shop ahead of the rush.",
      active: Boolean(eliteQuery.data?.feature_flags?.early_drop_enabled ?? true),
    },
    {
      title: "Private Vault Access",
      description: "Unlock premium vault pieces reserved for higher-tier members.",
      active: Boolean(eliteQuery.data?.feature_flags?.vault_enabled ?? true),
    },
    {
      title: "Priority Processing",
      description: "Eligible members get faster priority handling when this mode is enabled.",
      active: Boolean(eliteQuery.data?.feature_flags?.priority_checkout_enabled ?? true),
    },
    {
      title: "Royal Access Badge",
      description: "Your profile carries a visible Access Pass identity across the experience.",
      active: true,
    },
    {
      title: "30-Day Premium Window",
      description: "One successful payment unlocks your benefits for a full 30 days.",
      active: true,
    },
    {
      title: "Tier-Gated Product Access",
      description: "Premium tier locks open for eligible products while public users wait.",
      active: true,
    },
    {
      title: "No Referral Grind",
      description: "Get premium access directly without waiting for long referral milestones.",
      active: true,
    },
    {
      title: "Clean Premium Experience",
      description: "Focused access perks without clutter, distraction, or extra unlock friction.",
      active: true,
    },
    {
      title: "Protected Tier Access",
      description: "Your member perks are securely validated so your access stays protected.",
      active: true,
    },
  ];

  const ensureRazorpayLoaded = async (): Promise<void> => {
    if (window.Razorpay) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-rzp="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Could not load Razorpay SDK")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.dataset.rzp = "1";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Razorpay SDK"));
      document.body.appendChild(script);
    });
    if (!window.Razorpay) throw new Error("Razorpay SDK not available");
  };

  const royalAccessPurchaseMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Please login to unlock Royal Access");
      setRoyalAccessMessage("");
      setRoyalAccessError("");
      const created = await royalAccessApi.createOrder();
      await ensureRazorpayLoaded();
      const razorpayKey = (import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined)?.trim();
      if (!razorpayKey) throw new Error("VITE_RAZORPAY_KEY_ID is missing");
      const RazorpayCtor = window.Razorpay;
      if (!RazorpayCtor) throw new Error("Razorpay SDK missing");

      return await new Promise<{ expiresAt: string | null }>((resolve, reject) => {
        let settled = false;
        const finish = (cb: () => void) => {
          if (settled) return;
          settled = true;
          cb();
        };

        const checkout = new RazorpayCtor({
          key: razorpayKey,
          amount: created.amount,
          currency: created.currency,
          order_id: created.razorpayOrderId,
          name: "ZARELON Royal Access",
          description: `Royal Access - Rs ${created.monthly_price_inr}/month`,
          prefill: {
            name: profile?.name ?? user.email?.split("@")[0] ?? "Member",
            email: profile?.email ?? user.email ?? "",
          },
          theme: { color: "#D4AF37" },
          handler: async (response: Record<string, string>) => {
            try {
              const verified = await royalAccessApi.verify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              finish(() => resolve({ expiresAt: verified.expires_at ?? null }));
            } catch (error) {
              finish(() => reject(error));
            }
          },
          modal: {
            ondismiss: () => finish(() => reject(new Error("Payment window closed"))),
          },
        });
        (checkout as any).on?.("payment.failed", (response: any) => {
          const reason = response?.error?.description ?? response?.error?.reason ?? "Payment failed";
          finish(() => reject(new Error(reason)));
        });
        checkout.open();
      });
    },
    onSuccess: async ({ expiresAt }) => {
      const expiryText = expiresAt ? new Date(expiresAt).toLocaleString() : "30 days from now";
      setRoyalAccessMessage(
        `Payment successful. Purchase completed. All Royal Access benefits are now unlocked and active until ${expiryText}.`
      );
      await eliteQuery.refetch();
    },
    onError: (error) => setRoyalAccessError((error as Error)?.message ?? "Royal Access payment failed"),
  });

  const progressCount = Number(eliteQuery.data?.progress?.valid_referral_count ?? 0);
  const nextTier = (eliteQuery.data?.tiers ?? [])
    .filter((tier) => Number(tier.required_valid_referrals ?? 0) > progressCount)
    .sort((a, b) => Number(a.required_valid_referrals) - Number(b.required_valid_referrals))[0];
  const nextTarget = Number(nextTier?.required_valid_referrals ?? 1000);
  const progressPercent = Math.max(0, Math.min(100, Math.round((progressCount / Math.max(1, nextTarget)) * 100)));
  const topRoyal = (leaderboardQuery.data?.leaderboard ?? [])
    .filter((row) => String(row.elite_tier ?? "").toLowerCase() === "royal crown")
    .slice(0, 10);

  useEffect(() => {
    if (!hasRoyalAccess || !royalAccessExpiresAt) {
      setShowExpiryPopup(false);
      return;
    }

    const expiresAtMs = new Date(royalAccessExpiresAt).getTime();
    if (Number.isNaN(expiresAtMs)) {
      setShowExpiryPopup(false);
      return;
    }

    const remainingMs = expiresAtMs - Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    if (remainingMs <= 0 || remainingMs > twoDaysMs) {
      setShowExpiryPopup(false);
      return;
    }

    const now = new Date();
    const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const storageKey = `royal-expiry-popup-count:${dayKey}`;
    const currentCount = Number(window.localStorage.getItem(storageKey) ?? "0");
    if (currentCount >= 3) {
      setShowExpiryPopup(false);
      return;
    }

    window.localStorage.setItem(storageKey, String(currentCount + 1));
    setShowExpiryPopup(true);
  }, [hasRoyalAccess, royalAccessExpiresAt]);

  return (
    <section className="mx-auto w-full max-w-[1320px] space-y-8 px-5 py-10 text-[#111111] md:px-8">
      {showExpiryPopup && royalAccessExpiresAt ? (
        <div className="fixed right-4 top-20 z-[80] max-w-sm rounded-xl border border-[#d4af37]/50 bg-[#111111] px-4 py-3 text-white shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#d4af37]">Royal Pass Reminder</p>
          <p className="mt-1 text-sm">
            Your Royal pass expires soon on {new Date(royalAccessExpiresAt).toLocaleString()}. Renew now to keep benefits active.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => royalAccessPurchaseMutation.mutate()}
              disabled={royalAccessPurchaseMutation.isPending}
              className="rounded-md bg-[#d4af37] px-3 py-1.5 text-xs font-semibold text-[#111111] disabled:opacity-60"
            >
              Renew Now
            </button>
            <button
              type="button"
              onClick={() => setShowExpiryPopup(false)}
              className="rounded-md border border-white/30 px-3 py-1.5 text-xs"
            >
              Later
            </button>
          </div>
        </div>
      ) : null}

      {eliteQuery.data?.disabled ? (
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-6 text-sm text-[#444444]">
          Royal system is currently disabled by admin.
        </div>
      ) : null}
      {!eliteQuery.data?.disabled && isBlockEnabled("royal_landing_hero") ? (
        <div className="premium-luxe-card relative overflow-hidden rounded-3xl p-8 text-white md:p-10">
        <div className="absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[radial-gradient(circle,#d4af37_0%,rgba(212,175,55,0)_70%)] opacity-40" />
        <p className="royal-force-white premium-kicker">The Royal Crown</p>
        <h1 className="royal-force-white mt-3 text-4xl font-bold md:text-5xl">Earn Your Place Among the Elite.</h1>
        <p className="royal-force-white mt-3 max-w-2xl text-sm">
          Royal Ambassador is prestige-first growth. No gimmicks. Verified referrals unlock status, early access, and private vault rights.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/creator-dashboard" className="rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-semibold text-[#111111]">
            Earn Royal Crown
          </Link>
          {royalAccessEnabled ? (
            <button
              type="button"
              onClick={() => royalAccessPurchaseMutation.mutate()}
              disabled={royalAccessPurchaseMutation.isPending || hasRoyalAccess}
              className="royal-force-white rounded-lg border border-white/25 px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {hasRoyalAccess
                ? "Royal Access Active"
                : royalAccessPurchaseMutation.isPending
                ? "Opening secure checkout..."
                : `Apply for Royal Access - Rs ${monthlyPriceInr}/month`}
            </button>
          ) : null}
        </div>
        {royalAccessMessage ? <p className="mt-3 text-sm text-[#b6f5d1]">{royalAccessMessage}</p> : null}
        {royalAccessError ? <p className="mt-3 text-sm text-[#ffd0d0]">{royalAccessError}</p> : null}
        </div>
      ) : null}

      {!eliteQuery.data?.disabled && isBlockEnabled("royal_benefits_section") ? (
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="text-xl font-semibold">How It Works</h2>
        <ol className="mt-3 grid gap-2 text-sm text-[#333333] md:grid-cols-2">
          <li>1. Share your referral link</li>
          <li>2. Friend makes valid purchase</li>
          <li>3. Order delivered and verified</li>
          <li>4. Your progress increases</li>
        </ol>
        </div>
      ) : null}

      {!eliteQuery.data?.disabled && royalAccessEnabled ? (
        <div className="premium-luxe-card rounded-2xl p-6 text-white">
          <p className="royal-force-white premium-kicker">Royal Access Membership</p>
          <h2 className="royal-force-white mt-2 text-3xl font-semibold">Unlock Elite Access for only Rs {monthlyPriceInr}/month</h2>
          <p className="royal-force-white mt-2 max-w-3xl text-sm">
            Skip the wait and unlock premium access instantly. Your pass activates right after payment verification and stays active for a full
            30-day window.
          </p>
          {hasRoyalAccess && royalAccessExpiresAt ? (
            <p className="royal-force-white mt-2 text-xs">
              Active pass valid till: <strong>{new Date(royalAccessExpiresAt).toLocaleString()}</strong>
            </p>
          ) : null}
          <div className="mt-4 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/10 p-3 text-xs">
            <p className="royal-force-white font-semibold uppercase tracking-[0.12em]">Why users upgrade fast</p>
            <p className="royal-force-white mt-1">
              Early gated access, vault eligibility, protected renewal pricing, and direct premium entry without referral waiting.
            </p>
          </div>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            {accessFeatures.map((feature) => (
              <div key={feature.title} className="rounded-lg border border-white/15 bg-white/5 px-3 py-3">
                <p className="royal-force-white font-semibold">
                  {feature.active ? "• " : "○ "} {feature.title}
                </p>
                <p className="royal-force-white mt-1 text-xs">{feature.description}</p>
                {!feature.active ? (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-[#ffd88a]">Temporarily disabled by admin flag</p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => royalAccessPurchaseMutation.mutate()}
              disabled={royalAccessPurchaseMutation.isPending || hasRoyalAccess}
              className="rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-semibold text-[#111111] disabled:opacity-60"
            >
              {hasRoyalAccess
                ? "Already Active"
                : royalAccessPurchaseMutation.isPending
                ? "Processing..."
                : `Unlock Royal Access - Rs ${monthlyPriceInr}/month`}
            </button>
            <p className="royal-force-white text-xs">Monthly price may update seasonally. Your active 30-day pass stays protected once unlocked.</p>
          </div>
          {!hasRoyalAccess ? (
            <p className="royal-force-white mt-3 rounded-md border border-[#d4af37]/45 bg-[#d4af37]/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em]">
              Limited-Time Advantage: current month rate stays locked for your active pass once unlocked.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="premium-surface overflow-x-auto rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="text-xl font-semibold">Tier Comparison</h2>
        <table className="mt-3 min-w-full divide-y divide-black/10 text-sm">
          <thead className="text-left text-xs uppercase tracking-[0.12em] text-[#666666]">
            <tr>
              <th className="px-2 py-2">Tier</th>
              <th className="px-2 py-2">Valid Referrals</th>
              <th className="px-2 py-2">Perks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/10">
            {royalTiers.map((tier) => (
              <tr key={tier.name}>
                <td className="px-2 py-2 font-medium">{tier.name}</td>
                <td className="px-2 py-2">{tier.referrals}</td>
                <td className="px-2 py-2">{tier.perks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!eliteQuery.data?.disabled && (eliteQuery.data?.feature_flags?.leaderboard_enabled ?? true) && isBlockEnabled("royal_leaderboard_section") ? (
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-6">
        <h2 className="text-xl font-semibold">Live Leaderboard (Top 10 Royal Crown)</h2>
        <div className="mt-3 grid gap-2">
          {topRoyal.map((row, idx) => (
            <div key={row.user_id} className="flex items-center justify-between rounded-lg border border-black/10 px-3 py-2 text-sm">
              <p>
                #{idx + 1} {row.username}
              </p>
              <p className="text-[#666666]">{row.views.toLocaleString()} views</p>
            </div>
          ))}
          {!leaderboardQuery.isLoading && !topRoyal.length ? (
            <p className="text-sm text-[#666666]">Leaderboard will unlock as Royal Crown members grow.</p>
          ) : null}
        </div>
        </div>
      ) : null}

      {user && !eliteQuery.data?.disabled && isBlockEnabled("royal_progress_section") ? (
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-6">
          <h2 className="text-xl font-semibold">Your Progress</h2>
          <p className="mt-2 text-sm text-[#333333]">
            Valid referrals: <strong>{progressCount}</strong>
            {nextTier ? ` | Next milestone: ${nextTier.name} (${nextTarget})` : " | Top tier reached"}
          </p>
          <div className="mt-3 h-2 rounded-full bg-black/10">
            <div className="h-2 rounded-full bg-[#c8a951]" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      ) : null}
    </section>
  );
};
