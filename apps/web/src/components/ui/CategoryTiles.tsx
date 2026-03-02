import { Link } from "react-router-dom";

export type CategoryTileItem = {
  slug: string;
  name: string;
  displayImageUrl?: string | null;
};

export const CategoryTiles = ({
  title,
  basePath,
  items,
}: {
  title: string;
  basePath: string;
  items: CategoryTileItem[];
}) => {
  if (!items.length) return null;

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between">
        <h2 className="font-heading text-2xl uppercase tracking-[0.08em] text-[#111111]">{title}</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Link
            key={item.slug}
            to={`${basePath}/${item.slug}`}
            className="premium-media-card group relative isolate overflow-hidden bg-white"
          >
            {item.displayImageUrl ? (
              <img
                src={item.displayImageUrl}
                alt={item.name}
                loading="lazy"
                decoding="async"
                className="h-56 w-full object-cover transition duration-[500ms] ease-out group-hover:scale-[1.035] md:h-64"
              />
            ) : (
              <div className="h-56 w-full bg-[#F2F2F2] md:h-64" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              <p className="text-xs uppercase tracking-[0.2em] text-white/80">Category</p>
              <p className="font-heading text-2xl uppercase">{item.name}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-white/85">Explore Now</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};
