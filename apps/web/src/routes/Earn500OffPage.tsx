import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { socialRewardsApi } from "@/lib/apiClient";
import { fetchActiveSocialCampaign } from "@/services/socialRewards";

const statusClass: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 border border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30",
  rejected: "bg-rose-500/15 text-rose-700 border border-rose-500/30",
};

export const Earn500OffPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState<"instagram" | "youtube" | "tiktok" | "facebook">("instagram");
  const [videoUrl, setVideoUrl] = useState("");
  const [followersCount, setFollowersCount] = useState("");
  const [viewsSnapshot, setViewsSnapshot] = useState("");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const campaignQuery = useQuery({
    queryKey: ["social-campaign-active"],
    queryFn: fetchActiveSocialCampaign,
    staleTime: 60_000,
  });
  const submissionsQuery = useQuery({
    queryKey: ["social-submissions-me", user?.id],
    queryFn: () => socialRewardsApi.getMySubmissions(),
    enabled: Boolean(user?.id),
  });

  const activeCampaign = campaignQuery.data;
  const submissionMutation = useMutation({
    mutationFn: () =>
      socialRewardsApi.submitVideo({
        platform,
        videoUrl,
        followersCount: Number(followersCount || 0),
        viewsSnapshot: Number(viewsSnapshot || 0),
        caption,
      }),
    onSuccess: () => {
      setMessage("Submission sent for review. Once approved, coupon will be generated.");
      setVideoUrl("");
      setFollowersCount("");
      setViewsSnapshot("");
      setCaption("");
      void queryClient.invalidateQueries({ queryKey: ["social-submissions-me", user?.id] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Submission failed"),
  });
  const captionMutation = useMutation({
    mutationFn: async () => socialRewardsApi.generateCaption(caption),
    onSuccess: (result) => {
      setCaption(result.caption);
      if (result.mode === "fallback") {
        setMessage(`Caption generated in safe mode${result.ai_warning ? `: ${result.ai_warning}` : "."}`);
      } else if (result.mode === "cache") {
        setMessage("Caption generated from premium cache.");
      } else {
        setMessage(`Caption generated via AI${result.provider ? ` (${result.provider})` : ""}.`);
      }
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Caption generation failed"),
  });

  const hashtags = useMemo(() => activeCampaign?.required_hashtags ?? [], [activeCampaign?.required_hashtags]);
  const canSubmit = Boolean(user && activeCampaign && videoUrl.trim() && Number(followersCount) >= 0);

  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-12 text-[#111111] md:px-8">
      <div className="rounded-3xl border border-black/10 bg-white p-6 md:p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-black/55">Royal Creator Boost</p>
        <h1 className="mt-2 text-3xl font-bold md:text-4xl">Earn Rs {activeCampaign?.discount_amount ?? 500} OFF</h1>
        <p className="mt-3 text-sm text-[#444444]">
          Publish your social video, submit the link, and get a reward coupon after admin approval.
        </p>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1.2fr]">
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-semibold">Campaign Rules</h2>
          {activeCampaign ? (
            <ul className="mt-3 space-y-2 text-sm text-[#333333]">
              <li>Minimum followers: {activeCampaign.min_followers}</li>
              <li>Minimum views: {activeCampaign.min_views}</li>
              <li>Minimum days live: {activeCampaign.min_days_live}</li>
              <li>Campaign: {activeCampaign.name}</li>
              <li>Coupon validity: 15 days (one-time use)</li>
              <li>Minimum product value: Rs 1000</li>
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[#444444]">No active campaign right now.</p>
          )}
          <div className="mt-4">
            <p className="text-xs uppercase tracking-[0.15em] text-[#666666]">Required Hashtags</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {hashtags.length ? (
                hashtags.map((tag) => (
                  <span key={tag} className="rounded-full border border-black/15 px-3 py-1 text-xs">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-[#555555]">No hashtags configured.</span>
              )}
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-semibold">Submit Video</h2>
          {!user ? (
            <p className="mt-3 text-sm text-[#444444]">
              Please{" "}
              <Link to="/auth" className="underline underline-offset-2">
                sign in
              </Link>{" "}
              to submit your video.
            </p>
          ) : (
            <form
              className="mt-3 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setMessage(null);
                if (!activeCampaign) {
                  setMessage("Campaign is not active right now.");
                  return;
                }
                submissionMutation.mutate();
              }}
            >
              <label className="grid gap-1 text-sm">
                Platform
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as "instagram" | "youtube" | "tiktok" | "facebook")}
                  className="rounded-lg border border-black/20 bg-white px-3 py-2 outline-none focus:border-black"
                >
                  <option value="instagram">Instagram</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="facebook">Facebook Reels</option>
                </select>
              </label>

              <label className="grid gap-1 text-sm">
                Video URL
                <input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  type="url"
                  required
                  placeholder="https://..."
                  className="rounded-lg border border-black/20 bg-white px-3 py-2 outline-none focus:border-black"
                />
              </label>

              <label className="grid gap-1 text-sm">
                Current Views (optional)
                <input
                  value={viewsSnapshot}
                  onChange={(e) => setViewsSnapshot(e.target.value)}
                  type="number"
                  min={0}
                  className="rounded-lg border border-black/20 bg-white px-3 py-2 outline-none focus:border-black"
                />
              </label>

              <label className="grid gap-1 text-sm">
                Caption (optional)
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                  maxLength={280}
                  placeholder="Add caption with required hashtags..."
                  className="rounded-lg border border-black/20 bg-white px-3 py-2 outline-none focus:border-black"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMessage(null);
                    captionMutation.mutate();
                  }}
                  disabled={captionMutation.isPending}
                >
                  {captionMutation.isPending ? "Generating..." : "Generate Premium Caption"}
                </Button>
              </div>

              <label className="grid gap-1 text-sm">
                Followers Count
                <input
                  value={followersCount}
                  onChange={(e) => setFollowersCount(e.target.value)}
                  type="number"
                  min={0}
                  required
                  className="rounded-lg border border-black/20 bg-white px-3 py-2 outline-none focus:border-black"
                />
              </label>

              <Button type="submit" disabled={!canSubmit || submissionMutation.isPending}>
                {submissionMutation.isPending ? "Submitting..." : "Submit for Review"}
              </Button>
            </form>
          )}
          {message ? <p className="mt-3 text-sm text-[#333333]">{message}</p> : null}
        </article>
      </div>

      {user ? (
        <div className="mt-6 rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-semibold">My Submissions</h2>
          <div className="mt-3 grid gap-3">
            {(submissionsQuery.data?.submissions ?? []).map((item) => (
              <div key={item.id} className="rounded-xl border border-black/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.platform.toUpperCase()}</p>
                  <span className={`rounded-full px-2 py-1 text-xs ${statusClass[item.status] ?? "bg-black/5 text-black"}`}>
                    {item.status}
                  </span>
                </div>
                <a
                  href={item.video_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block break-all text-sm text-[#2563eb] underline underline-offset-2"
                >
                  {item.video_url}
                </a>
                {item.coupon_generated && item.coupon_code ? (
                  <p className="mt-2 text-sm font-semibold text-[#111111]">
                    Coupon: {item.coupon_code}{" "}
                    {item.coupon_expires_at ? <span className="font-normal text-[#555555]">(valid till {new Date(item.coupon_expires_at).toLocaleDateString()})</span> : null}
                  </p>
                ) : null}
              </div>
            ))}
            {submissionsQuery.isFetched && !(submissionsQuery.data?.submissions?.length ?? 0) ? (
              <p className="text-sm text-[#555555]">No submissions yet.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
};
