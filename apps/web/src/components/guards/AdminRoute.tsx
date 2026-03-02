import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { isOwnerEmail } from "@/lib/admin";

export const AdminRoute = () => {
  const { user, profile, isLoading, refreshProfile } = useAuth();
  const [hasCheckedProfile, setHasCheckedProfile] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user || isLoading) {
      setHasCheckedProfile(false);
    } else if (!profile) {
      void refreshProfile().finally(() => {
        if (active) setHasCheckedProfile(true);
      });
    } else {
      setHasCheckedProfile(true);
    }

    return () => {
      active = false;
    };
  }, [user?.id, profile?.role, isLoading, refreshProfile]);

  if (isLoading) return <div className="p-10">Loading access policy...</div>;
  if (!user) return <Navigate to="/auth" replace />;

  const isOwner = isOwnerEmail(user.email);
  const hasAdminRole = profile?.role === "admin" || profile?.role === "super_admin";

  if (isOwner) {
    return <Outlet />;
  }

  if (!profile && !hasCheckedProfile) {
    return <div className="p-10">Verifying admin access...</div>;
  }

  if (!hasAdminRole) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};
