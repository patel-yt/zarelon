import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import { z } from "zod";
import { adminClient, getServerConfigError, requirePermission, sendError } from "../_lib/server.js";
import {
  handleBannerText,
  handleEmailTest,
  handleShippingTest,
  handleSmartLayout,
  handleSocialSubmissionsAdmin,
  handleSocialSubmissionsUser,
  handleReferralValidate,
  handleReferralApply,
  handleReferralReminder,
  handleAdminReferrals,
  handleSocialRecheckRun,
  handleSocialLeaderboard,
  handleSocialCaptionGenerate,
  handleCreatorTrack,
  handleCreatorDashboard,
  handleAdminCreatorAnalytics,
  handleEliteMe,
  handleAdminElite,
  handleRoyalSystemSettings,
  handleAdminContentBlocks,
  handleRoyalAccessOrder,
  handleRoyalAccessVerify,
  handleAdminDropsCreate,
  handleAdminDropsUpdate,
  handleDropsActive,
  handleDropById,
  handleDropProductsById,
  handleDropAccessRequest,
  handleDropRedeem,
  handleHomepageMobile,
  handleHomepageVariant,
  handleHomepageInteraction,
  handleAdminDiscountCodes,
  handleDiscountCodeValidate,
} from "../_lib/specialRoutes.js";

const slugify = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(2),
  description: z.string().optional(),
  price_inr: z.coerce.number().int().positive(),
  discount_price: z.coerce.number().int().positive().optional(),
  discount_percent: z.coerce.number().int().min(0).max(90).default(0),
  category: z.string().min(2),
  stock: z.coerce.number().int().min(0),
  requires_shipping: z.coerce.boolean().default(true),
  requires_cod: z.coerce.boolean().default(true),
  return_allowed: z.coerce.boolean().default(true),
  exchange_allowed: z.coerce.boolean().default(true),
  return_window_days: z.coerce.number().int().min(1).max(30).default(7),
  featured: z.coerce.boolean().default(false),
  gender: z.enum(["men", "women", "unisex"]).default("unisex"),
  show_on_home: z.coerce.boolean().default(false),
  show_on_new_in: z.coerce.boolean().default(false),
  show_on_collection: z.coerce.boolean().default(false),
  collection_slug: z.string().optional(),
  category_slug: z.string().optional(),
  festival_tag: z.string().optional(),
  minimum_required_tier_id: z.string().uuid().optional(),
  image_url: z.string().url().optional(),
  image_urls: z.array(z.string().url()).optional(),
  video_url: z.string().url().optional(),
  bundle_with: z.array(z.string()).optional(),
  size_chart: z.array(z.record(z.string(), z.string())).optional(),
  variants: z
    .array(
      z.object({
        color: z.string().optional(),
        size: z.string().optional(),
        sku: z.string().optional(),
        stock: z.coerce.number().int().min(0),
        active: z.coerce.boolean().optional(),
      })
    )
    .optional(),
  active: z.coerce.boolean().default(true),
});

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const routeKey = Array.isArray(req.query?.__route) ? req.query.__route[0] : req.query?.__route;
    if (routeKey) {
      if (routeKey === "banner-text") return handleBannerText(req, res);
      if (routeKey === "smart-layout") return handleSmartLayout(req, res);
      if (routeKey === "email-test") return handleEmailTest(req, res);
      if (routeKey === "shipping-test") return handleShippingTest(req, res);
      if (routeKey === "social-submissions-user") return handleSocialSubmissionsUser(req, res);
      if (routeKey === "social-submissions-admin") return handleSocialSubmissionsAdmin(req, res);
      if (routeKey === "referral-validate") return handleReferralValidate(req, res);
      if (routeKey === "referral-apply") return handleReferralApply(req, res);
      if (routeKey === "referral-remind") return handleReferralReminder(req, res);
      if (routeKey === "admin-referrals") return handleAdminReferrals(req, res);
      if (routeKey === "social-recheck-run") return handleSocialRecheckRun(req, res);
      if (routeKey === "social-leaderboard") return handleSocialLeaderboard(req, res);
      if (routeKey === "social-caption-generate") return handleSocialCaptionGenerate(req, res);
      if (routeKey === "creator-track") return handleCreatorTrack(req, res);
      if (routeKey === "creator-dashboard") return handleCreatorDashboard(req, res);
      if (routeKey === "admin-creator-analytics") return handleAdminCreatorAnalytics(req, res);
      if (routeKey === "elite-me") return handleEliteMe(req, res);
      if (routeKey === "admin-elite") return handleAdminElite(req, res);
      if (routeKey === "admin-royal-system") return handleRoyalSystemSettings(req, res);
      if (routeKey === "admin-content-blocks") return handleAdminContentBlocks(req, res);
      if (routeKey === "royal-access-order") return handleRoyalAccessOrder(req, res);
      if (routeKey === "royal-access-verify") return handleRoyalAccessVerify(req, res);
      if (routeKey === "admin-drops-create") return handleAdminDropsCreate(req, res);
      if (routeKey === "admin-drops-update") return handleAdminDropsUpdate(req, res);
      if (routeKey === "drops-active") return handleDropsActive(req, res);
      if (routeKey === "drop-read") return handleDropById(req, res);
      if (routeKey === "drop-products") return handleDropProductsById(req, res);
      if (routeKey === "drop-access-request") return handleDropAccessRequest(req, res);
      if (routeKey === "drop-redeem") return handleDropRedeem(req, res);
      if (routeKey === "homepage-mobile") return handleHomepageMobile(req, res);
      if (routeKey === "homepage-variant") return handleHomepageVariant(req, res);
      if (routeKey === "homepage-interaction") return handleHomepageInteraction(req, res);
      if (routeKey === "admin-discount-codes") return handleAdminDiscountCodes(req, res);
      if (routeKey === "discount-code-validate") return handleDiscountCodeValidate(req, res);
      return sendError(res, 404, "Route not found");
    }

    if (req.method === "DELETE") {
      const serverConfigError = getServerConfigError();
      if (serverConfigError) return sendError(res, 500, serverConfigError);

      const admin = await requirePermission(req, "can_manage_products");
      if (!admin) return sendError(res, 403, "Permission denied");

      const queryId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
      const bodyId =
        typeof req.body?.productId === "string"
          ? req.body.productId
          : typeof req.body?.id === "string"
            ? req.body.id
            : null;
      const productId = String(queryId ?? bodyId ?? "").trim();
      if (!uuidPattern.test(productId)) return sendError(res, 400, "Invalid product id");

      await adminClient.from("product_images").delete().eq("product_id", productId);
      await adminClient.from("product_variants").delete().eq("product_id", productId);
      await adminClient.from("cart_items").delete().eq("product_id", productId);
      await adminClient.from("wishlist_items").delete().eq("product_id", productId);

      const { data: deletedRows, error: deleteError } = await adminClient
        .from("products")
        .delete()
        .eq("id", productId)
        .select("id");

      let archived = false;
      if (deleteError) {
        const lower = String(deleteError.message ?? "").toLowerCase();
        if (lower.includes("foreign key") || lower.includes("order_items")) {
          const archiveRecord: Record<string, unknown> = {
            active: false,
            featured: false,
            show_on_home: false,
            show_on_new_in: false,
            show_on_collection: false,
            stock: 0,
            updated_at: new Date().toISOString(),
          };
          let { error: archiveError } = await adminClient
            .from("products")
            .update(archiveRecord)
            .eq("id", productId);

          if (archiveError) {
            delete archiveRecord.show_on_home;
            delete archiveRecord.show_on_new_in;
            delete archiveRecord.show_on_collection;
            ({ error: archiveError } = await adminClient.from("products").update(archiveRecord).eq("id", productId));
          }

          if (archiveError) return sendError(res, 400, archiveError.message ?? "Could not archive product");
          archived = true;
        } else {
          return sendError(res, 400, deleteError.message ?? "Could not delete product");
        }
      } else if (!deletedRows?.length) {
        return sendError(res, 404, "Product not found");
      }

      await adminClient.from("admin_audit_logs").insert({
        admin_user_id: admin.id,
        action: archived ? "product_archive" : "product_delete",
        entity_type: "products",
        entity_id: productId,
        diff: { archived },
      });

      return res.status(200).json({ success: true, productId, archived });
    }

    if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

    const serverConfigError = getServerConfigError();
    if (serverConfigError) return sendError(res, 500, serverConfigError);

    const admin = await requirePermission(req, "can_manage_products");
    if (!admin) return sendError(res, 403, "Permission denied");

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues?.[0]?.message ?? "Invalid payload";
      return sendError(res, 400, firstIssue);
    }

    const payload = parsed.data;
    const slug = slugify(payload.title);
    const normalizedVariants =
      payload.variants?.map((item) => ({
        color: item.color?.trim() || null,
        size: item.size?.trim() || null,
        sku: item.sku?.trim() || null,
        stock: Math.max(0, Number(item.stock) || 0),
        active: item.active ?? true,
      })) ?? [];
    const computedStock = normalizedVariants.length
      ? normalizedVariants.reduce((sum, item) => sum + item.stock, 0)
      : payload.stock;

    let previousPrice: number | null = null;
    let supportsPreviousPriceColumn = false;
    if (payload.id) {
      const { data: existing, error: existingError } = await adminClient
        .from("products")
        .select("price_inr, previous_price_inr")
        .eq("id", payload.id)
        .maybeSingle();
      if (existingError) {
        const { data: fallbackExisting } = await adminClient
          .from("products")
          .select("price_inr")
          .eq("id", payload.id)
          .maybeSingle();
        if (fallbackExisting && typeof fallbackExisting.price_inr === "number") {
          previousPrice = fallbackExisting.price_inr !== payload.price_inr ? fallbackExisting.price_inr : null;
        }
      } else {
        supportsPreviousPriceColumn = true;
        if (existing && typeof existing.price_inr === "number") {
          if (existing.price_inr !== payload.price_inr) {
            previousPrice = existing.price_inr;
          } else {
            previousPrice = existing.previous_price_inr ?? null;
          }
        }
      }
    }

    const normalizedBundleWith = (payload.bundle_with ?? [])
      .map((id) => String(id).trim())
      .filter((id) => uuidPattern.test(id));
    const record: Record<string, unknown> = {
      slug,
      title: payload.title,
      description: payload.description ?? null,
      price_inr: payload.price_inr,
      discount_price: payload.discount_price ?? null,
      discount_percent: payload.discount_percent,
      category: payload.category,
      stock: computedStock,
      requires_shipping: payload.requires_shipping,
      requires_cod: payload.requires_cod,
      return_allowed: payload.return_allowed,
      exchange_allowed: payload.exchange_allowed,
      return_window_days: payload.return_window_days,
      featured: payload.featured,
      gender: payload.gender,
      show_on_home: payload.show_on_home,
      show_on_new_in: payload.show_on_new_in,
      show_on_collection: payload.show_on_collection,
      collection_slug: payload.collection_slug?.trim() || null,
      category_slug: payload.category_slug?.trim() || null,
      minimum_required_tier_id: payload.minimum_required_tier_id ?? null,
      festival_tag: payload.festival_tag ?? null,
      image_url: payload.image_url ?? null,
      video_url: payload.video_url ?? null,
      bundle_with: normalizedBundleWith,
      size_chart: payload.size_chart ?? null,
      active: payload.active,
      updated_at: new Date().toISOString(),
    };
    if (payload.id && supportsPreviousPriceColumn) {
      record.previous_price_inr = previousPrice;
    }

    let action = payload.id
      ? adminClient.from("products").update(record).eq("id", payload.id).select("id")
      : adminClient.from("products").insert(record).select("id");

    let { data, error } = await action;
    if (!payload.id && error) {
      const msg = String(error.message ?? "").toLowerCase();
      if (msg.includes("slug") || msg.includes("duplicate key")) {
        record.slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
        ({ data, error } = await adminClient.from("products").insert(record).select("id"));
      }
    }
    if (
      error &&
      (String(error.message ?? "").toLowerCase().includes("requires_shipping") ||
        String(error.message ?? "").toLowerCase().includes("requires_cod") ||
        String(error.message ?? "").toLowerCase().includes("return_allowed") ||
        String(error.message ?? "").toLowerCase().includes("exchange_allowed") ||
        String(error.message ?? "").toLowerCase().includes("return_window_days") ||
        String(error.message ?? "").toLowerCase().includes("bundle_with") ||
        String(error.message ?? "").toLowerCase().includes("size_chart") ||
        String(error.message ?? "").toLowerCase().includes("show_on_home") ||
        String(error.message ?? "").toLowerCase().includes("show_on_new_in") ||
        String(error.message ?? "").toLowerCase().includes("show_on_collection") ||
        String(error.message ?? "").toLowerCase().includes("category_slug") ||
        String(error.message ?? "").toLowerCase().includes("collection_slug") ||
        String(error.message ?? "").toLowerCase().includes("gender") ||
        String(error.message ?? "").toLowerCase().includes("minimum_required_tier_id"))
    ) {
      delete record.requires_shipping;
      delete record.requires_cod;
      delete record.return_allowed;
      delete record.exchange_allowed;
      delete record.return_window_days;
      delete record.bundle_with;
      delete record.size_chart;
      delete record.gender;
      delete record.show_on_home;
      delete record.show_on_new_in;
      delete record.show_on_collection;
      delete record.collection_slug;
      delete record.category_slug;
      delete record.minimum_required_tier_id;
      action = payload.id
        ? adminClient.from("products").update(record).eq("id", payload.id).select("id")
        : adminClient.from("products").insert(record).select("id");
      ({ data, error } = await action);
    }

    let productId = Array.isArray(data) ? data[0]?.id : (data as any)?.id;
    if (!error && !productId && payload.id) {
      const { data: exists } = await adminClient.from("products").select("id").eq("id", payload.id).maybeSingle();
      if (exists?.id) productId = payload.id;
    }
    if (error) return sendError(res, 400, error.message ?? "Could not save product");
    if (!productId) {
      return sendError(
        res,
        400,
        payload.id ? "Product not found for update. Refresh and try again." : "Could not save product"
      );
    }

    if (payload.image_urls) {
      await adminClient.from("product_images").delete().eq("product_id", productId);
      if (payload.image_urls.length) {
        const imageRows = payload.image_urls.map((url, index) => ({
          product_id: productId,
          image_url: url,
          sort_order: index,
          is_primary: index === 0,
        }));
        const { error: imageError } = await adminClient.from("product_images").insert(imageRows);
        if (imageError) return sendError(res, 400, "Product saved but image gallery update failed");
      }
    }

    if (payload.variants) {
      await adminClient.from("product_variants").delete().eq("product_id", productId);
      if (normalizedVariants.length) {
        const rows = normalizedVariants.map((item) => ({
          product_id: productId,
          color: item.color,
          size: item.size,
          sku: item.sku,
          stock: item.stock,
          active: item.active,
        }));
        const { error: variantError } = await adminClient.from("product_variants").insert(rows);
        if (variantError) return sendError(res, 400, "Product saved but variants update failed");
      }
    }

    await adminClient.from("admin_audit_logs").insert({
      admin_user_id: admin.id,
      action: payload.id ? "product_update" : "product_insert",
      entity_type: "products",
      entity_id: productId,
      diff: record,
    });

    res.status(200).json({ productId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save product";
    return sendError(res, 500, message);
  }
}

