import { useState } from "react";
import { Link } from "react-router-dom";
import { shouldUseDarkTextOnImage } from "@/lib/imageLuminance";

type MobileHeroBannerProps = {
  imageUrl: string | null;
  title: string;
  subtitle?: string;
  ctaText?: string;
  ctaUrl?: string;
  imagePosition?: "center" | "top" | "bottom";
  textColorMode?: "light" | "dark" | "auto";
  contentBelow?: boolean;
  kicker?: string;
};

const clampText = (value: string | undefined, maxLen: number) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}...`;
};

export const MobileHeroBanner = ({
  imageUrl,
  title,
  subtitle,
  ctaText,
  ctaUrl = "/products",
  imagePosition = "center",
  textColorMode = "auto",
  contentBelow = false,
  kicker,
}: MobileHeroBannerProps) => {
  const [autoDarkText, setAutoDarkText] = useState<boolean | null>(null);
  const safeTitle = clampText(title, 35);
  const safeSubtitle = clampText(subtitle, 60);
  const useDarkText = textColorMode === "dark" || (textColorMode === "auto" && autoDarkText === true);
  const titleClass = useDarkText ? "text-[#111111]" : "text-white";
  const subtitleClass = useDarkText ? "text-[#111111]/85" : "text-white/90";

  return (
    <section className="relative overflow-hidden bg-[#f6f6f6]">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={title}
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="h-[62vh] w-full object-cover"
          style={{
            objectPosition:
              imagePosition === "top"
                ? "center top"
                : imagePosition === "bottom"
                ? "center bottom"
                : "center center",
          }}
          crossOrigin="anonymous"
          onLoad={(event) => {
            if (textColorMode !== "auto") return;
            const shouldUseDark = shouldUseDarkTextOnImage(event.currentTarget);
            setAutoDarkText(shouldUseDark);
          }}
        />
      ) : (
        <div className="h-[62vh] w-full bg-[#111111]" />
      )}
      {contentBelow ? (
        <div className="bg-[#f6f6f6] px-4 py-5">
          {kicker ? <p className="text-[14px] font-medium text-[#111111]">{kicker}</p> : null}
          <h1 className="mt-1 font-heading text-[2.75rem] leading-[0.88] tracking-tight text-[#111111]">{safeTitle}</h1>
          {safeSubtitle ? <p className="mt-2 max-w-[96%] text-[1.04rem] leading-[1.24] text-[#222222]">{safeSubtitle}</p> : null}
          {ctaText ? (
            <Link
              to={ctaUrl}
              className="mt-5 inline-flex rounded-full bg-[#111111] px-5 py-2 text-[15px] font-semibold text-white"
            >
              {ctaText}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.30) 40%, rgba(0,0,0,0.10) 70%, transparent 100%)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-5">
            <div className="mobile-hero-text-safe max-w-[70%]">
              <h1 className={`force-text-light mobile-hero-title ${titleClass}`}>{safeTitle}</h1>
              {safeSubtitle ? <p className={`force-text-light mobile-hero-subtitle mt-1 ${subtitleClass}`}>{safeSubtitle}</p> : null}
            </div>
            {ctaText ? (
              <Link
                to={ctaUrl}
                className="force-text-light mt-2 inline-flex rounded-md border border-white/45 bg-white/20 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md"
              >
                {ctaText}
              </Link>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
};
