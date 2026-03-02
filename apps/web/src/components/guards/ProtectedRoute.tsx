import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";

export const ProtectedRoute = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="p-10">Loading session...</div>;
  if (!user) return <Navigate to="/auth" replace />;

  return <Outlet />;
};
