import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { discountCodeApi, eliteApi, referralApi } from "@/lib/apiClient";

type Period = "today" | "7d" | "1m" | "custom";

export const AdminReferralPage = () => {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [manualTierSelection, setManualTierSelection] = useState<Record<string, string>>({});
  const [discountForm, setDiscountForm] = useState({
    code: "",
    title: "",
    discount_type: "percentage" as "percentage" | "fixed",
    discount_value: "10",
    min_order_inr: "0",
    max_discount_inr: "",
    total_usage_limit: "",
    per_user_limit: "1",
    active: true,
  });

  const params = useMemo(
    () => ({
      period,
      from: period === "custom" ? fromDate : undefined,
      to: period === "custom" ? toDate : undefined,
    }),
    [period, fromDate, toDate]
  );

  const overviewQuery = useQuery({
    queryKey: ["admin-referrals", params.period, params.from, params.to],
    queryFn: () => referralApi.getAdminOverview(params),
  });
  const eliteOverviewQuery = useQuery({
    queryKey: ["admin-elite", params.period, params.from, params.to],
    queryFn: () =>
      eliteApi.getAdminOverview({
        period: params.period === "1m" ? "30d" : (params.period as "today" | "7d" | "30d" | "custom"),
        from: params.from,
        to: params.to,
      }),
  });
  const discountCodesQuery = useQuery({
    queryKey: ["admin-discount-codes"],
    queryFn: discountCodeApi.listAdmin,
  });

  const cfg = overviewQuery.data?.config;
  const [minPurchaseAmount, setMinPurchaseAmount] = useState("1000");
  const [referrerReward, setReferrerReward] = useState("200");
  const [friendReward, setFriendReward] = useState("150");
  const [active, setActive] = useState(true);
  const [ambassadorEnabled, setAmbassadorEnabled] = useState(true);
  const [paidAmbassadorEnabled, setPaidAmbassadorEnabled] = useState(false);
  const [referralProgramEnabled, setReferralProgramEnabled] = useState(true);
  const [royalAccessPrice, setRoyalAccessPrice] = useState("399");
  const [earlyAccessLockHours, setEarlyAccessLockHours] = useState<"24" | "48" | "72">("72");
  const [royalCrownEnabled, setRoyalCrownEnabled] = useState(true);
  const [royalAccessEnabled, setRoyalAccessEnabled] = useState(true);
  const [creatorProgramEnabled, setCreatorProgramEnabled] = useState(true);
  const [leaderboardEnabled, setLeaderboardEnabled] = useState(true);
  const [vaultEnabled, setVaultEnabled] = useState(true);
  const [earlyDropEnabled, setEarlyDropEnabled] = useState(true);
  const [priorityCheckoutEnabled, setPriorityCheckoutEnabled] = useState(true);
  const [contentBlocks, setContentBlocks] = useState<Array<{ key: string; title: string; description: string; is_enabled: boolean }>>([]);

  const seededFromServer = useMemo(() => {
    if (!cfg) return false;
    setMinPurchaseAmount(String(cfg.min_purchase_amount));
    setReferrerReward(String(cfg.referrer_reward));
    setFriendReward(String(cfg.friend_reward));
    setActive(Boolean(cfg.is_active));
    setAmbassadorEnabled(Boolean(overviewQuery.data?.settings?.ambassador_program_enabled ?? true));
    setPaidAmbassadorEnabled(Boolean(overviewQuery.data?.settings?.paid_ambassador_enabled ?? false));
    setReferralProgramEnabled(Boolean(overviewQuery.data?.settings?.referral_program_enabled ?? true));
    setRoyalAccessPrice(String(overviewQuery.data?.settings?.royal_access_price_inr ?? 399));
    setEarlyAccessLockHours(String(overviewQuery.data?.settings?.early_access_lock_hours ?? 72) as "24" | "48" | "72");
    setRoyalCrownEnabled(Boolean(overviewQuery.data?.feature_flags?.royal_crown_enabled ?? true));
    setRoyalAccessEnabled(Boolean(overviewQuery.data?.feature_flags?.royal_access_enabled ?? true));
    setCreatorProgramEnabled(Boolean(overviewQuery.data?.feature_flags?.creator_program_enabled ?? true));
    setLeaderboardEnabled(Boolean(overviewQuery.data?.feature_flags?.leaderboard_enabled ?? true));
    setVaultEnabled(Boolean(overviewQuery.data?.feature_flags?.vault_enabled ?? true));
    setEarlyDropEnabled(Boolean(overviewQuery.data?.feature_flags?.early_drop_enabled ?? true));
    setPriorityCheckoutEnabled(Boolean(overviewQuery.data?.feature_flags?.priority_checkout_enabled ?? true));
    setContentBlocks(
      (overviewQuery.data?.content_blocks ?? []).map((block) => ({
        key: block.key,
        title: String(block.title ?? ""),
        description: String(block.description ?? ""),
        is_enabled: Boolean(block.is_enabled),
      }))
    );
    return true;
  }, [cfg?.id, overviewQuery.data?.settings, overviewQuery.data?.feature_flags, overviewQuery.data?.content_blocks]);
  void seededFromServer;

  const updateMutation = useMutation({
    mutationFn: () =>
      referralApi.updateConfig({
        min_purchase_amount: Number(minPurchaseAmount || 1000),
        referrer_reward: Number(referrerReward || 200),
        friend_reward: Number(friendReward || 150),
        is_active: active,
        ambassador_program_enabled: ambassadorEnabled,
        paid_ambassador_enabled: paidAmbassadorEnabled,
        referral_program_enabled: referralProgramEnabled,
        royal_access_price_inr: Number(royalAccessPrice || 399),
        early_access_lock_hours: Number(earlyAccessLockHours) as 24 | 48 | 72,
        flags: {
          ambassador_program_enabled: ambassadorEnabled,
          royal_crown_enabled: royalCrownEnabled,
          royal_access_enabled: royalAccessEnabled,
          creator_program_enabled: creatorProgramEnabled,
          leaderboard_enabled: leaderboardEnabled,
          vault_enabled: vaultEnabled,
          early_drop_enabled: earlyDropEnabled,
          priority_checkout_enabled: priorityCheckoutEnabled,
        },
        blocks: contentBlocks.map((block) => ({
          key: block.key,
          title: block.title,
          description: block.description,
          is_enabled: block.is_enabled,
        })),
      }),
    onSuccess: () => {
      setMessage("Referral config updated.");
      void queryClient.invalidateQueries({ queryKey: ["admin-referrals"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Update failed"),
  });
  const updateTierMutation = useMutation({
    mutationFn: (input: { id: string; required_valid_referrals: number; is_active: boolean }) => eliteApi.updateTier(input),
    onSuccess: async () => {
      setMessage("Elite tier updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin-elite"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Tier update failed"),
  });

  const userTierMutation = useMutation({
    mutationFn: (input: {
      user_id: string;
      current_tier_id?: string | null;
      highest_tier_id?: string | null;
      valid_referral_count?: number;
      tier_locked?: boolean;
      permanent_royal_crown?: boolean;
    }) => eliteApi.setUserProgress(input),
    onSuccess: async () => {
      setMessage("User elite status updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin-elite"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "User update failed"),
  });

  const createDiscountMutation = useMutation({
    mutationFn: () =>
      discountCodeApi.createAdmin({
        code: discountForm.code,
        title: discountForm.title || undefined,
        discount_type: discountForm.discount_type,
        discount_value: Number(discountForm.discount_value || 0),
        min_order_inr: Number(discountForm.min_order_inr || 0),
        max_discount_inr: discountForm.max_discount_inr ? Number(discountForm.max_discount_inr) : null,
        total_usage_limit: discountForm.total_usage_limit ? Number(discountForm.total_usage_limit) : null,
        per_user_limit: Number(discountForm.per_user_limit || 1),
        active: discountForm.active,
      }),
    onSuccess: async () => {
      setMessage("Discount code created.");
      setDiscountForm({
        code: "",
        title: "",
        discount_type: "percentage",
        discount_value: "10",
        min_order_inr: "0",
        max_discount_inr: "",
        total_usage_limit: "",
        per_user_limit: "1",
        active: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-discount-codes"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Could not create discount code"),
  });

  const toggleDiscountMutation = useMutation({
    mutationFn: (input: { id: string; active: boolean }) => discountCodeApi.setActiveAdmin(input.id, input.active),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-discount-codes"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Could not update discount code"),
  });

  return (
    <section className="space-y-5 text-[#111111]">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-[#555555]">Referral Cashback Engine</p>
        <h1 className="mt-2 text-2xl font-semibold">Referral Dashboard</h1>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-xs text-[#666666]">Total referrals</p>
          <p className="mt-2 text-2xl font-semibold">{overviewQuery.data?.metrics.total_referrals ?? 0}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-xs text-[#666666]">Successful conversions</p>
          <p className="mt-2 text-2xl font-semibold">{overviewQuery.data?.metrics.successful_conversions ?? 0}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-xs text-[#666666]">Total rewards given</p>
          <p className="mt-2 text-2xl font-semibold">{overviewQuery.data?.metrics.total_rewards_given ?? 0}</p>
        </div>
      </div>

      {overviewQuery.error ? (
        <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
          Referral dashboard data load failed: {overviewQuery.error instanceof Error ? overviewQuery.error.message : "Unknown error"}
        </p>
      ) : null}
      {eliteOverviewQuery.error ? (
        <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
          Elite dashboard data load failed: {eliteOverviewQuery.error instanceof Error ? eliteOverviewQuery.error.message : "Unknown error"}
        </p>
      ) : null}

      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs text-[#555555]">
            Filter
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="today">Today</option>
              <option value="7d">7 days</option>
              <option value="1m">1 month</option>
              <option value="custom">Custom date</option>
            </select>
          </label>
          {period === "custom" ? (
            <>
              <label className="grid gap-1 text-xs text-[#555555]">
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
                />
              </label>
              <label className="grid gap-1 text-xs text-[#555555]">
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
                />
              </label>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4">
        <h2 className="text-lg font-semibold">Config</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 text-xs text-[#555555]">
            Min Purchase Amount
            <input
              type="number"
              min={1}
              value={minPurchaseAmount}
              onChange={(e) => setMinPurchaseAmount(e.target.value)}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Referrer Reward
            <input
              type="number"
              min={1}
              value={referrerReward}
              onChange={(e) => setReferrerReward(e.target.value)}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Friend Reward
            <input
              type="number"
              min={1}
              value={friendReward}
              onChange={(e) => setFriendReward(e.target.value)}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Active
            <select
              value={active ? "true" : "false"}
              onChange={(e) => setActive(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Ambassador Program
            <select
              value={ambassadorEnabled ? "true" : "false"}
              onChange={(e) => setAmbassadorEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Referral Program
            <select
              value={referralProgramEnabled ? "true" : "false"}
              onChange={(e) => setReferralProgramEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Paid Royal Access
            <select
              value={paidAmbassadorEnabled ? "true" : "false"}
              onChange={(e) => setPaidAmbassadorEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Royal Access Price (INR)
            <input
              type="number"
              min={1}
              value={royalAccessPrice}
              onChange={(e) => setRoyalAccessPrice(e.target.value)}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Product Early Access Window
            <select
              value={earlyAccessLockHours}
              onChange={(e) => setEarlyAccessLockHours(e.target.value as "24" | "48" | "72")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="24">24 hours</option>
              <option value="48">48 hours</option>
              <option value="72">72 hours</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Royal Crown
            <select
              value={royalCrownEnabled ? "true" : "false"}
              onChange={(e) => setRoyalCrownEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Royal Access
            <select
              value={royalAccessEnabled ? "true" : "false"}
              onChange={(e) => setRoyalAccessEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Creator Program
            <select
              value={creatorProgramEnabled ? "true" : "false"}
              onChange={(e) => setCreatorProgramEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Leaderboard
            <select
              value={leaderboardEnabled ? "true" : "false"}
              onChange={(e) => setLeaderboardEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Vault
            <select
              value={vaultEnabled ? "true" : "false"}
              onChange={(e) => setVaultEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Early Drop
            <select
              value={earlyDropEnabled ? "true" : "false"}
              onChange={(e) => setEarlyDropEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Priority Checkout
            <select
              value={priorityCheckoutEnabled ? "true" : "false"}
              onChange={(e) => setPriorityCheckoutEnabled(e.target.value === "true")}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
        </div>
        {contentBlocks.length ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs uppercase tracking-[0.14em] text-[#555555]">Royal Content Blocks</p>
            {contentBlocks.map((block) => (
              <div key={block.key} className="grid gap-2 rounded-lg border border-black/10 bg-[#fafafa] p-3 md:grid-cols-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#444444]">{block.key}</div>
                <input
                  value={block.title}
                  onChange={(event) =>
                    setContentBlocks((prev) =>
                      prev.map((item) => (item.key === block.key ? { ...item, title: event.target.value } : item))
                    )
                  }
                  className="rounded-md border border-black/20 bg-white px-2 py-2 text-xs text-[#111111]"
                />
                <input
                  value={block.description}
                  onChange={(event) =>
                    setContentBlocks((prev) =>
                      prev.map((item) => (item.key === block.key ? { ...item, description: event.target.value } : item))
                    )
                  }
                  className="rounded-md border border-black/20 bg-white px-2 py-2 text-xs text-[#111111]"
                />
                <select
                  value={block.is_enabled ? "true" : "false"}
                  onChange={(event) =>
                    setContentBlocks((prev) =>
                      prev.map((item) => (item.key === block.key ? { ...item, is_enabled: event.target.value === "true" } : item))
                    )
                  }
                  className="rounded-md border border-black/20 bg-white px-2 py-2 text-xs text-[#111111]"
                >
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-4">
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Config"}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4">
        <h2 className="text-lg font-semibold">Discount Codes</h2>
        <p className="mt-1 text-xs text-[#666666]">Create checkout discount codes users can apply on payment page.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 text-xs text-[#555555]">
            Code
            <input
              value={discountForm.code}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
              placeholder="HOLI10"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Title
            <input
              value={discountForm.title}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, title: e.target.value }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
              placeholder="Holi Offer"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Type
            <select
              value={discountForm.discount_type}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, discount_type: e.target.value as "percentage" | "fixed" }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            >
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed INR</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Value
            <input
              type="number"
              min={1}
              value={discountForm.discount_value}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, discount_value: e.target.value }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Min Order INR
            <input
              type="number"
              min={0}
              value={discountForm.min_order_inr}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, min_order_inr: e.target.value }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Max Discount INR (optional)
            <input
              type="number"
              min={1}
              value={discountForm.max_discount_inr}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, max_discount_inr: e.target.value }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Total Usage Limit (optional)
            <input
              type="number"
              min={1}
              value={discountForm.total_usage_limit}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, total_usage_limit: e.target.value }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
          <label className="grid gap-1 text-xs text-[#555555]">
            Per User Limit
            <input
              type="number"
              min={1}
              value={discountForm.per_user_limit}
              onChange={(e) => setDiscountForm((prev) => ({ ...prev, per_user_limit: e.target.value }))}
              className="rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-[#111111]"
            />
          </label>
        </div>
        <div className="mt-3">
          <Button onClick={() => createDiscountMutation.mutate()} disabled={createDiscountMutation.isPending}>
            {createDiscountMutation.isPending ? "Creating..." : "Create Discount Code"}
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-black/10">
          <table className="min-w-full divide-y divide-black/10 text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.12em] text-[#555555]">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Min Order</th>
                <th className="px-3 py-2">Usage</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 bg-white">
              {(discountCodesQuery.data?.rows ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.code}</p>
                    <p className="text-xs text-[#666666]">{row.title ?? "-"}</p>
                  </td>
                  <td className="px-3 py-2">{row.discount_type}</td>
                  <td className="px-3 py-2">{row.discount_value}</td>
                  <td className="px-3 py-2">{row.min_order_inr}</td>
                  <td className="px-3 py-2">
                    {row.used_count}
                    {row.total_usage_limit ? ` / ${row.total_usage_limit}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="ghost"
                      onClick={() => toggleDiscountMutation.mutate({ id: row.id, active: !row.active })}
                      disabled={toggleDiscountMutation.isPending}
                    >
                      {row.active ? "Active" : "Inactive"}
                    </Button>
                  </td>
                </tr>
              ))}
              {!discountCodesQuery.isLoading && !(discountCodesQuery.data?.rows?.length ?? 0) ? (
                <tr>
                  <td className="px-3 py-3 text-[#666666]" colSpan={6}>
                    No discount codes created yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {message ? <p className="rounded-md border border-black/10 bg-[#f7f7f7] px-3 py-2 text-sm">{message}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-black/10">
        <table className="min-w-full divide-y divide-black/10 text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.12em] text-[#555555]">
            <tr>
              <th className="px-3 py-3">Referrer</th>
              <th className="px-3 py-3">Friend</th>
              <th className="px-3 py-3">Code</th>
              <th className="px-3 py-3">Purchase</th>
              <th className="px-3 py-3">Reward</th>
              <th className="px-3 py-3">Coupons</th>
              <th className="px-3 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/10 bg-white">
            {(overviewQuery.data?.referrals ?? []).map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-3">
                  <p className="font-medium">{row.referrer?.name ?? "N/A"}</p>
                  <p className="text-xs text-[#666666]">{row.referrer?.email ?? "-"}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="font-medium">{row.friend?.name ?? "N/A"}</p>
                  <p className="text-xs text-[#666666]">{row.friend?.email ?? "-"}</p>
                </td>
                <td className="px-3 py-3">{row.referral_code}</td>
                <td className="px-3 py-3">{row.purchase_amount ?? "-"}</td>
                <td className="px-3 py-3">{row.reward_given ? "Given" : "Pending"}</td>
                <td className="px-3 py-3 text-xs">
                  <p>{row.friend_coupon_code ?? "-"}</p>
                  <p>{row.referrer_coupon_code ?? "-"}</p>
                </td>
                <td className="px-3 py-3 text-[#444444]">{new Date(row.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-xs text-[#666666]">Elite profiles</p>
          <p className="mt-2 text-2xl font-semibold">{eliteOverviewQuery.data?.metrics.total_profiles ?? 0}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-xs text-[#666666]">Royal Crown unlocked</p>
          <p className="mt-2 text-2xl font-semibold">{eliteOverviewQuery.data?.metrics.royal_crown_unlocked ?? 0}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-xs text-[#666666]">Tier locked</p>
          <p className="mt-2 text-2xl font-semibold">{eliteOverviewQuery.data?.metrics.locked_profiles ?? 0}</p>
        </div>
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <p className="text-xs text-[#666666]">Suspicious logs</p>
          <p className="mt-2 text-2xl font-semibold">{eliteOverviewQuery.data?.metrics.suspicious_events ?? 0}</p>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4">
        <h2 className="text-lg font-semibold">Elite Tier Thresholds</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-black/10">
          <table className="min-w-full divide-y divide-black/10 text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.12em] text-[#555555]">
              <tr>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Required Valid Referrals</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 bg-white">
              {(eliteOverviewQuery.data?.tiers ?? []).map((tier) => (
                <tr key={tier.id}>
                  <td className="px-3 py-2">{tier.name}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      defaultValue={tier.required_valid_referrals}
                      id={`tier-threshold-${tier.id}`}
                      className="w-28 rounded-md border border-black/20 bg-white px-2 py-1 text-sm text-[#111111]"
                    />
                  </td>
                  <td className="px-3 py-2">{tier.is_active ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">
                    <Button
                      onClick={() => {
                        const input = document.getElementById(`tier-threshold-${tier.id}`) as HTMLInputElement | null;
                        const value = Number(input?.value ?? tier.required_valid_referrals);
                        updateTierMutation.mutate({
                          id: tier.id,
                          required_valid_referrals: Number.isFinite(value) ? value : tier.required_valid_referrals,
                          is_active: tier.is_active,
                        });
                      }}
                      disabled={updateTierMutation.isPending}
                    >
                      Save
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-black/10 bg-white p-4">
        <h2 className="text-lg font-semibold">Manual User Controls</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-black/10">
          <table className="min-w-full divide-y divide-black/10 text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.12em] text-[#555555]">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Valid Referrals</th>
                <th className="px-3 py-2">Current Tier</th>
                <th className="px-3 py-2">Promote/Demote</th>
                <th className="px-3 py-2">Lock</th>
                <th className="px-3 py-2">Royal Crown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 bg-white">
              {(eliteOverviewQuery.data?.progress ?? []).slice(0, 50).map((row: any) => (
                <tr key={row.user_id}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{(Array.isArray(row.user) ? row.user[0] : row.user)?.name ?? "User"}</p>
                    <p className="text-xs text-[#666666]">{(Array.isArray(row.user) ? row.user[0] : row.user)?.email ?? "-"}</p>
                  </td>
                  <td className="px-3 py-2">{row.valid_referral_count}</td>
                  <td className="px-3 py-2">{(Array.isArray(row.current_tier) ? row.current_tier[0] : row.current_tier)?.name ?? "Base"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        value={manualTierSelection[row.user_id] ?? row.current_tier_id ?? ""}
                        onChange={(event) =>
                          setManualTierSelection((prev) => ({
                            ...prev,
                            [row.user_id]: event.target.value,
                          }))
                        }
                        className="rounded-md border border-black/20 bg-white px-2 py-1 text-xs text-[#111111]"
                      >
                        <option value="">Base</option>
                        {(eliteOverviewQuery.data?.tiers ?? []).map((tier) => (
                          <option key={tier.id} value={tier.id}>
                            {tier.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          userTierMutation.mutate({
                            user_id: row.user_id,
                            current_tier_id: (manualTierSelection[row.user_id] ?? row.current_tier_id ?? "") || null,
                            highest_tier_id: (manualTierSelection[row.user_id] ?? row.current_tier_id ?? "") || null,
                          })
                        }
                        disabled={userTierMutation.isPending}
                      >
                        Apply
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="ghost"
                      onClick={() =>
                        userTierMutation.mutate({
                          user_id: row.user_id,
                          tier_locked: !row.tier_locked,
                        })
                      }
                      disabled={userTierMutation.isPending}
                    >
                      {row.tier_locked ? "Unlock" : "Lock"}
                    </Button>
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      onClick={() =>
                        userTierMutation.mutate({
                          user_id: row.user_id,
                          permanent_royal_crown: !row.permanent_royal_crown,
                        })
                      }
                      disabled={userTierMutation.isPending}
                    >
                      {row.permanent_royal_crown ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};

