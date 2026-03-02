type RoyalLeaderboardRow = {
  user_id: string;
  username: string;
  views: number;
};

type RoyalLeaderboardSectionProps = {
  rows: RoyalLeaderboardRow[];
};

export const RoyalLeaderboardSection = ({ rows }: RoyalLeaderboardSectionProps) => {
  if (!rows.length) return null;

  return (
    <section className="mx-4 rounded-xl border border-[#d4af37]/40 bg-white px-4 py-4 text-[#111111] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.25)]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[#9f7a20]">Royal Crown Leaderboard</p>
      <div className="mt-3 grid gap-2">
        {rows.slice(0, 3).map((row, idx) => (
          <div key={row.user_id} className="flex items-center justify-between rounded-md border border-black/10 bg-[#fafafa] px-3 py-2 text-sm">
            <span>
              #{idx + 1} {row.username}
            </span>
            <span className="text-[#555555]">{row.views.toLocaleString()} views</span>
          </div>
        ))}
      </div>
    </section>
  );
};
