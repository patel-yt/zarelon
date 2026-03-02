import { supabase } from "@/lib/supabase";

// Keep a single Supabase client instance app-wide.
export const publicSupabase = supabase;
