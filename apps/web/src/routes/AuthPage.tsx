import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { referralApi } from "@/lib/apiClient";
import { appEnv, hasSupabaseConfig } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { fetchSiteSectionsByLocation } from "@/services/siteSections";
import type { SiteSection } from "@/types/domain";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const alignClass: Record<string, string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

const renderMedia = (section: SiteSection, className: string) => {
  if (!section.media_url) return <div className={`absolute inset-0 ${className}`} />;
  if (section.media_type === "video") {
    return <video src={section.media_url} className={className} autoPlay muted loop playsInline />;
  }
  return <img src={section.media_url} alt={section.title ?? section.section_key} loading="lazy" className={className} />;
};

const authFallback: Record<"signin" | "signup", { title: string; subtitle: string; description: string; media: string }> = {
  signin: {
    title: "Welcome Back",
    subtitle: "ZARELON Account",
    description: "Secure authentication, order tracking, wishlist sync, and faster checkout.",
    media: "/homepage/hero-right.svg",
  },
  signup: {
    title: "Create Your Account",
    subtitle: "Join ZARELON",
    description: "Create your account to unlock personalized collections and faster checkout.",
    media: "/homepage/hero-left.svg",
  },
};

export const AuthPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);
  const [googleScriptReady, setGoogleScriptReady] = useState(false);
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";
  // Prefer configured canonical site URL for stable OAuth callback domain.
  const baseSiteUrl = (appEnv.publicSiteUrl || browserOrigin || "").replace(/\/+$/, "");
  const authRedirectUrl = `${baseSiteUrl}/auth`;
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  const sectionsQuery = useQuery({
    queryKey: ["site-sections-auth"],
    queryFn: () => fetchSiteSectionsByLocation("auth"),
    retry: 1,
  });

  const authSections = sectionsQuery.data ?? [];
  const signinBg = authSections.find((section) => section.section_key === "signin_bg");
  const signupBg = authSections.find((section) => section.section_key === "signup_bg");
  const signinCopy = authSections.find((section) => section.section_key === "signin_copy");
  const signupCopy = authSections.find((section) => section.section_key === "signup_copy");
  const activeAuthSection = mode === "signin" ? signinBg : signupBg;
  const activeCopySection = mode === "signin" ? signinCopy : signupCopy;
  const panelTextColor = activeAuthSection?.text_color ?? "#F8F5F2";
  const panelAlign = alignClass[activeAuthSection?.text_alignment ?? "left"] ?? alignClass.left;
  const panelOverlayOpacity = Math.max(0, Math.min(1, activeAuthSection?.overlay_opacity ?? 0.38));
  const panelFallback = authFallback[mode];
  const panelTitle = activeCopySection?.title || activeAuthSection?.title || panelFallback.title;
  const panelSubtitle = activeCopySection?.subtitle || activeAuthSection?.subtitle || panelFallback.subtitle;
  const panelDescription = activeCopySection?.description || activeAuthSection?.description || panelFallback.description;
  const panelMedia = activeAuthSection?.media_url || activeCopySection?.media_url || panelFallback.media;
  const panelButtonText = activeAuthSection?.button_text || activeCopySection?.button_text || "";
  const panelButtonLink = activeAuthSection?.button_link || activeCopySection?.button_link || "/products";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref")?.trim().toUpperCase();
    if (!ref) return;
    const existing = localStorage.getItem("zarelon_creator_ref_code")?.trim().toUpperCase();
    if (existing !== ref) localStorage.setItem("zarelon_creator_ref_code", ref);
    setReferralCode((prev) => (prev ? prev : ref));
  }, [location.search]);

  useEffect(() => {
    console.info("[route] Rendering AuthPage route (/auth or /register)");
    if (!signinBg) console.warn("[site_sections] missing section_key: signin_bg");
    if (!signupBg) console.warn("[site_sections] missing section_key: signup_bg");
  }, [signinBg, signupBg]);

  useEffect(() => {
    if (!appEnv.googleClientId || typeof window === "undefined") return;
    if (window.google?.accounts?.id) {
      setGoogleScriptReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleScriptReady(true);
    script.onerror = () => setGoogleScriptReady(false);
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  const signInWithGoogleDirect = async () => {
    if (!appEnv.googleClientId) return false;
    if (!window.google?.accounts?.id) return false;
    try {
      const credential = await new Promise<string | null>((resolve) => {
        window.google?.accounts.id.initialize({
          client_id: appEnv.googleClientId as string,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (response) => resolve(response?.credential ?? null),
        });
        window.google?.accounts.id.prompt();
        setTimeout(() => resolve(null), 12000);
      });

      if (!credential) return false;
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: credential,
      });
      if (error) throw error;
      window.location.replace("/");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Google direct sign-in failed.";
      setMessage(errorMessage);
      return false;
    }
  };

  if (user) {
    return (
      <div className="rounded-2xl bg-white p-6 text-[#111]">
        <p className="text-sm">You are signed in as <strong>{user.email}</strong>.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            className="!rounded-xl !bg-black !px-4 !py-2 !text-sm !text-white hover:!bg-black/90"
            onClick={() => navigate("/profile")}
          >
            Continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="!rounded-xl !border-black/30 !px-4 !py-2 !text-sm !text-black hover:!bg-black/5"
            disabled={isSwitchingAccount}
            onClick={async () => {
              setIsSwitchingAccount(true);
              try {
                await supabase.auth.signOut({ scope: "global" });
              } catch {
                await supabase.auth.signOut({ scope: "local" });
              } finally {
                Object.keys(localStorage).forEach((key) => {
                  if (key.startsWith("sb-")) localStorage.removeItem(key);
                });
                Object.keys(sessionStorage).forEach((key) => {
                  if (key.startsWith("sb-")) sessionStorage.removeItem(key);
                });
                setIsSwitchingAccount(false);
                window.location.replace("/auth");
              }
            }}
          >
            {isSwitchingAccount ? "Switching..." : "Use Different Account"}
          </Button>
        </div>
      </div>
    );
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (!hasSupabaseConfig) {
      setMessage("Auth is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      return;
    }

    if (mode === "signup" && !strongPasswordRegex.test(password)) {
      setMessage("Password must be at least 8 chars with uppercase, lowercase, and number.");
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setMessage("Password and confirm password do not match.");
      return;
    }
    if (mode === "signup" && referralCode.trim()) {
      try {
        await referralApi.validateCode(referralCode.trim().toUpperCase());
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Invalid referral code");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const action =
        mode === "signin"
          ? supabase.auth.signInWithPassword({ email, password })
          : supabase.auth.signUp({
              email,
              password,
              options: {
                emailRedirectTo: authRedirectUrl,
                data: {
                  name: name.trim(),
                  referral_code_input: referralCode.trim().toUpperCase() || undefined,
                },
              },
            });

      const { data, error } = await action;
      if (error) {
        setMessage(error.message);
        return;
      }

      if (mode === "signin" && data?.user && !data.user.email_confirmed_at) {
        await supabase.auth.signOut();
        setMessage("Email verification is required before sign-in.");
        return;
      }

      setMessage(mode === "signup" ? "Account created. Verify your email to continue." : "Signed in.");
      if (mode === "signup") {
        setName("");
        setConfirmPassword("");
        setReferralCode("");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Network/auth request failed.";
      setMessage(`Auth failed: ${errorMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="-mx-5 bg-white px-5 py-10 text-[#111] md:-mx-8 md:px-8 md:py-14">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-black/10 shadow-[0_24px_60px_rgba(0,0,0,0.08)] md:grid-cols-2">
        <aside className="relative hidden bg-[#111] p-10 text-white md:block">
          {activeAuthSection ? (
            renderMedia(activeAuthSection, "absolute inset-0 h-full w-full object-cover")
          ) : (
            <img src={panelMedia} alt={panelTitle} className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: `rgba(0,0,0,${panelOverlayOpacity})` }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(212,175,55,0.18),transparent_40%)]" />
          <div className={`relative flex h-full flex-col justify-end gap-4 ${panelAlign}`}>
            <p className="text-xs uppercase tracking-[0.3em]" style={{ color: panelTextColor }}>
              {panelSubtitle}
            </p>
            <h1 className="mt-4 font-heading text-5xl leading-[0.95]">
              <span style={{ color: panelTextColor }}>
                {panelTitle}
              </span>
            </h1>
            <p className="mt-4 max-w-sm text-sm" style={{ color: panelTextColor }}>
              {panelDescription}
            </p>
            {panelButtonText ? (
              <a
                href={panelButtonLink}
                className="mt-2 inline-flex rounded-full border border-white/30 px-5 py-2 text-sm text-white transition hover:border-[#D4AF37] hover:text-[#D4AF37]"
              >
                {panelButtonText}
              </a>
            ) : null}
          </div>
        </aside>

        <div className="bg-white p-6 md:p-10">
          <p className="text-xs uppercase tracking-[0.25em] text-black/55">
            {mode === "signin" ? "Sign In" : "Register"}
          </p>
          <h2 className="mt-2 font-heading text-4xl text-[#111]">
            {mode === "signin" ? "Access Account" : "Create Account"}
          </h2>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode === "signup" ? (
              <label className="block">
                <span className="mb-1 block text-sm text-black/80">Full Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Enter full name"
                  className="w-full rounded-xl border border-black/20 bg-white px-3 py-2.5 text-sm text-[#111] outline-none focus:border-black"
                  required
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-sm text-black/80">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-black/20 bg-white px-3 py-2.5 text-sm text-[#111] outline-none focus:border-black"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm text-black/80">Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                className="w-full rounded-xl border border-black/20 bg-white px-3 py-2.5 text-sm text-[#111] outline-none focus:border-black"
                required
              />
            </label>

            {mode === "signup" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-sm text-black/80">Confirm Password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Re-enter password"
                    className="w-full rounded-xl border border-black/20 bg-white px-3 py-2.5 text-sm text-[#111] outline-none focus:border-black"
                    required
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm text-black/80">Referral Code (Optional)</span>
                  <input
                    value={referralCode}
                    onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
                    placeholder="AUR-XXXXXX"
                    className="w-full rounded-xl border border-black/20 bg-white px-3 py-2.5 text-sm text-[#111] outline-none focus:border-black"
                  />
                </label>
                <p className="text-xs text-black/60">
                  Use at least 8 characters with uppercase, lowercase, and a number.
                </p>
              </>
            ) : null}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full !rounded-xl !bg-black !py-2.5 !text-sm !text-white hover:!bg-black/90"
            >
              {isSubmitting ? "Please wait..." : mode === "signin" ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <button
            className="mt-4 text-sm text-black/70 underline underline-offset-4 hover:text-black"
            onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
          >
            {mode === "signin" ? "Need an account? Register" : "Already registered? Sign in"}
          </button>

          <Button
            variant="ghost"
            className="mt-4 w-full !rounded-xl !border-black/30 !py-2.5 !text-black hover:!bg-black/5"
            disabled={isSubmitting || !hasSupabaseConfig}
            onClick={async () => {
              setMessage("");
              setIsSubmitting(true);
              const host = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
              const isLocalHost = host === "localhost" || host === "127.0.0.1";
              try {
                // Try direct Google ID-token flow first (avoids mobile callback reachability issues).
                if (googleScriptReady && appEnv.googleClientId) {
                  const directOk = await signInWithGoogleDirect();
                  if (directOk) return;
                }

                // Fallback OAuth redirect flow.
                // Keep local signout lightweight to avoid stale sessions before redirect.
                await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
                const redirectTo = authRedirectUrl;

                const { data, error } = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: {
                    redirectTo,
                    skipBrowserRedirect: true,
                    queryParams: {
                      prompt: "select_account consent",
                      access_type: "offline",
                      include_granted_scopes: "false",
                    },
                  },
                });

                if (error) {
                  setMessage(
                    isLocalHost
                      ? error.message
                      : `${error.message}. If Google is blocked on your network, use Email/Password or switch network.`
                  );
                  return;
                }
                if (data?.url) {
                  const rawUrl = data.url;
                  const supabaseOrigin = (appEnv.supabaseUrl || "").replace(/\/+$/, "");
                  let resolvedUrl = rawUrl;
                  // Route OAuth start through same-origin proxy on production/mobile networks.
                  if (supabaseOrigin && rawUrl.startsWith(supabaseOrigin) && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
                    const remote = new URL(rawUrl);
                    resolvedUrl = `${window.location.origin}/supabase${remote.pathname}${remote.search}`;
                  }
                  window.location.assign(resolvedUrl);
                  return;
                }

                // Fallback if provider URL is not returned.
                const retry = await supabase.auth.signInWithOAuth({
                  provider: "google",
                  options: {
                    redirectTo,
                    queryParams: {
                      prompt: "select_account consent",
                      access_type: "offline",
                      include_granted_scopes: "false",
                    },
                  },
                });
                if (retry.error) {
                  setMessage(
                    isLocalHost
                      ? retry.error.message
                      : `${retry.error.message}. If Google is blocked on your network, use Email/Password or switch network.`
                  );
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Network/auth request failed.";
                setMessage(
                  isLocalHost
                    ? `Google sign-in failed: ${errorMessage}`
                    : `Google sign-in failed: ${errorMessage}. If Google is blocked on your network, use Email/Password or switch network.`
                );
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            Continue with Google
          </Button>

          {message ? <p className="mt-4 text-sm text-black/75">{message}</p> : null}
        </div>
      </div>
    </section>
  );
};
