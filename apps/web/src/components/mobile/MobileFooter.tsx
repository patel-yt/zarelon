import { Link } from "react-router-dom";

export const MobileFooter = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-black/10 bg-white px-4 py-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <img
            src="/ZARELON-logo.jpg"
            alt="ZARELON logo"
            className="h-9 w-9 object-contain"
            loading="lazy"
            decoding="async"
          />
          <p className="font-heading text-[0.95rem] tracking-[0.14em] text-[#111111]">ZARELON</p>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-[#444444]">
          <Link to="/collections" className="hover:text-[#111111]">
            Collections
          </Link>
          <Link to="/products" className="hover:text-[#111111]">
            Shop
          </Link>
          <Link to="/profile" className="hover:text-[#111111]">
            Account
          </Link>
          <Link to="/orders" className="hover:text-[#111111]">
            Orders
          </Link>
        </div>

        <p className="text-[11px] text-[#666666]">© {year} ZARELON. All rights reserved.</p>
      </div>
    </footer>
  );
};

