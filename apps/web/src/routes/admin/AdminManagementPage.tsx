import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { supabase } from "@/lib/supabase";

const defaultPermissions = {
  can_manage_products: true,
  can_manage_orders: true,
  can_manage_users: true,
  can_refund: true,
  can_manage_festival: true,
  can_view_analytics: true,
};

export const AdminManagementPage = () => {
  const { user, profile, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [shippingFlatInput, setShippingFlatInput] = useState("");
  const [lowStockThresholdInput, setLowStockThresholdInput] = useState("5");
  const [reservationHoldInput, setReservationHoldInput] = useState("15");

  if (isLoading) {
    return <p className="text-sm text-white/70">Loading admin access...</p>;
  }

  if (!isSuperAdmin) {
    return <p className="text-sm text-white/70">Only super admin can manage admin roles and permissions.</p>;
  }

  const usersQuery = useQuery({
    queryKey: ["admin-management-users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("users").select("id,email,role").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const permissionsQuery = useQuery({
    queryKey: ["admin-permissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("admin_permissions").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const settingsQuery = useQuery({
    queryKey: ["platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("id,payment_gateway_enabled,shipping_flat_inr,low_stock_threshold,reservation_hold_minutes")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data?.shipping_flat_inr != null) {
        setShippingFlatInput(String((data.shipping_flat_inr ?? 0) / 100));
      }
      if (data?.low_stock_threshold != null) {
        setLowStockThresholdInput(String(data.low_stock_threshold));
      }
      if (data?.reservation_hold_minutes != null) {
        setReservationHoldInput(String(data.reservation_hold_minutes));
      }
      return data;
    },
  });

  const permissionMap = new Map((permissionsQuery.data ?? []).map((p) => [p.admin_id, p]));

  const setRole = async (userId: string, role: "user" | "admin") => {
    await supabase.from("users").update({ role }).eq("id", userId);
    if (role === "admin") {
      await supabase.from("admin_permissions").upsert({ admin_id: userId, ...defaultPermissions }, { onConflict: "admin_id" });
    }
    usersQuery.refetch();
    permissionsQuery.refetch();
  };

  const togglePermission = async (userId: string, field: keyof typeof defaultPermissions) => {
    const current = permissionMap.get(userId) ?? { admin_id: userId, ...defaultPermissions };
    await supabase.from("admin_permissions").upsert({ ...current, [field]: !current[field] }, { onConflict: "admin_id" });
    permissionsQuery.refetch();
  };

  const addAdminByEmail = async () => {
    setAdminMessage("");
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) {
      setAdminMessage("Please enter admin email.");
      return;
    }
    const { data: user, error } = await supabase
      .from("users")
      .select("id,email,role")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      setAdminMessage(error.message);
      return;
    }
    if (!user?.id) {
      setAdminMessage("User not found. Ask them to sign up first.");
      return;
    }
    if (user.role === "super_admin") {
      setAdminMessage("This email is already super admin.");
      return;
    }

    await setRole(user.id, "admin");
    setNewAdminEmail("");
    setAdminMessage(`Admin added: ${user.email}`);
  };

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">Admin Management</h1>
      <div className="rounded-xl border border-white/10 p-4">
        <p className="font-medium">Add Admin by Email</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={newAdminEmail}
            onChange={(event) => setNewAdminEmail(event.target.value)}
            placeholder="admin@email.com"
            className="min-w-64 rounded-lg border-white/20 bg-black/20 text-sm"
          />
          <Button onClick={addAdminByEmail}>Add Admin</Button>
        </div>
        {adminMessage ? <p className="mt-2 text-xs text-gold-200">{adminMessage}</p> : null}
      </div>
      <div className="rounded-xl border border-white/10 p-4">
        <p className="font-medium">Payment Gateway</p>
        <p className="mb-3 text-xs text-white/60">Global Razorpay switch and shipping controls.</p>
        <Button
          variant={settingsQuery.data?.payment_gateway_enabled ? "danger" : "gold"}
          onClick={async () => {
            const current = settingsQuery.data;
            if (current?.id) {
              await supabase
                .from("platform_settings")
                .update({ payment_gateway_enabled: !current.payment_gateway_enabled, updated_at: new Date().toISOString() })
                .eq("id", current.id);
            } else {
              await supabase.from("platform_settings").insert({
                payment_gateway_enabled: false,
                shipping_flat_inr: 9900,
                updated_at: new Date().toISOString(),
              });
            }
            settingsQuery.refetch();
          }}
        >
          {settingsQuery.data?.payment_gateway_enabled ? "Disable Payments" : "Enable Payments"}
        </Button>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={shippingFlatInput}
            onChange={(event) => setShippingFlatInput(event.target.value)}
            placeholder="Shipping charge INR"
            className="w-56 rounded-lg border-white/20 bg-black/20 text-sm"
          />
          <Button
            variant="ghost"
            onClick={async () => {
              const value = Math.round(Number(shippingFlatInput) * 100);
              if (!Number.isFinite(value) || value < 0) return;
              const current = settingsQuery.data;
              if (current?.id) {
                await supabase
                  .from("platform_settings")
                  .update({ shipping_flat_inr: value, updated_at: new Date().toISOString() })
                  .eq("id", current.id);
              } else {
                await supabase.from("platform_settings").insert({
                  payment_gateway_enabled: true,
                  shipping_flat_inr: value,
                  updated_at: new Date().toISOString(),
                });
              }
              settingsQuery.refetch();
            }}
          >
            Save Shipping Charge
          </Button>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <input
            value={lowStockThresholdInput}
            onChange={(event) => setLowStockThresholdInput(event.target.value)}
            placeholder="Low stock threshold"
            className="rounded-lg border-white/20 bg-black/20 text-sm"
          />
          <input
            value={reservationHoldInput}
            onChange={(event) => setReservationHoldInput(event.target.value)}
            placeholder="Reservation hold minutes"
            className="rounded-lg border-white/20 bg-black/20 text-sm"
          />
          <Button
            variant="ghost"
            onClick={async () => {
              const lowStockThreshold = Math.max(1, Math.min(20, Number(lowStockThresholdInput) || 5));
              const reservationHoldMinutes = Math.max(5, Math.min(60, Number(reservationHoldInput) || 15));
              const current = settingsQuery.data;
              if (current?.id) {
                await supabase
                  .from("platform_settings")
                  .update({
                    low_stock_threshold: lowStockThreshold,
                    reservation_hold_minutes: reservationHoldMinutes,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", current.id);
              } else {
                await supabase.from("platform_settings").insert({
                  payment_gateway_enabled: true,
                  shipping_flat_inr: 9900,
                  low_stock_threshold: lowStockThreshold,
                  reservation_hold_minutes: reservationHoldMinutes,
                  updated_at: new Date().toISOString(),
                });
              }
              settingsQuery.refetch();
            }}
          >
            Save Inventory Rules
          </Button>
        </div>
      </div>
      {(usersQuery.data ?? []).map((user) => {
        const perms = permissionMap.get(user.id) ?? defaultPermissions;
        return (
          <div key={user.id} className="rounded-xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{user.email}</p>
                <p className="text-xs text-white/60">Role: {user.role}</p>
              </div>
              {user.role === "user" ? (
                <Button onClick={() => setRole(user.id, "admin")}>Make Admin</Button>
              ) : user.role === "admin" ? (
                <Button variant="ghost" onClick={() => setRole(user.id, "user")}>Remove Admin</Button>
              ) : (
                <span className="text-xs text-gold-300">Super Admin</span>
              )}
            </div>
            {user.role === "admin" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.keys(defaultPermissions).map((key) => (
                  <Button
                    key={key}
                    variant={perms[key as keyof typeof defaultPermissions] ? "gold" : "ghost"}
                    className="text-xs"
                    onClick={() => togglePermission(user.id, key as keyof typeof defaultPermissions)}
                  >
                    {key.replace("can_", "").replaceAll("_", " ")}
                  </Button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
