import { Link } from "react-router-dom";

export type ShopCategoryItem = {
  id: string;
  imageMobile: string;
  title: string;
  link: string;
};

type ShopByCategoryRowProps = {
  title?: string;
  categories: ShopCategoryItem[];
};

export const ShopByCategoryRow = ({ title = "Shop by Category", categories }: ShopByCategoryRowProps) => {
  if (!categories.length) return null;

  return (
    <section className="px-0">
      <div className="pt-12 pb-12">
        <h3 className="mb-3 px-4 text-[22px] font-semibold tracking-[0.01em] text-[#111111] md:px-8">{title}</h3>
        <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:px-8">
          {categories.map((item) => (
            <Link
              key={item.id}
              to={item.link}
              className="premium-mobile-chip snap-start min-w-[82vw] max-w-[82vw] shrink-0 sm:min-w-[360px] sm:max-w-[360px] md:min-w-[420px] md:max-w-[420px]"
            >
              <div className="relative overflow-hidden rounded-2xl bg-[#efefef]">
                <img
                  src={item.imageMobile}
                  alt={item.title}
                  loading="lazy"
                  decoding="async"
                  className="h-[62vw] w-full object-cover shadow-[0_12px_24px_-16px_rgba(0,0,0,0.5)] transition duration-300 hover:shadow-[0_16px_30px_-14px_rgba(0,0,0,0.58)] sm:h-[300px] md:h-[360px]"
                />
              </div>
              <p className="mt-2 line-clamp-1 text-[16px] font-medium text-[#111111]">{item.title}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};
