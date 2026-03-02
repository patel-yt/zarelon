import { z } from "zod";

export const shippingAddressSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(10),
  line1: z.string().min(4),
  line2: z.string().optional(),
  city: z.string().min(2),
  state: z.string().min(2),
  postalCode: z.string().min(4),
  country: z.literal("India"),
});

export const createRazorpayOrderSchema = z.object({
  cartId: z.string().uuid(),
  addressId: z.string().uuid(),
  discountCode: z.string().trim().max(40).optional(),
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const refundSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(3),
});

export const adminProductSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(2),
  description: z.string().optional(),
  price_inr: z.number().int().positive(),
  discount_percent: z.number().int().min(0).max(90),
  category: z.string().min(2),
  stock: z.number().int().min(0),
  featured: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const adminOrderStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "shipped", "delivered", "cancelled", "refunded"]),
});
