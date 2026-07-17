import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { AppProvider } from "./context/AppContext";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/auth/LoginPage";
import { RegisterPage } from "./pages/auth/RegisterPage";

// Client pages
import { ClientDashboard } from "./pages/client/ClientDashboard";
import { InBodyModule } from "./pages/client/InBodyModule";
import { AIPlansPage } from "./pages/client/AIPlansPage";
import { ContractPage } from "./pages/client/ContractPage";
import { ChatPage } from "./pages/client/ChatPage";
import { BookingPage } from "./pages/client/BookingPage";
import { WorkoutLogPage } from "./pages/client/WorkoutLogPage";
import { NutritionPage } from "./pages/client/NutritionPage";
import { PTDiscoveryPage } from "./pages/client/PTDiscoveryPage";
import { AICoachPage } from "./pages/client/AICoachPage";
import { ProfilePage } from "./pages/client/ProfilePage";
import { PTApplicationPage } from "./pages/client/PTApplicationPage";
import { WalletPage } from "./pages/client/WalletPage";
import { PaymentResultPage } from "./pages/client/PaymentResultPage";
import { GymsPage } from "./pages/client/GymsPage";
import { GymDetailPage } from "./pages/client/GymDetailPage";
import { GymMembershipsPage } from "./pages/client/GymMembershipsPage";

// PT pages
import { PTDashboard } from "./pages/pt/PTDashboard";
import { PTClientList } from "./pages/pt/PTClientList";
import { PTClientDetail } from "./pages/pt/PTClientDetail";
import { PTContractsPage } from "./pages/pt/PTContractsPage";
import { PlanReviewPage } from "./pages/pt/PlanReviewPage";
import { PTSchedulePage } from "./pages/pt/PTSchedulePage";
import { PTProfilePage } from "./pages/pt/PTProfilePage";
import { PTWalletPage } from "./pages/pt/PTWalletPage";

// Gym owner pages
import { MyGymsPage } from "./pages/gym-owner/MyGymsPage";
import { GymManagePage } from "./pages/gym-owner/GymManagePage";

// Admin pages
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { UserManagement } from "./pages/admin/UserManagement";
import { PTManagement } from "./pages/admin/PTManagement";
import { SystemMonitoring } from "./pages/admin/SystemMonitoring";
import { AdminWorkflowStudio } from "./pages/admin/AdminWorkflowStudio";
import { AdminAIObservability } from "./pages/admin/AdminAIObservability";

import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
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
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to="/client/dashboard" replace /> },
          { path: "dashboard", Component: ClientDashboard },
          { path: "inbody", Component: InBodyModule },
          { path: "plans", Component: AIPlansPage },
          { path: "contracts", Component: ContractPage },
          { path: "chat", Component: ChatPage },
          { path: "booking", Component: BookingPage },
          { path: "workout", Component: WorkoutLogPage },
          { path: "nutrition", Component: NutritionPage },
          { path: "coaches", Component: PTDiscoveryPage },
          { path: "ai-coach", Component: AICoachPage },
          { path: "profile", Component: ProfilePage },
          { path: "pt-application", Component: PTApplicationPage },
          { path: "wallet", Component: WalletPage },
          { path: "payments/result", Component: PaymentResultPage },
          { path: "gyms", Component: GymsPage },
          { path: "gyms/:id", Component: GymDetailPage },
          { path: "gym-memberships", Component: GymMembershipsPage },
        ],
      },

      // ── PT workspace ─────────────────────────────────────────────────────
      {
        path: "pt",
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to="/pt/dashboard" replace /> },
          { path: "dashboard", Component: PTDashboard },
          { path: "clients", Component: PTClientList },
          { path: "clients/:id", Component: PTClientDetail },
          { path: "contracts", Component: PTContractsPage },
          { path: "plans", Component: PlanReviewPage },
          { path: "schedule", Component: PTSchedulePage },
          { path: "profile", Component: PTProfilePage },
          { path: "chat", Component: ChatPage },
          { path: "wallet", Component: PTWalletPage },
        ],
      },

      // ── Gym owner workspace ──────────────────────────────────────────────
      {
        path: "gym-owner",
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to="/gym-owner/gyms" replace /> },
          { path: "gyms", Component: MyGymsPage },
          { path: "gyms/:id", Component: GymManagePage },
        ],
      },

      // ── Admin workspace ──────────────────────────────────────────────────
      {
        path: "admin",
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to="/admin/dashboard" replace /> },
          { path: "dashboard", Component: AdminDashboard },
          { path: "users", Component: UserManagement },
          { path: "pts", Component: PTManagement },
          { path: "system", Component: SystemMonitoring },
          { path: "workflows", Component: AdminWorkflowStudio },
          { path: "ai-observability", Component: AdminAIObservability },
        ],
      },
    ],
  },
]);
