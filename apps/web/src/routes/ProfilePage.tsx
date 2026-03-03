import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Link } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { eliteApi } from "@/lib/apiClient";
import { supabase } from "@/lib/supabase";
import type { RefundPayoutAccount } from "@/types/domain";

const titleCase = (value: string) =>
  value
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const profileGlassyButtonClass =
  "rounded-xl border border-[#d7c18a]/60 bg-gradient-to-br from-[#fff9ec] to-[#f4ead0] text-[#2a2110] shadow-[0_10px_24px_-16px_rgba(0,0,0,0.45)] backdrop-blur-md hover:border-[#c6a24b] hover:from-[#fff6e2] hover:to-[#f0e2bf]";

export const ProfilePage = () => {
  const { user, profile, refreshProfile } = useAuth();
  const role = profile?.role ?? "user";
  const isAdminProfile = role === "admin" || role === "super_admin";
  const queryClient = useQueryClient();
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  if (!user) return <div>Please sign in.</div>;

  const payoutQuery = useQuery({
    queryKey: ["refund-payout-account", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refund_payout_accounts")
        .select("id,user_id,account_holder_name,bank_account_number,bank_ifsc,bank_name,upi_id,created_at,updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error && !String(error.message ?? "").toLowerCase().includes("refund_payout_accounts")) throw error;
      return (data ?? null) as RefundPayoutAccount | null;
    },
  });

  const eliteQuery = useQuery({
    queryKey: ["elite-me", user.id],
    queryFn: eliteApi.getMyStatus,
    staleTime: 30_000,
  });

  useEffect(() => {
    const payout = payoutQuery.data;
    if (!payout) return;
    setAccountHolderName(payout.account_holder_name ?? "");
    setBankAccountNumber(payout.bank_account_number ?? "");
    setBankIfsc(payout.bank_ifsc ?? "");
    setBankName(payout.bank_name ?? "");
    setUpiId(payout.upi_id ?? "");
  }, [payoutQuery.data?.id]);

  const savePayoutMutation = useMutation({
    mutationFn: async () => {
      const hasBankFields = accountHolderName.trim() && bankAccountNumber.trim() && bankIfsc.trim();
      const hasUpi = upiId.trim();
      if (!hasBankFields && !hasUpi) {
        throw new Error("At least one payout method required: bank account or UPI.");
      }

      const payload = {
        user_id: user.id,
        account_holder_name: accountHolderName.trim() || null,
        bank_account_number: bankAccountNumber.trim() || null,
        bank_ifsc: bankIfsc.trim().toUpperCase() || null,
        bank_name: bankName.trim() || null,
        upi_id: upiId.trim().toLowerCase() || null,
      };
      const { error } = await supabase.from("refund_payout_accounts").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
    },
    onMutate: () => {
      setSaveMessage("");
      setSaveError("");
    },
    onSuccess: async () => {
      setSaveMessage("Refund payout details saved.");
      await queryClient.invalidateQueries({ queryKey: ["refund-payout-account", user.id] });
    },
    onError: (error) => {
      setSaveError((error as Error).message ?? "Could not save payout details.");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="premium-luxe-card rounded-3xl border border-[#d6bf89]/55 bg-[linear-gradient(145deg,#fffdf7,#f6ecd3)] p-6 text-[#111111] shadow-[0_22px_50px_-28px_rgba(0,0,0,0.45)]">
        <h2 className="font-heading text-2xl text-[#111111]">Quick Access</h2>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Link to="/orders" className="rounded-2xl border border-[#d6bf89]/55 bg-white/85 p-4 text-sm font-semibold text-[#1f1a12] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.55)] transition-all hover:-translate-y-0.5 hover:border-[#c6a24b] hover:bg-[#fff8e8]">
            Orders
          </Link>
          <Link to="/wishlist" className="rounded-2xl border border-[#d6bf89]/55 bg-white/85 p-4 text-sm font-semibold text-[#1f1a12] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.55)] transition-all hover:-translate-y-0.5 hover:border-[#c6a24b] hover:bg-[#fff8e8]">
            Wishlist
          </Link>
          <Link to="/earn-500-off" className="rounded-2xl border border-[#d6bf89]/55 bg-white/85 p-4 text-sm font-semibold text-[#1f1a12] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.55)] transition-all hover:-translate-y-0.5 hover:border-[#c6a24b] hover:bg-[#fff8e8]">
            Coupons
          </Link>
          <a
            href="mailto:support@zarelon.com?subject=ZARELON%20Support%20Request"
            className="rounded-2xl border border-[#d6bf89]/55 bg-white/85 p-4 text-sm font-semibold text-[#1f1a12] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.55)] transition-all hover:-translate-y-0.5 hover:border-[#c6a24b] hover:bg-[#fff8e8]"
          >
            Customer Support
          </a>
        </div>
      </div>

      <div className="premium-luxe-card rounded-3xl border border-[#d6bf89]/55 bg-[linear-gradient(145deg,#fffefb,#f6edd8)] p-6 text-[#111111] shadow-[0_22px_50px_-28px_rgba(0,0,0,0.45)]">
      <h1 className="mb-5 font-heading text-3xl text-[#111111]">Profile</h1>
      <div className="space-y-2 text-sm text-[#333333]">
        <p>Email: {profile?.email ?? user.email}</p>
        <p>Role: {role}</p>
        <p>Status: {profile?.is_blocked ? "Blocked" : "Active"}</p>
                {isAdminProfile ? (
          <p>
            Elite Tier:{" "}
            <span className="rounded-full border border-gold-300/40 bg-gold-400/10 px-2 py-0.5 text-gold-200">
              Royal Crown
            </span>{" "}
            | Valid Referrals: Bypassed (Admin)
          </p>
        ) : (
          <p>
            Elite Tier:{" "}
            <span className="rounded-full border border-gold-300/40 bg-gold-400/10 px-2 py-0.5 text-gold-200">
              {eliteQuery.data?.progress?.current_tier?.name ?? "Base"}
            </span>{" "}
            | Valid Referrals: {eliteQuery.data?.progress?.valid_referral_count ?? 0}
          </p>
        )}
      </div>
      {isAdminProfile ? (
        <div className="mt-4 rounded-xl border border-[#d4af37]/40 bg-[#fff8e8] p-3">
          <p className="text-xs uppercase tracking-[0.12em] text-[#8a6a00]">Admin Privilege</p>
          <p className="mt-1 text-sm text-[#222222]">Royal Crown unlocked without referral procedure.</p>
          <Link
            to="/royal"
            className="mt-3 inline-flex rounded-lg border border-black/20 px-3 py-1.5 text-sm font-semibold text-[#111111]"
          >
            Apply for Royal Access
          </Link>
        </div>
      ) : null}
      <Button
        variant="ghost"
        className={`mt-4 ${profileGlassyButtonClass}`}
        onClick={async () => {
          await supabase.from("users").update({ name: `ZARELON Member ${Date.now().toString().slice(-4)}` }).eq("id", user.id);
          await refreshProfile();
        }}
      >
        Refresh Profile Sync
      </Button>
      </div>
      <div className="premium-luxe-card rounded-3xl border border-[#d6bf89]/55 bg-[linear-gradient(145deg,#fffefb,#f6edd8)] p-6 text-[#111111] shadow-[0_22px_50px_-28px_rgba(0,0,0,0.45)]">
        <h2 className="font-heading text-2xl text-[#111111]">Refund Payout Details</h2>
        <p className="mt-1 text-xs text-[#666666]">
          Add bank account and one UPI. Refund requests will include these details for faster processing.
        </p>
        {saveMessage ? <p className="mt-3 text-xs text-emerald-300">{saveMessage}</p> : null}
        {saveError ? <p className="mt-3 text-xs text-rose-300">{saveError}</p> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input
            value={accountHolderName}
            onChange={(event) => setAccountHolderName(event.target.value)}
            placeholder="Account holder name"
            className="rounded-xl border border-[#d7c18a]/55 bg-white px-3 py-2 text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#c6a24b]"
          />
          <input
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            placeholder="Bank name"
            className="rounded-xl border border-[#d7c18a]/55 bg-white px-3 py-2 text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#c6a24b]"
          />
          <input
            value={bankAccountNumber}
            onChange={(event) => setBankAccountNumber(event.target.value)}
            placeholder="Bank account number"
            className="rounded-xl border border-[#d7c18a]/55 bg-white px-3 py-2 text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#c6a24b]"
          />
          <input
            value={bankIfsc}
            onChange={(event) => setBankIfsc(event.target.value)}
            placeholder="IFSC code"
            className="rounded-xl border border-[#d7c18a]/55 bg-white px-3 py-2 text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#c6a24b]"
          />
          <div className="md:col-span-2">
            <input
              value={upiId}
              onChange={(event) => setUpiId(event.target.value)}
              placeholder="UPI ID (example@bank)"
              className="w-full rounded-xl border border-[#d7c18a]/55 bg-white px-3 py-2 text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#c6a24b]"
            />
            {(upiId.trim() || accountHolderName.trim()) && (
              <div className="mt-2 rounded-lg border border-[#d4af37]/25 bg-[#fff8e8] p-3 text-xs text-[#555555]">
                <p>
                  Beneficiary Name:{" "}
                  <span className="text-gold-200">
                    {accountHolderName.trim() || titleCase((upiId.split("@")[0] ?? "").trim()) || "Not set"}
                  </span>
                </p>
                {upiId.includes("@") ? (
                  <p className="mt-1">
                    UPI Handle: <span className="text-gold-200">@{upiId.split("@")[1]?.trim() || "unknown"}</span>
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          className={`mt-4 ${profileGlassyButtonClass}`}
          onClick={() => savePayoutMutation.mutate()}
          disabled={savePayoutMutation.isPending || payoutQuery.isLoading}
        >
          {savePayoutMutation.isPending ? "Saving..." : "Save Payout Details"}
        </Button>
      </div>
    </div>
  );
};
