import { useQuery } from "@tanstack/react-query";
import { socialRewardsApi } from "@/lib/apiClient";

export const CreatorsPage = () => {
  const query = useQuery({
    queryKey: ["social-leaderboard"],
    queryFn: socialRewardsApi.getLeaderboard,
    staleTime: 60_000,
  });

  return (
    <section className="mx-auto w-full max-w-[1320px] px-5 py-10 md:px-8">
      <header className="mb-8">
        <p className="premium-kicker">Royal Creator Boost</p>
        <h1 className="premium-heading mt-2 text-4xl font-bold">Creators Leaderboard</h1>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(query.data?.leaderboard ?? []).map((item, idx) => (
          <article key={item.user_id} className="premium-surface rounded-2xl border border-black/10 bg-white p-5">
            <p className="text-xs uppercase tracking-[0.15em] text-[#666666]">Rank #{idx + 1}</p>
            <h2 className="mt-1 text-xl font-semibold text-[#111111]">{item.username}</h2>
            <p className="text-xs uppercase tracking-[0.12em] text-[#555555]">{item.platform}</p>
            <p className="mt-3 text-sm text-[#111111]">Views: {item.views.toLocaleString()}</p>
            <p className="text-sm text-[#111111]">Engagement: {item.engagement.toLocaleString()}</p>
            <p className="text-sm text-[#111111]">Approved: {item.approved_submissions}</p>
            <span className="mt-3 inline-flex rounded-full border border-black/15 px-3 py-1 text-xs uppercase tracking-[0.12em] text-[#111111]">
              {item.badge}
            </span>
            {item.elite_tier ? (
              <span
                className={`ml-2 mt-3 inline-flex rounded-full border px-3 py-1 text-xs uppercase tracking-[0.12em] ${
                  item.elite_tier.toLowerCase() === "royal crown"
                    ? "border-[#C8A951]/60 bg-[#C8A951]/10 text-[#8C6B1F] shadow-[0_0_0_1px_rgba(200,169,81,0.3)]"
                    : "border-black/20 text-[#111111]"
                }`}
              >
                {item.elite_tier}
              </span>
            ) : null}
          </article>
        ))}
      </div>

      {!query.isLoading && !(query.data?.leaderboard?.length ?? 0) ? (
        <p className="premium-surface rounded-xl border border-black/10 bg-[#fafafa] px-4 py-8 text-center text-sm text-[#555555]">
          Coming soon - leaderboard data will appear after approvals.
        </p>
      ) : null}
    </section>
  );
};
