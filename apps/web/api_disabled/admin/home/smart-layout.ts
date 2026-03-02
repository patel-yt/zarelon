import { z } from "zod";
import type { ApiRequest, ApiResponse } from "../../_lib/http.js";
import { adminClient, requirePermission, sendError } from "../../_lib/server.js";

const schema = z.object({
  pageId: z.string().uuid(),
  action: z.enum(["suggest", "apply", "reject"]),
  recommendationId: z.string().uuid().optional(),
});

const buildSuggestion = async (pageId: string) => {
  const [sectionsRes, eventsRes] = await Promise.all([
    adminClient.from("home_sections").select("id,section_key,display_order").eq("page_id", pageId).order("display_order", { ascending: true }),
    adminClient
      .from("experience_events")
      .select("event_type,target_id")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(800),
  ]);

  if (sectionsRes.error) throw sectionsRes.error;
  const sections = sectionsRes.data ?? [];
  const events = eventsRes.error ? [] : eventsRes.data ?? [];

  const topCategory =
    events
      .filter((row: any) => row.event_type === "category_click")
      .reduce((acc: Record<string, number>, row: any) => {
        const key = String(row.target_id ?? "").toLowerCase();
        if (!key) return acc;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}) || {};

  const leadingCategory = Object.entries(topCategory).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  const ranked = sections
    .map((section: any, idx) => {
      const key = String(section.section_key ?? "").toLowerCase();
      let score = 0;
      if (key.includes("hero")) score += 4;
      if (leadingCategory && key.includes(leadingCategory)) score += 9;
      if (key.includes("men") && leadingCategory.includes("men")) score += 5;
      if (key.includes("watch") && leadingCategory.includes("watch")) score += 6;
      return { id: section.id, section_key: section.section_key, display_order: section.display_order, idx, score };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((item, index) => ({ ...item, display_order: index }));

  const reason = `Based on last 7 days engagement, highlight '${leadingCategory || "top-performing"}' sections earlier.`;
  return { ranked, reason };
};

const applyOrder = async (orderedIds: string[]) => {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const update = await adminClient.from("home_sections").update({ display_order: i }).eq("id", orderedIds[i]);
    if (update.error) throw update.error;
  }
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    if (req.method !== "POST") return sendError(res, 405, "Method not allowed");

    const admin = await requirePermission(req, "can_manage_festival");
    if (!admin) return sendError(res, 403, "Permission denied");

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid payload");

    const body = parsed.data;

    if (body.action === "suggest") {
      const suggestion = await buildSuggestion(body.pageId);
      const pageRes = await adminClient.from("home_pages").select("smart_auto_apply").eq("id", body.pageId).maybeSingle();
      const autoApply = Boolean(pageRes.data?.smart_auto_apply);
      const insert = await adminClient
        .from("home_layout_recommendations")
        .insert({
          page_id: body.pageId,
          proposed_order: suggestion.ranked,
          reason: suggestion.reason,
          status: autoApply ? "applied" : "pending",
          created_by: admin.id,
          approved_by: autoApply ? admin.id : null,
        })
        .select("id,page_id,proposed_order,reason,status,created_at")
        .single();
      if (insert.error) throw insert.error;
      if (autoApply) {
        await applyOrder(suggestion.ranked.map((item) => item.id));
      }
      return res.status(200).json({ recommendation: insert.data });
    }

    if (!body.recommendationId) return sendError(res, 400, "recommendationId is required");

    const recommendationRes = await adminClient
      .from("home_layout_recommendations")
      .select("id,page_id,proposed_order,status")
      .eq("id", body.recommendationId)
      .maybeSingle();

    if (recommendationRes.error || !recommendationRes.data) return sendError(res, 404, "Recommendation not found");

    if (body.action === "reject") {
      const reject = await adminClient
        .from("home_layout_recommendations")
        .update({ status: "rejected", approved_by: admin.id })
        .eq("id", body.recommendationId);
      if (reject.error) throw reject.error;
      return res.status(200).json({ success: true, status: "rejected" });
    }

    const proposed = Array.isArray((recommendationRes.data as any).proposed_order)
      ? ((recommendationRes.data as any).proposed_order as Array<{ id: string }>)
      : [];

    const orderedIds = proposed.map((item) => item.id).filter(Boolean);
    if (!orderedIds.length) return sendError(res, 400, "Proposed order is empty");

    await applyOrder(orderedIds);

    const approve = await adminClient
      .from("home_layout_recommendations")
      .update({ status: "approved", approved_by: admin.id })
      .eq("id", body.recommendationId);
    if (approve.error) throw approve.error;

    return res.status(200).json({ success: true, status: "approved", appliedCount: orderedIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process smart layout action";
    return sendError(res, 500, message);
  }
}
