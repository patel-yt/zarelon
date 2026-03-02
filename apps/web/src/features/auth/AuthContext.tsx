import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isOwnerEmail } from "@/lib/admin";
import { referralApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import type { AdminPermissions, UserProfile } from "@/types/domain";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  permissions: AdminPermissions | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasPermission: (permission: keyof AdminPermissions) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const defaultPermissions: AdminPermissions = {
  can_manage_products: false,
  can_manage_orders: false,
  can_manage_users: false,
  can_refund: false,
  can_manage_festival: false,
  can_view_analytics: false,
};

const upsertProfile = async (user: User) => {
  try {
    await supabase.from("users").upsert({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? null,
    });
  } catch {
    // Best-effort sync only. Profile fetch continues even if upsert is denied by RLS.
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [permissions, setPermissions] = useState<AdminPermissions | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyReferralFromMetadata = useCallback(async (user: User) => {
    const rawCode = user.user_metadata?.referral_code_input;
    const metadataCode = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    const storedCode =
      typeof window !== "undefined"
        ? localStorage.getItem("zarelon_creator_ref_code")?.trim().toUpperCase() ?? ""
        : "";
    const referralCode = metadataCode || storedCode;
    if (!referralCode) return;
    const flagKey = `referral_applied:${user.id}:${referralCode}`;
    if (localStorage.getItem(flagKey) === "1") return;

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "na";
    const lang = typeof navigator !== "undefined" ? navigator.language : "na";
    const platform = typeof navigator !== "undefined" ? navigator.platform : "na";
    const fingerprint = `${ua}|${lang}|${platform}`.slice(0, 180);

    try {
      const result = await referralApi.applyCode({ referralCode, deviceFingerprint: fingerprint });
      if (result.applied || result.reason === "already_exists" || result.reason === "already_referred") {
        localStorage.setItem(flagKey, "1");
      }
    } catch {
      // Best-effort apply only. Do not mark applied on failure so next login can retry.
    }
  }, []);

  const resolveProfile = useCallback(async (user: User | null) => {
    if (!user) {
      setProfile(null);
      setPermissions(null);
      return;
    }
    const isOwner = isOwnerEmail(user.email);

    try {
      await upsertProfile(user);

      const { data } = await supabase
        .from("users")
        .select("id,name,email,role,is_blocked,access_tier,vip_level,referral_code,most_viewed_category,most_clicked_banner,recent_visits")
        .eq("id", user.id)
        .maybeSingle();

      const fallbackProfile = !data
        ? {
            id: user.id,
            name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "User",
            email: user.email ?? "",
            role: "user" as const,
            is_blocked: false,
            access_tier: "normal" as const,
            vip_level: "normal" as const,
            referral_code: null,
            most_viewed_category: null,
            most_clicked_banner: null,
            recent_visits: [],
          }
        : null;

      const rawProfile = data ?? fallbackProfile;
      const profileData =
        rawProfile && isOwner
          ? { ...rawProfile, role: "super_admin" as const, is_blocked: false }
          : rawProfile;
      setProfile(profileData ?? null);

      if (!profileData || profileData.role === "user") {
        setPermissions(null);
        return;
      }

      if (profileData.role === "super_admin" || isOwner) {
        setPermissions({
          can_manage_products: true,
          can_manage_orders: true,
          can_manage_users: true,
          can_refund: true,
          can_manage_festival: true,
          can_view_analytics: true,
        });
        return;
      }

      const { data: permissionData } = await supabase
        .from("admin_permissions")
        .select(
          "can_manage_products,can_manage_orders,can_manage_users,can_refund,can_manage_festival,can_view_analytics"
        )
        .eq("admin_id", user.id)
        .maybeSingle();

      if (permissionData) {
        setPermissions(permissionData);
        return;
      }

      if (profileData.role === "admin") {
        const bootstrapPermissions: AdminPermissions = {
          can_manage_products: true,
          can_manage_orders: true,
          can_manage_users: true,
          can_refund: true,
          can_manage_festival: true,
          can_view_analytics: true,
        };
        setPermissions(bootstrapPermissions);
        void supabase.from("admin_permissions").upsert({ admin_id: user.id, ...bootstrapPermissions }, { onConflict: "admin_id" });
        return;
      }

      // Fallback: resolve each permission through SECURITY DEFINER RPC.
      const keys = Object.keys(defaultPermissions) as Array<keyof AdminPermissions>;
      const rpcResults = await Promise.all(
        keys.map(async (key) => {
          const { data } = await supabase.rpc("check_admin_permission", { permission_name: key });
          return [key, Boolean(data)] as const;
        })
      );
      const resolved = rpcResults.reduce(
        (acc, [key, value]) => ({ ...acc, [key]: value }),
        defaultPermissions
      );
      setPermissions(resolved);
    } catch {
      // Never block app boot on profile sync failure.
      if (isOwner) {
        setProfile({
          id: user.id,
          name: user.user_metadata?.name ?? "Super Admin",
          email: user.email ?? "",
          role: "super_admin",
          is_blocked: false,
        });
        setPermissions({
          can_manage_products: true,
          can_manage_orders: true,
          can_manage_users: true,
          can_refund: true,
          can_manage_festival: true,
          can_view_analytics: true,
        });
      } else {
        setProfile(null);
        setPermissions(null);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await resolveProfile(session?.user ?? null);
  }, [resolveProfile, session?.user?.id]);

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return;
        const currentSession = data.session ?? null;
        const currentUser = currentSession?.user ?? null;
        setSession(currentSession);
        if (currentUser) {
          await upsertProfile(currentUser);
          await applyReferralFromMetadata(currentUser);
        }
        await resolveProfile(currentUser);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!active) return;
      setSession(currentSession);
      setIsLoading(true);

      void (async () => {
        const currentUser = currentSession?.user ?? null;
        if (currentUser) {
          await upsertProfile(currentUser);
          await applyReferralFromMetadata(currentUser);
        }
        await resolveProfile(currentUser);
      })().finally(() => {
        if (active) setIsLoading(false);
      });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [applyReferralFromMetadata, resolveProfile]);

  useEffect(() => {
    const onFocus = () => {
      void refreshProfile();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      permissions,
      isLoading,
      signOut: async () => {
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          // Ignore network/auth errors and force local logout state.
        } finally {
          setSession(null);
          setProfile(null);
          setPermissions(null);
          setIsLoading(false);
        }
      },
      refreshProfile,
      hasPermission: (permission) => {
        const currentUser = session?.user;
        if (isOwnerEmail(currentUser?.email)) return true;
        if (profile?.role === "super_admin") return true;
        return Boolean(permissions?.[permission]);
      },
    }),
    [session, profile, permissions, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
};
