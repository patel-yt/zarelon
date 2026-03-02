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

const required = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VITE_PUBLIC_SITE_URL",
];
for (const key of required) {
  if (!env[key] || !String(env[key]).trim()) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const baseUrl = String(env.VITE_PUBLIC_SITE_URL).trim().replace(/\/$/, "");
const supabaseUrl = String(env.VITE_SUPABASE_URL).trim();
const anonKey = String(env.VITE_SUPABASE_ANON_KEY).trim();
const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY).trim();

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mkAuthedClient = () =>
  createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const api = async (method, route, token, body) => {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload };
};

const assertOk = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const createAuthUser = async ({ email, password, name }) => {
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error || !data.user) throw error ?? new Error(`Could not create auth user ${email}`);
  return data.user.id;
};

const signIn = async ({ email, password }) => {
  const client = mkAuthedClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`Could not sign in ${email}`);
  return data.session.access_token;
};

const randomTag = Date.now().toString(36);
const password = `QaPass!${Date.now()}Aa1`;
const referrerEmail = `qa.referrer.${randomTag}@example.com`;
const referredEmail = `qa.referred.${randomTag}@example.com`;
const adminEmail = `qa.admin.${randomTag}@example.com`;

const run = async () => {
  const result = {
    createdUsers: {},
    referral: {},
    reminder: {},
    codOrder: {},
    adminChecks: {},
  };

  const referrerId = await createAuthUser({ email: referrerEmail, password, name: "QA Referrer" });
  const referredId = await createAuthUser({ email: referredEmail, password, name: "QA Referred" });
  const adminId = await createAuthUser({ email: adminEmail, password, name: "QA Admin" });
  result.createdUsers = { referrerId, referredId, adminId };

  const roleUp = await adminClient.from("users").update({ role: "admin" }).eq("id", adminId);
  if (roleUp.error) throw roleUp.error;
  const permUp = await adminClient.from("admin_permissions").upsert(
    {
      admin_id: adminId,
      can_manage_products: true,
      can_manage_orders: true,
      can_manage_users: true,
      can_refund: true,
      can_manage_festival: true,
      can_view_analytics: true,
    },
    { onConflict: "admin_id" }
  );
  if (permUp.error) throw permUp.error;

  const referrerToken = await signIn({ email: referrerEmail, password });
  const referredToken = await signIn({ email: referredEmail, password });
  const adminToken = await signIn({ email: adminEmail, password });

  const refProfile = await adminClient
    .from("users")
    .select("id, referral_code")
    .eq("id", referrerId)
    .single();
  if (refProfile.error || !refProfile.data) throw refProfile.error ?? new Error("Referrer profile missing");

  let referralCode = refProfile.data.referral_code;
  if (!referralCode) {
    const gen = await adminClient.rpc("generate_referral_code");
    if (gen.error || !gen.data) throw gen.error ?? new Error("Could not generate referral code");
    referralCode = String(gen.data);
    const up = await adminClient.from("users").update({ referral_code: referralCode }).eq("id", referrerId);
    if (up.error) throw up.error;
  }
  result.referral.referralCode = referralCode;

  const validate = await api("POST", "/api/referrals/validate", null, { referral_code: referralCode });
  assertOk(validate.status === 200 && validate.payload?.ok === true, "Referral validate failed");
  result.referral.validateStatus = validate.status;

  const apply = await api("POST", "/api/referrals/apply", referredToken, { referral_code: referralCode });
  assertOk(apply.status === 200 && apply.payload?.ok === true, "Referral apply failed");
  result.referral.applyStatus = apply.status;
  result.referral.applyPayload = apply.payload;

  const creatorDash = await api("GET", "/api/creator/dashboard", referrerToken);
  assertOk(creatorDash.status === 200 && creatorDash.payload?.ok === true, "Creator dashboard failed");
  const referralRow = (creatorDash.payload?.creator?.referrals ?? []).find((r) => r.referred_user_id === referredId);
  assertOk(Boolean(referralRow?.id), "Referred user not visible in creator dashboard");
  result.referral.creatorDashboardStatus = creatorDash.status;
  result.referral.referralId = referralRow.id;

  const remind = await api("POST", "/api/referrals/remind", referrerToken, { referral_id: referralRow.id });
  assertOk(remind.status === 200 && remind.payload?.ok === true, "Referral remind failed");
  result.reminder.status = remind.status;

  const notification = await adminClient
    .from("user_notifications")
    .select("id,title,message,created_at")
    .eq("user_id", referredId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertOk(!notification.error && Boolean(notification.data?.id), "Notification not created for referred user");
  result.reminder.notification = {
    title: notification.data.title,
    created_at: notification.data.created_at,
  };

  const productInsert = await adminClient
    .from("products")
    .insert({
      slug: `qa-product-${randomTag}`,
      title: `QA Product ${randomTag}`,
      description: "QA smoke product",
      price_inr: 1199,
      discount_percent: 0,
      category: "qa",
      stock: 10,
      active: true,
      featured: false,
      requires_shipping: true,
      requires_cod: true,
      return_allowed: true,
      exchange_allowed: true,
      return_window_days: 7,
      gender: "unisex",
      show_on_home: false,
      show_on_new_in: false,
      show_on_collection: false,
    })
    .select("id")
    .single();
  if (productInsert.error || !productInsert.data) throw productInsert.error ?? new Error("Product insert failed");
  const productId = productInsert.data.id;

  const existingCart = await adminClient.from("carts").select("id").eq("user_id", referredId).maybeSingle();
  if (existingCart.error) throw existingCart.error;
  let cartId = existingCart.data?.id ?? null;
  if (!cartId) {
    const cartInsert = await adminClient.from("carts").insert({ user_id: referredId }).select("id").single();
    if (cartInsert.error || !cartInsert.data) throw cartInsert.error ?? new Error("Cart insert failed");
    cartId = cartInsert.data.id;
  }

  const clearCart = await adminClient.from("cart_items").delete().eq("cart_id", cartId);
  if (clearCart.error) throw clearCart.error;
  const cartItemInsert = await adminClient
    .from("cart_items")
    .insert({ cart_id: cartId, product_id: productId, quantity: 1 });
  if (cartItemInsert.error) throw cartItemInsert.error;

  const addressInsert = await adminClient
    .from("shipping_addresses")
    .insert({
      user_id: referredId,
      label: "Home",
      full_name: "QA Referred",
      phone: "9999999999",
      line1: "QA Street 1",
      city: "Mumbai",
      state: "Maharashtra",
      postal_code: "400001",
      country: "India",
      is_default: true,
    })
    .select("id")
    .single();
  if (addressInsert.error || !addressInsert.data) throw addressInsert.error ?? new Error("Address insert failed");
  const addressId = addressInsert.data.id;

  const cod = await api("POST", "/api/orders/cod", referredToken, { cartId, addressId });
  assertOk(cod.status === 200 && cod.payload?.success === true, "COD order flow failed");
  result.codOrder = { status: cod.status, orderId: cod.payload.orderId };

  const adminReferrals = await api("GET", "/api/admin/referrals?period=7d", adminToken);
  assertOk(adminReferrals.status === 200, "Admin referrals API failed");
  result.adminChecks.referralsStatus = adminReferrals.status;

  const adminCreator = await api("GET", "/api/admin/creator-analytics?period=7d", adminToken);
  assertOk(adminCreator.status === 200, "Admin creator analytics API failed");
  result.adminChecks.creatorAnalyticsStatus = adminCreator.status;

  console.log(JSON.stringify({ ok: true, result }, null, 2));
};

run().catch((error) => {
  const normalized =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : typeof error === "object" && error !== null
      ? error
      : { message: String(error) };
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: normalized,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
