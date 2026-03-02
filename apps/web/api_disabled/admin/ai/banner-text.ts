import { z } from "zod";
import type { ApiRequest, ApiResponse } from "../../_lib/http.js";
import { requirePermission, sendError } from "../../_lib/server.js";

const schema = z.object({
  festivalName: z.string().min(2),
  discountPercent: z.coerce.number().min(0).max(95),
  categoryFocus: z.string().min(2),
  tone: z.enum(["sporty", "luxury", "bold", "emotional"]),
});

const fallbackCopy = (input: z.infer<typeof schema>) => {
  const bank = {
    sporty: {
      headline: `${input.festivalName} is Live. Move Fast.`,
      subtitle: `${input.discountPercent}% OFF on ${input.categoryFocus} built for performance days.`,
      cta: "Shop the Drop",
      urgency: "Limited stock. Speed wins.",
    },
    luxury: {
      headline: `${input.festivalName}: Curated Luxury, Limited Window`,
      subtitle: `Enjoy up to ${input.discountPercent}% OFF on ${input.categoryFocus} with premium finish.`,
      cta: "Explore Collection",
      urgency: "Exclusive pieces. Limited timeline.",
    },
    bold: {
      headline: `${input.festivalName} Starts Now`,
      subtitle: `${input.discountPercent}% OFF on ${input.categoryFocus}. No second window.`,
      cta: "Claim Offer",
      urgency: "Ends soon. Own it before it is gone.",
    },
    emotional: {
      headline: `Celebrate ${input.festivalName} in Signature Style`,
      subtitle: `Save ${input.discountPercent}% on ${input.categoryFocus} and gift your best moments.`,
      cta: "Celebrate & Shop",
      urgency: "Moments pass fast. Offer ends soon.",
    },
  } as const;
  return bank[input.tone];
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

    const admin = await requirePermission(req, "can_manage_festival");
    if (!admin) return sendError(res, 403, "Permission denied");

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid payload");

    const input = parsed.data;

    return res.status(200).json({ ...fallbackCopy(input), mode: "fallback" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate banner text";
    return sendError(res, 500, message);
  }
}
