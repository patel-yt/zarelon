import { Link } from "react-router-dom";

type Activity = { title: string; image: string; href: string };

type MobileActivitySectionProps = {
  title: string;
  items: Activity[];
};

export const MobileActivitySection = ({ title, items }: MobileActivitySectionProps) => {
  if (!items.length) return null;
  return (
    <section className="px-4">
      <h3 className="mb-3 text-[clamp(20px,6vw,28px)] font-semibold tracking-tight text-[#111111]">{title}</h3>
      <div className="grid grid-cols-3 gap-3">
        {items.slice(0, 3).map((item) => (
          <Link key={item.title} to={item.href} className="block">
            <div className="overflow-hidden bg-[#efefef]">
              <img src={item.image} alt={item.title} loading="lazy" decoding="async" className="h-[132px] w-full object-cover" />
            </div>
            <p className="mt-1 text-[13px] font-medium text-[#111111]">{item.title}</p>
          </Link>
        ))}
      </div>
    </section>
  );
};
