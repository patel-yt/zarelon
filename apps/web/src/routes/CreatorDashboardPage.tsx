import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { creatorApi, referralApi } from "@/lib/apiClient";
import { appEnv } from "@/lib/env";
import { useAuth } from "@/features/auth/AuthContext";
import { supabase } from "@/lib/supabase";

export const CreatorDashboardPage = () => {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [referralMessage, setReferralMessage] = useState<string>("");
  const query = useQuery({
    queryKey: ["creator-dashboard", user?.id],
    queryFn: creatorApi.getDashboard,
    enabled: Boolean(user?.id),
  });
  const referralCodeQuery = useQuery({
    queryKey: ["referral-code-fallback", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data } = await supabase.from("users").select("referral_code").eq("id", user!.id).maybeSingle();
      if (data?.referral_code) return data.referral_code as string;

      const gen = await supabase.rpc("generate_referral_code");
      if (gen.error || typeof gen.data !== "string") return null;

      await supabase.from("users").update({ referral_code: gen.data }).eq("id", user!.id).is("referral_code", null);
      const latest = await supabase.from("users").select("referral_code").eq("id", user!.id).maybeSingle();
      return (latest.data?.referral_code as string | null) ?? null;
    },
    staleTime: 60_000,
  });
  const remindMutation = useMutation({
    mutationFn: (referralId: string) => referralApi.remind(referralId),
    onSuccess: async () => {
      setReferralMessage("Reminder sent successfully.");
      await queryClient.invalidateQueries({ queryKey: ["creator-dashboard", user?.id] });
    },
    onError: (error) => {
      setReferralMessage(error instanceof Error ? error.message : "Could not send reminder.");
    },
  });

  if (!user) {
    return (
      <section className="mx-auto w-full max-w-3xl px-5 py-10 text-[#111111] md:px-8">
        <p className="text-sm">Please sign in to access creator dashboard.</p>
      </section>
    );
  }

  const creator = query.data?.creator;
  const referralCode = creator?.referral_code ?? profile?.referral_code ?? referralCodeQuery.data ?? "";
  const shareBaseUrl = useMemo(() => {
    const envUrl = appEnv.publicSiteUrl.trim().replace(/\/+$/, "");
    if (envUrl) return envUrl;
    if (typeof window === "undefined") return "";
    const runtimeOrigin = window.location.origin.trim().replace(/\/+$/, "");
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(runtimeOrigin)) return "";
    return runtimeOrigin;
  }, []);
  const referralLink = useMemo(() => {
    if (!referralCode || !shareBaseUrl) return "";
    return `${shareBaseUrl}/?ref=${referralCode}`;
  }, [referralCode, shareBaseUrl]);

  const handleCopyReferralCode = async () => {
    if (!referralCode) {
      setReferralMessage("Referral code unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(referralCode);
      setReferralMessage("Referral code copied.");
    } catch {
      setReferralMessage("Could not copy code.");
    }
  };

  const handleCopyReferralLink = async () => {
    if (!referralLink) {
      setReferralMessage("Referral link unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(referralLink);
      setReferralMessage("Referral link copied.");
    } catch {
      setReferralMessage("Could not copy link.");
    }
  };

  const handleShareOnWhatsApp = () => {
    if (!referralLink) {
      setReferralMessage("Referral link unavailable.");
      return;
    }
    const shareText = "Join using my referral link and unlock rewards.";
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${referralLink}`)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    setReferralMessage("WhatsApp share opened.");
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-10 text-[#111111] md:px-8">
      <header className="mb-8">
        <p className="premium-kicker">Creator Dashboard</p>
        <h1 className="premium-heading mt-2 text-4xl font-bold">Your Creator Performance</h1>
      </header>

      <div className="premium-luxe-card mb-6 rounded-2xl p-5 text-white">
        <p className="royal-force-white text-xs uppercase tracking-[0.18em]">The Royal Crown</p>
        <h2 className="royal-force-white mt-2 text-2xl font-semibold">Earn Your Place Among the Elite.</h2>
        <p className="royal-force-white mt-2 text-sm">
          Royal Ambassador is prestige-first growth. No gimmicks. Verified referrals unlock status, early access, and private vault rights.
        </p>
        <Link to="/royal" className="mt-4 inline-flex rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-semibold text-[#111111]">
          View Royal Program
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-5">
          <p className="text-xs text-[#666666]">Total submissions</p>
          <p className="mt-2 text-2xl font-semibold">{creator?.total_submissions ?? 0}</p>
        </div>
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-5">
          <p className="text-xs text-[#666666]">Approved count</p>
          <p className="mt-2 text-2xl font-semibold">{creator?.approved_count ?? 0}</p>
        </div>
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-5">
          <p className="text-xs text-[#666666]">Total views</p>
          <p className="mt-2 text-2xl font-semibold">{(creator?.total_views ?? 0).toLocaleString()}</p>
        </div>
        <div className="premium-surface rounded-2xl border border-black/10 bg-white p-5">
          <p className="text-xs text-[#666666]">Current tier</p>
          <p className="mt-2 text-2xl font-semibold">{creator?.current_tier?.name ?? "Bronze"}</p>
        </div>
      </div>

      <div className="premium-surface mt-6 rounded-2xl border border-black/10 bg-white p-5">
        <p className="text-sm font-semibold">Tier Progress</p>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs text-[#666666]">Approved submissions progress</p>
            <div className="mt-1 h-2 rounded-full bg-black/10">
              <div className="h-2 rounded-full bg-black" style={{ width: `${creator?.progress.approved_percent ?? 0}%` }} />
            </div>
          </div>
          <div>
            <p className="text-xs text-[#666666]">Views progress</p>
            <div className="mt-1 h-2 rounded-full bg-black/10">
              <div className="h-2 rounded-full bg-black" style={{ width: `${creator?.progress.views_percent ?? 0}%` }} />
            </div>
          </div>
        </div>
        {creator?.next_tier ? (
          <p className="mt-3 text-sm text-[#444444]">
            Next tier: <strong>{creator.next_tier.name}</strong> (need {creator.next_tier.min_approved_submissions} approved,{" "}
            {creator.next_tier.min_total_views.toLocaleString()} views)
          </p>
        ) : (
          <p className="mt-3 text-sm text-[#444444]">You are on top tier.</p>
        )}
      </div>

      <div className="premium-surface mt-6 rounded-2xl border border-black/10 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Share link</p>
          <Link to="/earn-500-off" className="text-sm underline underline-offset-2">
            Submit new video
          </Link>
        </div>
        <p className="mt-2 text-sm text-[#333333] break-all">
          {referralLink || "Referral code unavailable"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopyReferralCode}
            className="btn-secondary-contrast rounded-lg px-4 py-2 text-sm font-medium transition"
          >
            Copy Code
          </button>
          <button
            type="button"
            onClick={handleCopyReferralLink}
            className="btn-secondary-contrast rounded-lg px-4 py-2 text-sm font-medium transition"
          >
            Copy Referral Link
          </button>
          <button
            type="button"
            onClick={handleShareOnWhatsApp}
            className="btn-primary-contrast rounded-lg px-4 py-2 text-sm font-medium transition"
          >
            Share on WhatsApp
          </button>
        </div>
        {referralMessage ? <p className="mt-2 text-xs text-[#555555]">{referralMessage}</p> : null}
      </div>

      <div className="premium-surface mt-6 rounded-2xl border border-black/10 bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Referred Users</p>
          <p className="text-xs text-[#666666]">Signed up via your code: {(creator?.referrals ?? []).length}</p>
        </div>
        <div className="mt-3 grid gap-2">
          {(creator?.referrals ?? []).map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{row.friend?.name ?? "New user"}</p>
                <p className="text-xs text-[#666666]">{row.friend?.email ?? "-"}</p>
                <p className="text-xs text-[#666666]">Joined {new Date(row.created_at).toLocaleDateString()}</p>
              </div>
              {row.reward_given ? (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Converted</span>
              ) : (
                <button
                  type="button"
                  onClick={() => remindMutation.mutate(row.id)}
                  disabled={remindMutation.isPending}
                  className="rounded-lg border border-black/20 px-3 py-1.5 text-xs font-medium text-[#111111] transition hover:bg-black/5 disabled:opacity-60"
                >
                  {remindMutation.isPending ? "Sending..." : "Send Reminder"}
                </button>
              )}
            </div>
          ))}
          {query.isFetched && !(creator?.referrals?.length ?? 0) ? (
            <p className="text-sm text-[#666666]">No referred signups yet.</p>
          ) : null}
        </div>
      </div>

      <div className="premium-surface mt-6 rounded-2xl border border-black/10 bg-white p-5">
        <p className="text-sm font-semibold">Earned coupons</p>
        <div className="mt-3 grid gap-2">
          {(creator?.earned_coupons ?? []).map((coupon) => (
            <div key={coupon.id} className="rounded-lg border border-black/10 px-3 py-2 text-sm">
              <p className="font-medium">{coupon.coupon_code}</p>
              {coupon.coupon_expires_at ? <p className="text-xs text-[#666666]">Valid till {new Date(coupon.coupon_expires_at).toLocaleDateString()}</p> : null}
            </div>
          ))}
          {query.isFetched && !(creator?.earned_coupons.length ?? 0) ? (
            <p className="text-sm text-[#666666]">No earned coupons yet.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
};
