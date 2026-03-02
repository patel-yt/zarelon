import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { socialRewardsApi } from "@/lib/apiClient";

type Period = "today" | "7d" | "1m" | "custom";

const isAllowedSocialPlatform = (platform: string, url: string): boolean => {
  const u = String(url ?? "").toLowerCase();
  if (platform === "instagram") return u.includes("instagram.com");
  if (platform === "youtube") return u.includes("youtube.com") || u.includes("youtu.be");
  if (platform === "tiktok") return u.includes("tiktok.com");
  if (platform === "facebook") return u.includes("facebook.com") || u.includes("fb.watch");
  return false;
};

const hashtagsMissing = (caption: string, required: string[]): string[] => {
  const normalizedCaption = String(caption ?? "").toLowerCase();
  return (required ?? []).filter((tag) => !normalizedCaption.includes(String(tag).toLowerCase()));
};

const buildEligibility = (row: any) => {
  const minFollowers = Number(row?.campaign?.min_followers ?? 0);
  const minViews = Number(row?.campaign?.min_views ?? 0);
  const requiredHashtags = Array.isArray(row?.campaign?.required_hashtags) ? row.campaign.required_hashtags : [];
  const missingHashtags = hashtagsMissing(String(row?.caption ?? ""), requiredHashtags);

  const checks = [
    { label: "URL matches platform", ok: isAllowedSocialPlatform(String(row?.platform ?? ""), String(row?.video_url ?? "")) },
    { label: "Public URL reachable", ok: Boolean(row?.submitted_url_public ?? false) },
    { label: `Followers >= ${minFollowers}`, ok: Number(row?.followers_count ?? 0) >= minFollowers },
    { label: `Views >= ${minViews}`, ok: Number(row?.views_snapshot ?? 0) >= minViews },
    { label: "Required hashtags", ok: missingHashtags.length === 0, detail: missingHashtags.length ? `Missing: ${missingHashtags.join(", ")}` : "" },
  ];

  const okCount = checks.filter((item) => item.ok).length;
  const score = Math.round((okCount / checks.length) * 100);
  return { checks, score };
};

export const AdminSocialSubmissionsPage = () => {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const filterParams = useMemo(
    () => ({
      period,
      from: period === "custom" ? fromDate : undefined,
      to: period === "custom" ? toDate : undefined,
    }),
    [period, fromDate, toDate]
  );

  const submissionsQuery = useQuery({
    queryKey: ["admin-social-submissions", filterParams.period, filterParams.from, filterParams.to],
    queryFn: () => socialRewardsApi.getAdminSubmissions(filterParams),
  });

  const reviewMutation = useMutation({
    mutationFn: (input: { submissionId: string; action: "approve" | "reject" | "pin" | "unpin" | "recheck" }) =>
      socialRewardsApi.reviewSubmission(input),
    onSuccess: (result) => {
      if (result.status === "approved" && result.coupon?.code) {
        setMessage(`Approved. Coupon generated: ${result.coupon.code}`);
      } else if (result.status === "pinned") {
        setMessage("Submission pinned to spotlight.");
      } else if (result.status === "unpinned") {
        setMessage("Submission removed from spotlight.");
      } else if (result.status === "rechecked") {
        setMessage(
          result.result?.revoked
            ? "Recheck failed. Coupon revoked."
            : result.result?.flagged
            ? "Recheck completed and flagged for review."
            : "Recheck completed successfully."
        );
      } else {
        setMessage("Submission rejected.");
      }
      void queryClient.invalidateQueries({ queryKey: ["admin-social-submissions"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Action failed");
    },
  });
  const recheckDueMutation = useMutation({
    mutationFn: () => socialRewardsApi.runRecheckDue(),
    onSuccess: (result) => {
      setMessage(`Recheck run complete. Processed: ${result.processed}`);
      void queryClient.invalidateQueries({ queryKey: ["admin-social-submissions"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Recheck failed"),
  });

  return (
    <section className="space-y-5 text-white">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-white/65">Creator Boost</p>
        <h1 className="mt-2 text-2xl font-semibold">Social Submissions</h1>
      </header>

      <div className="rounded-xl border border-white/10 bg-[#111] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-white/70">
            Filter
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="rounded-md border border-white/20 bg-[#0f0f0f] px-2 py-2 text-sm text-white"
            >
              <option value="today">Today</option>
              <option value="7d">7 days</option>
              <option value="1m">1 month</option>
              <option value="custom">Custom date</option>
            </select>
          </label>
          {period === "custom" ? (
            <>
              <label className="grid gap-1 text-xs text-white/70">
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-md border border-white/20 bg-[#0f0f0f] px-2 py-2 text-sm text-white"
                />
              </label>
              <label className="grid gap-1 text-xs text-white/70">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-md border border-white/20 bg-[#0f0f0f] px-2 py-2 text-sm text-white"
                />
              </label>
            </>
          ) : null}
          <Button
            className="!px-3 !py-2"
            onClick={() => recheckDueMutation.mutate()}
            disabled={recheckDueMutation.isPending}
          >
            {recheckDueMutation.isPending ? "Running..." : "Run Due Recheck"}
          </Button>
        </div>
      </div>

      {message ? (
        <p className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">{message}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.12em] text-white/65">
            <tr>
              <th className="px-3 py-3">User</th>
              <th className="px-3 py-3">Platform</th>
              <th className="px-3 py-3">Followers</th>
              <th className="px-3 py-3">Video URL</th>
              <th className="px-3 py-3">Eligibility</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Submitted</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 bg-[#151515]">
            {(submissionsQuery.data?.submissions ?? []).map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-3">
                  <p className="font-medium text-white">{row.user?.name || "Unknown User"}</p>
                  <p className="text-xs text-white/60">{row.user?.email || row.user_id}</p>
                </td>
                <td className="px-3 py-3 capitalize text-white">{row.platform}</td>
                <td className="px-3 py-3 text-white">{row.followers_count}</td>
                <td className="px-3 py-3">
                  <a className="line-clamp-1 max-w-[320px] text-[#8cb4ff] underline" href={row.video_url} target="_blank" rel="noreferrer">
                    {row.video_url}
                  </a>
                </td>
                <td className="px-3 py-3">
                  {(() => {
                    const eligibility = buildEligibility(row);
                    return (
                      <div className="space-y-1">
                        <p className={`text-xs font-semibold ${eligibility.score >= 80 ? "text-emerald-300" : "text-rose-300"}`}>
                          Score: {eligibility.score}%
                        </p>
                        {eligibility.checks.map((check) => (
                          <p key={check.label} className={`text-[11px] ${check.ok ? "text-emerald-300" : "text-rose-300"}`}>
                            {check.ok ? "OK" : "NO"} - {check.label}
                            {check.detail ? ` (${check.detail})` : ""}
                          </p>
                        ))}
                        {Array.isArray(row.precheck_errors) && row.precheck_errors.length ? (
                          <p className="text-[11px] text-amber-300">Server check: {row.precheck_errors[0]}</p>
                        ) : null}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full border border-white/20 px-2 py-1 text-xs uppercase tracking-[0.08em]">
                    {row.status}
                  </span>
                  {row.flagged_for_review ? <p className="mt-1 text-xs text-amber-300">Flagged for review</p> : null}
                  {row.is_invalid ? <p className="mt-1 text-xs text-rose-300">Invalid (coupon revoked)</p> : null}
                  {row.coupon_code ? <p className="mt-1 text-xs text-emerald-300">{row.coupon_code}</p> : null}
                </td>
                <td className="px-3 py-3 text-white/85">{new Date(row.submitted_at).toLocaleString()}</td>
                <td className="px-3 py-3">
                  <div className="flex gap-2">
                    <Button
                      className="!px-3 !py-1.5"
                      disabled={row.status !== "pending" || reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ submissionId: row.id, action: "approve" })}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-3 !py-1.5 !border-white/25 !text-white hover:!bg-white/10"
                      disabled={row.status !== "pending" || reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ submissionId: row.id, action: "reject" })}
                    >
                      Reject
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-3 !py-1.5 !border-white/25 !text-white hover:!bg-white/10"
                      disabled={row.status !== "approved" || reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ submissionId: row.id, action: row.is_featured ? "unpin" : "pin" })}
                    >
                      {row.is_featured ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-3 !py-1.5 !border-white/25 !text-white hover:!bg-white/10"
                      disabled={row.status !== "approved" || reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ submissionId: row.id, action: "recheck" })}
                    >
                      Recheck
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {submissionsQuery.isFetched && !(submissionsQuery.data?.submissions?.length ?? 0) ? (
          <p className="px-3 py-6 text-sm text-white/70">No submissions for selected range.</p>
        ) : null}
      </div>
    </section>
  );
};
