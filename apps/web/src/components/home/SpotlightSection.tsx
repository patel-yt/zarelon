import { Link } from "react-router-dom";

type SpotlightProduct = {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  href?: string;
};

type SpotlightSectionProps = {
  title?: string;
  products: SpotlightProduct[];
  banner?: {
    image: string;
    alt?: string;
    link?: string;
  } | null;
};

export const SpotlightSection = ({ title = "Spotlight", products, banner }: SpotlightSectionProps) => {
  if (!products.length) return null;

  return (
    <section className="px-4 pt-1">
      {banner?.image ? (
        <Link
          to={banner.link || "/products"}
          className="-mx-4 mb-3 block overflow-hidden rounded-none bg-[#efefef] shadow-[0_10px_22px_-18px_rgba(0,0,0,0.45)]"
        >
          <img
            src={banner.image}
            alt={banner.alt || "Spotlight Banner"}
            loading="lazy"
            decoding="async"
            className="h-[70px] w-full object-cover"
          />
        </Link>
      ) : null}
      <h3 className="mb-3 text-center text-[22px] font-semibold tracking-[0.01em] text-[#111111]">{title}</h3>
      <div className="grid grid-cols-4 gap-2">
        {products.slice(0, 8).map((product) => (
          <Link
            key={product.id}
            to={product.href || `/products/${product.slug}`}
            className="premium-mobile-spot rounded-lg bg-white p-1 shadow-[0_8px_18px_-16px_rgba(0,0,0,0.35)]"
            aria-label={product.title}
          >
            <div className="overflow-hidden rounded-md bg-[#efefef]">
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.title}
                  loading="lazy"
                  decoding="async"
                  className="h-[72px] w-full object-cover shadow-[0_12px_24px_-16px_rgba(0,0,0,0.52)] transition duration-300 hover:shadow-[0_16px_30px_-14px_rgba(0,0,0,0.6)]"
                />
              ) : (
                <div className="grid h-[72px] place-items-center text-xs text-[#777777]">No image</div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
};
