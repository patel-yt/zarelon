import { adminClient } from "./server.js";

type RateLimitInput = {
  eventType: string;
  maxHits: number;
  windowMs: number;
  userId?: string | null;
  ipAddress?: string | null;
};

export const enforceRateLimit = async (input: RateLimitInput): Promise<{ allowed: boolean; count: number }> => {
  const userId = input.userId?.trim() || null;
  const ip = input.ipAddress?.trim() || null;
  if (!userId && !ip) return { allowed: true, count: 0 };

  const since = new Date(Date.now() - input.windowMs).toISOString();
  let query = adminClient
    .from("payment_risk_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", input.eventType)
    .gte("created_at", since);

  if (userId && ip) query = query.or(`user_id.eq.${userId},ip_address.eq.${ip}`);
  else if (userId) query = query.eq("user_id", userId);
  else query = query.eq("ip_address", ip as string);

  const check = await query;
  if (check.error) return { allowed: true, count: 0 };

  const count = Number(check.count ?? 0);
  if (count < input.maxHits) return { allowed: true, count };

  await adminClient.from("payment_risk_events").insert({
    user_id: userId,
    event_type: `${input.eventType}_blocked`,
    risk_level: "high",
    ip_address: ip,
    details: { max_hits: input.maxHits, window_ms: input.windowMs, observed_hits: count },
  });

  return { allowed: false, count };
};

