export const orderTransitionMap: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

export const isValidOrderTransition = (from: string, to: string): boolean =>
  orderTransitionMap[from]?.includes(to) ?? false;
