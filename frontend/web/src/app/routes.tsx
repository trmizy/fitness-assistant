import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { lazy, Suspense } from "react";
import { AppProvider } from "./context/AppContext";
import { AppShell } from "./components/layout/AppShell";
import { PageSkeleton } from "./components/layout/PageSkeleton";

/**
 * Vòng 4 / Phase D2 — every page below used to be a static import (61 of them at last count),
 * so visiting ANY single route pulled the entire app's JS into one bundle. Every page in this
 * codebase is a NAMED export (verified: `grep -rl "export default" src/app/pages/` returns
 * nothing), so the `.then(m => ({ default: m.X }))` mapping is uniform — lazy() itself only
 * accepts a component that resolves as a default export, which is why every line needs it.
 * The Suspense boundary that actually shows PageSkeleton while a chunk loads lives in
 * AppShell.tsx (scoped to the content area only, so Topbar/Sidebar/BottomNav never flash) and
 * in Root below (for the pre-login routes, which have no nav chrome to protect).
 */

// Auth pages
const LoginPage = lazy(() => import("./pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage").then((m) => ({ default: m.RegisterPage })));

// Client pages
const ClientDashboard = lazy(() => import("./pages/client/ClientDashboard").then((m) => ({ default: m.ClientDashboard })));
const InBodyModule = lazy(() => import("./pages/client/InBodyModule").then((m) => ({ default: m.InBodyModule })));
const NutritionPage = lazy(() => import("./pages/client/NutritionPage").then((m) => ({ default: m.NutritionPage })));
const ProfilePage = lazy(() => import("./pages/client/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const OnboardingWizardPage = lazy(() => import("./pages/client/OnboardingWizardPage").then((m) => ({ default: m.OnboardingWizardPage })));
const TrainingEquipmentSettingsPage = lazy(() => import("./pages/client/TrainingEquipmentSettingsPage").then((m) => ({ default: m.TrainingEquipmentSettingsPage })));
const PTApplicationPage = lazy(() => import("./pages/client/PTApplicationPage").then((m) => ({ default: m.PTApplicationPage })));
const WalletPage = lazy(() => import("./pages/client/WalletPage").then((m) => ({ default: m.WalletPage })));
const PaymentResultPage = lazy(() => import("./pages/client/PaymentResultPage").then((m) => ({ default: m.PaymentResultPage })));
const GymDetailPage = lazy(() => import("./pages/client/GymDetailPage").then((m) => ({ default: m.GymDetailPage })));
const ChatPage = lazy(() => import("./pages/client/ChatPage").then((m) => ({ default: m.ChatPage }))); // reused directly by /pt/chat (trainer workspace)
// Merged tabbed pages — each combines two previously-separate nav entries
// under one sidebar item (see TabbedPage) to shorten the nav for mobile.
const PlansPage = lazy(() => import("./pages/client/PlansPage").then((m) => ({ default: m.PlansPage })));
const TrainingPage = lazy(() => import("./pages/client/TrainingPage").then((m) => ({ default: m.TrainingPage })));
const ServicesPage = lazy(() => import("./pages/client/ServicesPage").then((m) => ({ default: m.ServicesPage })));
const ChatCoachPage = lazy(() => import("./pages/client/ChatCoachPage").then((m) => ({ default: m.ChatCoachPage })));
const PersonalizedServiceOrderPage = lazy(() => import("./pages/client/PersonalizedServiceOrderPage").then((m) => ({ default: m.PersonalizedServiceOrderPage })));
const ImportWorkoutsPage = lazy(() => import("./pages/client/ImportWorkoutsPage").then((m) => ({ default: m.ImportWorkoutsPage })));
const ExportDataPage = lazy(() => import("./pages/client/ExportDataPage").then((m) => ({ default: m.ExportDataPage })));
const TemplatesPage = lazy(() => import("./pages/client/TemplatesPage").then((m) => ({ default: m.TemplatesPage })));
const MuscleHeatmapPage = lazy(() => import("./pages/client/MuscleHeatmapPage").then((m) => ({ default: m.MuscleHeatmapPage })));
const ActivityHeatmapPage = lazy(() => import("./pages/client/ActivityHeatmapPage").then((m) => ({ default: m.ActivityHeatmapPage })));
const ExerciseProgressChartPage = lazy(() => import("./pages/client/ExerciseProgressChartPage").then((m) => ({ default: m.ExerciseProgressChartPage })));
const NotificationPreferencesPage = lazy(() => import("./pages/client/NotificationPreferencesPage").then((m) => ({ default: m.NotificationPreferencesPage })));

// PT pages
const PTDashboard = lazy(() => import("./pages/pt/PTDashboard").then((m) => ({ default: m.PTDashboard })));
const PTClientList = lazy(() => import("./pages/pt/PTClientList").then((m) => ({ default: m.PTClientList })));
const PTClientDetail = lazy(() => import("./pages/pt/PTClientDetail").then((m) => ({ default: m.PTClientDetail })));
const PTContractsPage = lazy(() => import("./pages/pt/PTContractsPage").then((m) => ({ default: m.PTContractsPage })));
const PlanReviewPage = lazy(() => import("./pages/pt/PlanReviewPage").then((m) => ({ default: m.PlanReviewPage })));
const PTSchedulePage = lazy(() => import("./pages/pt/PTSchedulePage").then((m) => ({ default: m.PTSchedulePage })));
const PTProfilePage = lazy(() => import("./pages/pt/PTProfilePage").then((m) => ({ default: m.PTProfilePage })));
const PTWalletPage = lazy(() => import("./pages/pt/PTWalletPage").then((m) => ({ default: m.PTWalletPage })));
const PTServiceOrderPage = lazy(() => import("./pages/pt/PTServiceOrderPage").then((m) => ({ default: m.PTServiceOrderPage })));

// Gym owner pages
const GymOwnerDashboard = lazy(() => import("./pages/gym-owner/GymOwnerDashboard").then((m) => ({ default: m.GymOwnerDashboard })));
const MyGymsPage = lazy(() => import("./pages/gym-owner/MyGymsPage").then((m) => ({ default: m.MyGymsPage })));
const GymManagePage = lazy(() => import("./pages/gym-owner/GymManagePage").then((m) => ({ default: m.GymManagePage })));

// Admin pages
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })));
const UserManagement = lazy(() => import("./pages/admin/UserManagement").then((m) => ({ default: m.UserManagement })));
const PTManagement = lazy(() => import("./pages/admin/PTManagement").then((m) => ({ default: m.PTManagement })));
const MarketplaceModeration = lazy(() => import("./pages/admin/MarketplaceModeration").then((m) => ({ default: m.MarketplaceModeration })));
const AdminExerciseReview = lazy(() => import("./pages/admin/AdminExerciseReview").then((m) => ({ default: m.AdminExerciseReview })));
const AdminCatalogQuality = lazy(() => import("./pages/admin/AdminCatalogQuality").then((m) => ({ default: m.AdminCatalogQuality })));
const PTServiceRefunds = lazy(() => import("./pages/admin/PTServiceRefunds").then((m) => ({ default: m.PTServiceRefunds })));
const SystemMonitoring = lazy(() => import("./pages/admin/SystemMonitoring").then((m) => ({ default: m.SystemMonitoring })));
const AdminWorkflowStudio = lazy(() => import("./pages/admin/AdminWorkflowStudio").then((m) => ({ default: m.AdminWorkflowStudio })));
const AdminAIObservability = lazy(() => import("./pages/admin/AdminAIObservability").then((m) => ({ default: m.AdminAIObservability })));
const AdminDisputes = lazy(() => import("./pages/admin/AdminDisputes").then((m) => ({ default: m.AdminDisputes })));
const AdminWithdrawals = lazy(() => import("./pages/admin/AdminWithdrawals").then((m) => ({ default: m.AdminWithdrawals })));
const AdminGymModeration = lazy(() => import("./pages/admin/AdminGymModeration").then((m) => ({ default: m.AdminGymModeration })));

import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { RequireRole } from "./components/RequireRole";
import { RequireOnboarding } from "./components/RequireOnboarding";
import { RootRedirect } from "./components/RootRedirect";
import { CallProvider } from "./context/CallContext";
import { SocketProvider } from "./context/SocketContext";
import { PwaUpdatePrompt } from "./pwa/PwaUpdatePrompt";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Avoid repeated retries for auth/client-side errors that only slow initial render.
      retry: (failureCount, error: any) => {
        const status = error?.response?.status;
        if (typeof status === "number" && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

/** Root layout — provides AppContext to the entire router tree */
function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <SocketProvider>
          <CallProvider>
            <Toaster position="top-center" expand={false} richColors />
            <PwaUpdatePrompt />
            {/* Vòng 4 / Phase D2 — /login and /register are lazy now too; Root has no nav
                chrome of its own (that only exists inside AppShell, per role), so wrapping the
                whole Outlet here is already "content area only". */}
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </CallProvider>
        </SocketProvider>
      </AppProvider>
    </QueryClientProvider>
  );
}

export const router = createBrowserRouter([
  {
    // Root wraps everything so AppProvider is always in context
    path: "/",
    Component: Root,
    errorElement: <RouteErrorBoundary />,
    children: [
      // Not a hard redirect to /login — see RootRedirect. The Capacitor WebView always
      // boots at "/", so this single line decided whether every app launch landed on the
      // login screen or in the app.
      { index: true, element: <RootRedirect /> },
      { path: "login", Component: LoginPage },
      { path: "register", Component: RegisterPage },

      // ── Client workspace ────────────────────────────────────────────────
      {
        path: "client",
        element: (
          // "Một tài khoản, nhiều vai trò": a PT keeps full access to their own
          // personal client-side experience (InBody, workouts, nutrition, ...) via the
          // activeView toggle already built into Sidebar/Topbar/BottomNav — this guard
          // must allow "pt" through too, or that toggle leads straight into this 403
          // regardless of activeView. RequireOnboarding already anticipated this (it
          // explicitly no-ops for any role !== "client"); this was the one guard that
          // hadn't been updated to match.
          <RequireRole allow={["client", "pt"]}>
            <RequireOnboarding>
              <AppShell />
            </RequireOnboarding>
          </RequireRole>
        ),
        children: [
          { index: true, element: <Navigate to="/client/dashboard" replace /> },
          { path: "onboarding", Component: OnboardingWizardPage },
          { path: "training-equipment", Component: TrainingEquipmentSettingsPage },
          { path: "import-workouts", Component: ImportWorkoutsPage },
          { path: "export-data", Component: ExportDataPage },
          { path: "templates", Component: TemplatesPage },
          { path: "muscle-heatmap", Component: MuscleHeatmapPage },
          { path: "activity-heatmap", Component: ActivityHeatmapPage },
          { path: "exercise-progress/:exerciseId", Component: ExerciseProgressChartPage },
          { path: "notification-preferences", Component: NotificationPreferencesPage },
          { path: "dashboard", Component: ClientDashboard },
          { path: "inbody", Component: InBodyModule },
          { path: "plans", Component: PlansPage },
          { path: "marketplace-orders/:id", Component: PersonalizedServiceOrderPage },
          { path: "services", Component: ServicesPage },
          { path: "contracts", Component: ServicesPage },
          { path: "chat", Component: ChatCoachPage },
          { path: "booking", Component: ServicesPage },
          { path: "workout", Component: TrainingPage },
          { path: "nutrition", Component: NutritionPage },
          { path: "coaches", Component: ServicesPage },
          { path: "ai-coach", Component: ChatCoachPage },
          { path: "profile", Component: ProfilePage },
          { path: "pt-application", Component: PTApplicationPage },
          { path: "wallet", Component: WalletPage },
          { path: "payments/result", Component: PaymentResultPage },
          { path: "gyms", Component: ServicesPage },
          { path: "gyms/:id", Component: GymDetailPage },
          { path: "gym-memberships", Component: ServicesPage },
        ],
      },

      // ── PT workspace ─────────────────────────────────────────────────────
      {
        path: "pt",
        element: (
          <RequireRole allow={["pt"]}>
            <AppShell />
          </RequireRole>
        ),
        children: [
          { index: true, element: <Navigate to="/pt/dashboard" replace /> },
          { path: "dashboard", Component: PTDashboard },
          { path: "clients", Component: PTClientList },
          { path: "clients/:id", Component: PTClientDetail },
          { path: "contracts", Component: PTContractsPage },
          { path: "plans", Component: PlanReviewPage },
          { path: "service-orders/:id", Component: PTServiceOrderPage },
          { path: "schedule", Component: PTSchedulePage },
          { path: "profile", Component: PTProfilePage },
          { path: "chat", Component: ChatPage },
          { path: "wallet", Component: PTWalletPage },
        ],
      },

      // ── Gym owner workspace ──────────────────────────────────────────────
      {
        path: "gym-owner",
        element: (
          <RequireRole allow={["gym_owner"]}>
            <AppShell />
          </RequireRole>
        ),
        children: [
          { index: true, element: <Navigate to="/gym-owner/dashboard" replace /> },
          { path: "dashboard", Component: GymOwnerDashboard },
          { path: "gyms", Component: MyGymsPage },
          { path: "gyms/:id", Component: GymManagePage },
        ],
      },

      // ── Admin workspace ──────────────────────────────────────────────────
      {
        path: "admin",
        element: (
          <RequireRole allow={["admin"]}>
            <AppShell />
          </RequireRole>
        ),
        children: [
          { index: true, element: <Navigate to="/admin/dashboard" replace /> },
          { path: "dashboard", Component: AdminDashboard },
          { path: "users", Component: UserManagement },
          { path: "pts", Component: PTManagement },
          { path: "marketplace", Component: MarketplaceModeration },
          { path: "exercise-review", Component: AdminExerciseReview },
          { path: "catalog-quality", Component: AdminCatalogQuality },
          { path: "pt-service-refunds", Component: PTServiceRefunds },
          { path: "system", Component: SystemMonitoring },
          { path: "disputes", Component: AdminDisputes },
          { path: "withdrawals", Component: AdminWithdrawals },
          { path: "gyms", Component: AdminGymModeration },
          { path: "workflows", Component: AdminWorkflowStudio },
          { path: "ai-observability", Component: AdminAIObservability },
        ],
      },
    ],
  },
]);
