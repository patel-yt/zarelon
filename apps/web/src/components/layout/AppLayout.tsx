import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Heart, LogOut, Menu, Search, ShoppingBag, User2, X } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FestivalTicker } from "@/components/ui/FestivalTicker";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { getCart, releaseExpiredDropItems } from "@/services/cart";
import { fetchProducts } from "@/services/products";
import { trackExperienceEvent } from "@/services/royalDropEngine";
import { fetchActiveSiteFestival, getCachedActiveSiteFestival } from "@/services/siteFestivals";
import { fetchSiteSectionsByLocation } from "@/services/siteSections";
import type { SiteSection } from "@/types/domain";
import { creatorApi } from "@/lib/apiClient";

type NavItem = Pick<SiteSection, "id" | "section_key" | "title" | "button_link">;

const topNavItems: Array<NavItem> = [
  { id: "top-nav-watches", section_key: "top_nav_watches", title: "Watches", button_link: "/products/c/watches" },
  { id: "top-nav-men", section_key: "top_nav_men", title: "Men", button_link: "/men" },
  { id: "top-nav-collections", section_key: "top_nav_collections", title: "Collections", button_link: "/collections" },
  { id: "top-nav-shoes", section_key: "top_nav_shoes", title: "Shoes", button_link: "/products/c/shoes" },
  { id: "top-nav-creators", section_key: "top_nav_creators", title: "Creators", button_link: "/creators" },
];

export const AppLayout = () => {
  const { user, profile, permissions, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creatorMenuOpen, setCreatorMenuOpen] = useState(false);
  const [cartBounce, setCartBounce] = useState(false);
  const isScrolled = false;
  const [showExitIntent, setShowExitIntent] = useState(false);
  const [headerOffsetPx, setHeaderOffsetPx] = useState(96);
  const topChromeRef = useRef<HTMLDivElement | null>(null);
  const isHome = location.pathname === "/";
  const useTransparentHomeNav = false;

  const productsQuery = useQuery({
    queryKey: ["layout-products"],
    queryFn: fetchProducts,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const cartQuery = useQuery({
    queryKey: ["layout-cart-count", user?.id],
    queryFn: () => getCart(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });
  const homeSectionsQuery = useQuery({
    queryKey: ["layout-home-sections"],
    queryFn: () => fetchSiteSectionsByLocation("home"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const globalSectionsQuery = useQuery({
    queryKey: ["layout-global-sections"],
    queryFn: () => fetchSiteSectionsByLocation("global"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const siteFestivalQuery = useQuery({
    queryKey: ["site-festival-active"],
    queryFn: fetchActiveSiteFestival,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    initialData: () => getCachedActiveSiteFestival(),
  });

  const activeSiteFestival = siteFestivalQuery.data ?? null;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref")?.trim().toUpperCase();
    if (!ref) return;
    const existing = localStorage.getItem("zarelon_creator_ref_code")?.trim().toUpperCase();
    if (existing !== ref) localStorage.setItem("zarelon_creator_ref_code", ref);
    void creatorApi.trackReferralClick(ref).catch(() => undefined);
    url.searchParams.delete("ref");
    const nextSearch = url.searchParams.toString();
    const nextPath = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
    window.history.replaceState({}, "", nextPath);
  }, [location.pathname, location.search]);
  const cartCount = useMemo(
    () => (cartQuery.data?.cart_items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0),
    [cartQuery.data]
  );

  useEffect(() => {
    if (!cartCount) return;
    setCartBounce(true);
    const timer = setTimeout(() => setCartBounce(false), 760);
    return () => clearTimeout(timer);
  }, [cartCount]);

  useEffect(() => {
    if (!user?.id) return;
    const runCleanup = async () => {
      try {
        const removed = await releaseExpiredDropItems(user.id);
        if (removed > 0) await cartQuery.refetch();
      } catch {
        // Best-effort reservation cleanup.
      }
    };

    void runCleanup();
    const interval = setInterval(() => void runCleanup(), 30_000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    if (activeSiteFestival) {
      root.style.setProperty("--primary-color", activeSiteFestival.theme_primary || "#C8A951");
      root.style.setProperty("--secondary-color", activeSiteFestival.theme_secondary || "#111111");
      body.classList.add("festival-mode");
      return;
    }

    root.style.setProperty("--primary-color", "#D4AF37");
    root.style.setProperty("--secondary-color", "#111111");
    body.classList.remove("festival-mode");
  }, [activeSiteFestival]);

  useEffect(() => {
    const key = "zarelon_exit_offer_seen";
    if (!activeSiteFestival || typeof window === "undefined") return;
    if (sessionStorage.getItem(key) === "1") return;

    const onMouseLeave = (event: MouseEvent) => {
      if (event.clientY > 24) return;
      sessionStorage.setItem(key, "1");
      setShowExitIntent(true);
    };

    document.addEventListener("mouseout", onMouseLeave);
    return () => document.removeEventListener("mouseout", onMouseLeave);
  }, [activeSiteFestival?.id]);

  useEffect(() => {
    let lastDepthBucket = 0;
    const onScrollDepth = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const depth = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
      const bucket = depth >= 90 ? 90 : depth >= 75 ? 75 : depth >= 50 ? 50 : depth >= 25 ? 25 : 0;
      if (!bucket || bucket <= lastDepthBucket) return;
      lastDepthBucket = bucket;
      void trackExperienceEvent({
        userId: user?.id,
        eventType: "scroll_depth",
        targetType: "page",
        targetId: location.pathname,
        scrollDepth: bucket,
      });
    };

    window.addEventListener("scroll", onScrollDepth, { passive: true });
    return () => window.removeEventListener("scroll", onScrollDepth);
  }, [location.pathname, user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.querySelector("main.page-transition-shell");
    if (!root) return;

    const observed = new WeakSet<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("premium-scroll-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -8% 0px" }
    );

    const registerTargets = () => {
      const nodes = root.querySelectorAll("section, article, .rounded-xl, .rounded-2xl, .rounded-3xl");
      nodes.forEach((node, index) => {
        if (observed.has(node)) return;
        observed.add(node);
        node.classList.add("premium-scroll-item");
        const delayMs = Math.min(260, index * 22);
        (node as HTMLElement).style.setProperty("--premium-reveal-delay", `${delayMs}ms`);
        requestAnimationFrame(() => observer.observe(node));
      });
    };

    registerTargets();
    const mutation = new MutationObserver(() => registerTargets());
    mutation.observe(root, { childList: true, subtree: true });

    // Safety fallback: never keep content hidden if observer misses.
    const fallbackTimer = window.setTimeout(() => {
      root.querySelectorAll(".premium-scroll-item:not(.premium-scroll-visible)").forEach((el) => {
        el.classList.add("premium-scroll-visible");
      });
    }, 1200);

    return () => {
      window.clearTimeout(fallbackTimer);
      mutation.disconnect();
      observer.disconnect();
    };
  }, [location.pathname, location.search]);

  const globalSections = useMemo(
    () => [...(globalSectionsQuery.data ?? [])].sort((a, b) => a.display_order - b.display_order),
    [globalSectionsQuery.data]
  );
  const navItems = topNavItems;
  const footerLinks = useMemo(
    () => globalSections.filter((section) => section.section_key.startsWith("footer_link_")),
    [globalSections]
  );

  useEffect(() => {
    if (homeSectionsQuery.isSuccess) {
      console.info("[navigation] using fixed top nav: New In / Watches / Men / Collections");
    }
  }, [homeSectionsQuery.isSuccess]);

  const autoCompleteResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return (productsQuery.data ?? [])
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.slug.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [productsQuery.data, search]);

  const clearSupabaseLocalSession = () => {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    });
    Object.keys(sessionStorage).forEach((key) => {
      if (key.startsWith("sb-")) sessionStorage.removeItem(key);
    });
  };

  const handleSignOut = async () => {
    clearSupabaseLocalSession();
    void Promise.race([signOut(), new Promise((resolve) => setTimeout(resolve, 1200))]).finally(() => {
      navigate("/auth", { replace: true });
    });
  };

  const canOpenAdmin =
    profile?.role === "admin" ||
    profile?.role === "super_admin" ||
    Boolean(
      permissions?.can_manage_products ||
        permissions?.can_manage_orders ||
        permissions?.can_manage_users ||
        permissions?.can_refund ||
        permissions?.can_manage_festival ||
        permissions?.can_view_analytics
    );

  useEffect(() => {
    const node = topChromeRef.current;
    if (!node) return;

    const measure = () => {
      const h = Math.ceil(node.getBoundingClientRect().height);
      if (Number.isFinite(h) && h > 0) setHeaderOffsetPx(Math.max(64, h + 4));
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(node);
    window.addEventListener("resize", measure);
    node.addEventListener("transitionend", measure);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      node.removeEventListener("transitionend", measure);
    };
  }, [activeSiteFestival?.id, mobileOpen, searchOpen]);

  return (
    <div className="min-h-screen bg-white" data-bg="light">
      <div ref={topChromeRef} className="lux-top-chrome fixed inset-x-0 top-0 z-[60]">
        <header
          className={`lux-nav-shell ${
            isHome && !isScrolled && useTransparentHomeNav ? "lux-navbar-transparent" : "lux-navbar-solid"
          }`}
        >
        <div className="lux-nav-inner mx-auto flex w-full max-w-[1320px] items-center justify-between gap-1 px-2 py-1.5 md:gap-3 md:px-8 md:py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`hidden lux-nav-icon h-9 w-9 items-center justify-center rounded-full border md:hidden ${
                isHome && !isScrolled && useTransparentHomeNav ? "border-white/40 text-white" : "border-black/20 text-[#111111]"
              }`}
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <Link to="/" className="inline-flex items-center gap-0 md:gap-1">
              <img
                src="/ZARELON-logo.jpg"
                alt="ZARELON logo"
                className="lux-nav-logo-mark h-24 w-24 shrink-0 object-contain md:h-40 md:w-40"
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
              <span
                className={`lux-nav-logo-word -ml-1 translate-y-[1px] md:-ml-8 md:translate-y-[4px] font-heading text-[1.05rem] tracking-[0.12em] md:text-2xl md:tracking-[0.16em] ${
                  isHome && !isScrolled && useTransparentHomeNav ? "text-white" : "text-[#111111]"
                }`}
              >
                ZARELON
              </span>
            </Link>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            {navItems.map((item) => (
              item.section_key === "top_nav_creators" ? (
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    className={`lux-nav-link inline-flex items-center gap-1 text-sm font-medium ${
                      isHome && !isScrolled && useTransparentHomeNav ? "text-white" : "text-[#111111]"
                    }`}
                    onClick={() => navigate(item.button_link || "/creators")}
                  >
                    <span className="lux-underline">{item.title || item.section_key}</span>
                    <ChevronDown size={14} />
                  </button>
                  <div className="invisible pointer-events-none absolute left-0 top-full z-20 min-w-[210px] pt-2 opacity-0 transition group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100">
                    <div className="lux-nav-dropdown rounded-xl border border-black/10 bg-white p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
                      <button
                        type="button"
                        onClick={() => navigate("/creator-dashboard")}
                        className="force-text-dark w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5"
                      >
                        Creator Dashboard
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/earn-500-off")}
                        className="force-text-dark w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5"
                      >
                        Earn 500 Off
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/royal")}
                        className="force-text-dark w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5"
                      >
                        Royal Crown
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={item.id}>
                  <button
                    type="button"
                    className={`lux-nav-link lux-underline text-sm font-medium ${
                      isHome && !isScrolled && useTransparentHomeNav ? "text-white" : "text-[#111111]"
                    }`}
                    onClick={() => {
                      void trackExperienceEvent({
                        userId: user?.id,
                        eventType: "category_click",
                        targetType: "category",
                        targetId: item.title ?? item.section_key,
                        path: location.pathname,
                      });
                      navigate(item.button_link || "/products");
                    }}
                  >
                    {item.title || item.section_key}
                  </button>
                </div>
              )
            ))}
          </nav>

          <div className={`flex items-center gap-1 md:gap-1.5 ${isHome && !isScrolled && useTransparentHomeNav ? "text-white" : "text-[#111111]"}`}>
            <button
              type="button"
              className={`lux-nav-icon inline-flex h-8 w-8 items-center justify-center rounded-full border transition md:h-9 md:w-9 ${
                isHome && !isScrolled && useTransparentHomeNav
                  ? "border-white/40 text-white hover:border-white hover:text-white"
                  : "border-black/20 text-[#111111] hover:border-black hover:text-black"
              }`}
              onClick={() => setSearchOpen((prev) => !prev)}
              aria-label="Open search"
            >
              <Search size={16} />
            </button>
            <Link
              to="/wishlist"
              className={`lux-nav-icon hidden h-8 w-8 items-center justify-center rounded-full border transition md:inline-flex md:h-9 md:w-9 ${
                isHome && !isScrolled && useTransparentHomeNav
                  ? "border-white/40 text-white hover:border-white hover:text-white"
                  : "border-black/20 text-[#111111] hover:border-black hover:text-black"
              }`}
              aria-label="Wishlist"
            >
              <Heart size={16} />
            </Link>
            <Link
              to="/cart"
              className={`lux-nav-icon relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition md:h-9 md:w-9 ${
                isHome && !isScrolled && useTransparentHomeNav
                  ? "border-white/40 text-white hover:border-white hover:text-white"
                  : "border-black/20 text-[#111111] hover:border-black hover:text-black"
              }`}
              aria-label="Cart"
            >
              <ShoppingBag size={16} />
              {cartCount > 0 ? (
                <span className={`absolute -right-1 -top-1 rounded-full bg-black px-1.5 py-[1px] text-[10px] text-white ${cartBounce ? "cart-badge-bounce" : ""}`}>
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              ) : null}
            </Link>
            {user ? (
              <>
                {canOpenAdmin ? (
                  <Link
                    to="/admin/dashboard"
                    className={`lux-nav-pill ml-1 hidden rounded-full border px-2.5 py-1 text-[11px] transition md:inline-flex md:px-3 md:text-xs ${
                      isHome && !isScrolled && useTransparentHomeNav
                        ? "border-white/40 text-white hover:border-white"
                        : "border-black/20 text-[#111111] hover:border-black"
                    }`}
                  >
                    Admin
                  </Link>
                ) : null}
                <Link
                  to="/profile"
                  className={`lux-nav-icon inline-flex h-8 w-8 items-center justify-center rounded-full border transition md:h-9 md:w-9 ${
                    isHome && !isScrolled && useTransparentHomeNav
                      ? "border-white/40 text-white hover:border-white hover:text-white"
                      : "border-black/20 text-[#111111] hover:border-black hover:text-black"
                  }`}
                >
                  <User2 size={16} />
                </Link>
                <button
                  type="button"
                  className={`lux-nav-icon inline-flex h-8 w-8 items-center justify-center rounded-full border transition md:hidden ${
                    isHome && !isScrolled && useTransparentHomeNav
                      ? "border-white/40 text-white hover:border-white hover:text-white"
                      : "border-black/20 text-[#111111] hover:border-black hover:text-black"
                  }`}
                  onClick={() => setMobileOpen((prev) => !prev)}
                  aria-label="Open menu"
                >
                  {mobileOpen ? <X size={16} /> : <Menu size={16} />}
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className={`lux-nav-icon hidden h-8 w-8 items-center justify-center rounded-full border transition md:inline-flex md:h-9 md:w-9 ${
                    isHome && !isScrolled && useTransparentHomeNav
                      ? "border-white/40 text-white hover:border-white hover:text-white"
                      : "border-black/20 text-[#111111] hover:border-black hover:text-black"
                  }`}
                >
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/auth"
                  className={`lux-nav-pill ml-1 rounded-full border px-2.5 py-1 text-[11px] transition md:ml-2 md:px-3 md:text-xs ${
                    isHome && !isScrolled && useTransparentHomeNav
                      ? "border-white/40 text-white hover:border-white"
                      : "border-black/20 text-[#111111] hover:border-black"
                  }`}
                >
                  Sign In
                </Link>

                <button
                  type="button"
                  className={`lux-nav-icon inline-flex h-8 w-8 items-center justify-center rounded-full border transition md:hidden ${
                    isHome && !isScrolled && useTransparentHomeNav
                      ? "border-white/40 text-white hover:border-white hover:text-white"
                      : "border-black/20 text-[#111111] hover:border-black hover:text-black"
                  }`}
                  onClick={() => setMobileOpen((prev) => !prev)}
                  aria-label="Open menu"
                >
                  {mobileOpen ? <X size={16} /> : <Menu size={16} />}
                </button>
              </>
            )}
          </div>
        </div>

        {searchOpen ? (
          <div className="mx-auto w-full max-w-[1320px] px-5 pb-4 md:px-8">
            <div className="lux-nav-search-panel premium-surface rounded-2xl border border-black/10 bg-white p-3">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") navigate(`/products?q=${encodeURIComponent(search.trim())}`);
                }}
                placeholder="Search products"
                className="w-full bg-transparent px-2 py-2 text-sm text-[#111111] outline-none placeholder:text-[#555555]"
              />
              {autoCompleteResults.length ? (
                <div className="mt-2 grid gap-1">
                  {autoCompleteResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        navigate(`/products/${item.slug}`);
                        setSearchOpen(false);
                        setSearch("");
                      }}
                      className="rounded-lg px-3 py-2 text-left text-sm text-[#111111] transition hover:bg-black/5"
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {mobileOpen ? (
          <div className="lux-mobile-drawer border-t border-black/10 bg-white px-4 py-3 md:hidden">
            <div className="premium-surface lux-mobile-drawer-card rounded-2xl border border-black/10 bg-[#fcfcfc] p-2">
              <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.16em] text-[#666666]">Quick Menu</div>
              <div className="flex flex-col gap-1.5">
              {navItems.map((item) =>
                item.section_key === "top_nav_creators" ? (
                  <div key={item.id} className="rounded-lg border border-black/10 bg-white">
                    <button
                      type="button"
                      onClick={() => setCreatorMenuOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-[#111111] hover:bg-black/5"
                    >
                      <span>{item.title || item.section_key}</span>
                      <ChevronDown size={14} className={`transition ${creatorMenuOpen ? "rotate-180" : ""}`} />
                    </button>
                    {creatorMenuOpen ? (
                      <div className="grid gap-1 px-2 pb-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigate("/creator-dashboard");
                            setMobileOpen(false);
                            setCreatorMenuOpen(false);
                          }}
                          className="force-text-dark rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5"
                        >
                          Creator Dashboard
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigate("/earn-500-off");
                            setMobileOpen(false);
                            setCreatorMenuOpen(false);
                          }}
                          className="force-text-dark rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5"
                        >
                          Earn 500 Off
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigate("/royal");
                            setMobileOpen(false);
                            setCreatorMenuOpen(false);
                          }}
                          className="force-text-dark rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5"
                        >
                          Royal Crown
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigate(item.button_link || "/products");
                      setMobileOpen(false);
                    }}
                    className="rounded-lg px-3 py-2.5 text-left text-sm text-[#111111] hover:bg-black/5"
                  >
                    {item.title || item.section_key}
                  </button>
                )
              )}
              {user && canOpenAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    navigate("/admin/dashboard");
                    setMobileOpen(false);
                  }}
                  className="rounded-lg px-3 py-2.5 text-left text-sm text-[#111111] hover:bg-black/5"
                >
                  Admin Panel
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  navigate("/wishlist");
                  setMobileOpen(false);
                }}
                className="rounded-lg px-3 py-2.5 text-left text-sm text-[#111111] hover:bg-black/5 md:hidden"
              >
                Wishlist
              </button>
              {user ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      navigate("/profile");
                      setMobileOpen(false);
                    }}
                    className="rounded-lg px-3 py-2.5 text-left text-sm text-[#111111] hover:bg-black/5 md:hidden"
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOpen(false);
                      void handleSignOut();
                    }}
                    className="rounded-lg px-3 py-2.5 text-left text-sm text-[#111111] hover:bg-black/5 md:hidden"
                  >
                    Logout
                  </button>
                </>
              ) : null}
              </div>
            </div>
          </div>
        ) : null}
        </header>
        {activeSiteFestival ? (
          <div className="overflow-hidden transition-all duration-300 max-h-14 opacity-100 translate-y-0" aria-hidden={false}>
            <FestivalTicker festival={activeSiteFestival} />
          </div>
        ) : null}
      </div>

      <main
        className="page-transition-shell w-full bg-white"
        style={{ paddingTop: `${headerOffsetPx}px` }}
        data-bg="light"
      >
        <div key={`${location.pathname}${location.search}`} className="page-cinematic-enter">
          <Outlet />
        </div>
      </main>

      {showExitIntent && activeSiteFestival ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 px-4">
          <div className="premium-surface-strong w-full max-w-sm rounded-2xl border border-black/10 bg-white p-5 text-[#111111] shadow-[0_20px_45px_rgba(0,0,0,0.18)]">
            <p className="text-xs uppercase tracking-[0.16em] text-[#666666]">Royal Drop Fest</p>
            <h3 className="mt-2 text-2xl font-bold">Wait - extra 5% if you order now.</h3>
            <p className="mt-2 text-sm text-[#555555]">One-time checkout boost is active for a short window.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-primary-contrast rounded-lg px-4 py-2 text-sm font-semibold"
                onClick={() => {
                  setShowExitIntent(false);
                  navigate("/checkout");
                }}
              >
                Claim Offer
              </button>
              <button
                type="button"
                className="btn-secondary-contrast rounded-lg px-4 py-2 text-sm"
                onClick={() => setShowExitIntent(false)}
              >
                Continue Browsing
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="footer-shell border-t border-black/10 bg-white" data-bg="light">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-black/15 to-transparent" />
        <div className="mx-auto w-full max-w-[1320px] px-4 py-6 md:px-8 md:py-8">
          <div className="grid gap-4 md:grid-cols-[1.15fr_1fr_0.85fr]">
            <div className="footer-brand-block">
              <div className="flex items-center gap-1">
                <img
                  src="/ZARELON-logo.jpg"
                  alt="ZARELON logo"
                  className="h-10 w-10 shrink-0 object-contain md:h-16 md:w-16"
                  loading="lazy"
                  decoding="async"
                />
                <p className="-ml-0.5 font-heading text-sm tracking-[0.12em] text-[#111111] md:text-base md:tracking-[0.14em]">ZARELON</p>
              </div>
              <p className="mt-1.5 max-w-md text-xs text-[#555555] md:text-sm">
                Elevated essentials designed for modern everyday style.
              </p>
            </div>

            <div>
              <p className="footer-title mb-2 text-[9px] uppercase tracking-[0.16em] text-[#666666]">Quick Links</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] uppercase tracking-[0.12em] text-[#555555] md:text-xs md:tracking-[0.14em]">
                {footerLinks.map((link) => (
                  <Link key={link.id} to={link.button_link || "/"} className="premium-footer-link transition hover:text-[#111111]">
                    {link.title || link.section_key}
                  </Link>
                ))}
              </div>
            </div>

            <div className="md:block">
              <p className="footer-title mb-2 text-[9px] uppercase tracking-[0.16em] text-[#666666]">Browse</p>
              <div className="flex flex-wrap gap-1.5 md:gap-2">
                {navItems.map((item) => (
                  <Link
                    key={`footer-nav-${item.id}`}
                    to={item.button_link || "/products"}
                    className="footer-chip rounded-full border border-black/15 bg-white px-2.5 py-0.5 text-[10px] font-medium text-[#111111] transition hover:border-black/35"
                  >
                    {item.title || item.section_key}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-1.5 border-t border-black/10 pt-3 text-[10px] text-[#666666] md:mt-5 md:flex-row md:items-center md:justify-between md:text-xs">
            <span>� {new Date().getFullYear()} ZARELON. All rights reserved.</span>
            <span className="hidden uppercase tracking-[0.12em] md:inline">Luxury Everyday Essentials</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export const AdminLayout = () => {
  const { user, profile, permissions } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const isAdmin = profile?.role === "admin" || isSuperAdmin;

  const nav = [
    ["/admin/dashboard", "Dashboard", isAdmin || Boolean(permissions?.can_view_analytics)],
    ["/admin/products", "Products", isSuperAdmin || Boolean(permissions?.can_manage_products)],
    ["/admin/orders", "Orders", isSuperAdmin || Boolean(permissions?.can_manage_orders)],
    ["/admin/returns", "Returns", isSuperAdmin || Boolean(permissions?.can_manage_orders)],
    ["/admin/refunds", "Refunds", isSuperAdmin || Boolean(permissions?.can_refund)],
    ["/admin/banners", "Banners", isSuperAdmin || Boolean(permissions?.can_manage_festival)],
    ["/admin/festival", "Royal Drop Fest", isSuperAdmin || Boolean(permissions?.can_manage_festival)],
    ["/admin/users", "Users", isSuperAdmin || Boolean(permissions?.can_manage_users)],
    ["/admin/sections", "Sections", isSuperAdmin || Boolean(permissions?.can_manage_festival)],
    ["/admin/home-manager", "Homepage CMS", isSuperAdmin || Boolean(permissions?.can_manage_festival)],
    ["/admin/categories", "Categories", isSuperAdmin || Boolean(permissions?.can_manage_products)],
    ["/admin/drops", "Drops", isSuperAdmin || Boolean(permissions?.can_manage_products)],
    ["/admin/social-submissions", "Social Rewards", isSuperAdmin || Boolean(permissions?.can_manage_orders)],
    [
      "/admin/referrals",
      "Referral Dashboard",
      isSuperAdmin || Boolean(permissions?.can_manage_orders || permissions?.can_view_analytics),
    ],
    [
      "/admin/creator-analytics",
      "Creator Viral Analytics",
      isSuperAdmin || Boolean(permissions?.can_manage_orders || permissions?.can_view_analytics),
    ],
    ["/admin/admins", "Admin Mgmt", isSuperAdmin],
  ] as const;

  return (
    <div className="grid min-h-[calc(100vh-64px)] gap-6 bg-[#f6f6f7] p-4 md:grid-cols-[250px_1fr] md:p-6" data-bg="light">
      <aside className="premium-surface-strong rounded-2xl border border-black/10 bg-white/65 p-5 backdrop-blur-xl">
        <p className="mb-4 text-xs uppercase tracking-[0.25em] text-[#111111]/75">Admin</p>
        <div className="space-y-2">
          {nav.filter(([, , allowed]) => allowed).map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  isActive
                    ? "border-black/20 bg-white/70 text-[#111111] shadow-[0_8px_20px_rgba(0,0,0,0.08)] backdrop-blur-md"
                    : "border-transparent text-[#111111]/80 hover:border-black/10 hover:bg-white/55 hover:backdrop-blur-md"
                }`
              }
            >
              <ShoppingBag size={15} />
              {label}
            </NavLink>
          ))}
        </div>
      </aside>
      <section className="premium-surface rounded-2xl border border-black/10 bg-white/80 p-6 text-[#111111] backdrop-blur-md">
        <Outlet />
      </section>
    </div>
  );
};

