import type { ReactNode } from "react";
import { Suspense, lazy } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { AdminRoute } from "@/components/guards/AdminRoute";
import { ProtectedRoute } from "@/components/guards/ProtectedRoute";
import { RouteErrorFallback } from "@/components/guards/RouteErrorFallback";
import { AppLayout, AdminLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/features/auth/AuthContext";

const HomePage = lazy(() => import("@/routes/HomePage").then((m) => ({ default: m.HomePage })));
const ProductsPage = lazy(() =>
  import("@/routes/ProductsPage").then((m) => ({ default: m.ProductsPage }))
);
const NewInPage = lazy(() => import("@/routes/NewInPage").then((m) => ({ default: m.NewInPage })));
const MenPage = lazy(() => import("@/routes/MenPage").then((m) => ({ default: m.MenPage })));
const WomenPage = lazy(() => import("@/routes/WomenPage").then((m) => ({ default: m.WomenPage })));
const CollectionsPage = lazy(() =>
  import("@/routes/CollectionsPage").then((m) => ({ default: m.CollectionsPage }))
);
const DropsPage = lazy(() => import("@/routes/DropsPage").then((m) => ({ default: m.DropsPage })));
const DropPage = lazy(() => import("@/routes/DropPage").then((m) => ({ default: m.DropPage })));
const ProductDetailPage = lazy(() =>
  import("@/routes/ProductDetailPage").then((m) => ({ default: m.ProductDetailPage }))
);
const CategoryPage = lazy(() =>
  import("@/routes/CategoryPage").then((m) => ({ default: m.CategoryPage }))
);
const AuthPage = lazy(() => import("@/routes/AuthPage").then((m) => ({ default: m.AuthPage })));
const CheckoutPage = lazy(() =>
  import("@/routes/CheckoutPage").then((m) => ({ default: m.CheckoutPage }))
);
const CartPage = lazy(() => import("@/routes/CartPage").then((m) => ({ default: m.CartPage })));
const OrdersPage = lazy(() => import("@/routes/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const ProfilePage = lazy(() => import("@/routes/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const WishlistPage = lazy(() =>
  import("@/routes/WishlistPage").then((m) => ({ default: m.WishlistPage }))
);
const CreatorsPage = lazy(() =>
  import("@/routes/CreatorsPage").then((m) => ({ default: m.CreatorsPage }))
);
const Earn500OffPage = lazy(() =>
  import("@/routes/Earn500OffPage").then((m) => ({ default: m.Earn500OffPage }))
);
const CreatorDashboardPage = lazy(() =>
  import("@/routes/CreatorDashboardPage").then((m) => ({ default: m.CreatorDashboardPage }))
);
const RoyalPage = lazy(() => import("@/routes/RoyalPage").then((m) => ({ default: m.RoyalPage })));

const AdminDashboardPage = lazy(() =>
  import("@/routes/admin/AdminDashboardPage").then((m) => ({ default: m.AdminDashboardPage }))
);
const AdminProductsPage = lazy(() =>
  import("@/routes/admin/AdminProductsPage").then((m) => ({ default: m.AdminProductsPage }))
);
const AdminOrdersPage = lazy(() =>
  import("@/routes/admin/AdminOrdersPage").then((m) => ({ default: m.AdminOrdersPage }))
);
const AdminRefundsPage = lazy(() =>
  import("@/routes/admin/AdminRefundsPage").then((m) => ({ default: m.AdminRefundsPage }))
);
const AdminReturnsPage = lazy(() =>
  import("@/routes/admin/AdminReturnsPage").then((m) => ({ default: m.AdminReturnsPage }))
);
const AdminFestivalPage = lazy(() =>
  import("@/routes/admin/AdminFestivalPage").then((m) => ({ default: m.AdminFestivalPage }))
);
const AdminBannersPage = lazy(() =>
  import("@/routes/admin/AdminBannersPage").then((m) => ({ default: m.AdminBannersPage }))
);
const AdminUsersPage = lazy(() =>
  import("@/routes/admin/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage }))
);
const AdminManagementPage = lazy(() =>
  import("@/routes/admin/AdminManagementPage").then((m) => ({ default: m.AdminManagementPage }))
);
const AdminSectionsPage = lazy(() =>
  import("@/routes/admin/AdminSectionsPage").then((m) => ({ default: m.AdminSectionsPage }))
);
const AdminCategoriesPage = lazy(() =>
  import("@/routes/admin/AdminCategoriesPage").then((m) => ({ default: m.AdminCategoriesPage }))
);
const AdminDropsPage = lazy(() =>
  import("@/routes/admin/AdminDropsPage").then((m) => ({ default: m.AdminDropsPage }))
);
const AdminHomeManagerPage = lazy(() =>
  import("@/routes/admin/AdminHomeManagerPage").then((m) => ({ default: m.AdminHomeManagerPage }))
);
const AdminSocialSubmissionsPage = lazy(() =>
  import("@/routes/admin/AdminSocialSubmissionsPage").then((m) => ({ default: m.AdminSocialSubmissionsPage }))
);
const AdminReferralPage = lazy(() =>
  import("@/routes/admin/AdminReferralPage").then((m) => ({ default: m.AdminReferralPage }))
);
const AdminCreatorAnalyticsPage = lazy(() =>
  import("@/routes/admin/AdminCreatorAnalyticsPage").then((m) => ({ default: m.AdminCreatorAnalyticsPage }))
);

const withAuth = (element: ReactNode) => <AuthProvider>{element}</AuthProvider>;

const withSuspense = (element: ReactNode) => (
  <Suspense fallback={<div className="py-10 text-center text-sm text-[#111111]">Loading...</div>}>{element}</Suspense>
);

export const router = createBrowserRouter([
  {
    path: "/",
    element: withAuth(<AppLayout />),
    errorElement: <RouteErrorFallback />,
    children: [
      { index: true, element: withSuspense(<HomePage />) },
      { path: "products", element: withSuspense(<ProductsPage />) },
      { path: "products/c/:categorySlug", element: withSuspense(<ProductsPage />) },
      { path: "new-in", element: withSuspense(<NewInPage />) },
      { path: "new-in/:categorySlug", element: withSuspense(<NewInPage />) },
      { path: "men", element: withSuspense(<MenPage />) },
      { path: "men/:categorySlug", element: withSuspense(<MenPage />) },
      { path: "women", element: withSuspense(<WomenPage />) },
      { path: "women/:categorySlug", element: withSuspense(<WomenPage />) },
      { path: "collections", element: withSuspense(<CollectionsPage />) },
      { path: "collections/:collectionSlug", element: withSuspense(<CollectionsPage />) },
      { path: "drops", element: withSuspense(<DropsPage />) },
      { path: "drops/:slug", element: withSuspense(<DropPage />) },
      { path: "category/:slug", element: withSuspense(<CategoryPage />) },
      { path: "products/:slug", element: withSuspense(<ProductDetailPage />) },
      { path: "creators", element: withSuspense(<CreatorsPage />) },
      { path: "creator-dashboard", element: withSuspense(<CreatorDashboardPage />) },
      { path: "royal", element: withSuspense(<RoyalPage />) },
      { path: "auth", element: withSuspense(<AuthPage />) },
      { path: "register", element: withSuspense(<AuthPage />) },
      { path: "earn-500-off", element: withSuspense(<Earn500OffPage />) },
      {
        element: <ProtectedRoute />,
        children: [
          { path: "cart", element: withSuspense(<CartPage />) },
          { path: "checkout", element: withSuspense(<CheckoutPage />) },
          { path: "orders", element: withSuspense(<OrdersPage />) },
          { path: "wishlist", element: withSuspense(<WishlistPage />) },
          { path: "profile", element: withSuspense(<ProfilePage />) },
          {
            path: "admin",
            element: <AdminRoute />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { index: true, element: <Navigate to="/admin/dashboard" replace /> },
                  { path: "dashboard", element: withSuspense(<AdminDashboardPage />) },
                  { path: "products", element: withSuspense(<AdminProductsPage />) },
                  { path: "orders", element: withSuspense(<AdminOrdersPage />) },
                  { path: "returns", element: withSuspense(<AdminReturnsPage />) },
                  { path: "refunds", element: withSuspense(<AdminRefundsPage />) },
                  { path: "festival", element: withSuspense(<AdminFestivalPage />) },
                  { path: "banners", element: withSuspense(<AdminBannersPage />) },
                  { path: "users", element: withSuspense(<AdminUsersPage />) },
                  { path: "sections", element: withSuspense(<AdminSectionsPage />) },
                  { path: "categories", element: withSuspense(<AdminCategoriesPage />) },
                  { path: "drops", element: withSuspense(<AdminDropsPage />) },
                  { path: "social-submissions", element: withSuspense(<AdminSocialSubmissionsPage />) },
                  { path: "referrals", element: withSuspense(<AdminReferralPage />) },
                  { path: "creator-analytics", element: withSuspense(<AdminCreatorAnalyticsPage />) },
                  { path: "home-manager", element: withSuspense(<AdminHomeManagerPage />) },
                  { path: "admins", element: withSuspense(<AdminManagementPage />) },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
