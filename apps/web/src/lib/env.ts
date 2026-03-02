interface EnvShape {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_GOOGLE_CLIENT_ID?: string;
  VITE_FLAT_SHIPPING_INR?: string;
  VITE_API_BASE_URL?: string;
  VITE_PUBLIC_SITE_URL?: string;
}

const env = import.meta.env as unknown as EnvShape;
const clean = (value?: string) => (typeof value === "string" ? value.trim() : "");
const normalizeApiBaseUrl = (value?: string) => {
  const raw = clean(value).replace(/\/+$/, "");
  if (!raw) return "";
  if (import.meta.env.DEV) return raw;
  // Safety: never use localhost API base on production builds.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(raw)) return "";
  return raw;
};

export const appEnv = {
  supabaseUrl: clean(env.VITE_SUPABASE_URL),
  supabaseAnonKey: clean(env.VITE_SUPABASE_ANON_KEY),
  googleClientId: clean(env.VITE_GOOGLE_CLIENT_ID),
  flatShippingInr: Number(env.VITE_FLAT_SHIPPING_INR ?? 9900),
  apiBaseUrl: normalizeApiBaseUrl(env.VITE_API_BASE_URL),
  publicSiteUrl: clean(env.VITE_PUBLIC_SITE_URL),
};

export const hasSupabaseConfig = Boolean(appEnv.supabaseUrl && appEnv.supabaseAnonKey);
