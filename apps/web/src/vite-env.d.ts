/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
    readonly VITE_GOOGLE_CLIENT_ID?: string;
    readonly VITE_RAZORPAY_KEY_ID: string;
    readonly VITE_FLAT_SHIPPING_INR?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
