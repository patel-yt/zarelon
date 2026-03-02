import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { DropHoldTimer } from "@/components/ui/DropHoldTimer";
import { useAuth } from "@/features/auth/AuthContext";
import { formatINR } from "@/lib/utils";
import { formatCurrencyAmount, resolveUserCurrency } from "@/services/currency";
import { fetchUserCartReservationMap, getCart, releaseExpiredDropItems, updateCartQuantity } from "@/services/cart";
import { fetchActiveFestival } from "@/services/festivals";

export const CartPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const cartQuery = useQuery({
    queryKey: ["cart", user?.id],
    queryFn: () => getCart(user!.id),
    enabled: Boolean(user?.id),
  });
  const festivalQuery = useQuery({
    queryKey: ["festival-active"],
    queryFn: fetchActiveFestival,
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
    queryKey: ["cart-reservations", user?.id, reservationProductIds.join(",")],
    queryFn: () => fetchUserCartReservationMap(user!.id, reservationProductIds),
    enabled: Boolean(user?.id) && reservationProductIds.length > 0,
  });
  const festivalDiscount = festivalQuery.data?.festival_discount ?? 0;
  const [holdNotice, setHoldNotice] = useState("");

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      const removed = await releaseExpiredDropItems(user.id);
      if (removed > 0) {
        setHoldNotice(`${removed} drop item(s) removed because cart hold expired.`);
        await queryClient.invalidateQueries({ queryKey: ["cart", user.id] });
      }
    })();
  }, [user?.id]);

  const getUnitPrice = (item: any) => {
    const base = item.product?.discount_price ?? item.product?.price_inr ?? 0;
    return Math.round(base * (1 - festivalDiscount / 100));
  };

  const quantityMutation = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) => updateCartQuantity(id, quantity),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["cart", user?.id] });
    },
  });

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

  if (!user) {
    return <div className="text-sm text-[#444444]">Please sign in to view your cart.</div>;
  }

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-[#111111]">Your Cart</h1>
      {holdNotice ? <p className="text-xs text-[#b45309]">{holdNotice}</p> : null}
      <div className="space-y-3">
        {cartItems.map((item) => (
          <div key={item.id} className="glass flex items-center justify-between rounded-xl bg-white p-4 text-[#111111]">
            <div>
              <p className="font-medium">{item.product?.title}</p>
              {item.product?.drop_id && user ? (
                <DropHoldTimer expiresAt={reservationQuery.data?.get(item.product_id) ?? null} className="mt-2" />
              ) : null}
              {item.variant ? (
                <p className="text-xs text-[#555555]">
                  {item.variant.color ? `${item.variant.color}` : "Default"}{" "}
                  {item.variant.size ? `| ${item.variant.size}` : ""}
                </p>
              ) : null}
              <p className="text-xs text-[#555555]">
                {currencyQuery.data ? formatCurrencyAmount(getUnitPrice(item), currencyQuery.data) : formatINR(getUnitPrice(item))}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => quantityMutation.mutate({ id: item.id, quantity: item.quantity - 1 })}>
                -
              </Button>
              <span>{item.quantity}</span>
              <Button
                variant="ghost"
                disabled={Boolean(item.variant && item.quantity >= (item.variant.stock ?? 0))}
                onClick={() => quantityMutation.mutate({ id: item.id, quantity: item.quantity + 1 })}
              >
                +
              </Button>
            </div>
          </div>
        ))}
        {!hasItems ? (
          <div className="rounded-xl border border-black/10 bg-[#fafafa] p-6 text-sm text-[#555555]">
            Your cart is empty. Add products to continue checkout.
          </div>
        ) : null}
      </div>

      <div className="glass rounded-xl bg-white p-5 text-[#111111]">
        <p className="text-sm text-[#555555]">Subtotal</p>
        <p className="font-heading text-2xl text-[#111111]">
          {currencyQuery.data ? formatCurrencyAmount(subtotal, currencyQuery.data) : formatINR(subtotal)}
        </p>
        {hasItems ? (
          <Link to="/checkout" className="btn-primary-contrast mt-4 inline-block rounded-lg px-4 py-2 text-sm font-semibold">
            Proceed to checkout
          </Link>
        ) : (
          <Link to="/products" className="btn-secondary-contrast mt-4 inline-block rounded-lg px-4 py-2 text-sm font-semibold">
            Continue shopping
          </Link>
        )}
      </div>
    </div>
  );
};
