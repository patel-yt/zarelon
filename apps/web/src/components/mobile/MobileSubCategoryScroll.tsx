import { Link } from "react-router-dom";

type Item = { slug: string; label: string; href: string };

type MobileSubCategoryScrollProps = {
  title: string;
  items: Item[];
  activeSlug?: string | null;
};

export const MobileSubCategoryScroll = ({ title, items, activeSlug }: MobileSubCategoryScrollProps) => {
  return (
    <section className="px-4">
      <h2 className="mb-3 text-[clamp(20px,6vw,28px)] font-semibold leading-[1.05] tracking-tight text-[#111111]">{title}</h2>
      <div className="flex gap-5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <Link
            key={item.slug}
            to={item.href}
            className={`shrink-0 border-b pb-1 text-[15px] font-medium tracking-tight transition ${
              activeSlug === item.slug ? "border-[#111111] text-[#111111]" : "border-transparent text-[#333333]"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </section>
  );
};
