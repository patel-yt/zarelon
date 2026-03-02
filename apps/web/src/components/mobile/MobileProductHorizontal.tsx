import { Link } from "react-router-dom";

type Item = {
  id: string;
  slug: string;
  image: string | null;
  title: string;
  category: string;
  priceLabel: string;
};

type MobileProductHorizontalProps = {
  title: string;
  items: Item[];
};

export const MobileProductHorizontal = ({ title, items }: MobileProductHorizontalProps) => {
  if (!items.length) return null;

  return (
    <section className="px-4">
      <h3 className="mb-3 text-[clamp(20px,6vw,28px)] font-semibold tracking-tight text-[#111111]">{title}</h3>
      <div className="flex gap-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.slice(0, 12).map((item) => (
          <Link key={item.id} to={`/products/${item.slug}`} className="w-[44vw] shrink-0 bg-[#f6f6f6]">
            <div className="overflow-hidden bg-[#efefef]">
              {item.image ? (
                <img src={item.image} alt={item.title} loading="lazy" decoding="async" className="h-[160px] w-full object-cover" />
              ) : (
                <div className="grid h-[160px] place-items-center text-xs text-[#777777]">No image</div>
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
