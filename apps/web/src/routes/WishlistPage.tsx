import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { ProductCard } from "@/components/ui/ProductCard";
import { useAuth } from "@/features/auth/AuthContext";
import { getWishlist, toggleWishlistItem } from "@/services/wishlist";

export const WishlistPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["wishlist", user?.id],
    queryFn: () => getWishlist(user!.id),
    enabled: Boolean(user?.id),
  });

  const removeMutation = useMutation({
    mutationFn: (productId: string) => toggleWishlistItem(user!.id, productId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["wishlist", user?.id] });
    },
  });

  if (!user) return <div>Please sign in to view wishlist.</div>;

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-[#111111]">Wishlist</h1>
      <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-3">
        {(query.data ?? []).map((item) => (
          <div key={item.id} className="space-y-2">
            <ProductCard product={Array.isArray(item.product) ? item.product[0] : item.product} />
            <Button variant="ghost" className="w-full" onClick={() => removeMutation.mutate((Array.isArray(item.product) ? item.product[0] : item.product).id)}>
              Remove
            </Button>
          </div>
        ))}
      </div>
      {!query.data?.length && <p className="text-sm text-[#555555]">No wishlist items yet.</p>}
    </div>
  );
};
