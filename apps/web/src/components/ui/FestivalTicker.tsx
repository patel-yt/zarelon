import type { SiteFestival } from "@/types/domain";

const withDefaultMessages = (festival: SiteFestival): string[] => {
  const base = [
    `Happy ${festival.festival_name}`,
    festival.discount_text,
    festival.urgency_text,
    festival.promo_text,
    ...(festival.promo_messages ?? []),
  ]
    .map((item) => item?.trim())
    .filter(Boolean) as string[];

  return base.length ? base : [`${festival.festival_name} Live`, "Limited Edition Drop", "Shop Festive Collection"];
};

const defaultPromo = ["Free shipping on prepaid orders", "New season arrivals", "Member exclusive drops", "Easy 7-day returns"];

export const FestivalTicker = ({ festival }: { festival?: SiteFestival | null }) => {
  const messages = festival ? withDefaultMessages(festival) : defaultPromo;
  const loop = [...messages, ...messages];

  return (
    <div className="festival-topbar border-b border-black/10">
      <div className="promo-ticker mx-auto w-full max-w-[1320px] overflow-hidden px-4 py-1.5 md:px-8">
        <div className="top-notice-track top-notice-track-fast">
          {loop.map((message, idx) => (
            <span key={`${message}-${idx}`} className="promo-pill">
              <span className="promo-dot">•</span>
              <span className="whitespace-nowrap">{message}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
