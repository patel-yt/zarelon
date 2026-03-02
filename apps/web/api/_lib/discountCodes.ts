import { adminClient } from "./server.js";

export type DiscountCodeValidationResult =
  | {
      ok: true;
      codeId: string;
      code: string;
      title: string | null;
      discountType: "percentage" | "fixed";
      discountValue: number;
      discountAmountInr: number;
      minOrderInr: number;
      maxDiscountInr: number | null;
    }
  | { ok: false; error: string };

const normalizeCode = (raw: string): string => raw.trim().toUpperCase();

export const validateDiscountCode = async (input: {
  userId: string;
  code: string;
  subtotalInr: number;
}): Promise<DiscountCodeValidationResult> => {
  const normalized = normalizeCode(input.code);
  if (!normalized) return { ok: false, error: "Enter a discount code" };

  const codeRes = await adminClient.from("discount_codes").select("*").ilike("code", normalized).maybeSingle();
  if (codeRes.error || !codeRes.data) return { ok: false, error: "Invalid discount code" };
  const row = codeRes.data as any;
  if (!row.active) return { ok: false, error: "This discount code is inactive" };

  const nowMs = Date.now();
  const startsAtMs = row.starts_at ? new Date(String(row.starts_at)).getTime() : null;
  const expiresAtMs = row.expires_at ? new Date(String(row.expires_at)).getTime() : null;
  if (startsAtMs && nowMs < startsAtMs) return { ok: false, error: "This discount code is not active yet" };
  if (expiresAtMs && nowMs > expiresAtMs) return { ok: false, error: "This discount code has expired" };

  const subtotal = Math.max(0, Math.round(Number(input.subtotalInr || 0)));
  const minOrder = Math.max(0, Number(row.min_order_inr ?? 0));
  if (subtotal < minOrder) return { ok: false, error: `Minimum order must be Rs ${minOrder}` };

  const totalUsageLimit = row.total_usage_limit == null ? null : Number(row.total_usage_limit);
  const usedCount = Math.max(0, Number(row.used_count ?? 0));
  if (totalUsageLimit != null && usedCount >= totalUsageLimit) return { ok: false, error: "This code has reached max usage" };

  const perUserLimit = Math.max(1, Number(row.per_user_limit ?? 1));
  const usageRes = await adminClient
    .from("discount_code_usages")
    .select("id", { count: "exact", head: true })
    .eq("discount_code_id", row.id)
    .eq("user_id", input.userId);
  if (usageRes.error) return { ok: false, error: "Could not validate discount usage. Please retry." };
  const usedByUser = Number(usageRes.count ?? 0);
  if (usedByUser >= perUserLimit) return { ok: false, error: "You have already used this code" };

  const discountType = String(row.discount_type) === "fixed" ? "fixed" : "percentage";
  const discountValue = Math.max(1, Number(row.discount_value ?? 0));
  let discountAmount = discountType === "percentage" ? Math.floor((subtotal * discountValue) / 100) : discountValue;
  if (row.max_discount_inr != null) discountAmount = Math.min(discountAmount, Math.max(1, Number(row.max_discount_inr)));
  discountAmount = Math.max(0, Math.min(discountAmount, subtotal));
  if (discountAmount <= 0) return { ok: false, error: "Discount is not applicable on current cart" };

  return {
    ok: true,
    codeId: String(row.id),
    code: normalized,
    title: row.title ? String(row.title) : null,
    discountType,
    discountValue,
    discountAmountInr: discountAmount,
    minOrderInr: minOrder,
    maxDiscountInr: row.max_discount_inr == null ? null : Math.max(1, Number(row.max_discount_inr)),
  };
};

export const registerDiscountUsage = async (input: {
  codeId: string;
  userId: string;
  orderId: string;
  codeSnapshot: string;
  discountAmountInr: number;
}) => {
  const existing = await adminClient
    .from("discount_code_usages")
    .select("id")
    .eq("order_id", input.orderId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message || "Could not confirm code usage");
  if (existing.data?.id) return;

  const insertRes = await adminClient.from("discount_code_usages").insert({
    discount_code_id: input.codeId,
    user_id: input.userId,
    order_id: input.orderId,
    code_snapshot: normalizeCode(input.codeSnapshot),
    discount_amount_inr: Math.max(0, Math.round(Number(input.discountAmountInr || 0))),
  });
  if (insertRes.error) throw new Error(insertRes.error.message || "Could not store code usage");

  const currentRes = await adminClient.from("discount_codes").select("used_count").eq("id", input.codeId).maybeSingle();
  if (currentRes.error || !currentRes.data) {
    throw new Error(currentRes.error?.message || "Could not load discount code usage counter");
  }
  const nextUsedCount = Math.max(0, Number((currentRes.data as any).used_count ?? 0)) + 1;
  const bumpRes = await adminClient
    .from("discount_codes")
    .update({ used_count: nextUsedCount, updated_at: new Date().toISOString() })
    .eq("id", input.codeId);
  if (bumpRes.error) throw new Error(bumpRes.error.message || "Could not update code usage counter");
};
