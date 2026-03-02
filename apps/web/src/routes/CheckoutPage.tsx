import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { DropHoldTimer } from "@/components/ui/DropHoldTimer";
import { useAuth } from "@/features/auth/AuthContext";
import { discountCodeApi, eliteApi, ordersApi, paymentsApi } from "@/lib/apiClient";
import { appConfig } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { formatINR } from "@/lib/utils";
import { formatCurrencyAmount, resolveUserCurrency } from "@/services/currency";
import { createAddress, fetchAddresses } from "@/services/addresses";
import { fetchUserCartReservationMap, getCart, releaseExpiredDropItems } from "@/services/cart";
import { fetchActiveFestival } from "@/services/festivals";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
    };
  }
}

export const CheckoutPage = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [paymentMethod, setPaymentMethod] = useState<"online" | "cod">("online");
  const [checkoutMessage, setCheckoutMessage] = useState<string>("");
  const [checkoutError, setCheckoutError] = useState<string>("");
  const [suspiciousAttempts, setSuspiciousAttempts] = useState(0);
  const [captchaPrompt, setCaptchaPrompt] = useState<{ a: number; b: number } | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    title: string | null;
    discountAmountInr: number;
    totalAfterDiscountInr: number;
  } | null>(null);
  const [discountError, setDiscountError] = useState("");
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [addressForm, setAddressForm] = useState({
    label: "Home",
    fullName: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "India",
    isDefault: false,
  });

  const cartQuery = useQuery({
    queryKey: ["cart", user?.id],
    queryFn: () => getCart(user!.id),
    enabled: Boolean(user?.id),
  });

  const addressesQuery = useQuery({
    queryKey: ["shipping-addresses", user?.id],
    queryFn: () => fetchAddresses(user!.id),
    enabled: Boolean(user?.id),
  });
  const festivalQuery = useQuery({
    queryKey: ["festival-active"],
    queryFn: fetchActiveFestival,
  });
  const tierBenefitsQuery = useQuery({
    queryKey: ["tier-checkout-benefits", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      if (!user?.id) return null;
      const progressRes = await supabase
        .from("elite_progress")
        .select("current_tier_id,current_tier:elite_tiers!elite_progress_current_tier_id_fkey(name)")
        .eq("user_id", user.id)
        .maybeSingle();
      if (progressRes.error || !(progressRes.data as any)?.current_tier_id) return null;
      const tierId = String((progressRes.data as any).current_tier_id);
      const tierName = String(
        (Array.isArray((progressRes.data as any)?.current_tier)
          ? (progressRes.data as any)?.current_tier?.[0]
          : (progressRes.data as any)?.current_tier)?.name ?? "Elite"
      );
      const benefitRes = await supabase
        .from("tier_checkout_benefits")
        .select("fast_checkout_enabled,preferred_shipping_enabled,free_gift_threshold,stepper_animation_style")
        .eq("tier_id", tierId)
        .maybeSingle();
      if (benefitRes.error || !benefitRes.data) return null;
      return { tierName, ...benefitRes.data };
    },
  });
  const royalStatusQuery = useQuery({
    queryKey: ["elite-me-checkout", user?.id],
    queryFn: eliteApi.getMyStatus,
    enabled: Boolean(user?.id),
    staleTime: 30_000,
  });
  const currencyQuery = useQuery({ queryKey: ["currency"], queryFn: resolveUserCurrency, staleTime: 30 * 60 * 1000 });
  const reservationProductIds = useMemo(
    () =>
      (cartQuery.data?.cart_items ?? [])
        .filter((item) => Boolean(item.product?.drop_id))
        .map((item) => item.product_id),
    [cartQuery.data]
  );
  const reservationQuery = useQuery({
    queryKey: ["checkout-reservations", user?.id, reservationProductIds.join(",")],
    queryFn: () => fetchUserCartReservationMap(user!.id, reservationProductIds),
    enabled: Boolean(user?.id) && reservationProductIds.length > 0,
  });
  const festivalDiscount = festivalQuery.data?.festival_discount ?? 0;

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      const removed = await releaseExpiredDropItems(user.id);
      if (removed > 0) {
        await queryClient.invalidateQueries({ queryKey: ["cart", user.id] });
      }
    })();
  }, [user?.id]);

  const getUnitPrice = (item: any) => {
    const base = item.product?.discount_price ?? item.product?.price_inr ?? 0;
    return Math.round(base * (1 - festivalDiscount / 100));
  };

  useEffect(() => {
    if (selectedAddressId) return;
    const first = addressesQuery.data?.[0];
    if (first?.id) setSelectedAddressId(first.id);
  }, [addressesQuery.data, selectedAddressId]);

  const subtotal = useMemo(
    () =>
      (cartQuery.data?.cart_items ?? []).reduce(
        (sum, item) => sum + item.quantity * getUnitPrice(item),
        0
      ),
    [cartQuery.data, festivalDiscount]
  );
  const cartItems = cartQuery.data?.cart_items ?? [];
  const hasItems = cartItems.length > 0;

  const hasShippableItem = useMemo(
    () => (cartQuery.data?.cart_items ?? []).some((item) => item.product?.requires_shipping !== false),
    [cartQuery.data]
  );
  const hasNonCodItem = useMemo(
    () => (cartQuery.data?.cart_items ?? []).some((item) => item.product?.requires_cod === false),
    [cartQuery.data]
  );
  const shippingPreview = hasShippableItem ? appConfig.flatShippingInr : 0;
  const discountAmountInr = Math.max(0, Number(appliedDiscount?.discountAmountInr ?? 0));
  const total = Math.max(0, subtotal - discountAmountInr) + shippingPreview;

  const discountApplyMutation = useMutation({
    mutationFn: async () => {
      if (!cartQuery.data?.id) throw new Error("No cart found");
      if (!discountCodeInput.trim()) throw new Error("Enter discount code");
      return discountCodeApi.validate({ cartId: cartQuery.data.id, code: discountCodeInput.trim() });
    },
    onSuccess: (result) => {
      setAppliedDiscount({
        code: result.code,
        title: result.title,
        discountAmountInr: result.discount_amount_inr,
        totalAfterDiscountInr: result.total_after_discount_inr,
      });
      setDiscountError("");
    },
    onError: (error) => {
      setAppliedDiscount(null);
      setDiscountError((error as Error)?.message ?? "Could not apply discount code");
    },
  });

  const addAddressMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Please sign in again");
      return createAddress(user.id, addressForm);
    },
    onSuccess: async (address) => {
      await queryClient.invalidateQueries({ queryKey: ["shipping-addresses", user?.id] });
      setSelectedAddressId(address.id);
      setShowAddressForm(false);
      setAddressForm({
        label: "Home",
        fullName: "",
        phone: "",
        line1: "",
        line2: "",
        city: "",
        state: "",
        postalCode: "",
        country: "India",
        isDefault: false,
      });
    },
  });

  const ensureRazorpayLoaded = async (): Promise<void> => {
    if (window.Razorpay) return;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-rzp="1"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Could not load Razorpay SDK")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.dataset.rzp = "1";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Razorpay SDK"));
      document.body.appendChild(script);
    });
    if (!window.Razorpay) throw new Error("Razorpay SDK not available");
  };

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      setCheckoutMessage("");
      setCheckoutError("");
      if (suspiciousAttempts >= 3) {
        const prompt = captchaPrompt ?? { a: Math.floor(Math.random() * 9) + 1, b: Math.floor(Math.random() * 9) + 1 };
        if (!captchaPrompt) setCaptchaPrompt(prompt);
        const expected = prompt.a + prompt.b;
        if (Number(captchaAnswer) !== expected) {
          throw new Error("Captcha failed. Solve challenge to continue checkout.");
        }
      }

      if (!cartQuery.data?.id) throw new Error("No cart found");
      if (!selectedAddressId) throw new Error("Please save/select delivery address first");
      if (paymentMethod === "cod") {
        if (hasNonCodItem) throw new Error("COD is not available for one or more items in your cart");
        const created = await ordersApi.createCodOrder({
          cartId: cartQuery.data.id,
          addressId: selectedAddressId,
          discountCode: appliedDiscount?.code ?? undefined,
        });
        return `Order placed (${created.orderNumber})`;
      }

      let created:
        | Awaited<ReturnType<typeof paymentsApi.createOrder>>
        | null = null;
      let createError: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          created = await paymentsApi.createOrder({
            cartId: cartQuery.data.id,
            addressId: selectedAddressId,
            discountCode: appliedDiscount?.code ?? undefined,
          });
          createError = null;
          break;
        } catch (error) {
          createError = error;
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      if (!created) throw (createError instanceof Error ? createError : new Error("Payment init failed"));

      await ensureRazorpayLoaded();
      const RazorpayCtor = window.Razorpay;
      if (!RazorpayCtor) throw new Error("Razorpay SDK missing");
      const razorpayKey = (import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined)?.trim();
      if (!razorpayKey) throw new Error("VITE_RAZORPAY_KEY_ID is missing");

      return await new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (cb: () => void) => {
          if (settled) return;
          settled = true;
          cb();
        };
        const razorpay = new RazorpayCtor({
          key: razorpayKey,
          amount: created.amount,
          currency: created.currency,
          order_id: created.razorpayOrderId,
          name: "ZARELON",
          description: "Luxury purchase",
          prefill: {
            name: profile?.name ?? addressForm.fullName,
            email: profile?.email,
            contact: addressForm.phone,
          },
          handler: async (response: Record<string, string>) => {
            try {
              await paymentsApi.verify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              });
              finish(() => resolve("Payment captured"));
            } catch (error) {
              finish(() => reject(error));
            }
          },
          modal: {
            ondismiss: () => {
              void paymentsApi.releaseOrderHold(created.orderId, "checkout_window_closed");
              finish(() => reject(new Error("Payment window closed")));
            },
          },
        });
        (razorpay as any).on?.("payment.failed", (response: any) => {
          const reason =
            response?.error?.description ?? response?.error?.reason ?? "Payment failed";
          void paymentsApi.releaseOrderHold(created.orderId, "payment_failed");
          finish(() => reject(new Error(reason)));
        });

        razorpay.open();
      });
    },
    onSuccess: (message) => {
      setCheckoutMessage(message);
      setCheckoutError("");
      setSuspiciousAttempts(0);
      setCaptchaPrompt(null);
      setCaptchaAnswer("");
      void queryClient.invalidateQueries({ queryKey: ["orders", user?.id] });
      navigate("/orders");
    },
    onError: (error) => {
      setSuspiciousAttempts((prev) => prev + 1);
      if (suspiciousAttempts + 1 >= 3 && !captchaPrompt) {
        setCaptchaPrompt({ a: Math.floor(Math.random() * 9) + 1, b: Math.floor(Math.random() * 9) + 1 });
      }
      const text = (error as Error)?.message ?? "Checkout failed";
      const isOnlineSetupIssue =
        paymentMethod === "online" &&
        (text.includes("Request failed (500)") ||
          text.toLowerCase().includes("razorpay not configured") ||
          text.toLowerCase().includes("server config missing"));

      if (isOnlineSetupIssue && !hasNonCodItem) {
        setPaymentMethod("cod");
        setCheckoutError("");
        setCheckoutMessage("Online payment temporarily unavailable. Switched to COD automatically.");
        return;
      }

      if (text.includes("API route not found")) {
        setCheckoutError("Payment API not available in current dev server. Start backend/api server and retry.");
      } else {
        setCheckoutError(text);
      }
      setCheckoutMessage("");
    },
  });

  if (!user) return <div>Please sign in for checkout.</div>;
  if (profile?.is_blocked) return <div>Your account is currently blocked from checkout.</div>;
  if (cartQuery.isLoading) return <div>Loading checkout...</div>;
  if (!hasItems) {
    return (
      <div className="space-y-4 rounded-xl border border-black/10 bg-white p-6 text-[#111111]">
        <p className="text-sm text-[#555555]">Your cart is empty. Add products before checkout.</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate("/cart")}>
            Back to Cart
          </Button>
          <Button onClick={() => navigate("/products")}>Shop Products</Button>
        </div>
      </div>
    );
  }

  const stepReady = {
    1: Boolean(selectedAddressId || showAddressForm),
    2: true,
    3: paymentMethod === "cod" || paymentMethod === "online",
    4: true,
  } as const;

  return (
    <div className="space-y-5" data-bg="light">
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-black/10 bg-white/30 p-2 backdrop-blur-xl supports-[backdrop-filter]:bg-white/20 md:grid-cols-4">
        {[
          [1, "Shipping"],
          [2, "Delivery"],
          [3, "Payment"],
          [4, "Review"],
        ].map(([idx, label]) => (
          <button
            key={idx}
            type="button"
            onClick={() => setStep(idx as 1 | 2 | 3 | 4)}
            className={`rounded-lg px-3 py-2 text-xs uppercase tracking-[0.12em] transition duration-300 transform-gpu ${
              step === idx
                ? "scale-[1.04] bg-white/55 text-[#111111] shadow-[0_10px_20px_rgba(0,0,0,0.14)] ring-1 ring-black/10"
                : "bg-white/15 text-[#444444] hover:bg-white/30"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tierBenefitsQuery.data && (royalStatusQuery.data?.feature_flags?.priority_checkout_enabled ?? true) ? (
        <div className="rounded-xl border border-black/10 bg-white/65 p-3 text-[#111111] backdrop-blur-md">
          <p className="text-xs uppercase tracking-[0.14em] text-[#666666]">
            {tierBenefitsQuery.data.tierName} Benefits
          </p>
          <p className="mt-1 text-sm">
            {tierBenefitsQuery.data.fast_checkout_enabled ? "Fast checkout enabled" : "Standard checkout"} ·{" "}
            {tierBenefitsQuery.data.preferred_shipping_enabled ? "Preferred shipping enabled" : "Best carrier auto-selected"} ·{" "}
            Stepper: {tierBenefitsQuery.data.stepper_animation_style}
          </p>
          {tierBenefitsQuery.data.fast_checkout_enabled ? (
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#1f6f3a]">Priority Processing Activated</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
      <div className="glass rounded-2xl border border-black/10 bg-white p-5 text-[#111111]">
        <h1 className="mb-4 font-heading text-3xl text-[#111111]">Checkout</h1>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-[#555555]">Delivery Address</p>
          <Button onClick={() => setShowAddressForm((prev) => !prev)} className="px-3 py-1 text-xs">
            {showAddressForm ? "Cancel" : "Add Address"}
          </Button>
        </div>

        {step === 1 && addressesQuery.isLoading ? <p className="text-sm text-[#666666]">Loading addresses...</p> : null}
        {step === 1 && !!addressesQuery.data?.length && (
          <div className="mb-4 grid gap-3">
            {addressesQuery.data.map((item) => (
              <label key={item.id} className="cursor-pointer rounded-lg border border-black/15 bg-white p-3 text-sm">
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    checked={selectedAddressId === item.id}
                    onChange={() => setSelectedAddressId(item.id)}
                  />
                  <div>
                    <p className="font-semibold text-[#111111]">
                      {item.full_name} {item.label ? `(${item.label})` : ""}
                    </p>
                    <p className="text-[#555555]">{item.phone}</p>
                    <p className="text-[#555555]">
                      {item.line1}
                      {item.line2 ? `, ${item.line2}` : ""}, {item.city}, {item.state} {item.postal_code}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        {step === 1 && !addressesQuery.data?.length && !showAddressForm ? (
          <p className="mb-4 text-sm text-amber-700">No saved address. Add one before placing order.</p>
        ) : null}

        {step === 1 && showAddressForm ? (
          <div className="grid gap-3">
            <input
              value={addressForm.label}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="Label (Home/Work)"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <input
              value={addressForm.fullName}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, fullName: event.target.value }))}
              placeholder="Full name"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <input
              value={addressForm.phone}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, phone: event.target.value }))}
              placeholder="Phone"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <input
              value={addressForm.line1}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, line1: event.target.value }))}
              placeholder="Address line 1"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <input
              value={addressForm.line2}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, line2: event.target.value }))}
              placeholder="Address line 2 (optional)"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <input
              value={addressForm.city}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, city: event.target.value }))}
              placeholder="City"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <input
              value={addressForm.state}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, state: event.target.value }))}
              placeholder="State"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <input
              value={addressForm.postalCode}
              onChange={(event) => setAddressForm((prev) => ({ ...prev, postalCode: event.target.value }))}
              placeholder="Postal code"
              className="rounded-lg border-black/20 bg-white text-[#111111]"
            />
            <label className="flex items-center gap-2 text-sm text-[#444444]">
              <input
                type="checkbox"
                checked={addressForm.isDefault}
                onChange={(event) => setAddressForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
              />
              Set as default
            </label>
            <Button onClick={() => addAddressMutation.mutate()} disabled={addAddressMutation.isPending}>
              {addAddressMutation.isPending ? "Saving address..." : "Save Address"}
            </Button>
            {addAddressMutation.error ? (
              <p className="text-xs text-rose-600">{(addAddressMutation.error as Error).message}</p>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3 rounded-xl border border-black/10 bg-[#fafafa] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[#555555]">Delivery Method</p>
            <label className="flex items-center gap-2 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm">
              <input type="radio" checked readOnly />
              Express standard shipping (auto best carrier)
            </label>
            <p className="text-xs text-[#666666]">Auto address suggestions and carrier assignment will be used at order placement.</p>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mb-5 space-y-2 rounded-lg border border-black/10 bg-[#fafafa] p-3">
            <p className="text-xs uppercase tracking-wider text-[#555555]">Payment Option</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={paymentMethod === "online"}
                onChange={() => setPaymentMethod("online")}
              />
              Online Payment (Razorpay)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={paymentMethod === "cod"}
                onChange={() => setPaymentMethod("cod")}
                disabled={hasNonCodItem}
              />
              Cash on Delivery (COD)
            </label>
            {hasNonCodItem ? (
              <p className="text-xs text-rose-600">COD disabled: one or more cart products are COD-off.</p>
            ) : null}
            <p className="text-[11px] text-[#555555]">Secured checkout • Razorpay encrypted flow • Save card available in Razorpay flow.</p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-2 rounded-xl border border-black/10 bg-[#fafafa] p-4 text-sm">
            <p className="text-xs uppercase tracking-[0.14em] text-[#555555]">Review</p>
            <p>Address: {selectedAddressId ? "Selected" : "Not selected"}</p>
            <p>Payment: {paymentMethod === "online" ? "Online (Razorpay)" : "Cash on Delivery"}</p>
            {appliedDiscount ? <p>Discount: {appliedDiscount.code}</p> : null}
            <p>Total payable: {currencyQuery.data ? formatCurrencyAmount(total, currencyQuery.data) : formatINR(total)}</p>
          </div>
        ) : null}
      </div>
      <div className="glass rounded-2xl border border-black/10 bg-white p-5 text-[#111111]">
        <div className="mb-4 rounded-xl border border-black/10 bg-[#fafafa] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-[#555555]">Have a discount code?</p>
          <div className="mt-2 flex gap-2">
            <input
              value={discountCodeInput}
              onChange={(event) => setDiscountCodeInput(event.target.value.toUpperCase())}
              placeholder="Enter code"
              className="w-full rounded-md border border-black/20 bg-white px-3 py-2 text-sm text-[#111111]"
            />
            <Button
              variant="ghost"
              onClick={() => discountApplyMutation.mutate()}
              disabled={discountApplyMutation.isPending || !discountCodeInput.trim()}
            >
              {discountApplyMutation.isPending ? "Applying..." : "Apply"}
            </Button>
            {appliedDiscount ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setAppliedDiscount(null);
                  setDiscountError("");
                  setDiscountCodeInput("");
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
          {appliedDiscount ? (
            <p className="mt-2 text-xs text-emerald-700">
              Code <strong>{appliedDiscount.code}</strong> applied. You save{" "}
              {currencyQuery.data
                ? formatCurrencyAmount(appliedDiscount.discountAmountInr, currencyQuery.data)
                : formatINR(appliedDiscount.discountAmountInr)}
              .
            </p>
          ) : null}
          {discountError ? <p className="mt-2 text-xs text-rose-600">{discountError}</p> : null}
        </div>

        <p className="text-sm text-[#555555]">Subtotal</p>
        {(cartQuery.data?.cart_items ?? []).map((item) =>
          item.product?.drop_id && user ? (
            <DropHoldTimer key={item.id} className="mb-2" expiresAt={reservationQuery.data?.get(item.product_id) ?? null} />
          ) : null
        )}
        <p className="mb-2 text-xl text-[#111111]">
          {currencyQuery.data ? formatCurrencyAmount(subtotal, currencyQuery.data) : formatINR(subtotal)}
        </p>
        <p className="text-sm text-[#555555]">Shipping</p>
        <p className="mb-2 text-xl text-[#111111]">
          {currencyQuery.data ? formatCurrencyAmount(shippingPreview, currencyQuery.data) : formatINR(shippingPreview)}
        </p>
        {appliedDiscount ? (
          <>
            <p className="text-sm text-[#555555]">Discount ({appliedDiscount.code})</p>
            <p className="mb-2 text-xl text-emerald-700">
              -{" "}
              {currencyQuery.data
                ? formatCurrencyAmount(appliedDiscount.discountAmountInr, currencyQuery.data)
                : formatINR(appliedDiscount.discountAmountInr)}
            </p>
          </>
        ) : null}
        <p className="text-sm text-[#555555]">Total</p>
        <p className="mb-5 font-heading text-3xl text-[#111111]">
          {currencyQuery.data ? formatCurrencyAmount(total, currencyQuery.data) : formatINR(total)}
        </p>
        <p className="mb-5 text-xs text-[#666666]">
          Final shipping is calculated securely at payment based on product shipping rules.
        </p>

        <div className="mb-3 flex gap-2">
          <Button variant="ghost" onClick={() => setStep((prev) => (prev > 1 ? ((prev - 1) as 1 | 2 | 3 | 4) : prev))}>
            Back
          </Button>
          {step < 4 ? (
            <Button
              onClick={() => setStep((prev) => (prev < 4 && stepReady[prev] ? ((prev + 1) as 1 | 2 | 3 | 4) : prev))}
              disabled={!stepReady[step]}
            >
              Continue
            </Button>
          ) : null}
        </div>

        <Button onClick={() => checkoutMutation.mutate()} disabled={checkoutMutation.isPending || total <= 0 || step !== 4}>
          {checkoutMutation.isPending
            ? paymentMethod === "online"
              ? "Opening Razorpay..."
              : "Placing COD Order..."
            : paymentMethod === "online"
            ? "Pay Securely"
            : "Place COD Order"}
        </Button>
        {checkoutError ? <p className="mt-3 text-xs text-rose-600">{checkoutError}</p> : null}
        {captchaPrompt ? (
          <div className="mt-3 rounded-lg border border-amber-300/40 bg-amber-50 p-3 text-xs text-amber-950">
            <p className="font-medium">Suspicious activity detected. Complete captcha:</p>
            <p className="mt-1">
              What is {captchaPrompt.a} + {captchaPrompt.b} ?
            </p>
            <input
              value={captchaAnswer}
              onChange={(event) => setCaptchaAnswer(event.target.value)}
              className="mt-2 w-full rounded border border-amber-400/60 bg-white px-2 py-1 text-sm text-black"
            />
          </div>
        ) : null}
        {checkoutMessage ? <p className="mt-3 text-xs text-emerald-300">{checkoutMessage}</p> : null}
      </div>
    </div>
    </div>
  );
};

