import { Link } from "react-router-dom";

type Item = {
  id: string;
  image: string | null;
  title: string;
  subtitle?: string;
  href: string;
};

type MobileFeaturedSectionProps = {
  title: string;
  items: Item[];
};

export const MobileFeaturedSection = ({ title, items }: MobileFeaturedSectionProps) => {
  if (!items.length) return null;
  return (
    <section className="px-4">
      <h3 className="mb-3 text-[clamp(20px,6vw,28px)] font-semibold tracking-tight text-[#111111]">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        {items.slice(0, 2).map((item) => (
          <Link key={item.id} to={item.href} className="bg-[#f6f6f6] p-0">
            <div className="overflow-hidden bg-[#efefef]">
              {item.image ? (
                <img src={item.image} alt={item.title} loading="lazy" decoding="async" className="h-[174px] w-full object-cover" />
              ) : (
                <div className="grid h-[174px] place-items-center text-xs text-[#777777]">No image</div>
              )}
            </div>
            <p className="mt-1.5 line-clamp-1 text-[13px] font-medium text-[#111111]">{item.title}</p>
            {item.subtitle ? <p className="line-clamp-1 text-[11px] text-[#666666]">{item.subtitle}</p> : null}
          </Link>
        ))}
      </div>
    </section>
  );
};
