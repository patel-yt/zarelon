import { supabase } from "@/lib/supabase";

export type SocialCampaign = {
  id: string;
  name: string;
  discount_amount: number;
  min_followers: number;
  min_views: number;
  min_days_live: number;
  required_hashtags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const fetchActiveSocialCampaign = async (): Promise<SocialCampaign | null> => {
  const { data, error } = await supabase
    .from("social_campaigns")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[social_rewards] failed to fetch active campaign", error.message);
    return null;
  }
  if (!data) return null;
  return {
    ...data,
    required_hashtags: Array.isArray(data.required_hashtags)
      ? data.required_hashtags.map((v: unknown) => String(v))
      : [],
  } as SocialCampaign;
};
