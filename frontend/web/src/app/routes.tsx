import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AppProvider } from "./context/AppContext";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";

// Client pages
import { ClientDashboard } from "./pages/client/ClientDashboard";
import { InBodyModule } from "./pages/client/InBodyModule";
import { NutritionPage } from "./pages/client/NutritionPage";
import { ProfilePage } from "./pages/client/ProfilePage";
import { OnboardingWizardPage } from "./pages/client/OnboardingWizardPage";
import { TrainingEquipmentSettingsPage } from "./pages/client/TrainingEquipmentSettingsPage";
import { PTApplicationPage } from "./pages/client/PTApplicationPage";
import { WalletPage } from "./pages/client/WalletPage";
import { PaymentResultPage } from "./pages/client/PaymentResultPage";
import { GymDetailPage } from "./pages/client/GymDetailPage";
import { ChatPage } from "./pages/client/ChatPage"; // reused directly by /pt/chat (trainer workspace)
// Merged tabbed pages — each combines two previously-separate nav entries
// under one sidebar item (see TabbedPage) to shorten the nav for mobile.
import { PlansPage } from "./pages/client/PlansPage";
import { TrainingPage } from "./pages/client/TrainingPage";
import { ServicesPage } from "./pages/client/ServicesPage";
import { ChatCoachPage } from "./pages/client/ChatCoachPage";
import { PersonalizedServiceOrderPage } from "./pages/client/PersonalizedServiceOrderPage";

// PT pages
import { PTDashboard } from "./pages/pt/PTDashboard";
import { PTClientList } from "./pages/pt/PTClientList";
import { PTClientDetail } from "./pages/pt/PTClientDetail";
import { PTContractsPage } from "./pages/pt/PTContractsPage";
import { PlanReviewPage } from "./pages/pt/PlanReviewPage";
import { PTSchedulePage } from "./pages/pt/PTSchedulePage";
import { PTProfilePage } from "./pages/pt/PTProfilePage";
import { PTWalletPage } from "./pages/pt/PTWalletPage";
import { PTServiceOrderPage } from "./pages/pt/PTServiceOrderPage";

// Gym owner pages
import { GymOwnerDashboard } from "./pages/gym-owner/GymOwnerDashboard";
import { MyGymsPage } from "./pages/gym-owner/MyGymsPage";
import { GymManagePage } from "./pages/gym-owner/GymManagePage";

// Admin pages
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { UserManagement } from "./pages/admin/UserManagement";
import { PTManagement } from "./pages/admin/PTManagement";
import { MarketplaceModeration } from "./pages/admin/MarketplaceModeration";
import { AdminExerciseReview } from "./pages/admin/AdminExerciseReview";
import { AdminCatalogQuality } from "./pages/admin/AdminCatalogQuality";
import { PTServiceRefunds } from "./pages/admin/PTServiceRefunds";
import { SystemMonitoring } from "./pages/admin/SystemMonitoring";
import { AdminWorkflowStudio } from "./pages/admin/AdminWorkflowStudio";
import { AdminAIObservability } from "./pages/admin/AdminAIObservability";
import { AdminDisputes } from "./pages/admin/AdminDisputes";
import { AdminWithdrawals } from "./pages/admin/AdminWithdrawals";

import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { RequireRole } from "./components/RequireRole";
import { RequireOnboarding } from "./components/RequireOnboarding";
import { CallProvider } from "./context/CallContext";
import { SocketProvider } from "./context/SocketContext";

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
            <Outlet />
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
      { index: true, element: <Navigate to="/login" replace /> },
      { path: "login", Component: LoginPage },
      { path: "register", Component: RegisterPage },

      // ── Client workspace ────────────────────────────────────────────────
      {
        path: "client",
        element: (
          <RequireOnboarding>
            <AppShell />
          </RequireOnboarding>
        ),
        children: [
          { index: true, element: <Navigate to="/client/dashboard" replace /> },
          { path: "onboarding", Component: OnboardingWizardPage },
          { path: "training-equipment", Component: TrainingEquipmentSettingsPage },
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
          { path: "workflows", Component: AdminWorkflowStudio },
          { path: "ai-observability", Component: AdminAIObservability },
        ],
      },
    ],
  },
]);
