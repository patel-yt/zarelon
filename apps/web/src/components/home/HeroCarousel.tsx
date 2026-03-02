import { useEffect, useMemo, useRef, useState, type TouchEventHandler } from "react";
import { Link } from "react-router-dom";

export type HeroCarouselItem = {
  id: string;
  imageMobile: string;
  headline: string;
  subText?: string;
  ctaText?: string;
  ctaUrl?: string;
  priority?: number;
  imagePosition?: "center" | "top" | "bottom";
  textColorMode?: "light" | "dark" | "auto";
};

type HeroCarouselProps = {
  items: HeroCarouselItem[];
  autoPlayMs?: number;
};

const clampText = (value: string | undefined, maxLen: number) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}...`;
};

export const HeroCarousel = ({ items, autoPlayMs = 4500 }: HeroCarouselProps) => {
  const sorted = useMemo(
    () => [...items].sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0)),
    [items]
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const startXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!sorted.length || paused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % sorted.length);
    }, autoPlayMs);
    return () => window.clearInterval(timer);
  }, [autoPlayMs, paused, sorted.length]);

  if (!sorted.length) return null;

  const onTouchStart: TouchEventHandler<HTMLDivElement> = (event) => {
    startXRef.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchEnd: TouchEventHandler<HTMLDivElement> = (event) => {
    const startX = startXRef.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    startXRef.current = null;
    if (startX == null || endX == null) return;
    const delta = endX - startX;
    if (Math.abs(delta) < 42) return;
    if (delta < 0) {
      setActiveIndex((prev) => (prev + 1) % sorted.length);
    } else {
      setActiveIndex((prev) => (prev - 1 + sorted.length) % sorted.length);
    }
  };

  return (
    <section className="relative w-full overflow-hidden bg-[#111111]" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${activeIndex * 100}%)` }}
      >
        {sorted.map((item) => {
          const safeHeadline = clampText(item.headline, 35);
          const safeSubText = clampText(item.subText, 60);
          const titleClass = "text-[#111111]";
          const subtitleClass = "text-[#111111]/86";

          return (
          <article key={item.id} className="relative min-w-full">
            <img
              src={item.imageMobile}
              alt={item.headline}
              className="hero-kenburns h-[72vh] w-full object-cover shadow-[0_24px_46px_-24px_rgba(0,0,0,0.62)]"
              style={{ objectPosition: item.imagePosition === "top" ? "center top" : item.imagePosition === "bottom" ? "center bottom" : "center center" }}
              loading={activeIndex === 0 ? "eager" : "lazy"}
              fetchPriority={activeIndex === 0 ? "high" : "auto"}
              decoding="async"
              crossOrigin="anonymous"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to top, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.42) 40%, rgba(255,255,255,0.16) 70%, transparent 100%)",
              }}
            />
            <div className="absolute inset-x-0 bottom-0 px-4 pb-8">
              <div className="max-w-[92%]">
                <h2 className={`line-clamp-2 text-[clamp(26px,8.2vw,44px)] font-extrabold uppercase leading-[0.95] tracking-[0.01em] ${titleClass}`}>
                  {safeHeadline}
                </h2>
                {safeSubText ? <p className={`mt-2 line-clamp-2 text-[clamp(14px,4.4vw,20px)] ${subtitleClass}`}>{safeSubText}</p> : null}
              </div>
              {item.ctaText ? (
                <Link
                  to={item.ctaUrl || "/products"}
                  className="mt-4 inline-flex rounded-full border border-[#b88d2d]/40 bg-[linear-gradient(180deg,#f7e6b5_0%,#efd58d_100%)] px-6 py-2 text-sm font-semibold text-black shadow-[0_12px_24px_-18px_rgba(0,0,0,0.45)]"
                >
                  {item.ctaText}
                </Link>
              ) : null}
            </div>
          </article>
          );
        })}
      </div>

      {sorted.length > 1 ? (
        <>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {sorted.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Slide ${index + 1}`}
                className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-5 bg-white" : "w-1.5 bg-white/60"}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPaused((prev) => !prev)}
            className="force-text-light absolute bottom-3 right-3 rounded-full border border-white/45 bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-md"
          >
            {paused ? "Play" : "Pause"}
          </button>
        </>
      ) : null}
    </section>
  );
};
