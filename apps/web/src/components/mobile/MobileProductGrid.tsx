import { Link } from "react-router-dom";

type GridItem = {
  id: string;
  slug: string;
  image: string | null;
  title: string;
  category: string;
  priceLabel: string;
};

type MobileProductGridProps = {
  title: string;
  items: GridItem[];
};

export const MobileProductGrid = ({ title, items }: MobileProductGridProps) => {
  return (
    <section className="px-4">
      <h3 className="mb-3 text-[2rem] font-medium tracking-tight text-[#111111]">{title}</h3>
      <div className="grid grid-cols-3 gap-2">
        {items.slice(0, 12).map((item) => (
          <Link key={item.id} to={`/products/${item.slug}`} className="bg-[#f6f6f6] p-0">
            <div className="overflow-hidden bg-[#efefef]">
              {item.image ? (
                <img src={item.image} alt={item.title} loading="lazy" decoding="async" className="h-[92px] w-full object-cover" />
              ) : (
                <div className="grid h-[92px] place-items-center text-xs text-[#777777]">No image</div>
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-tight text-[#111111]">{item.title}</p>
            <p className="text-[11px] text-[#666666]">{item.category}</p>
            <p className="text-[13px] font-semibold text-[#111111]">{item.priceLabel}</p>
          </Link>
        ))}
      </div>
    </section>
  );
};
