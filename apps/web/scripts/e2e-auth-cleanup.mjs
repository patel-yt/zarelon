import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const envCandidates = [path.join(root, ".env"), path.join(root, "apps", "web", ".env")];

const parseDotEnv = (raw) => {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

const envFile = envCandidates.find((p) => fs.existsSync(p));
const localEnv = envFile ? parseDotEnv(fs.readFileSync(envFile, "utf8")) : {};
const env = { ...localEnv, ...process.env };

for (const key of ["VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!env[key] || !String(env[key]).trim()) throw new Error(`Missing required env: ${key}`);
}

const adminClient = createClient(String(env.VITE_SUPABASE_URL).trim(), String(env.SUPABASE_SERVICE_ROLE_KEY).trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const safeDeleteIn = async (table, column, ids) => {
  const { error, count } = await adminClient.from(table).delete({ count: "exact" }).in(column, ids);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
  return count ?? 0;
};

const safeDeleteOr = async (table, filter) => {
  const { error, count } = await adminClient.from(table).delete({ count: "exact" }).or(filter);
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
  return count ?? 0;
};

const run = async () => {
  const usersRes = await adminClient
    .from("users")
    .select("id,email")
    .ilike("email", "qa.%@example.com")
    .order("created_at", { ascending: false });
  if (usersRes.error) throw usersRes.error;

  const users = usersRes.data ?? [];
  if (!users.length) {
    console.log(JSON.stringify({ ok: true, message: "No QA users found", removed: {} }, null, 2));
    return;
  }

  const ids = users.map((u) => u.id);
  const removed = {};

  removed.referral_reminders = await safeDeleteOr(
    "referral_reminders",
    `referrer_id.in.(${ids.join(",")}),referred_user_id.in.(${ids.join(",")})`
  );
  removed.referrals = await safeDeleteOr(
    "referrals",
    `referrer_id.in.(${ids.join(",")}),referred_user_id.in.(${ids.join(",")})`
  );
  removed.user_notifications = await safeDeleteIn("user_notifications", "user_id", ids);

  removed.return_requests = await safeDeleteIn("return_requests", "user_id", ids);
  removed.inventory_reservations = await safeDeleteIn("inventory_reservations", "user_id", ids);
  removed.abandoned_cart_reminders = await safeDeleteIn("abandoned_cart_reminders", "user_id", ids);
  removed.refund_payout_accounts = await safeDeleteIn("refund_payout_accounts", "user_id", ids);
  removed.product_reviews = await safeDeleteIn("product_reviews", "user_id", ids);
  removed.user_behavior_events = await safeDeleteIn("user_behavior_events", "user_id", ids);
  removed.payment_risk_events = await safeDeleteIn("payment_risk_events", "user_id", ids);
  removed.social_submissions = await safeDeleteIn("social_submissions", "user_id", ids);
  removed.creator_referral_clicks = await safeDeleteIn("creator_referral_clicks", "user_id", ids);
  removed.creator_payouts = await safeDeleteIn("creator_payouts", "user_id", ids);
  removed.drop_access_requests = await safeDeleteIn("drop_access_requests", "user_id", ids);
  removed.drop_tokens = await safeDeleteIn("drop_tokens", "user_id", ids);
  removed.drop_credits = await safeDeleteIn("drop_credits", "user_id", ids);
  removed.cart_reservations = await safeDeleteIn("cart_reservations", "user_id", ids);
  removed.elite_progress = await safeDeleteIn("elite_progress", "user_id", ids);
  removed.royal_access_passes = await safeDeleteIn("royal_access_passes", "user_id", ids);
  removed.shipping_addresses = await safeDeleteIn("shipping_addresses", "user_id", ids);
  removed.carts = await safeDeleteIn("carts", "user_id", ids);
  removed.wishlists = await safeDeleteIn("wishlists", "user_id", ids);
  removed.orders = await safeDeleteIn("orders", "user_id", ids);
  removed.admin_permissions = await safeDeleteIn("admin_permissions", "admin_id", ids);

  removed.users = await safeDeleteIn("users", "id", ids);

  let authDeleted = 0;
  for (const id of ids) {
    const { error } = await adminClient.auth.admin.deleteUser(id);
    if (!error) authDeleted += 1;
  }
  removed.auth_users = authDeleted;

  const qaProducts = await adminClient
    .from("products")
    .select("id")
    .ilike("slug", "qa-product-%");
  if (qaProducts.error) throw qaProducts.error;
  const productIds = (qaProducts.data ?? []).map((p) => p.id);
  if (productIds.length) {
    removed.qa_products = await safeDeleteIn("products", "id", productIds);
  } else {
    removed.qa_products = 0;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        removed,
        users: users.map((u) => u.email),
      },
      null,
      2
    )
  );
};

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : typeof error === "object" && error !== null
            ? error
            : { message: String(error) },
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
