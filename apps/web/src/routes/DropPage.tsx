import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { calculateEffectivePrice, formatINR } from "@/lib/utils";
import { allowBurstRequest } from "@/lib/dropRateLimiter";
import { addToCart } from "@/services/cart";
import { startDropHold } from "@/services/dropHold";
import {
  computeDropDerivedStock,
  evaluateDropAccess,
  fetchDropBySlug,
  joinDropWaitlist,
  trackDropEvent,
} from "@/services/drops";
import { fetchActiveFestival } from "@/services/festivals";
import { applyExtraDiscount, fetchDropFlashSchedule, getActiveFlashDiscount } from "@/services/royalDropEngine";

const formatDateTime = (iso: string) => new Date(iso).toLocaleString();

const getCountdownLabel = (targetIso: string) => {
  const remaining = new Date(targetIso).getTime() - Date.now();
  if (remaining <= 0) return "00:00:00";
  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((totalSec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export const DropPage = () => {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [nowTick, setNowTick] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [emailInput, setEmailInput] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dropQuery = useQuery({
    queryKey: ["drop-page", slug],
    queryFn: () => fetchDropBySlug(slug),
    refetchInterval: 15_000,
  });
  const festivalQuery = useQuery({ queryKey: ["festival-active"], queryFn: fetchActiveFestival });
  const flashScheduleQuery = useQuery({
    queryKey: ["drop-flash-schedule", dropQuery.data?.id ?? ""],
    queryFn: () => fetchDropFlashSchedule(dropQuery.data!.id),
    enabled: Boolean(dropQuery.data?.id),
    refetchInterval: 30_000,
  });

  const accessQuery = useQuery({
    queryKey: ["drop-access", dropQuery.data?.id ?? "", user?.id ?? "guest"],
    queryFn: async () => {
      if (!dropQuery.data) return { allowed: false, reason: "Drop not available." };
      return evaluateDropAccess(dropQuery.data, user?.id);
    },
    enabled: Boolean(dropQuery.data),
    refetchInterval: 15_000,
  });

  const drop = dropQuery.data;

  useEffect(() => {
    if (!drop?.id) return;
    if (!allowBurstRequest(`drop-view-${drop.id}`, 3)) return;
    void trackDropEvent({ dropId: drop.id, eventType: "view", userId: user?.id, meta: { slug } });
  }, [drop?.id, user?.id, slug]);

  useEffect(() => {
    if (!drop) return;
    const title = `${drop.name} - Limited Drop | Zarelon`;
    document.title = title;

    const descriptionText = drop.description ?? `Exclusive ${drop.name} drop. Limited access and stock.`;

    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.setAttribute("name", "description");
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute("content", descriptionText);

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}/drops/${drop.slug}`;
  }, [drop]);

  const derivedStock = useMemo(() => {
    if (!drop) return 0;
    return computeDropDerivedStock(drop, drop.products);
  }, [drop]);

  const soldOut = derivedStock <= 0;

  const addMutation = useMutation({
    mutationFn: async (productId: string) => {
      if (!user?.id) {
        navigate("/auth");
        return;
      }
      if (!drop) throw new Error("Drop unavailable.");
      if (!allowBurstRequest(`drop-add-${drop.id}-${user.id}`, 3)) {
        throw new Error("Too many requests. Please slow down.");
      }
      if (soldOut) throw new Error("Drop sold out. Join waitlist.");

      await addToCart(user.id, productId, 1);
      startDropHold(user.id, drop.id);
      await trackDropEvent({ dropId: drop.id, eventType: "add_to_cart", userId: user.id, meta: { productId } });
      setMessage("Added to cart with 10-minute hold.");
    },
    onError: (err) => setMessage((err as Error).message),
  });

  const waitlistMutation = useMutation({
    mutationFn: async () => {
      if (!drop) throw new Error("Drop unavailable.");
      if (!allowBurstRequest(`drop-waitlist-${drop.id}`, 3)) {
        throw new Error("Too many requests. Please wait.");
      }
      const email = (profile?.email ?? emailInput).trim();
      if (!email || !email.includes("@")) throw new Error("Valid email required.");
      await joinDropWaitlist({ dropId: drop.id, email, userId: user?.id });
      await trackDropEvent({ dropId: drop.id, eventType: "waitlist_join", userId: user?.id, meta: { email } });
      setMessage("You are on waitlist. We'll notify after restock.");
    },
    onError: (err) => setMessage((err as Error).message),
  });

  if (dropQuery.isLoading) return <div className="rounded-2xl border border-black/10 bg-white p-6">Loading drop details...</div>;
  if (dropQuery.isError)
    return (
      <div className="rounded-2xl border border-white/15 bg-[#131313] p-6 text-white/80">
        Drop details unavailable - please retry.
      </div>
    );
  if (!drop) {
    return (
      <div className="rounded-2xl border border-white/15 bg-[#131313] p-6 text-white/80">
        This drop is not active yet.
      </div>
    );
  }

  const now = nowTick;
  const startAt = new Date(drop.start_time).getTime();
  const endAt = new Date(drop.end_time).getTime();
  const isPreStart = now < startAt;
  const isExpired = now > endAt;
  const countdownTarget = isPreStart ? drop.start_time : drop.end_time;

  const access = accessQuery.data ?? { allowed: false, reason: "Access check pending..." };
  const canShowProducts = !isExpired && access.allowed;
  const flashPricing = getActiveFlashDiscount(flashScheduleQuery.data ?? [], now);
  const tierExtra = profile?.access_tier === "vip" || profile?.access_tier === "elite" ? 5 : 0;

  const urgencyText = soldOut
    ? "Sold Out"
    : derivedStock <= 5
    ? `Only ${derivedStock} left`
    : derivedStock <= 20
    ? "Selling fast!"
    : `${derivedStock} available`;

  const heroHeadline =
    drop.access_type === "early"
      ? "Early Access - Limited Time Only"
      : drop.access_type === "vip"
      ? "VIP Exclusive Drop"
      : drop.name;

  return (
    <div className="-mx-5 space-y-6 bg-[#0F0F10] px-5 pb-12 text-white md:-mx-8 md:px-8">
      <section className="lux-hero hero-fallback-bg relative overflow-hidden rounded-3xl border border-white/15">
        {drop.hero_media_type === "video" ? (
          <video src={drop.hero_media_url} className="h-[80vh] w-full object-cover" autoPlay muted loop playsInline />
        ) : (
          <img
            src={drop.hero_media_url}
            alt={drop.name}
            className="h-[80vh] w-full object-cover"
            onError={(event) => {
              (event.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="absolute inset-0 bg-black/56" />
        <div className="hero-text-readable absolute inset-x-0 bottom-0 p-6 text-white md:p-10">
          <p className="text-xs uppercase tracking-[0.22em]">Exclusive Launch</p>
          <h1 className="font-heading text-[clamp(2.6rem,10vw,6rem)] font-extrabold uppercase leading-[0.95]">{heroHeadline}</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/85 md:text-base">{drop.description ?? "Limited stock drop with premium access controls."}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.14em]">
            <span className="rounded-full border border-white/35 bg-black/35 px-3 py-1">{drop.access_type} access</span>
            <span className="rounded-full border border-white/35 bg-black/35 px-3 py-1">
              {isPreStart ? "Drop starts in" : "Drop ends in"} {getCountdownLabel(countdownTarget)}
            </span>
            <span className="rounded-full border border-white/35 bg-black/35 px-3 py-1">
              {urgencyText}
            </span>
            {flashPricing.percent > 0 || tierExtra > 0 ? (
              <span className="rounded-full border border-white/35 bg-black/35 px-3 py-1">
                Flash {flashPricing.percent}% + Tier {tierExtra}%
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {isExpired ? (
        <div className="rounded-2xl border border-white/15 bg-[#181818] p-4 text-white/75">This drop has ended.</div>
      ) : null}

      {!access.allowed ? (
        <section className="rounded-2xl border border-white/15 bg-[#181818] p-4 text-white">
          <p className="text-sm font-semibold uppercase tracking-[0.12em]">Access Locked</p>
          <p className="mt-1 text-sm text-white/80">{access.reason ?? "You are not eligible for this drop yet."}</p>
          {!user ? (
            <Link to="/auth" className="mt-2 inline-flex rounded-lg bg-black px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-white">
              Login for early access
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="mt-2 inline-flex rounded-lg bg-black px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-white"
            >
              Earn more to unlock
            </button>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/15 bg-[#181818] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-2xl text-white">Drop Products</h2>
          <p className="text-xs text-white/70">Real-time stock and urgency</p>
        </div>
        {message ? <p className="mt-3 text-xs text-white/80">{message}</p> : null}

        {canShowProducts && drop.products.length ? (
          <div className="mt-4 grid gap-10 md:grid-cols-2 xl:grid-cols-3">
            {drop.products.map((product) => {
              const effectivePrice = calculateEffectivePrice(
                product.discount_price ?? product.price_inr,
                product.discount_percent,
                festivalQuery.data?.festival_discount ?? 0
              );
              const finalPrice = applyExtraDiscount(effectivePrice, flashPricing.percent + tierExtra);
              return (
                <article key={product.id} className="group overflow-hidden rounded-2xl border border-white/15 bg-[#141414] p-3">
                  <Link to={`/products/${product.slug}`}>
                    <img
                      src={product.image_url ?? "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=900&q=80"}
                      alt={product.title}
                      className="h-56 w-full rounded-xl object-cover transition duration-500 group-hover:scale-[1.02]"
                    />
                  </Link>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="rounded-full border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/90">
                      {drop.access_type === "early" ? "Early" : drop.access_type === "vip" ? "VIP" : "Drop"}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-white/65">{Math.max(0, product.stock)} in stock</span>
                  </div>
                  <h3 className="mt-2 font-heading text-xl text-white">{product.title}</h3>
                  <p className="text-sm text-white">{formatINR(finalPrice)}</p>

                  {soldOut ? (
                    <div className="mt-3 space-y-2">
                      {!profile?.email ? (
                        <input
                          value={emailInput}
                          onChange={(event) => setEmailInput(event.target.value)}
                          placeholder="Email for waitlist"
                          className="w-full rounded-lg border border-white/20 bg-black/25 px-3 py-2 text-xs text-white"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => waitlistMutation.mutate()}
                        className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-white"
                      >
                        {waitlistMutation.isPending ? "Joining..." : "Join Waitlist"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addMutation.mutate(product.id)}
                      className="mt-3 w-full rounded-lg bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-black transition hover:bg-[#EDEDED]"
                    >
                      Add to Cart
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : canShowProducts && !drop.products.length ? (
          <div className="mt-4 rounded-xl border border-white/15 bg-[#141414] p-8 text-center text-white/70">
            Products will appear here when assigned by admin.
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-white/15 bg-[#141414] p-8 text-center text-white/70">
            {isPreStart ? "This drop is not active yet." : "Access required to view drop products."}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/15 bg-[#181818] p-4 text-xs text-white/70">
        Window: {formatDateTime(drop.start_time)} - {formatDateTime(drop.end_time)}
      </section>
    </div>
  );
};
