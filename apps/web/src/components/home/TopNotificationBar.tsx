import { Link } from "react-router-dom";

type TopNotificationBarProps = {
  message: string;
  ctaText?: string;
  ctaUrl?: string;
};

export const TopNotificationBar = ({
  message,
  ctaText = "Shop Now",
  ctaUrl = "/products",
}: TopNotificationBarProps) => {
  const messageItems = message
    .split(/[\u2022|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const tickerItems = messageItems.length ? messageItems : [message];

  return (
    <div className="w-full bg-[#f5f5f5] py-1.5 text-[#111111]">
      <div className="promo-ticker">
        <div className="top-notice-track">
          {[...tickerItems, ...tickerItems].map((item, index) => (
            <span key={`${item}-${index}`} className="promo-pill">
              <span className="promo-dot">•</span>
              {item}
            </span>
          ))}
          <Link to={ctaUrl} className="promo-pill font-semibold underline underline-offset-2">
            <span className="promo-dot">•</span>
            {ctaText}
          </Link>
          <Link to={ctaUrl} className="promo-pill font-semibold underline underline-offset-2" aria-hidden="true" tabIndex={-1}>
            <span className="promo-dot">•</span>
            {ctaText}
          </Link>
        </div>
      </div>
    </div>
  );
};
