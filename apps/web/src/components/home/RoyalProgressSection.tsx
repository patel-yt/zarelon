type RoyalProgressSectionProps = {
  progressCount: number;
  nextTarget: number;
  nextTierName?: string | null;
};

export const RoyalProgressSection = ({ progressCount, nextTarget, nextTierName }: RoyalProgressSectionProps) => {
  const safeTarget = Math.max(1, nextTarget);
  const percent = Math.max(0, Math.min(100, Math.round((progressCount / safeTarget) * 100)));

  return (
    <section className="mx-4 rounded-xl border border-[#d4af37]/40 bg-white px-4 py-4 text-[#111111] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.25)]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[#9f7a20]">Royal Progress</p>
      <p className="mt-2 text-sm text-[#333333]">
        Valid referrals: <strong>{progressCount}</strong>
        {nextTierName ? ` | Next: ${nextTierName} (${nextTarget})` : ""}
      </p>
      <div className="mt-3 h-2 rounded-full bg-black/10">
        <div className="h-2 rounded-full bg-[#d4af37]" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
};
