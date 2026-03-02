import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";
import { supabase } from "@/lib/supabase";

export const AdminUsersPage = () => {
  const [search, setSearch] = useState("");
  const { user, profile, permissions, hasPermission, isLoading } = useAuth();
  const isSuperAdmin = profile?.role === "super_admin" || isOwnerEmail(user?.email);
  const canManageUsers = isSuperAdmin || hasPermission("can_manage_users");

  if (isLoading) {
    return <p className="text-sm text-white/70">Loading user management access...</p>;
  }

  if (!canManageUsers && profile?.role === "admin" && permissions == null) {
    return <p className="text-sm text-white/70">Syncing admin permissions... please reopen users once.</p>;
  }

  if (!canManageUsers) {
    return <p className="text-sm text-white/70">You do not have user management access.</p>;
  }

  const query = useQuery({
    queryKey: ["admin-users"],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = (await Promise.race([
        supabase
          .from("users")
          .select("id, email, role, is_blocked, created_at")
          .order("created_at", { ascending: false }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Users request timeout")), 12000)),
      ])) as { data: any[] | null; error: any };
      const { data, error } = result;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filteredUsers = useMemo(() => {
    const rows = query.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((rowUser) => {
      const email = String(rowUser.email ?? "").toLowerCase();
      const role = String(rowUser.role ?? "").toLowerCase();
      const id = String(rowUser.id ?? "").toLowerCase();
      return email.includes(term) || role.includes(term) || id.includes(term);
    });
  }, [query.data, search]);

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-3xl text-gold-200">User Management</h1>
      <div className="space-y-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by email, role, or user ID..."
          className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/45 focus:border-gold-300/60 focus:outline-none"
        />
        {!query.isLoading && !query.isError ? (
          <p className="text-xs text-white/55">
            Showing {filteredUsers.length} of {(query.data ?? []).length} users
          </p>
        ) : null}
      </div>
      {query.isLoading ? <p className="text-sm text-white/70">Loading users...</p> : null}
      {query.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-rose-300">
            Could not load users: {(query.error as Error)?.message ?? "Unknown error"}
          </p>
          <p className="text-xs text-white/60">
            If you see timeout/500, run the latest Supabase migration for admin RLS function fix.
          </p>
        </div>
      ) : null}
      {!query.isLoading && !query.isError && !(filteredUsers ?? []).length ? (
        <p className="text-sm text-white/60">No users found.</p>
      ) : null}
      <div className="space-y-3">
        {filteredUsers.map((rowUser) => (
          <div key={rowUser.id} className="rounded-xl border border-white/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{rowUser.email}</p>
                <p className="text-xs uppercase text-white/60">Role: {rowUser.role}</p>
              </div>
              {isSuperAdmin || rowUser.role === "user" ? (
                <Button
                  variant={rowUser.is_blocked ? "ghost" : "danger"}
                  onClick={async () => {
                    await supabase.from("users").update({ is_blocked: !rowUser.is_blocked }).eq("id", rowUser.id);
                    query.refetch();
                  }}
                  disabled={rowUser.role === "super_admin"}
                >
                  {rowUser.role === "super_admin" ? "Protected" : rowUser.is_blocked ? "Unblock" : "Block"}
                </Button>
              ) : (
                <span className="text-xs text-white/50">No action</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
