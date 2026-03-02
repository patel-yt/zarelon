import { createClient } from "@supabase/supabase-js";
import { appEnv } from "./env";

const resolveBrowserSupabaseUrl = () => {
  if (typeof window === "undefined") return appEnv.supabaseUrl;
  const host = window.location.hostname.toLowerCase();
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  // Production/preview: route Supabase traffic via same-origin proxy to avoid ISP DNS blocking issues.
  if (!isLocalHost) return `${window.location.origin}/supabase`;
  return appEnv.supabaseUrl;
};

const safeSupabaseUrl = resolveBrowserSupabaseUrl() || "https://placeholder.supabase.co";
const safeSupabaseAnonKey = appEnv.supabaseAnonKey || "public-anon-key";

export const supabase = createClient(safeSupabaseUrl, safeSupabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
