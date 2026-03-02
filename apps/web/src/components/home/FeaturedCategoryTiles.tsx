import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export type FeaturedTile = {
  id: string;
  image: string;
  title: string;
  subtitle?: string;
  link: string;
};

type FeaturedCategoryTilesProps = {
  title?: string;
  tiles: FeaturedTile[];
};

export const FeaturedCategoryTiles = ({ title = "Featured", tiles }: FeaturedCategoryTilesProps) => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [animationActive, setAnimationActive] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setAnimationActive(entry.isIntersecting && entry.intersectionRatio >= 0.28);
      },
      { threshold: [0, 0.28, 0.45] }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!tiles.length) return null;

  return (
    <section ref={sectionRef} className={`mt-12 px-0 ${animationActive ? "featured-anim-on" : "featured-anim-off"}`}>
      <div className="pt-12 pb-12">
        <h3 className="mb-3 px-4 text-[22px] font-semibold tracking-[0.01em] text-[#111111] md:px-8">{title}</h3>
        <div className="featured-grid-premium mx-[-0.9rem] grid grid-cols-1 gap-0 md:mx-0 md:grid-cols-2">
          {tiles.slice(0, 6).map((tile, index) => {
            const normalizedIndex = index % 4;
            const motionClass =
              normalizedIndex === 0 || normalizedIndex === 3
                ? "featured-tile--front"
                : normalizedIndex === 1
                  ? "featured-tile--rise"
                  : "featured-tile--fall";
            return (
            <Link
              key={tile.id}
              to={tile.link}
              className={`premium-mobile-tile featured-sharp-tile ${motionClass} group relative block overflow-hidden rounded-none border-0 bg-white shadow-none transition duration-300`}
            >
              <img
                src={tile.image}
                alt={tile.title}
                loading="lazy"
                decoding="async"
                className="h-[66vw] min-h-[300px] w-full object-cover shadow-[0_14px_28px_-18px_rgba(0,0,0,0.55)] transition duration-300 group-hover:scale-[1.03] group-hover:shadow-[0_18px_34px_-16px_rgba(0,0,0,0.62)] group-active:scale-[0.98] md:h-[380px]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/52 via-black/18 to-transparent" />
              <div className="absolute bottom-2 left-2 w-[min(74%,20rem)] overflow-hidden pr-1 text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.45)]">
                <p className="force-text-light line-clamp-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-white/90">
                  {tile.title}
                </p>
                {tile.subtitle ? (
                  <p className="force-text-light font-heading line-clamp-2 break-words text-[clamp(12px,3.2vw,16px)] font-bold leading-[1.15] text-white">
                    {tile.subtitle}
                  </p>
                ) : null}
                <span className="mt-0.5 inline-flex rounded-full border border-black/15 bg-white px-2.5 py-0.5 font-heading text-[11px] font-semibold uppercase tracking-[0.16em] text-[#111111] shadow-[0_8px_18px_-14px_rgba(0,0,0,0.3)]">
                  Shop
                </span>
              </div>
            </Link>
          )})}
        </div>
      </div>
    </section>
  );
};
